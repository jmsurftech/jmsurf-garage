import { useEffect, useMemo, useState } from "react";
import { erpApi } from "@/lib/erpApi";
import { ShieldCheck } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal, Plus, Search, Trash2, Save, CheckCircle2, Pencil, Printer, Paperclip, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, Pill } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import Pager, { usePaged } from "@/components/Pager";
import { useSelection, BulkBar, Tick, downloadCsv } from "@/components/Bulk";
import { confirmAction } from "@/components/books/confirm";
import { uploadDocument, openDocument } from "@/components/DocumentsPanel";
import { useUnsavedGuard } from "@/lib/unsaved";
import { fmtDate } from "@/lib/doc-pdf";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

const sb: any = supabase;
export const ADJ_REASONS = ["Stocktaking results", "Damaged goods", "Stolen goods", "Expired goods", "Stock written off", "Opening stock", "Free samples / giveaways", "Returned to stock", "Inventory revaluation"];
const ACCOUNTS = ["Cost of Goods Sold", "Inventory Asset", "Stock Write-off", "Shrinkage", "Opening Balance Adjustments"];
const today = () => new Date().toISOString().slice(0, 10);

type Line = { product_id: string; name: string; sku?: string | null; unit?: string | null; cost: number; qty_available: number; new_qty: number | ""; qty_adjusted: number | ""; current_value: number; new_value: number | ""; value_adjusted: number | "" };

function useAdjustments() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["inv-adjustments", tenantId], enabled: !!tenantId,
    queryFn: async () => (await sb.from("inventory_adjustments").select("*, locations(name)").eq("tenant_id", tenantId).order("adjustment_date", { ascending: false }).order("created_at", { ascending: false }).limit(2000)).data || [],
  });
}

