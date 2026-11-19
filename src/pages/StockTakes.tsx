import { useEffect, useMemo, useRef, useState } from "react";
import { useUnsavedGuard } from "@/lib/unsaved";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Plus, ScanBarcode, CheckCircle2, ArrowLeft, Save, XCircle, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenantId";
import { useLocations } from "@/hooks/useData";
import { useInventorySettings } from "@/hooks/useInventorySettings";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import { PagedRows } from "@/components/Pager";
import { PageHeader, Panel, TableWrap, EmptyState, Field, Modal, StatTile, StatGrid, Toolbar, SearchBox, Segmented, StatusPill, PageLoader } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const sb: any = supabase;

export default function StockTakes() {
  const tenantId = useTenantId();
  const { role } = useAuth();
  const canCount = ["admin", "manager", "stock_manager", "super_admin"].includes(String(role));
  const { data: locations = [] } = useLocations();
  const { data: inv } = useInventorySettings();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ location: "", name: "", category: "" });
  const [starting, setStarting] = useState(false);

  const { data: counts = [], isLoading } = useQuery({
    queryKey: ["stock-counts", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await sb.from("stock_counts").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  const start = async () => {
    setStarting(true);
    const { data, error } = await sb.rpc("start_stock_count", { p_location: form.location || locations[0]?.id, p_name: form.name, p_category: form.category || null });
    setStarting(false);
    if (error) { toast({ title: "Could not start", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["stock-counts"] });
    setShowNew(false);
    setOpenId(data);
  };

  if (openId) return <CountSheet id={openId} onBack={() => { setOpenId(null); qc.invalidateQueries({ queryKey: ["stock-counts"] }); }} />;
  if (isLoading) return <PageLoader label="Loading stock-takes…" />;

  const locName = (id: string) => locations.find((l: any) => l.id === id)?.name || "Branch";
  const open = counts.filter((c: any) => c.status === "counting");

  return (
    <div className="space-y-5">
      <PageHeader title="Stock-take" icon={ClipboardCheck} description="Count what is really on the shelves and correct the system in one go."
        actions={canCount && <Button onClick={() => { setForm({ location: locations[0]?.id || "", name: "", category: "" }); setShowNew(true); }}><Plus /> New stock-take</Button>} />

      {!canCount && <Panel><p className="text-sm text-muted-foreground">Only a manager, stock manager or the owner can do stock-takes.</p></Panel>}

      <StatGrid className="lg:grid-cols-3">
        <StatTile label="In progress" value={open.length} icon={ClipboardCheck} tone="warning" />
        <StatTile label="Completed" value={counts.filter((c: any) => c.status === "completed").length} icon={CheckCircle2} tone="success" />
        <StatTile label="Last finished" value={counts.find((c: any) => c.status === "completed") ? format(new Date(counts.find((c: any) => c.status === "completed").completed_at), "d MMM yyyy") : "—"} icon={ClipboardCheck} tone="muted" className="col-span-2 lg:col-span-1" />
      </StatGrid>

      <Panel flush>
        {counts.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No stock-takes yet" description="Start one at the end of the day or month to find missing or extra stock."
            action={canCount ? <Button onClick={() => setShowNew(true)}><Plus /> New stock-take</Button> : undefined} />
        ) : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Stock-take</th><th>Branch</th><th className="hidden md:table-cell">Started</th><th>Status</th><th className="text-right">Open</th></tr></thead>
              <tbody>
                <PagedRows rows={counts} colSpan={5}>{(rows) => rows.map((c: any) => (
                  <tr key={c.id} className="cursor-pointer" onClick={() => setOpenId(c.id)}>
                    <td><p className="font-medium">{c.name}</p>{c.category && <p className="text-xs text-muted-foreground">{c.category} only</p>}</td>
                    <td className="text-muted-foreground">{locName(c.location_id)}</td>
                    <td className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{format(new Date(c.created_at), "d MMM, HH:mm")}{c.created_by_name ? ` · ${c.created_by_name}` : ""}</td>
                    <td><StatusPill status={c.status === "counting" ? "open" : c.status} /></td>
                    <td className="text-right"><Button size="sm" variant={c.status === "counting" ? "default" : "outline"}>{c.status === "counting" ? "Continue" : "View"}</Button></td>
                  </tr>
                ))}</PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      <Modal open={showNew} onClose={() => setShowNew(false)} icon={ClipboardCheck} title="New stock-take"
        description="The system notes what it expects now. You then type what you count."
        footer={<>
          <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
          <Button onClick={start} disabled={starting || !(form.location || locations[0])}>{starting ? "Preparing…" : "Start counting"}</Button>
        </>}>
        <div className="grid gap-4">
          <Field label="Branch">
            <select className="fi" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}>
              {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Name" hint="Optional — e.g. Month end September"><input className="fi" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Only count one category" hint="Leave empty to count everything">
            <select className="fi" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">Everything</option>
              {(inv?.categories || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function CountSheet({ id, onBack }: { id: string; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "todo" | "diff">("all");
  const [search, setSearch] = useState("");
  const [scan, setScan] = useState("");
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["stock-count", id],
    queryFn: async () => {
      const [{ data: count }, { data: lines }] = await Promise.all([
        sb.from("stock_counts").select("*").eq("id", id).maybeSingle(),
        sb.from("stock_count_lines").select("*").eq("count_id", id).order("name"),
      ]);
      return { count, lines: (lines || []) as any[] };
    },
  });
  const count = data?.count;
  const lines = data?.lines || [];
  const editable = count?.status === "counting";

  const valueOf = (l: any): number | null => {
    const e = edits[l.id];
    if (e !== undefined) return e === "" ? null : Number(e);
    return l.counted == null ? null : Number(l.counted);
  };
  const dirty = Object.keys(edits).length > 0;
  // Warn before leaving with counts that are not saved yet, and save them when the tab is hidden.
  useUnsavedGuard(dirty && editable, "Some counts are not saved yet. Leave without saving them?");
  useEffect(() => {
    if (!dirty || !editable) return;
    const onHide = () => { if (document.visibilityState === "hidden") void save(true); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, editable]);

  // Save counts every few seconds while typing.
  useEffect(() => {
    if (!dirty || !editable) return;
    const t = setTimeout(() => { void save(true); }, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits]);

  const save = async (quiet = false) => {
    if (!dirty) return true;
    setSaving(true);
    const payload = Object.entries(edits).map(([lineId, v]) => ({ id: lineId, counted: v === "" ? null : Number(v) }));
    const { error } = await sb.rpc("save_stock_count", { p_count: id, p_lines: payload });
    setSaving(false);
    if (error) { toast({ title: "Counts not saved", description: error.message, variant: "destructive" }); return false; }
    await refetch();
    setEdits({});
    if (!quiet) toast({ title: "Counts saved" });
    return true;
  };

  const onScan = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scan.trim();
    if (!code) return;
    const hit = lines.find((l) => (l.barcode || "") === code);
    if (!hit) { toast({ title: "Not on this count", description: code, variant: "destructive" }); setScan(""); return; }
    setEdits((prev) => ({ ...prev, [hit.id]: String((valueOf(hit) ?? 0) + 1) }));
    setScan("");
    setSearch(hit.name);
    toast({ title: `${hit.name}: ${(valueOf(hit) ?? 0) + 1}` });
  };

  const stats = useMemo(() => {
    let counted = 0, diffLines = 0, units = 0, value = 0;
    lines.forEach((l) => {
      const v = valueOf(l);
      if (v == null) return;
      counted++;
      const d = v - Number(l.expected);
      if (Math.abs(d) > 0.0001) { diffLines++; units += d; value += d * Number(l.unit_cost || 0); }
    });
    return { counted, diffLines, units, value };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, edits]);

  const shown = lines.filter((l) => {
    const v = valueOf(l);
    if (filter === "todo" && v != null) return false;
    if (filter === "diff" && (v == null || Math.abs(v - Number(l.expected)) < 0.0001)) return false;
    const q = search.trim().toLowerCase();
    return !q || `${l.name} ${l.barcode || ""} ${l.category || ""}`.toLowerCase().includes(q);
  });

  const finish = async () => {
    if (!(await save(true))) return;
    setFinishing(true);
    const { data: res, error } = await sb.rpc("finish_stock_count", { p_count: id });
    setFinishing(false);
    if (error) { toast({ title: "Could not finish", description: error.message, variant: "destructive" }); return; }
    ["product-stocks", "products", "product-variants", "stock-adjustments"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    setReview(false);
    await refetch();
    toast({ title: "Stock-take finished", description: `${res.changed} item${res.changed === 1 ? "" : "s"} corrected · ${res.units > 0 ? "+" : ""}${res.units} units · ${formatKES(res.value)}` });
  };

  const cancel = async () => {
    const { error } = await sb.rpc("cancel_stock_count", { p_count: id });
    if (error) { toast({ title: "Could not cancel", description: error.message, variant: "destructive" }); return; }
    setConfirmCancel(false);
    onBack();
  };

  if (isLoading || !count) return <PageLoader label="Opening stock-take…" />;
  const pct = lines.length ? Math.round((stats.counted / lines.length) * 100) : 0;

  return (
    <div className="space-y-5 pb-24">
      <PageHeader title={count.name} icon={ClipboardCheck}
        description={<>{count.category ? `${count.category} · ` : ""}{lines.length} items · started {format(new Date(count.created_at), "d MMM, HH:mm")}</>}
        actions={<>
          <Button variant="outline" onClick={async () => { if (await save(true)) onBack(); }}><ArrowLeft /> All stock-takes</Button>
          {editable && <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmCancel(true)}><XCircle /> Cancel</Button>}
        </>} />

      {!editable && <div className="rounded-2xl border border-border bg-muted/50 p-4 text-sm"><StatusPill status={count.status} /> <span className="ml-2">{count.status === "completed" ? `Finished ${format(new Date(count.completed_at), "d MMM yyyy, HH:mm")}${count.completed_by_name ? ` by ${count.completed_by_name}` : ""}. Stock was corrected.` : "This stock-take was cancelled; stock was not changed."}</span></div>}

      <StatGrid>
        <StatTile label="Counted" value={`${stats.counted} / ${lines.length}`} icon={ClipboardCheck} tone="primary" hint={`${pct}% done`} />
        <StatTile label="Differences" value={stats.diffLines} icon={AlertTriangle} tone={stats.diffLines ? "warning" : "muted"} />
        <StatTile label="Units +/-" value={`${stats.units > 0 ? "+" : ""}${stats.units}`} icon={ClipboardCheck} tone={stats.units < 0 ? "danger" : "success"} />
        <StatTile label="Value +/-" value={formatKES(stats.value)} icon={ClipboardCheck} tone={stats.value < 0 ? "danger" : "success"} hint="At cost price" />
      </StatGrid>
      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>

      <Toolbar>
        {editable && (
          <form onSubmit={onScan} className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input ref={scanRef} value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Scan a barcode to add 1" className="fi pl-9" />
          </form>
        )}
        <SearchBox value={search} onChange={setSearch} placeholder="Find an item…" />
        <Segmented value={filter} onChange={(v) => setFilter(v as any)} options={[
          { value: "all", label: "All", count: lines.length },
          { value: "todo", label: "Not counted", count: lines.length - stats.counted },
          { value: "diff", label: "Differences", count: stats.diffLines },
        ]} />
      </Toolbar>

      <Panel flush>
        {shown.length === 0 ? <EmptyState icon={ClipboardCheck} title="Nothing here" className="py-10" /> : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Item</th><th className="num">System</th><th className="text-center">Counted</th><th className="num">Difference</th></tr></thead>
              <tbody>
                <PagedRows rows={shown} colSpan={4} pageSize={50}>{(rows) => rows.map((l: any) => {
                  const v = valueOf(l);
                  const d = v == null ? null : v - Number(l.expected);
                  return (
                    <tr key={l.id} className={cn(d != null && Math.abs(d) > 0.0001 && "bg-warning/5")}>
                      <td><p className="font-medium">{l.name}</p><p className="text-xs text-muted-foreground">{[l.category, l.barcode].filter(Boolean).join(" · ")}</p></td>
                      <td className="num text-muted-foreground">{Number(l.expected)}</td>
                      <td className="text-center">
                        {editable ? (
                          <input type="number" min={0} inputMode="decimal" value={edits[l.id] ?? (l.counted ?? "")}
                            onChange={(e) => setEdits((p) => ({ ...p, [l.id]: e.target.value }))}
                            className="fi mx-auto h-9 w-24 text-center font-semibold" aria-label={`Counted ${l.name}`} />
                        ) : <span className="font-semibold">{v ?? "—"}</span>}
                      </td>
                      <td className={cn("num font-semibold", d == null ? "text-muted-foreground" : d > 0 ? "text-success" : d < 0 ? "text-destructive" : "")}>
                        {d == null ? "—" : d === 0 ? "✓" : `${d > 0 ? "+" : ""}${d}`}
                      </td>
                    </tr>
                  );
                })}</PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      {editable && (
        <div className="fixed inset-x-3 bottom-[104px] md:bottom-20 z-40 mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-2xl md:bottom-4">
          <p className="min-w-0 flex-1 text-sm">{saving ? "Saving…" : dirty ? "Unsaved changes" : "All counts saved"} · {stats.counted}/{lines.length} counted</p>
          <Button variant="outline" size="sm" onClick={() => save()} disabled={!dirty || saving}><Save /> Save</Button>
          <Button onClick={() => setReview(true)} disabled={stats.counted === 0}><CheckCircle2 /> Finish</Button>
        </div>
      )}

      <Modal open={review} onClose={() => setReview(false)} locked={finishing} icon={CheckCircle2} title="Finish and correct stock?"
        description="Stock is moved by the difference you counted. Items you didn't count stay as they are."
        footer={<>
          <Button variant="outline" onClick={() => setReview(false)} disabled={finishing}>Keep counting</Button>
          <Button onClick={finish} disabled={finishing}>{finishing ? "Correcting stock…" : "Finish stock-take"}</Button>
        </>}>
        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Items counted</p><p className="font-display text-xl font-bold">{stats.counted}/{lines.length}</p></div>
          <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">With a difference</p><p className="font-display text-xl font-bold">{stats.diffLines}</p></div>
          <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Units</p><p className={cn("font-display text-xl font-bold", stats.units < 0 ? "text-destructive" : "text-success")}>{stats.units > 0 ? "+" : ""}{stats.units}</p></div>
          <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Value at cost</p><p className={cn("font-display text-xl font-bold", stats.value < 0 ? "text-destructive" : "text-success")}>{formatKES(stats.value)}</p></div>
        </div>
        {stats.counted < lines.length && <p className="mt-3 text-xs text-muted-foreground">{lines.length - stats.counted} items were not counted and will not change.</p>}
      </Modal>

      <Modal open={confirmCancel} onClose={() => setConfirmCancel(false)} size="sm" icon={XCircle} title="Cancel this stock-take?"
        description="Counts are thrown away and stock is not changed."
        footer={<>
          <Button variant="outline" onClick={() => setConfirmCancel(false)}>Keep it</Button>
          <Button variant="destructive" onClick={cancel}>Cancel stock-take</Button>
        </>} />
    </div>
  );
}
