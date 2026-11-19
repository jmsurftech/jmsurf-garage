import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Columns3, Download, Filter, KanbanSquare, List, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, Field, Modal, PageHeader, PageLoader, SearchBox, Toolbar } from "@/components/kit";
import Pager, { usePaged } from "@/components/Pager";
import { BulkBar, downloadCsv, Tick, useSelection } from "@/components/Bulk";
import { confirmAction } from "@/components/books/confirm";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenantId";
import { friendlyError } from "@/lib/friendlyError";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fieldText, FieldValue, useCrmRefresh, useLookups, useModuleRows } from "./fields";
import { isClosedStage, MODULES, ownerKey, sb, STAGES, type FieldDef, type ModuleDef, type ModuleKey } from "./modules";
import RecordForm from "./RecordForm";

type Rule = { field: string; op: "contains" | "is" | "isnt" | "empty" | "filled" | "gt" | "lt"; value?: string };
type View = { id: string; name: string; filters: Rule[]; columns?: string[] | null; sort?: string | null; system?: (r: any, me: string) => boolean };
const OPS: [Rule["op"], string][] = [["contains", "contains"], ["is", "is"], ["isnt", "is not"], ["empty", "is empty"], ["filled", "is not empty"], ["gt", "is more than / after"], ["lt", "is less than / before"]];

function systemViews(m: ModuleDef): View[] {
  const own = ownerKey(m);
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
  const monthStart = new Date().toISOString().slice(0, 8) + "01";
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const base: View[] = [
    { id: "all", name: `All ${m.plural.toLowerCase()}`, filters: [], system: m.key === "leads" ? (r) => !r.converted_contact_id : () => true },
    { id: "mine", name: `My ${m.plural.toLowerCase()}`, filters: [], system: (r, me) => r[own] === me && !r.converted_contact_id },
    { id: "new", name: "Added this week", filters: [], system: (r) => r.created_at >= weekAgo },
  ];
  if (m.key === "deals") base.splice(1, 0,
    { id: "open", name: "Open deals", filters: [], system: (r) => !isClosedStage(r.stage) },
    { id: "closing", name: "Closing this month", filters: [], system: (r) => !isClosedStage(r.stage) && !!r.closing_date && r.closing_date >= monthStart && r.closing_date <= monthEnd },
    { id: "overdue", name: "Past closing date", filters: [], system: (r) => !isClosedStage(r.stage) && !!r.closing_date && r.closing_date < new Date().toISOString().slice(0, 10) },
    { id: "won", name: "Won deals", filters: [], system: (r) => r.stage === "won" },
    { id: "lost", name: "Lost deals", filters: [], system: (r) => r.stage === "lost" });
  if (m.key === "leads") base.push(
    { id: "untouched", name: "Not contacted yet", filters: [], system: (r) => !r.converted_contact_id && (!r.lead_status || r.lead_status === "New") },
    { id: "hot", name: "Hot leads", filters: [], system: (r) => !r.converted_contact_id && r.rating === "Hot" },
    { id: "converted", name: "Converted leads", filters: [], system: (r) => !!r.converted_contact_id });
  if (m.key === "contacts") base.push({ id: "noaccount", name: "Without an account", filters: [], system: (r) => !r.account_id });
  if (m.key === "accounts") base.push(
    { id: "customers", name: "Customers", filters: [], system: (r) => (r.account_type || "Customer") === "Customer" },
    { id: "prospects", name: "Prospects", filters: [], system: (r) => r.account_type === "Prospect" },
    { id: "owing", name: "With a balance due", filters: [], system: (r) => Number(r.balance || 0) > 0 });
  return base;
}