/** Inventory adjustments list: quantity and value adjustments, drafts and applied ones. */
export default function Adjustments() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: list = [], isLoading } = useAdjustments();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "draft" | "adjusted">("all");
  const [mode, setMode] = useState<"all" | "quantity" | "value">("all");
  const rows = useMemo(() => (list as any[]).filter((a) =>
    (status === "all" || a.status === status) && (mode === "all" || a.mode === mode) &&
    (!q.trim() || `${a.adjustment_number} ${a.reason} ${a.reference || ""} ${a.description || ""} ${(a.lines || []).map((l: any) => l.name).join(" ")}`.toLowerCase().includes(q.trim().toLowerCase()))), [list, q, status, mode]);
  const paged = usePaged(rows, 25);
  const sel = useSelection(paged.rows.map((r: any) => r.id));
  const open = id ? (list as any[]).find((a) => a.id === id) : null;

  const removeDrafts = async () => {
    const drafts = (list as any[]).filter((a) => sel.has(a.id) && a.status === "draft");
    if (!drafts.length) return toast({ title: "Only drafts can be deleted", description: "Applied adjustments stay for the stock history.", variant: "destructive" });
    if (!(await confirmAction({ title: `Delete ${drafts.length} draft${drafts.length === 1 ? "" : "s"}?`, danger: true, confirmLabel: "Delete" }))) return;
    await sb.from("inventory_adjustments").delete().in("id", drafts.map((d) => d.id));
    sel.clear(); qc.invalidateQueries({ queryKey: ["inv-adjustments"] }); toast({ title: "Drafts deleted" });
  };
  const applyMany = async () => {
    const drafts = (list as any[]).filter((a) => sel.has(a.id) && a.status === "draft");
    if (!drafts.length) return toast({ title: "Pick draft adjustments to apply", variant: "destructive" });
    if (!(await confirmAction({ title: `Apply ${drafts.length} adjustment${drafts.length === 1 ? "" : "s"}?`, message: "Stock and values change straight away." }))) return;
    let ok = 0;
    for (const d of drafts) { const { error } = await sb.rpc("apply_inventory_adjustment", { p_id: d.id }); if (error) toast({ title: `${d.adjustment_number} not applied`, description: error.message, variant: "destructive" }); else ok++; }
    sel.clear(); ["inv-adjustments", "zitems", "products"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); if (ok) toast({ title: `${ok} applied` });
  };

  if (isLoading) return <OrbLoader label="Loading adjustments…" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Inventory Adjustments" icon={SlidersHorizontal} description="Correct stock counts or item values: damaged, stolen, expired, stock-take results and revaluations."
        actions={<Button onClick={() => navigate("/inventory/adjustments/new")}><Plus /> New adjustment</Button>} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className="fi pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, reason, item…" />
        </div>
        <select className="fi w-40" value={status} onChange={(e) => setStatus(e.target.value as any)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="adjusted">Adjusted</option></select>
        <select className="fi w-44" value={mode} onChange={(e) => setMode(e.target.value as any)}><option value="all">Quantity & value</option><option value="quantity">Quantity</option><option value="value">Value</option></select>
      </div>
      <Panel flush>
        {rows.length === 0 ? <EmptyState icon={SlidersHorizontal} title="No adjustments yet" description="Record damaged or expired stock, stock-take differences or a change in an item's value." className="m-6" /> : <>
          <BulkBar sel={sel} noun="adjustment">
            <Button size="sm" variant="outline" onClick={applyMany}><CheckCircle2 /> Apply drafts</Button>
            <Button size="sm" variant="outline" onClick={() => downloadCsv("adjustments.csv", ["Number", "Date", "Type", "Reason", "Reference", "Status", "Items", "Value change"], (list as any[]).filter((a) => sel.has(a.id)).map((a) => [a.adjustment_number, a.adjustment_date, a.mode, a.reason, a.reference, a.status, (a.lines || []).length, a.value_change]))}>Export</Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={removeDrafts}><Trash2 /> Delete drafts</Button>
          </BulkBar>
          <table className="dt">
            <thead><tr><th className="w-10"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} /></th><th>Date</th><th>Number</th><th>Reason</th><th>Description</th><th>Type</th><th>Status</th><th>Reference</th><th className="num">Value change</th></tr></thead>
            <tbody>{(paged.rows as any[]).map((a) => (
              <tr key={a.id} className={cn("cursor-pointer", sel.has(a.id) && "bg-primary/5")} onClick={() => navigate(`/inventory/adjustments/${a.id}`)}>
                <td data-label=""><Tick on={sel.has(a.id)} onChange={() => sel.toggle(a.id)} /></td>
                <td data-label="Date">{fmtDate(a.adjustment_date)}</td>
                <td data-label="Number" className="font-semibold text-primary">{a.adjustment_number}</td>
                <td data-label="Reason">{a.reason}</td>
                <td data-label="Description" className="max-w-[260px] truncate text-muted-foreground">{a.description || `${(a.lines || []).length} item${(a.lines || []).length === 1 ? "" : "s"}`}</td>
                <td data-label="Type" className="capitalize">{a.mode}</td>
                <td data-label="Status"><Pill tone={a.status === "adjusted" ? "success" : "muted"}>{a.status === "adjusted" ? "Adjusted" : "Draft"}</Pill></td>
                <td data-label="Reference">{a.reference || "—"}</td>
                <td data-label="Value" className={cn("num", Number(a.value_change) < 0 ? "text-destructive" : "")}>{a.status === "adjusted" ? formatKES(Number(a.value_change)) : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
          <Pager {...paged.pager} />
        </>}
      </Panel>
      {open && <AdjustmentDetail adj={open} onClose={() => navigate("/inventory/adjustments")} />}
    </div>
  );
}

function AdjustmentDetail({ adj, onClose }: { adj: any; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const qty = adj.mode === "quantity";
  const apply = async () => {
    if (!(await confirmAction({ title: `Apply ${adj.adjustment_number}?`, message: qty ? "Stock on hand changes straight away." : "Item cost prices change so stock is worth the new values." }))) return;
    setBusy(true);
    const { error } = await sb.rpc("apply_inventory_adjustment", { p_id: adj.id });
    setBusy(false);
    if (error) return toast({ title: "Not applied", description: error.message, variant: "destructive" });
    ["inv-adjustments", "zitems", "products", "product-stocks"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    toast({ title: "Adjustment applied" });
  };
  const remove = async () => {
    if (!(await confirmAction({ title: `Delete ${adj.adjustment_number}?`, danger: true, confirmLabel: "Delete" }))) return;
    await sb.from("inventory_adjustments").delete().eq("id", adj.id);
    qc.invalidateQueries({ queryKey: ["inv-adjustments"] }); toast({ title: "Draft deleted" }); onClose();
  };
  const print = () => {
    const w = window.open("", "_blank", "width=820,height=900");
    if (!w) return toast({ title: "Allow pop-ups to print", variant: "destructive" });
    const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
    const head = qty ? "<th>Item</th><th class=r>Available</th><th class=r>New on hand</th><th class=r>Adjusted</th>" : "<th>Item</th><th class=r>Current value</th><th class=r>New value</th><th class=r>Adjusted</th>";
    const body = (adj.lines || []).map((l: any) => qty ? `<tr><td>${esc(l.name)}</td><td class=r>${l.qty_available}</td><td class=r>${l.new_qty}</td><td class=r>${l.qty_adjusted}</td></tr>` : `<tr><td>${esc(l.name)}</td><td class=r>${Number(l.current_value).toFixed(2)}</td><td class=r>${Number(l.new_value).toFixed(2)}</td><td class=r>${Number(l.value_adjusted).toFixed(2)}</td></tr>`).join("");
    w.document.write(`<!doctype html><html><head><title>${esc(adj.adjustment_number)}</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#222}h1{color:#A8121B;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}th,td{padding:8px;border-bottom:1px solid #eee;text-align:left}th{background:#faf6f2}.r{text-align:right}</style></head><body><h1>INVENTORY ADJUSTMENT</h1><p><b>${esc(adj.adjustment_number)}</b> · ${fmtDate(adj.adjustment_date)} · ${esc(adj.mode)} · ${esc(adj.status)}</p><p>Reason: ${esc(adj.reason)}<br>Account: ${esc(adj.account)}<br>Branch: ${esc(adj.locations?.name || "")}${adj.reference ? `<br>Reference: ${esc(adj.reference)}` : ""}${adj.description ? `<br>${esc(adj.description)}` : ""}</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table><p style="margin-top:50px">Approved by ____________________</p><script>setTimeout(()=>print(),300)</script></body></html>`);
    w.document.close();
  };
  return (
    <Modal open onClose={onClose} title={adj.adjustment_number} icon={SlidersHorizontal} size="2xl" description={`${fmtDate(adj.adjustment_date)} · ${adj.reason}`}
      footer={<div className="flex w-full flex-wrap gap-2">
        {adj.status === "draft" && <Button onClick={apply} disabled={busy}>{busy ? <OrbSpinner state="working" /> : <CheckCircle2 />} Apply to stock</Button>}
        {adj.status === "adjusted" && qty && adj.etims_status !== "signed" && <Button variant="outline" disabled={busy} onClick={async () => {
          try { await erpApi("etims/report-adjustment", { id: adj.id }); toast({ title: "Stock reported to KRA eTIMS" }); void qc.invalidateQueries(); }
          catch (e: any) { toast({ title: "Not reported to KRA", description: e.message, variant: "destructive" }); }
        }}><ShieldCheck /> Report to KRA</Button>}
        {adj.status === "draft" && <Button variant="outline" onClick={() => navigate(`/inventory/adjustments/${adj.id}/edit`)}><Pencil /> Edit</Button>}
        <Button variant="outline" onClick={print}><Printer /> Print / PDF</Button>
        {adj.document_id && <Button variant="outline" onClick={async () => { const { data } = await sb.from("documents").select("path,url,name,mime_type").eq("id", adj.document_id).maybeSingle(); if (data) void openDocument(data); }}><Paperclip /> Attachment</Button>}
        {adj.status === "draft" && <Button variant="ghost" className="ml-auto text-destructive" onClick={remove}><Trash2 /> Delete</Button>}
      </div>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2"><Pill tone={adj.status === "adjusted" ? "success" : "muted"}>{adj.status === "adjusted" ? "Adjusted" : "Draft"}</Pill>{adj.etims_status === "signed" && <Pill tone="success">Reported to KRA</Pill>}{adj.etims_status === "failed" && <Pill tone="danger">KRA: not accepted</Pill>}<Pill tone="info">{qty ? "Quantity adjustment" : "Value adjustment"}</Pill></div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          {[["Account", adj.account], ["Branch", adj.locations?.name || "—"], ["Reference", adj.reference || "—"], ["Created by", adj.created_by_name || "—"], ["Applied", adj.adjusted_at ? fmtDate(adj.adjusted_at) : "Not yet"], ["Value change", adj.status === "adjusted" ? formatKES(Number(adj.value_change)) : "—"]].map(([k, v]) => (
            <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>
          ))}
        </dl>
        {adj.description && <p className="rounded-xl bg-muted/50 p-3 text-sm">{adj.description}</p>}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="dt dt-keep">
            <thead><tr><th>Item</th>{qty ? <><th className="num">Available</th><th className="num">New on hand</th><th className="num">Adjusted</th></> : <><th className="num">Current value</th><th className="num">New value</th><th className="num">Adjusted</th></>}</tr></thead>
            <tbody>{(adj.lines || []).map((l: any, i: number) => (
              <tr key={i}><td><span className="font-medium">{l.name}</span>{l.sku && <span className="block text-xs text-muted-foreground">{l.sku}</span>}</td>
                {qty ? <><td className="num">{l.qty_available}</td><td className="num">{l.new_qty}</td><td className={cn("num font-semibold", Number(l.qty_adjusted) < 0 ? "text-destructive" : "text-success")}>{Number(l.qty_adjusted) > 0 ? "+" : ""}{l.qty_adjusted}</td></>
                  : <><td className="num">{formatKES(Number(l.current_value))}</td><td className="num">{formatKES(Number(l.new_value))}</td><td className={cn("num font-semibold", Number(l.value_adjusted) < 0 ? "text-destructive" : "text-success")}>{formatKES(Number(l.value_adjusted))}</td></>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

/** New or draft adjustment: quantity (new on hand ⇄ adjusted) or value (new value ⇄ adjusted). */
export function AdjustmentForm() {
  const { id } = useParams<{ id?: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const { profile } = useAuth() as any;
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: list = [] } = useAdjustments();
  const existing = id ? (list as any[]).find((a) => a.id === id) : null;
  const { data: locations = [] } = useQuery({ queryKey: ["locations-lite", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("locations").select("id,name,is_main").eq("tenant_id", tenantId).eq("is_active", true).order("is_main", { ascending: false })).data || [] });
  const { data: products = [], isFetched: productsReady } = useQuery({ queryKey: ["adj-products", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("products").select("id,name,sku,unit,cost_price,stock").eq("tenant_id", tenantId).eq("is_active", true).order("name").limit(10000)).data || [] });
  const [f, setF] = useState<any>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [pick, setPick] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"" | "draft" | "apply">("");
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty && !busy);

  const locId = f?.location_id || (locations as any[])[0]?.id || null;
  const { data: stockAt = new Map<string, number>() } = useQuery({
    queryKey: ["adj-stock", locId], enabled: !!locId,
    queryFn: async () => new Map<string, number>(((await sb.from("product_stocks").select("product_id,stock").eq("location_id", locId)).data || []).map((r: any) => [r.product_id, Number(r.stock)])),
  });
  const onHand = (p: any) => (stockAt.has(p.id) ? stockAt.get(p.id)! : Number(p.stock || 0));
  const mkLine = (p: any): Line => ({ product_id: p.id, name: p.name, sku: p.sku, unit: p.unit, cost: Number(p.cost_price || 0), qty_available: onHand(p), new_qty: "", qty_adjusted: "", current_value: Math.round(onHand(p) * Number(p.cost_price || 0) * 100) / 100, new_value: "", value_adjusted: "" });

  // Load the draft, or start fresh with any items picked on the Products page.
  useEffect(() => {
    if (f) return;
    if (id && !existing) return;
    if (existing) {
      setF({ mode: existing.mode, reference: existing.reference || "", adjustment_date: existing.adjustment_date, account: existing.account, reason: existing.reason, location_id: existing.location_id, description: existing.description || "" });
      setLines(existing.lines || []);
    } else setF({ mode: "quantity", reference: "", adjustment_date: today(), account: "Cost of Goods Sold", reason: "", location_id: null, description: "" });
  }, [f, id, existing]);
  useEffect(() => {
    if (!f || lines !== null || existing || !productsReady) return;
    const ids = (params.get("items") || "").split(",").filter(Boolean);
    setLines((products as any[]).filter((p) => ids.includes(p.id)).map(mkLine));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, lines, existing, productsReady, products, stockAt]);
  if (!f || lines === null) return <OrbLoader label="Loading…" />;

  const qty = f.mode === "quantity";
  const set = (k: string, v: any) => { setDirty(true); setF((x: any) => ({ ...x, [k]: v })); };
  const setLine = (i: number, patch: Partial<Line>) => { setDirty(true); setLines((ls) => ls!.map((l, j) => (j === i ? { ...l, ...patch } : l))); };
  const add = (pid: string) => {
    const p = (products as any[]).find((x) => x.id === pid);
    if (!p || lines.some((l) => l.product_id === pid)) return;
    setDirty(true); setLines([...lines, mkLine(p)]); setPick("");
  };
  const valid = lines.filter((l) => (qty ? l.qty_adjusted !== "" && Number(l.qty_adjusted) !== 0 : l.new_value !== ""));

  const save = async (applyNow: boolean) => {
    if (!f.reason) return toast({ title: "Choose a reason", variant: "destructive" });
    if (!valid.length) return toast({ title: "Add at least one item with a change", variant: "destructive" });
    setBusy(applyNow ? "apply" : "draft");
    try {
      let document_id = existing?.document_id || null;
      if (file && tenantId) document_id = (await uploadDocument(tenantId, file, { entity_type: "general", entity_name: "Inventory adjustment", category: "Inventory adjustment", uploaded_by_name: profile?.display_name })).id;
      const body = { ...f, location_id: locId, reference: f.reference || null, description: f.description || null, lines: valid, document_id, created_by_name: existing?.created_by_name || profile?.display_name || null };
      const { data, error } = existing ? await sb.from("inventory_adjustments").update(body).eq("id", existing.id).select("*").single() : await sb.from("inventory_adjustments").insert({ ...body, tenant_id: tenantId }).select("*").single();
      if (error) throw error;
      if (applyNow) { const r = await sb.rpc("apply_inventory_adjustment", { p_id: data.id }); if (r.error) throw r.error; }
      ["inv-adjustments", "zitems", "products"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setDirty(false);
      toast({ title: applyNow ? `${data.adjustment_number} applied` : `${data.adjustment_number} saved as draft` });
      navigate(`/inventory/adjustments/${data.id}`);
    } catch (e: any) {
      toast({ title: "Not saved", description: e.message, variant: "destructive" });
    } finally { setBusy(""); }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-24">
      <PageHeader title={existing ? `Edit ${existing.adjustment_number}` : "New Adjustment"} icon={SlidersHorizontal} />
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mode of adjustment" required>
            <div className="flex gap-4 pt-1.5 text-sm">
              {[["quantity", "Quantity adjustment"], ["value", "Value adjustment"]].map(([v, l]) => (
                <label key={v} className="flex cursor-pointer items-center gap-2"><input type="radio" name="mode" checked={f.mode === v} onChange={() => set("mode", v)} className="accent-[hsl(var(--primary))]" /> {l}</label>
              ))}
            </div>
          </Field>
          <Field label="Reference number"><input className="fi" value={f.reference} onChange={(e) => set("reference", e.target.value)} placeholder="Optional" /></Field>
          <Field label="Date" required><input className="fi" type="date" value={f.adjustment_date} onChange={(e) => set("adjustment_date", e.target.value)} /></Field>
          <Field label="Account" required><select className="fi" value={f.account} onChange={(e) => set("account", e.target.value)}>{ACCOUNTS.map((a) => <option key={a}>{a}</option>)}</select></Field>
          <Field label="Reason" required>
            <select className="fi" value={ADJ_REASONS.includes(f.reason) || !f.reason ? f.reason : "__other"} onChange={(e) => set("reason", e.target.value === "__other" ? " " : e.target.value)}>
              <option value="">Choose a reason…</option>{ADJ_REASONS.map((r) => <option key={r}>{r}</option>)}<option value="__other">Other…</option>
            </select>
            {f.reason && !ADJ_REASONS.includes(f.reason) && <input className="fi mt-2" autoFocus value={f.reason.trim()} onChange={(e) => set("reason", e.target.value || " ")} placeholder="Type the reason" />}
          </Field>
          <Field label="Branch / warehouse"><select className="fi" value={locId || ""} onChange={(e) => set("location_id", e.target.value)}>{(locations as any[]).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label="Description" className="sm:col-span-2"><textarea className="fi min-h-[70px]" value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Max. 500 characters" maxLength={500} /></Field>
        </div>
      </Panel>

      <Panel title="Items" flush>
        <div className="overflow-x-auto">
          <table className="dt dt-keep min-w-[640px]">
            <thead><tr><th>Item details</th>{qty ? <><th className="num">Quantity available</th><th className="num">New quantity on hand</th><th className="num">Quantity adjusted</th></> : <><th className="num">Current value</th><th className="num">Changed value</th><th className="num">Adjusted value</th></>}<th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.product_id}>
                  <td><span className="font-medium">{l.name}</span><span className="block text-xs text-muted-foreground">{l.sku || ""}{l.unit ? ` · ${l.unit}` : ""}</span></td>
                  {qty ? <>
                    <td className="num">{l.qty_available}</td>
                    <td className="num"><input className="fi h-9 w-28 text-right" type="number" step="any" min={0} value={l.new_qty} onChange={(e) => { const v = e.target.value === "" ? "" : Number(e.target.value); setLine(i, { new_qty: v, qty_adjusted: v === "" ? "" : Math.round((Number(v) - l.qty_available) * 1000) / 1000 }); }} placeholder="0" /></td>
                    <td className="num"><input className="fi h-9 w-28 text-right" type="number" step="any" value={l.qty_adjusted} onChange={(e) => { const v = e.target.value === "" ? "" : Number(e.target.value); setLine(i, { qty_adjusted: v, new_qty: v === "" ? "" : Math.round((l.qty_available + Number(v)) * 1000) / 1000 }); }} placeholder="e.g. +10 or -2" /></td>
                  </> : <>
                    <td className="num">{formatKES(l.current_value)}</td>
                    <td className="num"><input className="fi h-9 w-32 text-right" type="number" step="any" min={0} value={l.new_value} onChange={(e) => { const v = e.target.value === "" ? "" : Number(e.target.value); setLine(i, { new_value: v, value_adjusted: v === "" ? "" : Math.round((Number(v) - l.current_value) * 100) / 100 }); }} /></td>
                    <td className="num"><input className="fi h-9 w-32 text-right" type="number" step="any" value={l.value_adjusted} onChange={(e) => { const v = e.target.value === "" ? "" : Number(e.target.value); setLine(i, { value_adjusted: v, new_value: v === "" ? "" : Math.round((l.current_value + Number(v)) * 100) / 100 }); }} /></td>
                  </>}
                  <td><button className="icon-btn-danger" onClick={() => { setDirty(true); setLines(lines.filter((_, j) => j !== i)); }} aria-label="Remove"><X className="h-4 w-4" /></button></td>
                </tr>
              ))}
              <tr><td colSpan={5}>
                <select className="fi max-w-md" value={pick} onChange={(e) => add(e.target.value)}>
                  <option value="">+ Add an item…</option>
                  {(products as any[]).filter((p) => !lines.some((l) => l.product_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""} · {onHand(p)} on hand</option>)}
                </select>
              </td></tr>
            </tbody>
          </table>
        </div>
        {!qty && <p className="px-4 pb-3 text-xs text-muted-foreground">A value adjustment changes what the stock on hand is worth: the item's cost price becomes new value ÷ quantity on hand.</p>}
      </Panel>

      <Panel title="Attachment">
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-border p-4 text-sm text-muted-foreground hover:border-primary">
          <Paperclip className="h-5 w-5" /> {file ? file.name : existing?.document_id ? "A file is attached. Choose another to replace it." : "Attach a stock-take sheet, photo or report (max 20 MB)"}
          <input type="file" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] || null); setDirty(true); }} />
        </label>
      </Panel>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 px-4 py-3 backdrop-blur md:left-[var(--sidebar-w,0px)]">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-2">
          <Button variant="outline" onClick={() => save(false)} disabled={!!busy}>{busy === "draft" ? <OrbSpinner state="working" /> : <Save />} Save as draft</Button>
          <Button onClick={() => save(true)} disabled={!!busy}>{busy === "apply" ? <OrbSpinner state="working" /> : <CheckCircle2 />} Save and apply</Button>
          <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

