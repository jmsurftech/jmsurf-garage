import { useMemo, useState, useRef, useEffect } from "react";
import { ShareLinkModal } from "@/components/books/ShareLink";
import { Link2 } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { DocPane, SplitView } from "@/components/books/DocPane";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Mail, MessageCircle, Smartphone, Send, FileMinus, Receipt, Plus, Search, Ban, Wallet, CalendarClock, AlertTriangle, CheckCircle2, Truck, Save, Download, Undo2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessSettings } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, Pill, TableWrap } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import Pager, { usePaged } from "@/components/Pager";
import { useSelection, BulkBar, Tick, downloadCsv } from "@/components/Bulk";
import { DocumentPreview } from "@/components/print/document-pdf-view";
import DocumentsPanel, { uploadDocument } from "@/components/DocumentsPanel";
import { confirmAction } from "@/components/books/confirm";
import { emailDocument, shareOnWhatsApp } from "@/lib/docSend";
import { sendShopMessage } from "@/lib/messaging";
import { useUnsavedGuard } from "@/lib/unsaved";
import type { DocumentKind } from "@/lib/docModels";
import { fmtDate } from "@/lib/doc-pdf";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

const sb: any = supabase;
const today = () => new Date().toISOString().slice(0, 10);
type Sup = { id?: string | null; name?: string | null; email?: string | null; phone?: string | null; contact_person?: string | null };

export function useSupplier(id?: string | null) {
  return useQuery({ queryKey: ["supplier-lite", id], enabled: !!id, queryFn: async () => (await sb.from("suppliers").select("id,name,email,phone,contact_person,withholding_vat").eq("id", id).maybeSingle()).data as Sup | null });
}