function passes(f: FieldDef | undefined, r: any, rule: Rule, text: (f: FieldDef, r: any) => string) {
  if (!f) return true;
  const raw = r[f.key];
  const t = text(f, r).toLowerCase();
  const v = String(rule.value ?? "").toLowerCase().trim();
  switch (rule.op) {
    case "empty": return raw === null || raw === undefined || raw === "";
    case "filled": return !(raw === null || raw === undefined || raw === "");
    case "contains": return t.includes(v);
    case "is": return t === v || String(raw ?? "").toLowerCase() === v;
    case "isnt": return t !== v && String(raw ?? "").toLowerCase() !== v;
    case "gt": case "lt": {
      const a = ["money", "number", "percent"].includes(f.type) ? Number(raw || 0) : String(raw || "").slice(0, 10);
      const b = ["money", "number", "percent"].includes(f.type) ? Number(rule.value || 0) : String(rule.value || "");
      return rule.op === "gt" ? a > b : a < b;
    }
  }
}

export default function RecordList({ module }: { module: ModuleKey }) {
  const m = MODULES[module];
  const nav = useNavigate();
  const tenantId = useTenantId();
  const { user } = useAuth();
  const lk = useLookups();
  const refresh = useCrmRefresh();
  const [params, setParams] = useSearchParams();
  const { data: rows = [], isLoading } = useModuleRows(m);
  const { data: saved = [], refetch: refetchViews } = useQuery({
    queryKey: ["crm-hub-views", tenantId, m.key], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("crm_views").select("*").eq("tenant_id", tenantId).eq("module", m.key).order("name")).data || []) as View[],
  });
  const views = useMemo(() => [...systemViews(m), ...saved], [m, saved]);
  const viewId = params.get("view") || (m.key === "deals" ? "open" : "all");
  const view = views.find((v) => v.id === viewId) || views[0];
  const mode = m.board && params.get("mode") === "board" ? "board" : "list";
  const setParam = (k: string, v: string | null) => setParams((q) => { const n = new URLSearchParams(q); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });

  const defaultCols = m.fields.filter((f) => f.list).map((f) => f.key);
  const [cols, setCols] = useState<string[]>(defaultCols);
  const [rules, setRules] = useState<Rule[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(m.sortDefault);
  const [showFilters, setShowFilters] = useState(false);
  const [showCols, setShowCols] = useState(false);
  const [creating, setCreating] = useState(params.get("new") === "1");
  useEffect(() => {
    setRules(view?.filters || []);
    setCols(view?.columns?.length ? view.columns : defaultCols);
    if (view?.sort) { const [key, dir] = view.sort.split(":"); setSort({ key, asc: dir !== "desc" }); }
  }, [view?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const text = (f: FieldDef, r: any) => fieldText(f, r, lk);
  const shown = useMemo(() => {
    const me = user?.id || "";
    const q = search.trim().toLowerCase();
    const list = rows.filter((r: any) =>
      (!view?.system || view.system(r, me)) &&
      rules.every((rule) => passes(m.fields.find((f) => f.key === rule.field), r, rule, text)) &&
      (!q || m.search.some((k) => String(r[k] ?? "").toLowerCase().includes(q)) || (m.key === "contacts" && (lk.accountName.get(r.account_id) || "").toLowerCase().includes(q))));
    const f = m.fields.find((x) => x.key === sort.key);
    const val = (r: any) => (f && ["money", "number", "percent"].includes(f.type) ? Number(r[sort.key] || 0) : f ? text(f, r).toLowerCase() : String(r[sort.key] || ""));
    return [...list].sort((a, b) => { const x = val(a), y = val(b); if (x === y) return 0; if (x === "" || x === null) return 1; if (y === "" || y === null) return -1; return (x > y ? 1 : -1) * (sort.asc ? 1 : -1); });
  }, [rows, view, rules, search, sort, lk, user?.id, m]); // eslint-disable-line react-hooks/exhaustive-deps

  const paged = usePaged(shown, 50);
  const sel = useSelection(paged.pageRows.map((r: any) => r.id));
  const colDefs = cols.map((k) => m.fields.find((f) => f.key === k)).filter(Boolean) as FieldDef[];
  const total = m.board?.amount ? shown.reduce((a: number, r: any) => a + Number(r[m.board!.amount!] || 0), 0) : 0;

  const [naming, setNaming] = useState<string | null>(null);
  const saveView = async () => {
    const name = naming;
    setNaming(null);
    if (!name?.trim()) return;
    const { data, error } = await sb.from("crm_views").insert({ tenant_id: tenantId, module: m.key, name: name.trim(), filters: rules, columns: cols, sort: `${sort.key}:${sort.asc ? "asc" : "desc"}` }).select("id").single();
    if (error) return toast.error(friendlyError(error));
    await refetchViews(); setParam("view", data.id); toast.success("View saved");
  };
  const deleteView = async () => {
    if (!(await confirmAction({ title: `Delete the view "${view.name}"?`, confirmLabel: "Delete view", danger: true }))) return;
    await sb.from("crm_views").delete().eq("id", view.id); await refetchViews(); setParam("view", null);
  };
  const bulkUpdate = async (patch: Record<string, any>, label: string) => {
    const { error } = await sb.from(m.table).update(patch).in("id", sel.ids);
    if (error) return toast.error(friendlyError(error));
    toast.success(`${sel.count} ${m.plural.toLowerCase()} ${label}`); sel.clear(); refresh();
  };
  const bulkDelete = async () => {
    if (!(await confirmAction({ title: `Delete ${sel.count} ${m.plural.toLowerCase()}?`, message: "This cannot be undone.", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await sb.from(m.table).delete().in("id", sel.ids);
    if (error) return toast.error(m.key === "accounts" ? "Accounts with invoices, quotes or payments cannot be deleted." : friendlyError(error));
    toast.success("Deleted"); sel.clear(); refresh();
  };
  const exportCsv = () => downloadCsv(`${m.key}-${new Date().toISOString().slice(0, 10)}.csv`, m.fields.map((f) => f.label), shown.map((r: any) => m.fields.map((f) => text(f, r))));

  return (
    <div className="crm-ui space-y-4 p-4 sm:p-6">
      <PageHeader title={view?.name || m.plural} icon={m.icon}
        description={<span>{shown.length.toLocaleString()} {shown.length === 1 ? m.singular.toLowerCase() : m.plural.toLowerCase()}{total ? ` · ${formatKES(total)}` : ""}</span>}
        actions={<>
          {m.board && (
            <div className="inline-flex rounded-xl border border-border p-0.5">
              <button className={cn("rounded-lg px-2.5 py-1.5", mode === "list" && "bg-primary text-primary-foreground")} onClick={() => setParam("mode", null)} title="List"><List className="h-4 w-4" /></button>
              <button className={cn("rounded-lg px-2.5 py-1.5", mode === "board" && "bg-primary text-primary-foreground")} onClick={() => setParam("mode", "board")} title="Board"><KanbanSquare className="h-4 w-4" /></button>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!shown.length}><Download /> Export</Button>
          <Button size="sm" onClick={() => setCreating(true)}><Plus /> New {m.singular.toLowerCase()}</Button>
        </>} />

      <Toolbar>
        <select className="fi h-9 w-auto min-w-[180px]" value={view?.id} onChange={(e) => setParam("view", e.target.value)}>
          <optgroup label="Views">{systemViews(m).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</optgroup>
          {saved.length > 0 && <optgroup label="Saved views">{saved.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</optgroup>}
        </select>
        <SearchBox value={search} onChange={setSearch} placeholder={`Search ${m.plural.toLowerCase()}…`} />
        <Button variant={showFilters || rules.length ? "default" : "outline"} size="sm" onClick={() => setShowFilters((v) => !v)}><Filter /> Filter{rules.length ? ` (${rules.length})` : ""}</Button>
        {mode === "list" && <Button variant="outline" size="sm" onClick={() => setShowCols((v) => !v)}><Columns3 /> Columns</Button>}
        <Button variant="outline" size="sm" onClick={() => setNaming("")}><Save /> Save view</Button>
        {!view?.system && <Button variant="ghost" size="sm" onClick={deleteView}><Trash2 /> Delete view</Button>}
      </Toolbar>

      {showFilters && (
        <div className="space-y-2 rounded-2xl border border-border bg-card p-3">
          {rules.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select className="fi h-9 w-44" value={r.field} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>
                {m.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <select className="fi h-9 w-44" value={r.op} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, op: e.target.value as Rule["op"] } : x)))}>
                {OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {!["empty", "filled"].includes(r.op) && <input className="fi h-9 w-56" value={r.value || ""} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="Value" />}
              <button className="icon-btn" onClick={() => setRules(rules.filter((_, j) => j !== i))} title="Remove"><X className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setRules([...rules, { field: m.fields[0].key, op: "contains", value: "" }])}><Plus /> Add condition</Button>
            {rules.length > 0 && <Button variant="ghost" size="sm" onClick={() => setRules([])}>Clear</Button>}
          </div>
        </div>
      )}
      {showCols && mode === "list" && (
        <div className="flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-3">
          {m.fields.map((f) => (
            <label key={f.key} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs", cols.includes(f.key) ? "border-primary bg-primary/5 text-primary" : "border-border")}>
              <input type="checkbox" className="hidden" checked={cols.includes(f.key)} onChange={() => setCols(cols.includes(f.key) ? cols.filter((k) => k !== f.key) : [...cols, f.key])} />{f.label}
            </label>
          ))}
        </div>
      )}

      {isLoading ? <PageLoader /> : !shown.length ? (
        <EmptyState icon={m.icon} title={rows.length ? `No ${m.plural.toLowerCase()} in this view` : `No ${m.plural.toLowerCase()} yet`} action={<Button onClick={() => setCreating(true)}><Plus /> New {m.singular.toLowerCase()}</Button>} />
      ) : mode === "board" ? (
        <Board m={m} rows={shown} lk={lk} onMoved={refresh} />
      ) : (
        <>
          <BulkBar sel={sel} noun={m.singular.toLowerCase()}>
            <select className="fi h-8 w-48 text-sm" value="" onChange={(e) => e.target.value && bulkUpdate({ [ownerKey(m)]: e.target.value }, "reassigned")}>
              <option value="">Change owner…</option>{lk.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {m.board && (
              <select className="fi h-8 w-48 text-sm" value="" onChange={(e) => e.target.value && bulkUpdate({ [m.board!.field]: e.target.value }, "updated")}>
                <option value="">Move to…</option>{m.board.columns.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            )}
            <Button size="sm" variant="outline" className="text-destructive" onClick={bulkDelete}><Trash2 /> Delete</Button>
          </BulkBar>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="dt">
              <thead><tr>
                <th className="w-8"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} /></th>
                {colDefs.map((f) => (
                  <th key={f.key} className={cn("cursor-pointer select-none whitespace-nowrap", ["money", "number", "percent"].includes(f.type) && "text-right")} onClick={() => setSort({ key: f.key, asc: sort.key === f.key ? !sort.asc : true })}>
                    {f.label}{sort.key === f.key && (sort.asc ? <ArrowUp className="ml-1 inline h-3 w-3" /> : <ArrowDown className="ml-1 inline h-3 w-3" />)}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {paged.pageRows.map((r: any) => (
                  <tr key={r.id} className="cursor-pointer" onClick={() => nav(`/crm/${m.key}/${r.id}`)}>
                    <td onClick={(e) => e.stopPropagation()}><Tick on={sel.has(r.id)} onChange={() => sel.toggle(r.id)} /></td>
                    {colDefs.map((f, i) => (
                      <td key={f.key} className={cn("max-w-[260px] truncate", ["money", "number", "percent"].includes(f.type) && "text-right", i === 0 && "font-medium")}>
                        {i === 0 ? <span className="text-primary">{text(f, r) || m.title(r)}</span> : <FieldValue f={f} r={r} lk={lk} />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager {...paged.pager} />
        </>
      )}
      <RecordForm m={m} open={creating} onClose={() => setCreating(false)} onSaved={(row) => nav(`/crm/${m.key}/${row.id}`)} />
      <Modal open={naming !== null} onClose={() => setNaming(null)} size="sm" center icon={Save} title="Save this view"
        description="The filters, columns and sort you have now, under a name of your own."
        footer={<><Button variant="outline" onClick={() => setNaming(null)}>Cancel</Button><Button disabled={!naming?.trim()} onClick={saveView}>Save view</Button></>}>
        <Field label="View name" required><input className="fi" autoFocus value={naming || ""} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === "Enter" && naming?.trim() && void saveView()} /></Field>
      </Modal>
    </div>
  );
}

/** Columns by stage (deals) or status (leads); drag a card to another column to move it. */
function Board({ m, rows, lk, onMoved }: { m: ModuleDef; rows: any[]; lk: ReturnType<typeof useLookups>; onMoved: () => void }) {
  const nav = useNavigate();
  const b = m.board!;
  const [over, setOver] = useState<string | null>(null);
  const move = async (id: string, value: string) => {
    const r = rows.find((x) => x.id === id);
    if (!r || r[b.field] === value) return;
    const patch: any = { [b.field]: value, updated_at: new Date().toISOString() };
    // A deal moved to a stage takes that stage's probability; won or lost closes it.
    if (m.key === "deals") Object.assign(patch, { probability: STAGES.find((s) => s.key === value)?.p ?? r.probability, closed_at: isClosedStage(value) ? new Date().toISOString() : null });
    const { error } = await sb.from(m.table).update(patch).eq("id", id);
    if (error) return toast.error(friendlyError(error));
    onMoved();
  };
  const columns = b.columns;
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {columns.map((c) => {
        const list = rows.filter((r) => (r[b.field] || (m.key === "leads" ? "New" : "")) === c.value);
        const sum = b.amount ? list.reduce((a, r) => a + Number(r[b.amount!] || 0), 0) : 0;
        return (
          <div key={c.value} onDragOver={(e) => { e.preventDefault(); setOver(c.value); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); void move(e.dataTransfer.getData("text/plain"), c.value); }}
            className={cn("flex w-72 shrink-0 flex-col rounded-2xl border bg-muted/30 transition-colors", over === c.value ? "border-primary bg-primary/5" : "border-border")}>
            <div className="border-b border-border px-3 py-2.5">
              <p className="flex items-center justify-between text-sm font-semibold"><span>{c.label}</span><span className="text-xs text-muted-foreground">{list.length}</span></p>
              {b.amount && <p className="text-xs tabular-nums text-muted-foreground">{formatKES(sum)}</p>}
            </div>
            <div className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto p-2">
              {list.map((r) => (
                <button key={r.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)} onClick={() => nav(`/crm/${m.key}/${r.id}`)}
                  className="rounded-xl border border-border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md">
                  <p className="truncate text-sm font-semibold">{m.title(r)}</p>
                  {m.key === "deals" ? <p className="truncate text-xs text-muted-foreground">{lk.accountName.get(r.customer_id) || r.account_name || "—"}</p> : <p className="truncate text-xs text-muted-foreground">{m.subtitle(r) || r.email || r.phone || "—"}</p>}
                  <div className="mt-2 flex items-center justify-between text-xs">
                    {b.amount ? <span className="font-semibold tabular-nums">{formatKES(Number(r[b.amount] || 0))}</span> : <span />}
                    <span className="text-muted-foreground">{m.key === "deals" ? (r.closing_date ? String(r.closing_date).slice(0, 10) : "") : lk.userName.get(r[ownerKey(m)]) || ""}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
