import { useEffect, useMemo, useState } from "react";
import { useSelection, BulkBar, TickAllCell, TickCell, downloadCsv } from "@/components/Bulk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Warehouse as WarehouseIcon, Plus, MapPin, Boxes, PackageCheck, Truck, ArrowRightLeft, Printer, Send, CheckCircle2, ShoppingCart,
  RefreshCcw, Layers, PackagePlus, ClipboardList,
} from "lucide-react";
import { PageHeader, Panel, EmptyState, Modal, Field, Pill, TableWrap, StatGrid, StatTile } from "@/components/kit";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/friendlyError";
import { openStockDocument } from "@/lib/docModels";
import { toast } from "sonner";
import { sb, fmtD, n, useLocs, useProds, useBins, LinesEditor, blankLine, STATUS_TONE, type Line } from "./common";

import { PagedRows } from "@/components/Pager";
const Btn = ({ children, onClick, primary, disabled }: { children: React.ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean }) => (
  <button disabled={disabled} onClick={onClick} className={primary ? "inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" : "inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"}>{children}</button>
);
const act = async (fn: () => Promise<any>, ok: string, after?: () => void) => {
  try { await fn(); toast.success(ok); after?.(); } catch (e) { toast.error(friendlyError(e)); }
};
const rpc = async (name: string, args: any) => { const { data, error } = await sb.rpc(name, args); if (error) throw error; return data; };

/* ======================================================================= Locations & bins */