/** Send a purchase document (PDF) or a message to the supplier: email, WhatsApp or SMS. */
export function SupplierShare({ kind, id, supplier, subject, message, compact, autoOpen }: { kind: DocumentKind; id: string; supplier?: Sup | null; subject: string; message: string; compact?: boolean; autoOpen?: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ to: "", subject, message });
  const [busy, setBusy] = useState("");
  const [link, setLink] = useState(false);
  const start = () => { setF({ to: supplier?.email || "", subject, message }); setOpen(true); };
  // "Save and Send" on a new document opens this straight away (once the vendor's details are loaded).
  const opened = useRef(false);
  useEffect(() => { if (autoOpen && !opened.current && supplier !== undefined) { opened.current = true; start(); } }, [autoOpen, supplier]); // eslint-disable-line react-hooks/exhaustive-deps
  const email = async () => {
    const to = f.to.split(/[,;\s]+/).filter((x) => /@/.test(x));
    if (!to.length) return toast({ title: "Enter the supplier's email", variant: "destructive" });
    setBusy("email");
    try { await emailDocument({ kind, id, to, subject: f.subject, message: f.message }); toast({ title: `Sent to ${to.join(", ")}` }); setOpen(false); }
    catch (e: any) { toast({ title: "Email not sent", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  };
  const sms = async () => {
    if (!supplier?.phone) return toast({ title: "Add the supplier's phone number first", variant: "destructive" });
    setBusy("sms");
    try { const r: any = await sendShopMessage("sms", supplier.phone, f.message); if (r?.ok === false) throw new Error(r.error || "Not sent"); toast({ title: "SMS sent" }); setOpen(false); }
    catch (e: any) { toast({ title: "SMS not sent", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  };
  return (
    <>
      <Button size={compact ? "sm" : "default"} variant="outline" onClick={start}><Send /> Send to supplier</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Send to supplier" icon={Send} description={supplier?.name || undefined}
        footer={<div className="flex w-full flex-wrap gap-2">
          <Button onClick={email} disabled={!!busy}>{busy === "email" ? <OrbSpinner /> : <Mail />} Email with PDF</Button>
          <Button variant="outline" onClick={() => { shareOnWhatsApp(supplier?.phone, f.message); setOpen(false); }}><MessageCircle /> WhatsApp</Button>
          <Button variant="outline" onClick={sms} disabled={!!busy}>{busy === "sms" ? <OrbSpinner /> : <Smartphone />} SMS</Button>
          <Button variant="outline" onClick={() => { setOpen(false); setLink(true); }}><Link2 /> Share link</Button>
        </div>}>
        <div className="space-y-3">
          <Field label="Email to" hint="Separate several addresses with commas"><input className="fi" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} placeholder="Enter email address" /></Field>
          <Field label="Subject"><input className="fi" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
          <Field label="Message" hint="The same text is used for WhatsApp and SMS."><textarea className="fi min-h-[150px]" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
          <p className="text-xs text-muted-foreground">Phone on file: {supplier?.phone || "none"}</p>
        </div>
      </Modal>
      {link && <ShareLinkModal kind={kind} id={id} title={subject} phone={supplier?.phone} email={supplier?.email} onClose={() => setLink(false)} />}
    </>
  );
}

/** Message about what did not arrive. */
export function shortfallMessage(shop: string, po: { po_number?: string | null; supplier_name?: string | null }, receivedOn: string, short: any[], expected?: string | null) {
  const later = short.filter((x) => x.action === "later"), gone = short.filter((x) => x.action !== "later");
  const line = (x: any) => `• ${x.name}: ${Number(x.quantity)}${x.reason ? ` (${x.reason})` : ""}`;
  return [
    `Hello ${po.supplier_name || ""},`.trim(),
    ``,
    `We received your delivery for ${po.po_number || "our order"} on ${fmtDate(receivedOn)}. Thank you.`,
    later.length ? `\nStill to be delivered:\n${later.map(line).join("\n")}${expected ? `\nPlease deliver these by ${fmtDate(expected)}.` : ""}` : "",
    gone.filter((x) => x.action === "damaged").length ? `\nDamaged / rejected:\n${gone.filter((x) => x.action === "damaged").map(line).join("\n")}` : "",
    gone.filter((x) => x.action === "cancel").length ? `\nNot delivered (cancelled from the order):\n${gone.filter((x) => x.action === "cancel").map(line).join("\n")}` : "",
    gone.length ? `\nPlease send us a credit note for the damaged and cancelled items, or bill only what was delivered.` : "",
    ``,
    `Regards,\n${shop}`,
  ].filter((x) => x !== "").join("\n");
}

/* ───────────────────────── New purchase receive (style) ───────────────────────── */

type RLot = { batch: string; expiry: string; qty: string };
type RLine = { id: string; name: string; unit?: string | null; ordered: number; received: number; cancelled: number; left: number; cost: number; qty: string; action: "later" | "cancel" | "damaged"; reason: string; lots: RLot[]; serials: string; trackBatches: boolean; trackSerials: boolean };

/** Serial numbers typed or scanned: one per line, or separated by commas. */
export const parseSerials = (t: string) => [...new Set(t.split(/[\n,;\t]+/).map((x) => x.trim()).filter(Boolean))];
const lotSum = (l: RLine) => l.lots.reduce((a, x) => a + (Number(x.qty) || 0), 0);
const qtyNow = (l: RLine) => Math.min(l.left, Math.max(0, Number(l.qty) || 0));
/** How the received quantity of a line splits into batches (a single batch takes it all). */
const lotRows = (l: RLine, qty: number) => (l.lots.length <= 1 ? [{ ...(l.lots[0] || { batch: "", expiry: "" }), qty: String(qty) }] : l.lots);

export function ReceiveForm() {
  const [params] = useSearchParams();
  const poId = params.get("po");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: biz } = useBusinessSettings();
  const { data: po, isLoading } = useQuery({
    queryKey: ["receive-po", poId], enabled: !!poId,
    queryFn: async () => (await sb.from("purchases").select("*, purchase_items(*, products(name, unit, track_batches, track_serials))").eq("id", poId).maybeSingle()).data,
  });
  const { data: supplier } = useSupplier(po?.supplier_id);
  const [lines, setLines] = useState<RLine[] | null>(null);
  const [head, setHead] = useState({ date: today(), notes: "", expected: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const rcvTenant = useTenantId();
  const [done, setDone] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty && !done && !busy);
  if (po && !lines) {
    setLines(((po.purchase_items || []) as any[]).map((i) => {
      const left = Number(i.quantity) - Number(i.received_quantity) - Number(i.cancelled_quantity || 0);
      return { id: i.id, name: i.products?.name || "Item", unit: i.products?.unit, ordered: Number(i.quantity), received: Number(i.received_quantity), cancelled: Number(i.cancelled_quantity || 0), left, cost: Number(i.unit_cost), qty: String(Math.max(0, left)), action: "later" as RLine["action"], reason: "", lots: [{ batch: "", expiry: "", qty: "" }], serials: "", trackBatches: !!i.products?.track_batches, trackSerials: !!i.products?.track_serials };
    }).filter((l) => l.left > 0));
  }
  if (!poId) return <EmptyState icon={PackageCheck} title="Choose a purchase order" description="Open a purchase order and press Receive." action={<Button onClick={() => navigate("/purchases/orders")}>Purchase orders</Button>} />;
  if (isLoading || !po || !lines) return <OrbLoader label="Loading the order…" />;

  const set = (i: number, p: Partial<RLine>) => { setDirty(true); setLines((ls) => ls!.map((l, j) => (j === i ? { ...l, ...p } : l))); };
  const shortOf = (l: RLine) => Math.max(0, l.left - Math.min(l.left, Math.max(0, Number(l.qty) || 0)));
  const shorts = lines.filter((l) => shortOf(l) > 0);
  const anyLater = shorts.some((l) => l.action === "later");
  const receivedValue = lines.reduce((a, l) => a + Math.min(l.left, Number(l.qty) || 0) * l.cost, 0);
  const shortValue = shorts.filter((l) => l.action !== "later").reduce((a, l) => a + shortOf(l) * l.cost, 0);

  const save = async () => {
    for (const l of lines) if ((Number(l.qty) || 0) > l.left) return toast({ title: `${l.name}: only ${l.left} still to come`, variant: "destructive" });
    for (const l of lines) {
      const q = qtyNow(l);
      if (q <= 0) continue;
      const rows = lotRows(l, q);
      if (l.lots.length > 1 && Math.abs(lotSum(l) - q) > 0.0001) return toast({ title: `${l.name}: the batches add up to ${lotSum(l)}, not ${q}`, variant: "destructive" });
      if (l.trackBatches && rows.some((x) => !x.batch.trim())) return toast({ title: `${l.name} needs a batch number`, variant: "destructive" });
      if (l.trackSerials && parseSerials(l.serials).length !== q) return toast({ title: `${l.name}: enter ${q} serial number(s)`, description: `${parseSerials(l.serials).length} entered.`, variant: "destructive" });
    }
    if (anyLater && !head.expected) return toast({ title: "When will the rest be delivered?", description: "Pick the expected date so you are reminded.", variant: "destructive" });
    setBusy(true);
    // Batches, expiry dates and serial numbers are saved with the receive (all or nothing).
    const lots = lines.flatMap((l) => {
      const q = qtyNow(l);
      if (q <= 0) return [];
      const serials = parseSerials(l.serials);
      return lotRows(l, q).map((x, k) => ({ item_id: l.id, quantity: Number(x.qty) || 0, batch_number: x.batch.trim() || null, expiry_date: x.expiry || null, serials: k === 0 ? serials : [] }));
    });
    const { data, error } = await sb.rpc("receive_purchase_tracked", {
      p_purchase: po.id, p_lots: lots,
      p_lines: lines.map((l) => ({ item_id: l.id, quantity: Math.min(l.left, Number(l.qty) || 0) })),
      p_shortfall: shorts.map((l) => ({ item_id: l.id, quantity: shortOf(l), action: l.action, reason: l.reason.trim() || null })),
      p_received_date: head.date, p_notes: head.notes, p_expected: anyLater ? head.expected : null, p_update_cost: true,
    });
    setBusy(false);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    ["purchase-orders-z", "purchase-receives", "po-receives", "products", "product-stocks", "zitems", "calendar", "product_batches", "product-serials"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    // Delivery note, photos of the goods and the like stay with the receive.
    for (const file of files) await uploadDocument(rcvTenant!, file, { entity_type: "purchase_receive", entity_id: data.receive_id, entity_name: data.receive_number, category: "Attachment", name: file.name }).catch(() => null);
    setDirty(false);
    setDone({ ...data, shortValue, short: data.shortfall || [] });
    toast({ title: `Received · ${data.receive_number}`, description: shorts.length ? "Stock added; the missing items are flagged." : "Everything arrived. Stock added." });
  };

  if (done) {
    const msg = shortfallMessage(biz?.business_name || "JMSURF Garage", po, head.date, done.short, anyLater ? head.expected : null);
    const cancelled = (done.short as any[]).filter((x) => x.action !== "later");
    return (
      <div className="mx-auto max-w-4xl space-y-5">
        <PageHeader title={`${done.receive_number} saved`} icon={CheckCircle2} description={`${po.po_number} · ${po.supplier_name}`} />
        <Panel>
          <div className="space-y-3">
            <p className="text-sm">Stock for what arrived is added. {done.short.length ? <>These were <b>not delivered</b>:</> : "Everything on the order has arrived."}</p>
            {done.short.length > 0 && <ul className="space-y-1 text-sm">{(done.short as any[]).map((x, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2"><span><b>{x.name}</b>: {Number(x.quantity)}</span>
                <Pill tone={x.action === "later" ? "warning" : "danger"}>{x.action === "later" ? `Coming ${anyLater ? fmtDate(head.expected) : "later"}` : x.action === "damaged" ? "Damaged / rejected" : "Not available"}</Pill></li>
            ))}</ul>}
            {anyLater && <p className="flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm"><CalendarClock className="h-4 w-4" /> A reminder is set for {fmtDate(head.expected)} (calendar and bell) to follow up the delivery.</p>}
          </div>
        </Panel>
        <div className="flex flex-wrap gap-2">
          {done.short.length > 0 && <SupplierShare kind="purchase_receive" id={done.receive_id} supplier={supplier} subject={`${po.po_number}: delivery received with items missing`} message={msg} />}
          {!po.billed && <Button onClick={() => navigate(`/purchases/orders/${po.id}?bill=1`)}><Receipt /> Convert to bill</Button>}
          {po.billed && cancelled.length > 0 && <Button onClick={() => navigate(`/purchases/vendor-credits/new?receive=${done.receive_id}`)}><FileMinus /> Create vendor credit · {formatKES(done.shortValue)}</Button>}
          <Button variant="outline" onClick={() => navigate(`/purchases/receives?open=${done.receive_id}`)}><PackageCheck /> View receive</Button>
          <Button variant="ghost" onClick={() => navigate(`/purchases/orders/${po.id}`)}><Truck /> Back to the order</Button>
        </div>
        {po.billed && cancelled.length > 0 && <p className="text-sm text-muted-foreground">This order is already billed in full. A vendor credit for the missing items reduces what you owe the supplier.</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-24">
      <PageHeader title="New Purchase Receive" icon={PackageCheck} description={`${po.po_number} · ${po.supplier_name}`} />
      <Panel>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Purchase order"><input className="fi" value={po.po_number || ""} readOnly /></Field>
          <Field label="Received date" required><input className="fi" type="date" value={head.date} max={today()} onChange={(e) => { setDirty(true); setHead({ ...head, date: e.target.value }); }} /></Field>
          <Field label="Vendor"><input className="fi" value={po.supplier_name || ""} readOnly /></Field>
        </div>
      </Panel>
      <Panel flush title="Items" description="Type what actually arrived. Anything short is flagged: choose whether it is coming later, not available, or damaged.">
        <div className="overflow-x-auto">
          <table className="dt dt-keep min-w-[1240px]">
            <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received before</th><th className="num">To come</th><th className="num">Received now</th><th>Batch · Expiry · Qty</th><th>Serial numbers</th><th className="num">Short</th><th>The rest is…</th><th>Note</th></tr></thead>
            <tbody>{lines.map((l, i) => {
              const short = shortOf(l);
              return (
                <tr key={l.id} className={cn(short > 0 && "bg-warning/5")}>
                  <td><span className="font-medium">{l.name}</span>{l.unit && <span className="block text-xs text-muted-foreground">{l.unit}</span>}</td>
                  <td className="num">{l.ordered}</td>
                  <td className="num">{l.received}{l.cancelled ? <span className="block text-xs text-muted-foreground">{l.cancelled} cancelled</span> : null}</td>
                  <td className="num font-semibold">{l.left}</td>
                  <td className="num"><input className="fi h-9 w-24 text-right" type="number" min={0} max={l.left} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} /></td>
                  <td>
                    <div className="space-y-1.5">
                      {l.lots.map((x, k) => (
                        <div key={k} className="flex items-center gap-1.5">
                          <input className="fi h-9 w-32" value={x.batch} onChange={(e) => set(i, { lots: l.lots.map((y, j) => (j === k ? { ...y, batch: e.target.value } : y)) })} placeholder={l.trackBatches ? "Batch (required)" : "Batch"} aria-label="Batch number" />
                          <input className="fi h-9 w-36" type="date" value={x.expiry} onChange={(e) => set(i, { lots: l.lots.map((y, j) => (j === k ? { ...y, expiry: e.target.value } : y)) })} aria-label="Expiry date" />
                          {l.lots.length > 1 && <input className="fi h-9 w-24 text-right" type="number" min={0} value={x.qty} onChange={(e) => set(i, { lots: l.lots.map((y, j) => (j === k ? { ...y, qty: e.target.value } : y)) })} placeholder="Qty" aria-label="Batch quantity" />}
                          {l.lots.length > 1 && <button type="button" className="icon-btn-danger" onClick={() => set(i, { lots: l.lots.filter((_, j) => j !== k) })} aria-label="Remove batch"><Trash2 className="h-4 w-4" /></button>}
                        </div>
                      ))}
                      <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => {
                        const q = qtyNow(l);
                        const lots = l.lots.length === 1 ? [{ ...l.lots[0], qty: String(q) }, { batch: "", expiry: "", qty: "0" }] : [...l.lots, { batch: "", expiry: "", qty: String(Math.max(0, q - lotSum(l))) }];
                        set(i, { lots });
                      }}><Plus className="mr-0.5 inline h-3 w-3" />Split into batches</button>
                      {l.lots.length > 1 && <p className={cn("text-[11px]", Math.abs(lotSum(l) - qtyNow(l)) > 0.0001 ? "text-destructive" : "text-muted-foreground")}>Batches: {lotSum(l)} of {qtyNow(l)}</p>}
                    </div>
                  </td>
                  <td>
                    {l.trackSerials ? (
                      <>
                        <textarea className="fi min-h-[38px] w-48 font-mono text-xs" rows={2} value={l.serials} onChange={(e) => set(i, { serials: e.target.value })} placeholder="Scan or type, one per line" aria-label="Serial numbers" />
                        <p className={cn("text-[11px]", parseSerials(l.serials).length !== qtyNow(l) ? "text-destructive" : "text-muted-foreground")}>{parseSerials(l.serials).length} of {qtyNow(l)}</p>
                      </>
                    ) : <span className="text-xs text-muted-foreground">Not tracked</span>}
                  </td>
                  <td className={cn("num font-semibold", short > 0 ? "text-destructive" : "text-muted-foreground")}>{short || "—"}</td>
                  <td>{short > 0 ? (
                    <select className="fi h-9 w-48" value={l.action} onChange={(e) => set(i, { action: e.target.value as RLine["action"] })}>
                      <option value="later">Coming later</option><option value="cancel">Not available (cancel)</option><option value="damaged">Damaged / rejected</option>
                    </select>) : <span className="text-xs text-success">All arrived</span>}</td>
                  <td>{short > 0 ? <input className="fi h-9 w-44" value={l.reason} onChange={(e) => set(i, { reason: e.target.value })} placeholder="Optional" /> : null}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
          <Button size="sm" variant="ghost" onClick={() => { setDirty(true); setLines(lines.map((l) => ({ ...l, qty: String(l.left) }))); }}>Everything arrived</Button>
          <Button size="sm" variant="ghost" onClick={() => { setDirty(true); setLines(lines.map((l) => ({ ...l, qty: "0" }))); }}>Clear quantities</Button>
        </div>
      </Panel>
      {shorts.length > 0 && (
        <Panel title="What did not arrive" icon={AlertTriangle}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 text-sm">{shorts.map((l) => <p key={l.id}><b>{l.name}</b>: {shortOf(l)} · {l.action === "later" ? "coming later" : l.action === "damaged" ? "damaged" : "not available"} · {formatKES(shortOf(l) * l.cost)}</p>)}</div>
            {anyLater && <Field label="The rest is expected on" required hint="You get a reminder on this date (bell and calendar)."><input className="fi" type="date" min={today()} value={head.expected} onChange={(e) => { setDirty(true); setHead({ ...head, expected: e.target.value }); }} /></Field>}
          </div>
          {shortValue > 0 && <p className="mt-3 text-sm text-muted-foreground">{po.billed ? `This order is already billed. After saving you can raise a vendor credit for ${formatKES(shortValue)}.` : `When you convert to a bill, only what arrived is billed (${formatKES(receivedValue)} on this receive).`}</p>}
        </Panel>
      )}
      <Panel title="Notes"><textarea className="fi min-h-[70px]" value={head.notes} onChange={(e) => { setDirty(true); setHead({ ...head, notes: e.target.value }); }} placeholder="Enter notes, e.g. packaging torn on 2 cartons" /></Panel>
      <Panel title="Attach File(s)" description="The vendor's delivery note, photos of the goods. Up to 5 files, 10MB each.">
        <label className="flex max-w-md cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm hover:border-primary"><Download className="h-4 w-4 rotate-180 text-muted-foreground" /> Upload File
          <input type="file" multiple className="hidden" onChange={(e) => { const add = Array.from(e.target.files || []).filter((x) => x.size <= 10 * 1024 * 1024); setFiles((cur) => [...cur, ...add].slice(0, 5)); e.target.value = ""; }} /></label>
        {files.length > 0 && <ul className="mt-2 max-w-md space-y-1 text-sm">{files.map((x, i) => <li key={i} className="flex items-center gap-2 rounded-lg bg-muted/60 px-2 py-1"><span className="flex-1 truncate">{x.name}</span><button type="button" className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${x.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></li>)}</ul>}
      </Panel>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
          <Button onClick={save} disabled={busy}>{busy ? <OrbSpinner /> : <Save />} Save receive</Button>
          <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
          <span className="ml-auto text-sm text-muted-foreground">Received now: <b className="text-foreground">{formatKES(receivedValue)}</b>{shorts.length ? ` · short ${shorts.reduce((a, l) => a + shortOf(l), 0)} item(s)` : ""}</span>
        </div>
      </div>
    </div>
  );
}

/** Receive detail: the goods received note, what is missing, message the supplier, vendor credit. */
export function ReceiveDetail({ r, onClose }: { r: any; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: biz } = useBusinessSettings();
  const { data: supplier } = useSupplier(r.supplier_id);
  const { data: po } = useQuery({ queryKey: ["receive-po-lite", r.purchase_id], queryFn: async () => (await sb.from("purchases").select("id,po_number,supplier_name,billed").eq("id", r.purchase_id).maybeSingle()).data });
  const short = (r.shortfall || []) as any[];
  const gone = short.filter((x) => x.action !== "later");
  return (
    <DocPane title={r.receive_number} subtitle={`${r.supplier_name} · ${fmtDate(r.received_date)}`} onClose={onClose}
      actions={<>
        <SupplierShare kind="purchase_receive" id={r.id} supplier={supplier} subject={`${po?.po_number || "Order"}: goods received (${r.receive_number})`}
          message={short.length ? shortfallMessage(biz?.business_name || "JMSURF Garage", { po_number: po?.po_number, supplier_name: r.supplier_name }, r.received_date, short, r.expected_rest_on) : `Hello ${r.supplier_name || ""}, we received your delivery for ${po?.po_number || "our order"} on ${fmtDate(r.received_date)} in full. Thank you.`} />
        {po?.billed && gone.length > 0 && <Button variant="outline" onClick={() => navigate(`/purchases/vendor-credits/new?receive=${r.id}`)}><FileMinus /> Vendor credit</Button>}
        {po && !po.billed && <Button variant="outline" onClick={() => navigate(`/purchases/orders/${po.id}?bill=1`)}><Receipt /> Convert to bill</Button>}
        <Button variant="ghost" onClick={() => navigate(`/purchases/orders/${r.purchase_id}`)}><Truck /> Purchase order</Button>
      </>}>
      <div className="space-y-4">
        {short.length > 0 && (
          <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm">
            <p className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-warning" /> Not delivered</p>
            <ul className="space-y-0.5">{short.map((x, i) => <li key={i}>{x.name}: <b>{Number(x.quantity)}</b> · {x.action === "later" ? `coming later${r.expected_rest_on ? ` (expected ${fmtDate(r.expected_rest_on)})` : ""}` : x.action === "damaged" ? "damaged / rejected" : "not available"}{x.reason ? ` · ${x.reason}` : ""}</li>)}</ul>
          </div>
        )}
        <DocumentPreview kind="purchase_receive" id={r.id} />
        <DocumentsPanel entityType="purchase_receive" entityId={r.id} entityName={String(r.receive_number || "")} />
      </div>
    </DocPane>
  );
}

/* ───────────────────────── Vendor credits ───────────────────────── */

const VC_TONE: Record<string, "success" | "info" | "muted" | "danger"> = { open: "info", closed: "success", draft: "muted", void: "danger" };
const vcLeft = (c: any) => Math.max(0, Number(c.amount) - Number(c.amount_applied || 0) - Number(c.amount_refunded || 0));

export function VendorCredits() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const [q, setQ] = useState("");
  const [view, setView] = useState("all");
  const { data = [], isLoading } = useQuery({
    queryKey: ["vendor-credits", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("vendor_credits").select("*, bills(bill_number), purchases(po_number)").eq("tenant_id", tenantId).order("credit_date", { ascending: false, nullsFirst: false }).order("credit_number", { ascending: false }).order("created_at", { ascending: false }).limit(2000)).data || []) as any[],
  });
  const rows = useMemo(() => data.filter((c) => (view === "all" || c.status === view) && (!q.trim() || `${c.credit_number} ${c.supplier_name} ${c.reason || ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [data, q, view]);
  const paged = usePaged(rows, 25);
  const sel = useSelection(paged.rows.map((c: any) => c.id));
  if (id === "new") return <VendorCreditForm />;
  const open = id ? data.find((c) => c.id === id) : null;
  if (isLoading) return <OrbLoader label="Loading vendor credits…" />;
  if (open) return (
    <SplitView heading="All Vendor Credits" newHref="/purchases/vendor-credits/new" activeId={open.id}
      rows={rows.map((c: any) => ({ id: c.id, href: `/purchases/vendor-credits/${c.id}`, title: c.supplier_name || "—", amount: formatKES(Number(c.amount)), sub: `${c.credit_number} · ${fmtDate(c.credit_date)}`, status: c.status, tone: c.status === "closed" ? "success" : c.status === "void" ? "danger" : undefined }))}>
      <VendorCreditDetail c={open} onClose={() => navigate("/purchases/vendor-credits")} />
    </SplitView>
  );
  return (
    <div className="space-y-5">
      <PageHeader title="Vendor Credits" icon={FileMinus} description="Credit from suppliers for goods not delivered, damaged or returned. Apply it to their bills or record a refund."
        actions={<Button onClick={() => navigate("/purchases/vendor-credits/new")}><Plus /> New vendor credit</Button>} />
      <StatGrid className="lg:grid-cols-3">
        <StatTile label="Unused credit" value={formatKES(data.filter((c) => c.status === "open").reduce((a, c) => a + vcLeft(c), 0))} icon={FileMinus} tone="info" />
        <StatTile label="Applied to bills" value={formatKES(data.reduce((a, c) => a + Number(c.amount_applied || 0), 0))} icon={Receipt} tone="success" />
        <StatTile label="Refunded" value={formatKES(data.reduce((a, c) => a + Number(c.amount_refunded || 0), 0))} icon={Undo2} tone="muted" />
      </StatGrid>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-muted p-1">{["all", "open", "closed", "void"].map((v) => <button key={v} onClick={() => setView(v)} className={cn("rounded-lg px-3 py-1.5 text-sm capitalize", view === v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{v}</button>)}</div>
        <div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <Panel flush>
        {rows.length === 0 ? <EmptyState icon={FileMinus} title="No vendor credits" description="Raise one when a supplier bills for goods that did not arrive or came damaged." /> : <>
          <BulkBar sel={sel} noun="credit"><Button size="sm" variant="outline" onClick={() => downloadCsv("vendor-credits.csv", ["Number", "Date", "Supplier", "Reason", "Amount", "Applied", "Refunded", "Left", "Status"], data.filter((c) => sel.has(c.id)).map((c) => [c.credit_number, c.credit_date, c.supplier_name, c.reason, c.amount, c.amount_applied, c.amount_refunded, vcLeft(c), c.status]))}><Download /> Export</Button></BulkBar>
          <TableWrap><table className="dt">
            <thead><tr><th className="w-10"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} /></th><th>Date</th><th>Credit#</th><th>Supplier</th><th className="hidden md:table-cell">Reason</th><th>Status</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
            <tbody>{(paged.rows as any[]).map((c) => (
              <tr key={c.id} className={cn("cursor-pointer", sel.has(c.id) && "bg-primary/5")} onClick={() => navigate(`/purchases/vendor-credits/${c.id}`)}>
                <td data-label=""><Tick on={sel.has(c.id)} onChange={() => sel.toggle(c.id)} /></td>
                <td>{fmtDate(c.credit_date)}</td><td className="font-semibold text-primary">{c.credit_number}</td><td>{c.supplier_name}</td>
                <td className="hidden max-w-[220px] truncate text-muted-foreground md:table-cell">{c.reason || "—"}</td>
                <td><Pill tone={VC_TONE[c.status]}>{c.status}</Pill></td><td className="num">{formatKES(Number(c.amount))}</td><td className="num font-semibold">{formatKES(vcLeft(c))}</td>
              </tr>
            ))}</tbody>
          </table></TableWrap>
          <Pager {...paged.pager} />
        </>}
      </Panel>
    </div>
  );
}

function VendorCreditForm() {
  const [params] = useSearchParams();
  const receiveId = params.get("receive");
  const billId = params.get("bill");
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const { profile } = useAuth() as any;
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: suppliers = [] } = useQuery({ queryKey: ["vc-suppliers", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("suppliers").select("id,name").eq("tenant_id", tenantId).order("name")).data || [] });
  const { data: seed } = useQuery({
    queryKey: ["vc-seed", receiveId, billId], enabled: !!(receiveId || billId),
    queryFn: async () => {
      if (receiveId) {
        const { data: r } = await sb.from("purchase_receives").select("*, purchases(id, po_number, supplier_id, supplier_name)").eq("id", receiveId).maybeSingle();
        const { data: b } = r ? await sb.from("bills").select("id,bill_number").eq("purchase_id", r.purchase_id).neq("status", "void").order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
        return { supplier_id: r?.purchases?.supplier_id || r?.supplier_id, supplier_name: r?.supplier_name, purchase_id: r?.purchase_id, bill_id: b?.id || null, receive_id: r?.id,
          reason: `Goods not delivered on ${r?.receive_number || "receive"}`, items: ((r?.shortfall || []) as any[]).filter((x) => x.action !== "later").map((x) => ({ name: x.name, quantity: Number(x.quantity), unit_cost: Number(x.unit_cost || 0), reason: x.action === "damaged" ? "Damaged / rejected" : "Not available" })) };
      }
      const { data: b } = await sb.from("bills").select("id,bill_number,supplier_id,purchase_id,suppliers(name)").eq("id", billId).maybeSingle();
      return { supplier_id: b?.supplier_id, supplier_name: b?.suppliers?.name, purchase_id: b?.purchase_id, bill_id: b?.id, receive_id: null, reason: `Credit on ${b?.bill_number || "bill"}`, items: [] };
    },
  });
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  if (!f && (seed || (!receiveId && !billId))) setF({ supplier_id: seed?.supplier_id || "", reason: seed?.reason || "", credit_date: today(), notes: "", items: seed?.items?.length ? seed.items : [{ name: "", quantity: 1, unit_cost: "", reason: "" }], apply: !!seed?.bill_id });
  if (!f) return <OrbLoader label="Preparing…" />;
  const total = f.items.reduce((a: number, l: any) => a + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0);
  const setItem = (i: number, p: any) => setF({ ...f, items: f.items.map((l: any, j: number) => (j === i ? { ...l, ...p } : l)) });
  const save = async () => {
    if (!f.supplier_id) return toast({ title: "Choose the supplier", variant: "destructive" });
    if (!(total > 0)) return toast({ title: "Enter the items and amounts", variant: "destructive" });
    setBusy(true);
    const sup = (suppliers as any[]).find((s) => s.id === f.supplier_id);
    const { data, error } = await sb.from("vendor_credits").insert({
      tenant_id: tenantId, supplier_id: f.supplier_id, supplier_name: sup?.name || seed?.supplier_name, purchase_id: seed?.purchase_id || null, bill_id: seed?.bill_id || null, receive_id: seed?.receive_id || null,
      credit_date: f.credit_date, reason: f.reason || null, notes: f.notes || null, amount: Math.round(total * 100) / 100, status: "open", created_by_name: profile?.display_name || null,
      items: f.items.filter((l: any) => l.name && Number(l.quantity) > 0).map((l: any) => ({ ...l, amount: Number(l.quantity) * Number(l.unit_cost) })),
    }).select("*").single();
    if (error) { setBusy(false); return toast({ title: "Not saved", description: error.message, variant: "destructive" }); }
    if (f.apply && seed?.bill_id) {
      const { data: b } = await sb.from("bills").select("amount,amount_paid").eq("id", seed.bill_id).maybeSingle();
      const due = b ? Number(b.amount) - Number(b.amount_paid) : 0;
      const amt = Math.min(due, Number(data.amount));
      if (amt > 0) { const r = await sb.rpc("apply_vendor_credit", { p_credit: data.id, p_bill: seed.bill_id, p_amount: amt }); if (r.error) toast({ title: "Credit saved, not applied", description: r.error.message, variant: "destructive" }); }
    }
    setBusy(false);
    ["vendor-credits", "bills-z", "bill-payments", "purchase-orders-z"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    toast({ title: `${data.credit_number} created` });
    navigate(`/purchases/vendor-credits/${data.id}`);
  };
  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-20">
      <PageHeader title="New Vendor Credit" icon={FileMinus} description={seed?.receive_id ? "For items billed but not delivered or damaged on a purchase receive." : "Credit the supplier owes you."} />
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Supplier" required><select className="fi" value={f.supplier_id} onChange={(e) => setF({ ...f, supplier_id: e.target.value })}><option value="">Choose…</option>{(suppliers as any[]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Credit date"><input className="fi" type="date" value={f.credit_date} onChange={(e) => setF({ ...f, credit_date: e.target.value })} /></Field>
          <Field label="Reason" className="sm:col-span-2"><input className="fi" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </div>
      </Panel>
      <Panel flush title="Items">
        <div className="overflow-x-auto"><table className="dt dt-keep min-w-[640px]"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th><th>Why</th><th /></tr></thead>
          <tbody>{f.items.map((l: any, i: number) => (
            <tr key={i}>
              <td><input className="fi h-9" value={l.name} onChange={(e) => setItem(i, { name: e.target.value })} /></td>
              <td className="num"><input className="fi h-9 w-20 text-right" type="number" min={0} value={l.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} /></td>
              <td className="num"><input className="fi h-9 w-28 text-right" type="number" min={0} step="any" placeholder="0" value={l.unit_cost} onChange={(e) => setItem(i, { unit_cost: e.target.value })} /></td>
              <td className="num font-semibold">{formatKES(Number(l.quantity || 0) * Number(l.unit_cost || 0))}</td>
              <td><input className="fi h-9" value={l.reason || ""} onChange={(e) => setItem(i, { reason: e.target.value })} /></td>
              <td><button className="icon-btn-danger" onClick={() => setF({ ...f, items: f.items.filter((_: any, j: number) => j !== i) })} aria-label="Remove">×</button></td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={3}>Total credit</td><td className="num">{formatKES(total)}</td><td colSpan={2} /></tr></tfoot></table></div>
        <div className="border-t border-border p-3"><Button size="sm" variant="outline" onClick={() => setF({ ...f, items: [...f.items, { name: "", quantity: 1, unit_cost: "", reason: "" }] })}><Plus /> Add a line</Button></div>
      </Panel>
      {seed?.bill_id && <label className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={f.apply} onChange={(e) => setF({ ...f, apply: e.target.checked })} /> Apply it to the order's bill straight away (reduces what you owe)</label>}
      <Panel title="Notes"><textarea className="fi" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Panel>
      <div className="flex gap-2"><Button onClick={save} disabled={busy}>{busy ? <OrbSpinner /> : <Save />} Save vendor credit</Button><Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button></div>
    </div>
  );
}

function VendorCreditDetail({ c, onClose }: { c: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: supplier } = useSupplier(c.supplier_id);
  const left = vcLeft(c);
  const [apply, setApply] = useState(false);
  const [refund, setRefund] = useState(false);
  const [amt, setAmt] = useState(String(left));
  const [billId, setBillId] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: bills = [] } = useQuery({
    queryKey: ["vc-bills", c.supplier_id], enabled: apply && !!c.supplier_id,
    queryFn: async () => ((await sb.from("bills").select("id,bill_number,amount,amount_paid,due_date,status").eq("supplier_id", c.supplier_id).not("status", "in", "(void,draft,paid)").order("due_date")).data || []) as any[],
  });
  const refresh = () => ["vendor-credits", "bills-z", "bill-payments", "purchase-orders-z", "doc-model"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const doApply = async () => {
    setBusy(true);
    const { error } = await sb.rpc("apply_vendor_credit", { p_credit: c.id, p_bill: billId, p_amount: Number(amt) });
    setBusy(false);
    if (error) return toast({ title: "Not applied", description: error.message, variant: "destructive" });
    toast({ title: "Credit applied to the bill" }); setApply(false); refresh();
  };
  const doRefund = async () => {
    const a = Number(amt);
    if (!(a > 0) || a > left + 0.009) return toast({ title: `Enter up to ${formatKES(left)}`, variant: "destructive" });
    const { error } = await sb.from("vendor_credits").update({ amount_refunded: Number(c.amount_refunded || 0) + a, status: left - a <= 0.009 ? "closed" : "open" }).eq("id", c.id);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Refund recorded" }); setRefund(false); refresh();
  };
  return (
    <DocPane title={c.credit_number} subtitle={`${c.supplier_name} · ${fmtDate(c.credit_date)}`} onClose={onClose}
      actions={<>
        {c.status === "open" && left > 0 && <Button onClick={() => { setAmt(String(left)); setBillId(""); setApply(true); }}><Receipt /> Apply to a bill</Button>}
        {c.status === "open" && left > 0 && <Button variant="outline" onClick={() => { setAmt(String(left)); setRefund(true); }}><Wallet /> Record refund</Button>}
        <SupplierShare kind="vendor_credit" id={c.id} supplier={supplier} subject={`Vendor credit ${c.credit_number}`} message={`Hello ${c.supplier_name || ""},\n\nPlease find our vendor credit ${c.credit_number} for ${formatKES(Number(c.amount))}${c.reason ? ` (${c.reason})` : ""}. Kindly confirm and issue your credit note.\n\nThank you.`} />
        {c.status === "open" && Number(c.amount_applied) === 0 && Number(c.amount_refunded) === 0 && <Button variant="ghost" className="ml-auto text-destructive" onClick={async () => { if (await confirmAction({ title: `Void ${c.credit_number}?`, danger: true, confirmLabel: "Void" })) { await sb.from("vendor_credits").update({ status: "void" }).eq("id", c.id); refresh(); onClose(); } }}><Ban /> Void</Button>}
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-xl bg-muted/50 p-2"><p className="text-xs text-muted-foreground">Credit</p><b>{formatKES(Number(c.amount))}</b></div>
          <div className="rounded-xl bg-muted/50 p-2"><p className="text-xs text-muted-foreground">Used</p><b>{formatKES(Number(c.amount_applied || 0) + Number(c.amount_refunded || 0))}</b></div>
          <div className="rounded-xl bg-muted/50 p-2"><p className="text-xs text-muted-foreground">Remaining</p><b className="text-primary">{formatKES(left)}</b></div>
        </div>
        {(c.bills?.bill_number || c.purchases?.po_number) && <p className="text-sm text-muted-foreground">{c.purchases?.po_number ? <>For <Link to={`/purchases/orders/${c.purchase_id}`} className="text-primary">{c.purchases.po_number}</Link></> : null}{c.bills?.bill_number ? <> · bill <Link to={`/purchases/bills/${c.bill_id}`} className="text-primary">{c.bills.bill_number}</Link></> : null}</p>}
        <DocumentPreview kind="vendor_credit" id={c.id} version={`${c.amount_applied}-${c.amount_refunded}-${c.status}`} />
        <div className="mt-4"><DocumentsPanel entityType="vendor_credit" entityId={c.id} entityName={String(c.credit_number || "")} /></div>
      </div>
      <Modal open={apply} onClose={() => setApply(false)} title="Apply credit to a bill" icon={Receipt} footer={<Button onClick={doApply} disabled={busy || !billId}>{busy && <OrbSpinner />} Apply</Button>}>
        <div className="space-y-3">
          <Field label="Bill"><select className="fi" value={billId} onChange={(e) => { setBillId(e.target.value); const b = (bills as any[]).find((x) => x.id === e.target.value); if (b) setAmt(String(Math.min(left, Number(b.amount) - Number(b.amount_paid)))); }}><option value="">Choose an unpaid bill…</option>{(bills as any[]).map((b) => <option key={b.id} value={b.id}>{b.bill_number} · owes {formatKES(Number(b.amount) - Number(b.amount_paid))}{b.due_date ? ` · due ${fmtDate(b.due_date)}` : ""}</option>)}</select></Field>
          <Field label="Amount to apply"><input className="fi" type="number" min={0} step="any" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
          {(bills as any[]).length === 0 && <p className="text-sm text-muted-foreground">This supplier has no unpaid bills. Keep the credit for the next bill or record a refund.</p>}
        </div>
      </Modal>
      <Modal open={refund} onClose={() => setRefund(false)} title="Record refund" icon={Wallet} center footer={<Button onClick={doRefund}>Save refund</Button>}>
        <Field label="Amount the supplier paid back"><input className="fi" type="number" min={0} step="any" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
      </Modal>
    </DocPane>
  );
}