export function Warehouses() {
  const qc = useQueryClient();
  const { data: locs = [] } = useLocs();
  const { data: staff = [] } = useQuery({ queryKey: ["wh-staff"], queryFn: async () => ((await sb.from("profiles").select("user_id,display_name").order("display_name")).data || []) as any[] });
  const [edit, setEdit] = useState<any | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["wh-locations"] }); void qc.invalidateQueries({ queryKey: ["locations"] }); };
  const save = async () => {
    if (!String(edit.name || "").trim()) return toast.error("Name the location");
    const row = { name: edit.name.trim(), location_type: edit.location_type || "warehouse", parent_id: edit.parent_id || null, manager_id: edit.manager_id || null, phone: edit.phone || null, city: edit.city || null, code: edit.code || null, is_active: edit.is_active !== false };
    const { error } = edit.id ? await sb.from("locations").update(row).eq("id", edit.id) : await sb.from("locations").insert(row);
    if (error) return toast.error(friendlyError(error));
    toast.success("Saved"); setEdit(null); refresh();
  };
  const branches = locs.filter((l) => l.location_type === "branch");
  return (
    <div className="space-y-6">
      <PageHeader title="Warehouses & Branches" icon={WarehouseIcon} description="Every branch and warehouse, their bins and the batches stored in them."
        actions={<Btn primary onClick={() => setEdit({ location_type: "warehouse", is_active: true })}><Plus className="h-4 w-4" /> New location</Btn>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <PagedRows rows={locs} gridSpan>{(pageRows) => pageRows.map((l) => (
          <Panel key={l.id} title={l.name} icon={l.location_type === "warehouse" ? WarehouseIcon : MapPin}
            description={[l.location_type === "warehouse" ? "Warehouse" : l.location_type === "branch" ? "Branch" : l.location_type, l.is_main ? "main" : "", l.city || "", l.parent_id ? `of ${locs.find((x) => x.id === l.parent_id)?.name || ""}` : ""].filter(Boolean).join(" · ")}
            actions={<button onClick={() => setEdit(l)} className="text-xs font-semibold text-primary">Edit</button>}>
            <p className="text-sm text-muted-foreground">Manager: {staff.find((s) => s.user_id === l.manager_id)?.display_name || "—"}</p>
            <button onClick={() => setOpen(open === l.id ? null : l.id)} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary"><Layers className="h-4 w-4" /> {open === l.id ? "Hide" : "Bins & stock"}</button>
            {open === l.id && <LocationDetail locationId={l.id} />}
          </Panel>
        ))}</PagedRows>
      </div>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? edit.name : "New location"} icon={WarehouseIcon}
          footer={<><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn primary onClick={() => void save()}>Save</Btn></>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label="Name" required><input className="fi" value={edit.name || ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Mombasa Road warehouse" /></Field></div>
            <Field label="Type"><select className="fi" value={edit.location_type} onChange={(e) => setEdit({ ...edit, location_type: e.target.value })}><option value="warehouse">Warehouse</option><option value="branch">Branch</option><option value="store">Shop / store</option></select></Field>
            <Field label="Belongs to branch"><select className="fi" value={edit.parent_id || ""} onChange={(e) => setEdit({ ...edit, parent_id: e.target.value })}><option value="">—</option>{branches.filter((b) => b.id !== edit.id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
            <Field label="Manager"><select className="fi" value={edit.manager_id || ""} onChange={(e) => setEdit({ ...edit, manager_id: e.target.value })}><option value="">—</option>{staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.display_name}</option>)}</select></Field>
            <Field label="Code"><input className="fi" value={edit.code || ""} onChange={(e) => setEdit({ ...edit, code: e.target.value })} placeholder="WH-MSA" /></Field>
            <Field label="Town / city"><input className="fi" value={edit.city || ""} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></Field>
            <Field label="Phone"><input className="fi" value={edit.phone || ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LocationDetail({ locationId }: { locationId: string }) {
  const qc = useQueryClient();
  const { data: bins = [] } = useBins(locationId);
  const { data: lots = [] } = useQuery({ queryKey: ["wh-lots", locationId], queryFn: async () => ((await sb.from("product_batches").select("id,batch_number,expiry_date,quantity,bin_id,products(name,sku)").eq("location_id", locationId).gt("quantity", 0).order("expiry_date", { ascending: true, nullsFirst: false }).limit(300)).data || []) as any[] });
  const [code, setCode] = useState("");
  const [type, setType] = useState("storage");
  const addBin = async () => {
    if (!code.trim()) return;
    const { error } = await sb.from("wh_bins").insert({ location_id: locationId, code: code.trim().toUpperCase(), bin_type: type });
    if (error) return toast.error(friendlyError(error));
    setCode(""); void qc.invalidateQueries({ queryKey: ["wh-bins", locationId] });
  };
  const soon = (d?: string) => d && Date.parse(d) - Date.now() < 60 * 86400_000;
  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div className="flex flex-wrap gap-1.5">{bins.map((b) => <Pill key={b.id} tone={b.bin_type === "quarantine" ? "danger" : b.bin_type === "storage" ? "muted" : "info"}>{b.code}</Pill>)}{!bins.length && <span className="text-xs text-muted-foreground">No bins yet.</span>}</div>
      <div className="flex gap-2"><input className="fi h-9" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Bin code, e.g. A-01-02" /><select className="fi h-9 w-auto" value={type} onChange={(e) => setType(e.target.value)}><option value="storage">Storage</option><option value="receiving">Receiving</option><option value="dispatch">Dispatch</option><option value="quarantine">Quarantine</option><option value="returns">Returns</option></select><button onClick={() => void addBin()} className="rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /></button></div>
      <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
        <table className="w-full text-xs"><thead className="sticky top-0 bg-muted text-muted-foreground"><tr><th className="px-2 py-1.5 text-left">Item</th><th className="text-left">Batch</th><th className="text-left">Expiry</th><th className="text-left">Bin</th><th className="px-2 text-right">Qty</th></tr></thead><tbody>
          <PagedRows rows={lots} colSpan={5} after={<>{!lots.length && <tr><td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">No batches recorded here.</td></tr>}</>}>{(pageRows) => pageRows.map((l) => <tr key={l.id} className="border-t border-border"><td className="px-2 py-1">{l.products?.name}</td><td>{l.batch_number || "—"}</td><td className={soon(l.expiry_date) ? "font-semibold text-destructive" : ""}>{fmtD(l.expiry_date)}</td><td>{bins.find((b) => b.id === l.bin_id)?.code || "—"}</td><td className="px-2 text-right tabular-nums">{n(l.quantity)}</td></tr>)}</PagedRows>
        </tbody></table>
      </div>
    </div>
  );
}

/* ======================================================================= Receive stock */

export function ReceiveStock() {
  const qc = useQueryClient();
  const { data: locs = [] } = useLocs();
  const { data: products = [] } = useProds();
  const [loc, setLoc] = useState("");
  const [reason, setReason] = useState("restock");
  const [ref, setRef] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const { data: bins = [] } = useBins(loc);
  useEffect(() => { if (!loc && locs.length) setLoc(locs[0].id); }, [locs, loc]);
  const save = () => act(async () => {
    const ok = lines.filter((l) => l.product_id && l.quantity > 0);
    if (!ok.length) throw new Error("Add at least one item and quantity");
    await rpc("wh_receive", { p_location: loc, p_lines: ok, p_reason: reason, p_ref_type: "receipt", p_ref_id: null, p_ref_number: ref || null });
  }, "Stock received", () => { setLines([blankLine()]); setRef(""); void qc.invalidateQueries(); });
  return (
    <div className="space-y-6">
      <PageHeader title="Receive Stock" icon={PackagePlus} description="Stock coming in without a purchase order, with batch, expiry and bin." />
      <Panel title="What came in" icon={Boxes}>
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Field label="Into"><select className="fi" value={loc} onChange={(e) => setLoc(e.target.value)}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label="Reason"><select className="fi" value={reason} onChange={(e) => setReason(e.target.value)}><option value="restock">Restock / opening stock</option><option value="return">Customer return</option><option value="count">Found in a count</option><option value="other">Other</option></select></Field>
          <Field label="Reference"><input className="fi" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Delivery note, production run…" /></Field>
        </div>
        <LinesEditor lines={lines} onChange={setLines} products={products} bins={bins} showLots showCost />
        <div className="mt-4 flex justify-end"><Btn primary onClick={() => void save()}><CheckCircle2 className="h-4 w-4" /> Receive</Btn></div>
      </Panel>
    </div>
  );
}

/* ======================================================================= Transfers */

export function Transfers() {
  const qc = useQueryClient();
  const { data: locs = [] } = useLocs();
  const { data: products = [] } = useProds();
  const { data: rows = [] } = useQuery({ queryKey: ["wh-transfers"], queryFn: async () => ((await sb.from("wh_transfers").select("*").order("created_at", { ascending: false }).limit(300)).data || []) as any[] });
  const [edit, setEdit] = useState<any | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["wh-transfers"] }); void qc.invalidateQueries({ queryKey: ["wh-lots"] }); };
  const name = (id: string) => locs.find((l) => l.id === id)?.name || "—";
  // Bulk: send all picked drafts, receive all picked in-transit transfers, export.
  const tsel = useSelection(rows.map((t) => t.id));
  const pickedT = rows.filter((t) => tsel.has(t.id));
  const bulkRun = (status: string, fn: string, done: string) => act(async () => {
    const list = pickedT.filter((t) => t.status === status);
    if (!list.length) throw new Error(status === "draft" ? "None of the picked transfers is a draft" : "None of the picked transfers is in transit");
    for (const t of list) await rpc(fn, fn === "wh_transfer_receive" ? { p_id: t.id, p_bin: null } : { p_id: t.id });
  }, done, () => { tsel.clear(); refresh(); });
  const create = (ship: boolean) => act(async () => {
    const lines = edit.lines.filter((l: Line) => l.product_id && l.quantity > 0);
    if (!edit.from || !edit.to || edit.from === edit.to) throw new Error("Choose two different locations");
    if (!lines.length) throw new Error("Add items to move");
    const { data, error } = await sb.from("wh_transfers").insert({ from_location_id: edit.from, to_location_id: edit.to, lines, notes: edit.notes || null }).select("id").single();
    if (error) throw error;
    if (ship) await rpc("wh_transfer_ship", { p_id: data.id });
  }, ship ? "Transfer sent" : "Transfer saved", () => { setEdit(null); refresh(); });
  return (
    <div className="space-y-6">
      <PageHeader title="Transfer Orders" icon={ArrowRightLeft} description="Move stock between branches and warehouses; it is in transit until received."
        actions={<Btn primary onClick={() => setEdit({ from: locs[0]?.id, to: locs[1]?.id, lines: [blankLine()] })}><Plus className="h-4 w-4" /> New transfer</Btn>} />
      <Panel flush>
        {!rows.length ? <EmptyState icon={ArrowRightLeft} title="No transfers yet" /> : (
          <><BulkBar sel={tsel} noun="transfer">
            <Btn onClick={() => void bulkRun("draft", "wh_transfer_ship", "Transfers sent")}><Send className="h-4 w-4" /> Send</Btn>
            <Btn onClick={() => void bulkRun("in_transit", "wh_transfer_receive", "Transfers received")}><CheckCircle2 className="h-4 w-4" /> Receive</Btn>
            <Btn onClick={() => downloadCsv("transfers.csv", ["Number", "From", "To", "Items", "Status", "Date"], pickedT.map((t) => [t.number || "Draft", name(t.from_location_id), name(t.to_location_id), (t.lines || []).reduce((a: number, l: any) => a + n(l.quantity), 0), t.status, fmtD(t.shipped_at || t.created_at)]))}>Export</Btn>
          </BulkBar>
          <TableWrap><table className="dt w-full"><thead><tr><TickAllCell sel={tsel} /><th>Number</th><th>From</th><th>To</th><th>Items</th><th>Status</th><th>Date</th><th /></tr></thead><tbody>
            <PagedRows rows={rows} colSpan={7}>{(pageRows) => pageRows.map((t) => (
              <tr key={t.id} className={tsel.has(t.id) ? "bg-primary/5" : undefined}>
                <TickCell sel={tsel} id={t.id} />
                <td className="font-semibold">{t.number || "Draft"}</td><td>{name(t.from_location_id)}</td><td>{name(t.to_location_id)}</td>
                <td>{(t.lines || []).reduce((a: number, l: any) => a + n(l.quantity), 0)}</td>
                <td><Pill tone={STATUS_TONE[t.status]}>{String(t.status).replace("_", " ")}</Pill></td><td>{fmtD(t.shipped_at || t.created_at)}</td>
                <td className="whitespace-nowrap text-right">
                  {t.status === "draft" && <Btn onClick={() => void act(() => rpc("wh_transfer_ship", { p_id: t.id }), "Sent", refresh)}><Send className="h-4 w-4" /> Send</Btn>}
                  {t.status === "in_transit" && <Btn primary onClick={() => void act(() => rpc("wh_transfer_receive", { p_id: t.id, p_bin: null }), "Received", refresh)}><CheckCircle2 className="h-4 w-4" /> Receive</Btn>}
                  <button onClick={() => void openStockDocument("transfer", t.id).catch((e) => toast.error(friendlyError(e)))} className="ml-1 rounded-lg p-2 hover:bg-muted" aria-label="Print"><Printer className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}</PagedRows>
          </tbody></table></TableWrap></>
        )}
      </Panel>
      {edit && (
        <Modal open onClose={() => setEdit(null)} size="xl" title="New transfer" icon={ArrowRightLeft}
          footer={<><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn onClick={() => void create(false)}>Save draft</Btn><Btn primary onClick={() => void create(true)}><Send className="h-4 w-4" /> Send now</Btn></>}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="From"><select className="fi" value={edit.from} onChange={(e) => setEdit({ ...edit, from: e.target.value })}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
              <Field label="To"><select className="fi" value={edit.to} onChange={(e) => setEdit({ ...edit, to: e.target.value })}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
            </div>
            <LinesEditor lines={edit.lines} onChange={(lines) => setEdit({ ...edit, lines })} products={products} showLots={false} />
            <p className="text-xs text-muted-foreground">Batches leave earliest-expiry first; name one on a line to move that batch instead.</p>
            <Field label="Notes"><textarea className="fi" rows={2} value={edit.notes || ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ======================================================================= Packages */

export function Packages() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({ queryKey: ["wh-packages"], queryFn: async () => ((await sb.from("wh_packages").select("*").order("created_at", { ascending: false }).limit(300)).data || []) as any[] });
  const [newPkg, setNewPkg] = useState(false);
  const [ship, setShip] = useState<any | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["wh-packages"] }); void qc.invalidateQueries({ queryKey: ["wh-shipments"] }); };
  return (
    <div className="space-y-6">
      <PageHeader title="Packages" icon={PackageCheck} description="Pack sales orders and invoices batch by batch. Packing slips carry no prices."
        actions={<Btn primary onClick={() => setNewPkg(true)}><Plus className="h-4 w-4" /> New package</Btn>} />
      <Panel flush>
        {!rows.length ? <EmptyState icon={PackageCheck} title="No packages yet" description="Create one from a sales order or invoice." /> : (
          <TableWrap><table className="dt w-full"><thead><tr><th>Package</th><th>For</th><th>Customer</th><th>Quantity</th><th>Status</th><th>Date</th><th /></tr></thead><tbody>
            <PagedRows rows={rows} colSpan={7}>{(pageRows) => pageRows.map((p) => (
              <tr key={p.id}>
                <td className="font-semibold">{p.number}</td><td>{p.source_number || "—"}</td><td>{p.customer_name}</td>
                <td className="tabular-nums">{(p.lines || []).reduce((a: number, l: any) => a + n(l.quantity), 0)}</td>
                <td><Pill tone={STATUS_TONE[p.status]}>{p.status}</Pill></td><td>{fmtD(p.created_at)}</td>
                <td className="whitespace-nowrap text-right">
                  {p.status === "packed" && <Btn primary onClick={() => setShip(p)}><Truck className="h-4 w-4" /> Ship</Btn>}
                  <button onClick={() => void openStockDocument("package", p.id).catch((e) => toast.error(friendlyError(e)))} className="ml-1 rounded-lg p-2 hover:bg-muted" aria-label="Print packing slip"><Printer className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}</PagedRows>
          </tbody></table></TableWrap>
        )}
      </Panel>
      {newPkg && <NewPackage onClose={() => { setNewPkg(false); refresh(); }} />}
      {ship && <ShipPackage pkg={ship} onClose={() => { setShip(null); refresh(); }} />}
    </div>
  );
}

function NewPackage({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth() as any;
  const { data: locs = [] } = useLocs();
  const [type, setType] = useState<"sales_order" | "invoice">("sales_order");
  const [docId, setDocId] = useState("");
  const [loc, setLoc] = useState("");
  const [lines, setLines] = useState<any[]>([]);
  const [weight, setWeight] = useState("");
  const [notes, setNotes] = useState("");
  const { data: docs = [] } = useQuery({
    queryKey: ["pkg-docs", type],
    queryFn: async () => (type === "sales_order"
      ? (await sb.from("sales_orders").select("id,quote_number,customer_id,customer_name,items,status").in("status", ["sent", "accepted"]).order("created_at", { ascending: false }).limit(200)).data
      : (await sb.from("invoices").select("id,invoice_number,customer_id,customer_name,items,status").not("status", "in", "(draft,void)").order("created_at", { ascending: false }).limit(200)).data) || [],
  });
  useEffect(() => { if (!loc && locs.length) setLoc(locs[0].id); }, [locs, loc]);
  const doc = docs.find((d: any) => d.id === docId);
  useEffect(() => {
    if (!doc) { setLines([]); return; }
    void (async () => {
      const packed = ((await sb.rpc("wh_packed", { p_source_type: type, p_source: doc.id })).data || []) as any[];
      const out = [];
      for (const l of (doc.items || []) as any[]) {
        const pid = l.item_id || l.product_id;
        if (!pid || l.type === "service") continue;
        const left = Math.max(0, n(l.quantity) - n(packed.find((x) => x.product_id === pid)?.packed));
        if (left <= 0) continue;
        const sug = ((await sb.rpc("wh_suggest", { p_product: pid, p_location: loc, p_qty: left })).data || []) as any[];
        out.push({ product_id: pid, name: l.name, unit: l.unit, ordered: n(l.quantity), quantity: left, lots: sug.map((s: any) => ({ batch: s.batch_number, expiry: s.expiry_date, qty: n(s.take), bin_code: s.bin_code })) });
      }
      setLines(out);
    })();
  }, [docId, loc]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => act(async () => {
    const ok = lines.filter((l) => n(l.quantity) > 0);
    if (!doc || !ok.length) throw new Error("Choose the order and what to pack");
    const { data: num } = await sb.rpc("next_doc_number", { p_kind: "package" });
    const { error } = await sb.from("wh_packages").insert({ number: num, source_type: type, source_id: doc.id, source_number: doc.quote_number || doc.invoice_number, customer_id: doc.customer_id, customer_name: doc.customer_name, location_id: loc, lines: ok, weight_kg: weight ? Number(weight) : null, notes: notes || null, packed_by_name: profile?.display_name || null });
    if (error) throw error;
  }, "Package created", onClose);
  return (
    <Modal open onClose={onClose} size="xl" title="New package" icon={PackageCheck} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={() => void save()}>Create package</Btn></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="From"><select className="fi" value={type} onChange={(e) => { setType(e.target.value as any); setDocId(""); }}><option value="sales_order">Sales order</option><option value="invoice">Invoice</option></select></Field>
          <Field label={type === "sales_order" ? "Sales order" : "Invoice"}><select className="fi" value={docId} onChange={(e) => setDocId(e.target.value)}><option value="">Choose…</option>{docs.map((d: any) => <option key={d.id} value={d.id}>{d.quote_number || d.invoice_number} · {d.customer_name}</option>)}</select></Field>
          <Field label="Pick from"><select className="fi" value={loc} onChange={(e) => setLoc(e.target.value)}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        </div>
        {doc && !lines.length && <p className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">Everything on this order is already packed.</p>}
        {lines.map((l, i) => (
          <div key={l.product_id} className="rounded-2xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-3"><b className="flex-1">{l.name}</b><span className="text-xs text-muted-foreground">ordered {l.ordered}</span>
              <input className="fi h-9 w-24 text-right" type="number" min={0} step="any" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} aria-label="Quantity to pack" /></div>
            {l.lots?.length ? <p className="mt-1.5 text-xs text-muted-foreground">Take: {l.lots.map((x: any) => `${x.qty} × batch ${x.batch || "—"}${x.expiry ? ` (exp ${fmtD(x.expiry)})` : ""}${x.bin_code ? ` from ${x.bin_code}` : ""}`).join("; ")}</p> : <p className="mt-1.5 text-xs text-muted-foreground">No batches recorded for this item here.</p>}
          </div>
        ))}
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Weight (kg)"><input className="fi" type="number" min={0} step="any" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field><Field label="Notes"><input className="fi" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
      </div>
    </Modal>
  );
}

function ShipPackage({ pkg, onClose }: { pkg: any; onClose: () => void }) {
  const { data: riders = [] } = useQuery({ queryKey: ["wh-riders"], queryFn: async () => ((await sb.from("profiles").select("user_id,display_name,phone").order("display_name")).data || []) as any[] });
  const [f, setF] = useState<any>({ carrier: "Own delivery", tracking_number: "", rider_id: "", ship_date: new Date().toISOString().slice(0, 10), address: "" });
  const save = () => act(async () => {
    const { data: num } = await sb.rpc("next_doc_number", { p_kind: "shipment" });
    const rider = riders.find((r: any) => r.user_id === f.rider_id);
    const { error } = await sb.from("delivery_notes").insert({
      delivery_number: num, package_id: pkg.id, invoice_id: pkg.source_type === "invoice" ? pkg.source_id : null, source_number: pkg.source_number, customer_id: pkg.customer_id, customer_name: pkg.customer_name,
      customer_address: f.address || null, items: pkg.lines, carrier: f.carrier || null, tracking_number: f.tracking_number || null, ship_date: f.ship_date, location_id: pkg.location_id,
      rider_id: f.rider_id || null, rider_name: rider?.display_name || null, status: f.rider_id ? "assigned" : "dispatched", dispatched_at: new Date().toISOString(),
    });
    if (error) throw error;
    await sb.from("wh_packages").update({ status: "shipped" }).eq("id", pkg.id);
  }, "Shipped", onClose);
  return (
    <Modal open onClose={onClose} title={`Ship ${pkg.number}`} icon={Truck} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={() => void save()}><Truck className="h-4 w-4" /> Create delivery note</Btn></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Carrier"><input className="fi" value={f.carrier} onChange={(e) => setF({ ...f, carrier: e.target.value })} placeholder="Own delivery, G4S, Wells Fargo…" /></Field>
        <Field label="Tracking number"><input className="fi" value={f.tracking_number} onChange={(e) => setF({ ...f, tracking_number: e.target.value })} /></Field>
        <Field label="Driver / rider"><select className="fi" value={f.rider_id} onChange={(e) => setF({ ...f, rider_id: e.target.value })}><option value="">—</option>{riders.map((r: any) => <option key={r.user_id} value={r.user_id}>{r.display_name}</option>)}</select></Field>
        <Field label="Ship date"><input className="fi" type="date" value={f.ship_date} onChange={(e) => setF({ ...f, ship_date: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Field label="Delivery address"><input className="fi" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field></div>
      </div>
    </Modal>
  );
}

/* ======================================================================= Shipments (delivery notes) */

export function Shipments() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({ queryKey: ["wh-shipments"], queryFn: async () => ((await sb.from("delivery_notes").select("*").order("created_at", { ascending: false }).limit(300)).data || []) as any[] });
  const [done, setDone] = useState<any | null>(null);
  const [who, setWho] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["wh-shipments"] });
  const deliver = () => act(async () => {
    const { error } = await sb.from("delivery_notes").update({ status: "delivered", delivered_at: new Date().toISOString(), received_by: who || null }).eq("id", done.id);
    if (error) throw error;
    if (done.package_id) await sb.from("wh_packages").update({ status: "delivered" }).eq("id", done.package_id);
  }, "Marked delivered", () => { setDone(null); setWho(""); refresh(); });
  const open = rows.filter((r) => r.status !== "delivered").length;
  return (
    <div className="space-y-6">
      <PageHeader title="Shipments & Delivery Notes" icon={Truck} description="Everything on its way to customers. Delivery notes carry no prices." actions={<Link to="/warehouse/packages" className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><PackageCheck className="h-4 w-4" /> Ship a package</Link>} />
      <StatGrid><StatTile label="On the way" value={open} icon={Truck} tone="info" /><StatTile label="Delivered" value={rows.length - open} icon={CheckCircle2} tone="success" /></StatGrid>
      <Panel flush>
        {!rows.length ? <EmptyState icon={Truck} title="No shipments yet" /> : (
          <TableWrap><table className="dt w-full"><thead><tr><th>Delivery note</th><th>For</th><th>Customer</th><th>Carrier</th><th>Driver</th><th>Status</th><th>Date</th><th /></tr></thead><tbody>
            <PagedRows rows={rows} colSpan={8}>{(pageRows) => pageRows.map((r) => (
              <tr key={r.id}>
                <td className="font-semibold">{r.delivery_number}</td><td>{r.source_number || "—"}</td><td>{r.customer_name}</td><td>{r.carrier || "—"}{r.tracking_number ? ` · ${r.tracking_number}` : ""}</td><td>{r.rider_name || "—"}</td>
                <td><Pill tone={STATUS_TONE[r.status] || "muted"}>{r.status}</Pill></td><td>{fmtD(r.ship_date || r.created_at)}</td>
                <td className="whitespace-nowrap text-right">
                  {r.status !== "delivered" && <Btn onClick={() => setDone(r)}><CheckCircle2 className="h-4 w-4" /> Delivered</Btn>}
                  <button onClick={() => void openStockDocument("shipment", r.id).catch((e) => toast.error(friendlyError(e)))} className="ml-1 rounded-lg p-2 hover:bg-muted" aria-label="Print delivery note"><Printer className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}</PagedRows>
          </tbody></table></TableWrap>
        )}
      </Panel>
      {done && <Modal open onClose={() => setDone(null)} title={`Delivered: ${done.delivery_number}`} footer={<><Btn onClick={() => setDone(null)}>Cancel</Btn><Btn primary onClick={() => void deliver()}>Confirm delivery</Btn></>}>
        <Field label="Received by (name)"><input className="fi" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Who signed for it" /></Field>
      </Modal>}
    </div>
  );
}

/* ======================================================================= Reorder */

export function Reorder() {
  const qc = useQueryClient();
  const { data: locs = [] } = useLocs();
  const [loc, setLoc] = useState("");
  const { data: rows = [], refetch } = useQuery({ queryKey: ["reorder", loc], queryFn: async () => ((await sb.rpc("reorder_suggestions", { p_location: loc || null })).data || []) as any[] });
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const key = (r: any) => `${r.product_id}:${r.location_id}`;
  const chosen = rows.filter((r) => pick[key(r)] && n(r.suggest) > 0);
  const makePOs = async () => {
    if (!chosen.length) return toast.error("Tick the items to order");
    if (chosen.some((r) => !r.supplier_id)) return toast.error("Some items have no supplier yet: set one in a reorder rule or buy it once first");
    setBusy(true);
    try {
      const groups = new Map<string, any[]>();
      chosen.forEach((r) => { const k = `${r.supplier_id}:${r.location_id}`; groups.set(k, [...(groups.get(k) || []), r]); });
      let made = 0;
      for (const [, list] of groups) {
        const { data: num } = await sb.rpc("next_doc_number", { p_kind: "po" });
        const total = list.reduce((a, r) => a + n(r.suggest) * n(r.unit_cost), 0);
        const { data: po, error } = await sb.from("purchases").insert({ po_number: num, supplier_id: list[0].supplier_id, supplier_name: list[0].supplier_name, location_id: list[0].location_id, order_date: new Date().toISOString().slice(0, 10), subtotal: total, tax: 0, total, status: "draft", notes: "Created from reorder suggestions" }).select("id").single();
        if (error) throw error;
        const { error: e2 } = await sb.from("purchase_items").insert(list.map((r) => ({ purchase_id: po.id, product_id: r.product_id, quantity: Math.ceil(n(r.suggest)), unit_cost: n(r.unit_cost), total: Math.ceil(n(r.suggest)) * n(r.unit_cost) })));
        if (e2) throw e2;
        made++;
      }
      toast.success(`${made} draft purchase order(s) created`, { action: { label: "Open", onClick: () => (window.location.href = "/purchases/orders") } });
      setPick({}); void refetch(); void qc.invalidateQueries({ queryKey: ["purchase-orders-z"] });
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Reorder" icon={RefreshCcw} description="Items at or below their minimum. Tick them to draft purchase orders."
        actions={<div className="flex flex-wrap gap-2"><select className="fi w-auto min-w-0" value={loc} onChange={(e) => setLoc(e.target.value)}><option value="">All locations</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select><Btn primary disabled={busy || !chosen.length} onClick={() => void makePOs()}><ShoppingCart className="h-4 w-4" /> Create {chosen.length || ""} order lines</Btn></div>} />
      <Panel flush>
        {!rows.length ? <EmptyState icon={CheckCircle2} title="Nothing to reorder" description="Set minimum levels on items (reorder level) or reorder rules per location." /> : (
          <TableWrap><table className="dt w-full"><thead><tr><th /><th>Item</th><th>Location</th><th className="text-right">On hand</th><th className="text-right">On order</th><th className="text-right">Min / max</th><th className="text-right">Order</th><th>Supplier</th></tr></thead><tbody>
            <PagedRows rows={rows} colSpan={8}>{(pageRows) => pageRows.map((r) => (
              <tr key={key(r)}>
                <td><input type="checkbox" checked={!!pick[key(r)]} onChange={(e) => setPick({ ...pick, [key(r)]: e.target.checked })} aria-label="Order this" /></td>
                <td className="font-medium">{r.name}<span className="block text-xs text-muted-foreground">{r.sku}</span></td><td>{r.location_name}</td>
                <td className="text-right tabular-nums">{n(r.on_hand)}</td><td className="text-right tabular-nums">{n(r.on_order)}</td><td className="text-right tabular-nums">{n(r.min_qty)} / {n(r.max_qty)}</td>
                <td className="text-right font-semibold tabular-nums">{Math.ceil(n(r.suggest))}</td><td>{r.supplier_name || <span className="text-destructive">none</span>}</td>
              </tr>
            ))}</PagedRows>
          </tbody></table></TableWrap>
        )}
      </Panel>
      <ReorderRules />
    </div>
  );
}

function ReorderRules() {
  const qc = useQueryClient();
  const { data: locs = [] } = useLocs();
  const { data: products = [] } = useProds();
  const { data: suppliers = [] } = useQuery({ queryKey: ["wh-suppliers"], queryFn: async () => ((await sb.from("suppliers").select("id,name").eq("is_active", true).order("name")).data || []) as any[] });
  const { data: rules = [] } = useQuery({ queryKey: ["wh-rules"], queryFn: async () => ((await sb.from("wh_reorder_rules").select("*, products(name)").limit(1000)).data || []) as any[] });
  const [f, setF] = useState<any>({ product_id: "", location_id: "", min_qty: 10, max_qty: 50, supplier_id: "", lead_days: 7 });
  const add = () => act(async () => {
    if (!f.product_id || !f.location_id) throw new Error("Choose the item and location");
    const { error } = await sb.from("wh_reorder_rules").upsert({ ...f, supplier_id: f.supplier_id || null }, { onConflict: "product_id,location_id" });
    if (error) throw error;
  }, "Rule saved", () => { void qc.invalidateQueries({ queryKey: ["wh-rules"] }); void qc.invalidateQueries({ queryKey: ["reorder"] }); });
  return (
    <Panel title="Reorder rules" icon={ClipboardList} description="Minimum and maximum per item and location, with the preferred supplier.">
      <div className="grid gap-2 md:grid-cols-[2fr_1fr_90px_90px_1fr_auto]">
        <select className="fi" value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}><option value="">Item…</option>{products.filter((p) => p.product_type !== "service").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="fi" value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}><option value="">Location…</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <input className="fi" type="number" value={f.min_qty} onChange={(e) => setF({ ...f, min_qty: Number(e.target.value) })} aria-label="Minimum" title="Minimum" />
        <input className="fi" type="number" value={f.max_qty} onChange={(e) => setF({ ...f, max_qty: Number(e.target.value) })} aria-label="Maximum" title="Maximum" />
        <select className="fi" value={f.supplier_id} onChange={(e) => setF({ ...f, supplier_id: e.target.value })}><option value="">Supplier…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <Btn primary onClick={() => void add()}><Plus className="h-4 w-4" /></Btn>
      </div>
      {rules.length > 0 && <ul className="mt-3 divide-y divide-border text-sm"><PagedRows rows={rules} list>{(pageRows) => pageRows.map((r) => <li key={r.id} className="flex justify-between py-1.5"><span>{r.products?.name} · {locs.find((l) => l.id === r.location_id)?.name}</span><span className="tabular-nums text-muted-foreground">min {n(r.min_qty)} · max {n(r.max_qty)} · {suppliers.find((s) => s.id === r.supplier_id)?.name || "any supplier"}</span></li>)}</PagedRows></ul>}
    </Panel>
  );
}
