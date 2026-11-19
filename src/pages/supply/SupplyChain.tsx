import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileQuestion, Plus, Printer, Award, Scale, Ship, CheckCircle2, Trash2, Send, ShoppingBag, Paperclip, Mail, Smartphone, MessageCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import DocumentsPanel, { uploadDocument } from "@/components/DocumentsPanel";
import { loadStockDocModel } from "@/lib/docModels";
import { buildDocPdf } from "@/lib/doc-pdf";
import { shareOnWhatsApp } from "@/lib/docSend";
import { PageHeader, Panel, EmptyState, Modal, Field, Pill, TableWrap } from "@/components/kit";
import { friendlyError } from "@/lib/friendlyError";
import { openStockDocument } from "@/lib/docModels";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { sb, fmtD, n, useLocs, useProds, LinesEditor, blankLine, STATUS_TONE, type Line } from "@/pages/warehouse/common";

import { PagedRows } from "@/components/Pager";
const money = (v: number) => `KES ${Math.round(v).toLocaleString("en-KE")}`;
const Btn = ({ children, onClick, primary, disabled }: { children: React.ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean }) => (
  <button disabled={disabled} onClick={onClick} className={primary ? "inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" : "inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"}>{children}</button>
);
function useSuppliers() {
  return useQuery({ queryKey: ["sc-suppliers"], queryFn: async () => ((await sb.from("suppliers").select("id,name,phone,email").eq("is_active", true).order("name")).data || []) as any[] });
}

/* ======================================================================= RFQs */

const lineKey = (l: any, i: number) => (l.product_id ? `p:${l.product_id}` : `l:${i}`);

/**
 * Requests for quotation. An RFQ is general (addressed to no vendor, only the company's details): once created it is
 * sent to the vendors picked, by email, SMS or WhatsApp. Their quotes are recorded (with the vendor's file attached),
 * compared, and the RFQ is converted to a purchase order for the vendor chosen, with the quotes attached.
 */
export function Rfqs() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({ queryKey: ["rfqs"], queryFn: async () => ((await sb.from("rfqs").select("*").order("created_at", { ascending: false }).limit(300)).data || []) as any[] });
  const [edit, setEdit] = useState<any | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("open"));
  const open = rows.find((r) => r.id === openId) || null;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["rfqs"] });
  const close = () => { setOpenId(null); if (window.location.search) window.history.replaceState({}, "", window.location.pathname); refresh(); };
  return (
    <div className="space-y-6">
      <PageHeader title="Requests for Quotation" icon={FileQuestion} description="Ask vendors for quotes, compare them and convert the best to a purchase order."
        actions={<Btn primary onClick={() => setEdit({ lines: [blankLine()] })}><Plus className="h-4 w-4" /> New RFQ</Btn>} />
      <Panel flush>
        {!rows.length ? <EmptyState icon={FileQuestion} title="No RFQs yet" description="Approved requisitions without a vendor become RFQs here, or create one directly." /> : (
          <TableWrap><table className="dt w-full"><thead><tr><th>Number</th><th>Title</th><th>Sent to</th><th>Needed by</th><th>Status</th><th /></tr></thead><tbody>
            <PagedRows rows={rows} colSpan={6}>{(pageRows) => pageRows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpenId(r.id)}>
                <td className="font-semibold">{r.number}</td><td>{r.title || "—"}</td><td>{(r.supplier_ids || []).length ? `${(r.supplier_ids || []).length} vendor${(r.supplier_ids || []).length === 1 ? "" : "s"}` : "Not sent yet"}</td><td>{fmtD(r.needed_by)}</td>
                <td><Pill tone={STATUS_TONE[r.status]}>{r.status === "draft" ? "not sent" : r.status}</Pill></td>
                <td className="text-right" onClick={(e) => e.stopPropagation()}><button onClick={() => void openStockDocument("rfq", r.id).catch((e) => toast.error(friendlyError(e)))} className="rounded-lg p-2 hover:bg-muted" aria-label="Print"><Printer className="h-4 w-4" /></button></td>
              </tr>
            ))}</PagedRows>
          </tbody></table></TableWrap>
        )}
      </Panel>
      {edit && <RfqForm rfq={edit} onClose={(id) => { setEdit(null); refresh(); if (id) setOpenId(id); }} />}
      {open && <RfqDetail rfq={open} onClose={close} onChanged={refresh} />}
    </div>
  );
}

function RfqForm({ rfq, onClose }: { rfq: any; onClose: (id?: string) => void }) {
  const { data: products = [] } = useProds();
  const { data: locs = [] } = useLocs();
  const [f, setF] = useState<any>({ ...rfq, location_id: rfq.location_id || "" });
  const save = async () => {
    const lines = (f.lines as Line[]).filter((l) => l.product_id && l.quantity > 0);
    if (!lines.length) return toast.error("Add the items you need");
    const { data: num } = await sb.rpc("next_doc_number", { p_kind: "rfq" });
    const { data, error } = await sb.from("rfqs").insert({ number: num, title: f.title || null, lines, supplier_ids: [], needed_by: f.needed_by || null, location_id: f.location_id || null, notes: f.notes || null, status: "draft" }).select("id").single();
    if (error) return toast.error(friendlyError(error));
    toast.success(`${num} created`, { description: "Now send it to the vendors you want quotes from." });
    onClose(data.id);
  };
  return (
    <Modal open onClose={() => onClose()} size="xl" title="New request for quotation" icon={FileQuestion} description="A general request with your company's details. You choose the vendors when you send it."
      footer={<><Btn onClick={() => onClose()}>Cancel</Btn><Btn primary onClick={() => void save()}>Create RFQ</Btn></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Title"><input className="fi" value={f.title || ""} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Q4 packaging" /></Field>
          <Field label="Needed by"><input className="fi" type="date" value={f.needed_by || ""} onChange={(e) => setF({ ...f, needed_by: e.target.value })} /></Field>
          <Field label="Deliver to"><select className="fi" value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}><option value="">—</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        </div>
        <LinesEditor lines={f.lines} onChange={(lines) => setF({ ...f, lines })} products={products} showLots={false} />
        <Field label="Notes to vendors"><textarea className="fi" rows={2} value={f.notes || ""} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Delivery terms, payment terms, how to reply" /></Field>
      </div>
    </Modal>
  );
}

function RfqDetail({ rfq, onClose, onChanged }: { rfq: any; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const { data: suppliers = [] } = useSuppliers();
  const { data: quotes = [], refetch } = useQuery({ queryKey: ["rfq-quotes", rfq.id], queryFn: async () => ((await sb.from("rfq_quotes").select("*").eq("rfq_id", rfq.id)).data || []) as any[] });
  const [entry, setEntry] = useState<any | null>(null);
  const [sending, setSending] = useState(false);
  const [convert, setConvert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lines: any[] = rfq.lines || [];
  const done = rfq.status === "awarded" || !!rfq.purchase_id;
  const priceOf = (q: any, l: any, i: number) => n((q.lines || []).find((x: any, j: number) => (x.product_id && x.product_id === l.product_id) || (x.line ?? j) === i)?.unit_price);
  const best = (l: any, i: number) => { const ps = quotes.map((q) => priceOf(q, l, i)).filter((x) => x > 0); return ps.length ? Math.min(...ps) : 0; };
  const saveQuote = async () => {
    if (!entry.supplier_id) return toast.error("Choose the vendor");
    const ql = lines.map((l, i) => ({ line: i, product_id: l.product_id || null, name: l.name, quantity: l.quantity, unit_price: n(entry.prices[lineKey(l, i)]) }));
    const total = ql.reduce((a, l) => a + n(l.quantity) * l.unit_price, 0);
    const sup = suppliers.find((s) => s.id === entry.supplier_id);
    setBusy(true);
    try {
      const { error } = await sb.from("rfq_quotes").upsert({ rfq_id: rfq.id, supplier_id: entry.supplier_id, supplier_name: sup?.name, lines: ql, total, lead_days: entry.lead_days ? Number(entry.lead_days) : null, valid_until: entry.valid_until || null, delivery_terms: entry.delivery_terms || null }, { onConflict: "rfq_id,supplier_id" });
      if (error) throw error;
      // The vendor's own quotation (PDF or photo) is kept on the RFQ and goes to the purchase order.
      if (entry.file && tenantId) await uploadDocument(tenantId, entry.file, { entity_type: "rfq", entity_id: rfq.id, entity_name: rfq.number, category: "Quotation", name: `Quotation · ${sup?.name || "Vendor"} · ${entry.file.name}` });
      const ids = Array.from(new Set([...(rfq.supplier_ids || []), entry.supplier_id]));
      await sb.from("rfqs").update({ status: "quoted", supplier_ids: ids }).eq("id", rfq.id);
      setEntry(null); void refetch(); void qc.invalidateQueries({ queryKey: ["documents"] }); onChanged();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  const toPo = async (supplierId: string) => {
    setBusy(true);
    const { data: po, error } = await sb.rpc("rfq_to_po", { p_rfq: rfq.id, p_supplier: supplierId });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success("Purchase order created", { description: "The vendors' quotations are attached to it." });
    void qc.invalidateQueries({ queryKey: ["purchase-orders-z"] }); void qc.invalidateQueries({ queryKey: ["requisitions"] });
    navigate(`/purchases/orders/${po}`);
  };
  const cheapest = quotes.length ? quotes.reduce((a, q) => (n(q.total) < n(a.total) ? q : a), quotes[0]) : null;
  const sentTo = suppliers.filter((s) => (rfq.supplier_ids || []).includes(s.id));
  return (
    <Modal open onClose={onClose} size="xl" title={`${rfq.number}${rfq.title ? ` · ${rfq.title}` : ""}`} icon={Scale}
      description={`Needed by ${fmtD(rfq.needed_by)} · ${sentTo.length ? `sent to ${sentTo.length} vendor${sentTo.length === 1 ? "" : "s"}` : "not sent yet"} · ${quotes.length} quote${quotes.length === 1 ? "" : "s"}`}
      footer={done ? (rfq.purchase_id ? <Btn primary onClick={() => navigate(`/purchases/orders/${rfq.purchase_id}`)}><ShoppingBag className="h-4 w-4" /> View purchase order</Btn> : undefined) : <div className="flex w-full flex-wrap gap-2">
        <Btn primary={!quotes.length} onClick={() => setSending(true)}><Send className="h-4 w-4" /> {sentTo.length ? "Send to more vendors" : "Send to vendors"}</Btn>
        <Btn onClick={() => setEntry({ supplier_id: sentTo.find((s) => !quotes.some((q) => q.supplier_id === s.id))?.id || "", prices: {} })}><Plus className="h-4 w-4" /> Record a quote</Btn>
        <span className="flex-1" />
        <Btn primary={quotes.length > 0} onClick={() => setConvert(cheapest?.supplier_id || sentTo[0]?.id || "")}><ShoppingBag className="h-4 w-4" /> Convert to PO</Btn>
      </div>}>
      <div className="space-y-4">
        {!sentTo.length && !done && <p className="rounded-xl bg-primary/5 px-3 py-2 text-sm">This request is general: it shows only your company's details. <b>Send to vendors</b> to pick who gets it and how (email, SMS or WhatsApp).</p>}
        {sentTo.length > 0 && <p className="text-xs text-muted-foreground">Sent to: {sentTo.map((s) => s.name).join(", ")}</p>}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Item</th><th className="text-right">Qty</th>{quotes.map((q) => <th key={q.id} className="px-3 text-right">{q.supplier_name}</th>)}</tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={lineKey(l, i)} className="border-t border-border"><td className="px-3 py-2">{l.name}</td><td className="text-right tabular-nums">{n(l.quantity)}</td>
                  {quotes.map((q) => { const p = priceOf(q, l, i); return <td key={q.id} className={cn("px-3 text-right tabular-nums", p > 0 && p === best(l, i) && "font-bold text-success")}>{p ? money(p) : "—"}</td>; })}</tr>
              ))}
              {quotes.length > 0 && <>
                <tr className="border-t-2 border-border font-semibold"><td className="px-3 py-2">Total</td><td />{quotes.map((q) => <td key={q.id} className={cn("px-3 text-right tabular-nums", cheapest?.id === q.id && "text-success")}>{money(n(q.total))}</td>)}</tr>
                <tr className="border-t border-border text-xs text-muted-foreground"><td className="px-3 py-1.5">Lead time / valid until</td><td />{quotes.map((q) => <td key={q.id} className="px-3 text-right">{q.lead_days ? `${q.lead_days} days` : "—"} · {fmtD(q.valid_until)}</td>)}</tr>
                {!done && <tr className="border-t border-border"><td className="px-3 py-2" /><td />{quotes.map((q) => <td key={q.id} className="px-3 py-2 text-right"><Btn onClick={() => setConvert(q.supplier_id)}><Award className="h-4 w-4" /> Choose</Btn></td>)}</tr>}
              </>}
            </tbody>
          </table>
        </div>
        {!quotes.length && <p className="text-sm text-muted-foreground">Record each vendor's prices as they reply and attach their quotation. The best price per item is highlighted.</p>}
        {entry && (
          <div className="space-y-3 rounded-2xl border border-border p-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Vendor"><select className="fi" value={entry.supplier_id} onChange={(e) => setEntry({ ...entry, supplier_id: e.target.value })}><option value="">Choose…</option>{[...sentTo, ...suppliers.filter((s) => !(rfq.supplier_ids || []).includes(s.id))].map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="Lead time (days)"><input className="fi" type="number" value={entry.lead_days || ""} onChange={(e) => setEntry({ ...entry, lead_days: e.target.value })} /></Field>
              <Field label="Valid until"><input className="fi" type="date" value={entry.valid_until || ""} onChange={(e) => setEntry({ ...entry, valid_until: e.target.value })} /></Field>
              <Field label="Delivery terms"><input className="fi" value={entry.delivery_terms || ""} onChange={(e) => setEntry({ ...entry, delivery_terms: e.target.value })} /></Field>
            </div>
            {lines.map((l, i) => <div key={lineKey(l, i)} className="flex items-center gap-3 text-sm"><span className="flex-1">{l.name} × {n(l.quantity)}</span><input className="fi h-9 w-36 text-right" type="number" min={0} step="any" placeholder="Unit price" value={entry.prices[lineKey(l, i)] ?? ""} onChange={(e) => setEntry({ ...entry, prices: { ...entry.prices, [lineKey(l, i)]: e.target.value } })} /></div>)}
            <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-3 py-2.5 text-sm", entry.file ? "border-success/40 bg-success/5" : "border-border hover:border-primary")}>
              <Paperclip className="h-4 w-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{entry.file ? entry.file.name : "Attach the vendor's quotation (PDF or photo)"}</span>
              <input type="file" className="hidden" accept=".pdf,image/*" onChange={(e) => setEntry({ ...entry, file: e.target.files?.[0] || null })} />
            </label>
            <div className="flex justify-end gap-2"><Btn onClick={() => setEntry(null)}>Cancel</Btn><Btn primary disabled={busy} onClick={() => void saveQuote()}>Save quote</Btn></div>
          </div>
        )}
        <DocumentsPanel entityType="rfq" entityId={rfq.id} entityName={rfq.number} />
      </div>
      {sending && <RfqSend rfq={rfq} suppliers={suppliers} onClose={() => setSending(false)} onSent={() => { setSending(false); onChanged(); }} />}
      {convert !== null && (
        <Modal open onClose={() => setConvert(null)} title={`Convert ${rfq.number} to a purchase order`} icon={ShoppingBag} description="Choose the vendor. Their quoted prices are used (or your estimates where no quote was recorded), and the quotations are attached."
          footer={<><Btn onClick={() => setConvert(null)}>Cancel</Btn><Btn primary disabled={!convert || busy} onClick={() => void toPo(convert)}><ShoppingBag className="h-4 w-4" /> Create purchase order</Btn></>}>
          <div className="space-y-2">
            {quotes.map((q) => (
              <label key={q.id} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-sm", convert === q.supplier_id ? "border-primary bg-primary/5" : "border-border")}>
                <input type="radio" className="accent-primary" checked={convert === q.supplier_id} onChange={() => setConvert(q.supplier_id)} />
                <span className="flex-1 font-semibold">{q.supplier_name}{cheapest?.id === q.id && <span className="ml-2 rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success">Lowest</span>}</span>
                <span className="tabular-nums">{money(n(q.total))}</span>
              </label>
            ))}
            <Field label={quotes.length ? "Or another vendor" : "Vendor"}><select className="fi" value={quotes.some((q) => q.supplier_id === convert) ? "" : convert} onChange={(e) => setConvert(e.target.value)}><option value="">Choose…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/** Sends a general RFQ to the vendors picked: email (PDF attached), SMS (link to the PDF) and WhatsApp. */
function RfqSend({ rfq, suppliers, onClose, onSent }: { rfq: any; suppliers: any[]; onClose: () => void; onSent: () => void }) {
  const tenantId = useTenantId();
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [ch, setCh] = useState({ email: true, sms: false, whatsapp: false });
  const [busy, setBusy] = useState(false);
  const [wa, setWa] = useState<{ name: string; phone: string; text: string }[] | null>(null);
  const [message, setMessage] = useState(`Hello, please send us your best quotation for the items in ${rfq.number}${rfq.needed_by ? `, needed by ${fmtD(rfq.needed_by)}` : ""}: unit prices, lead time and delivery terms. Thank you.`);
  const list = suppliers.filter((s) => !q.trim() || `${s.name} ${s.phone || ""} ${s.email || ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const send = async () => {
    if (!picked.length) return toast.error("Choose at least one vendor");
    if (!ch.email && !ch.sms && !ch.whatsapp) return toast.error("Choose how to send it");
    setBusy(true);
    const out = { email: 0, sms: 0, failed: [] as string[] };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const auth = { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` };
      const { model, filename } = await loadStockDocModel("rfq", rfq.id);
      const bytes = await buildDocPdf(model);
      let link = "";
      if (ch.sms || ch.whatsapp) {
        const path = `${tenantId}/shared/rfq-${rfq.id}-${Date.now().toString(36)}.pdf`;
        const store = (supabase as any).storage.from("documents");
        const up = await store.upload(path, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf" });
        if (up.error) throw up.error;
        const signed = await store.createSignedUrl(path, 30 * 86400, { download: filename });
        if (signed.error) throw signed.error;
        link = signed.data.signedUrl;
      }
      let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const pdf = btoa(bin);
      const chosen = suppliers.filter((s) => picked.includes(s.id));
      const waList: { name: string; phone: string; text: string }[] = [];
      for (const s of chosen) {
        const hi = `Dear ${s.name},\n\n${message}`;
        if (ch.email) {
          if (!s.email) out.failed.push(`${s.name}: no email`);
          else {
            const r = await fetch("/api/email/document", { method: "POST", headers: auth, body: JSON.stringify({ purpose: "purchasing", to: [s.email], subject: `Request for quotation ${rfq.number}${rfq.title ? `: ${rfq.title}` : ""}`, message: hi, pdf, filename }) });
            const j = await r.json().catch(() => ({}));
            if (r.ok && j.ok) out.email++; else out.failed.push(`${s.name} email: ${j.error || "not sent"}`);
          }
        }
        if (ch.sms) {
          if (!s.phone) out.failed.push(`${s.name}: no phone`);
          else {
            const r = await fetch("/api/messages/send", { method: "POST", headers: auth, body: JSON.stringify({ channel: "sms", to: s.phone, text: `${rfq.number}: ${message} ${link}`, reference: rfq.number }) });
            const j = await r.json().catch(() => ({}));
            if (r.ok && j.ok) out.sms++; else out.failed.push(`${s.name} SMS: ${j.error || "not sent"}`);
            await new Promise((ok) => setTimeout(ok, 2600)); // the SMS route allows one message every 2.5 s
          }
        }
        if (ch.whatsapp && s.phone) waList.push({ name: s.name, phone: s.phone, text: `${hi}\n\n${rfq.number} (PDF): ${link}` });
        else if (ch.whatsapp) out.failed.push(`${s.name}: no phone for WhatsApp`);
      }
      const ids = Array.from(new Set([...(rfq.supplier_ids || []), ...picked]));
      const log = [...(rfq.sent_log || []), { at: new Date().toISOString(), suppliers: picked, channels: Object.entries(ch).filter(([, v]) => v).map(([k]) => k) }];
      await sb.from("rfqs").update({ supplier_ids: ids, sent_log: log, status: rfq.status === "draft" ? "sent" : rfq.status }).eq("id", rfq.id);
      const sent = out.email + out.sms + waList.length;
      if (sent) toast.success(`Sent: ${out.email} email, ${out.sms} SMS${waList.length ? `, ${waList.length} on WhatsApp` : ""}`, { description: out.failed.slice(0, 3).join(" · ") || undefined });
      else toast.error("Nothing was sent", { description: out.failed.slice(0, 3).join(" · ") || undefined });
      if (waList.length) setWa(waList); else onSent();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  if (wa) return (
    <Modal open onClose={onSent} title="Send on WhatsApp" icon={MessageCircle} description="WhatsApp opens one chat at a time: tap each vendor to send the message with the RFQ link."
      footer={<Btn primary onClick={onSent}>Done</Btn>}>
      <div className="space-y-2">{wa.map((w) => (
        <button key={w.phone} className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left text-sm hover:border-primary" onClick={() => shareOnWhatsApp(w.phone, w.text)}>
          <MessageCircle className="h-4 w-4 text-success" /><span className="flex-1 font-semibold">{w.name}</span><span className="text-xs text-muted-foreground">{w.phone}</span>
        </button>
      ))}</div>
    </Modal>
  );
  return (
    <Modal open onClose={onClose} size="lg" title={`Send ${rfq.number} to vendors`} icon={Send} locked={busy}
      footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn primary onClick={() => void send()} disabled={busy}><Send className="h-4 w-4" /> {busy ? "Sending…" : `Send to ${picked.length || ""} vendor${picked.length === 1 ? "" : "s"}`}</Btn></>}>
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium">Send by</p>
          <div className="flex flex-wrap gap-2">
            {([["email", "Email (PDF attached)", Mail], ["sms", "SMS (link)", Smartphone], ["whatsapp", "WhatsApp (link)", MessageCircle]] as const).map(([k, l, I]) => (
              <label key={k} className={cn("flex cursor-pointer items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm font-semibold", ch[k] ? "border-primary bg-primary/5" : "border-border")}>
                <input type="checkbox" className="accent-primary" checked={ch[k]} onChange={(e) => setCh({ ...ch, [k]: e.target.checked })} /><I className="h-4 w-4" /> {l}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2"><p className="flex-1 text-sm font-medium">Vendors ({picked.length} chosen)</p><input className="fi h-8 w-48 text-sm" placeholder="Search vendors…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border p-1.5">
            {!list.length && <p className="p-3 text-sm text-muted-foreground">No vendors. Add them under Purchases → Vendors.</p>}
            {list.map((s) => (
              <label key={s.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm hover:bg-muted/60", picked.includes(s.id) && "bg-primary/5")}>
                <input type="checkbox" className="accent-primary" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
                <span className="flex-1 font-medium">{s.name}{(rfq.supplier_ids || []).includes(s.id) && <span className="ml-2 text-[10px] font-semibold text-muted-foreground">already sent</span>}</span>
                <span className="text-xs text-muted-foreground">{[s.email, s.phone].filter(Boolean).join(" · ") || "no contact"}</span>
              </label>
            ))}
          </div>
        </div>
        <Field label="Message"><textarea className="fi" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/* ======================================================================= Landed costs */

export function LandedCosts() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({ queryKey: ["landed"], queryFn: async () => ((await sb.from("landed_costs").select("*, purchase_receives(receive_number, supplier_name)").order("created_at", { ascending: false }).limit(200)).data || []) as any[] });
  const { data: receives = [] } = useQuery({ queryKey: ["landed-receives"], queryFn: async () => ((await sb.from("purchase_receives").select("id,receive_number,supplier_name,received_date,purchase_id").order("created_at", { ascending: false }).limit(200)).data || []) as any[] });
  const [edit, setEdit] = useState<any | null>(null);
  const total = useMemo(() => (edit?.charges || []).reduce((a: number, c: any) => a + n(c.amount), 0), [edit]);
  const save = async (apply: boolean) => {
    try {
      if (!edit.receive_id) throw new Error("Choose the goods received");
      const charges = edit.charges.filter((c: any) => c.name && n(c.amount) > 0);
      const rcv = receives.find((r) => r.id === edit.receive_id);
      const { data, error } = await sb.from("landed_costs").insert({ receive_id: edit.receive_id, purchase_id: rcv?.purchase_id, charges, method: edit.method, total }).select("id").single();
      if (error) throw error;
      if (apply) { const { error: e2 } = await sb.rpc("apply_landed_cost", { p_id: data.id }); if (e2) throw e2; }
      toast.success(apply ? "Landed cost applied: item costs updated and posted to the books" : "Saved");
      setEdit(null); void qc.invalidateQueries({ queryKey: ["landed"] });
    } catch (e) { toast.error(friendlyError(e)); }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Landed Costs" icon={Ship} description="Freight, duty, clearing and insurance spread over the goods they brought in, so item costs and margins are true."
        actions={<Btn primary onClick={() => setEdit({ receive_id: "", method: "value", charges: [{ name: "Freight", amount: "" }, { name: "Import duty", amount: "" }] })}><Plus className="h-4 w-4" /> New landed cost</Btn>} />
      <Panel flush>
        {!rows.length ? <EmptyState icon={Ship} title="No landed costs yet" /> : (
          <TableWrap><table className="dt w-full"><thead><tr><th>Number</th><th>Goods received</th><th>Spread by</th><th className="text-right">Total</th><th>Status</th><th /></tr></thead><tbody>
            <PagedRows rows={rows} colSpan={6}>{(pageRows) => pageRows.map((r) => (
              <tr key={r.id}><td className="font-semibold">{r.number || "Draft"}</td><td>{r.purchase_receives?.receive_number} · {r.purchase_receives?.supplier_name}</td><td>{r.method}</td><td className="text-right tabular-nums">{money(n(r.total))}</td><td><Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill></td>
                <td className="text-right">{r.status === "draft" && <Btn onClick={async () => { const { error } = await sb.rpc("apply_landed_cost", { p_id: r.id }); if (error) toast.error(friendlyError(error)); else { toast.success("Applied"); void qc.invalidateQueries({ queryKey: ["landed"] }); } }}><CheckCircle2 className="h-4 w-4" /> Apply</Btn>}</td></tr>
            ))}</PagedRows>
          </tbody></table></TableWrap>
        )}
      </Panel>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title="New landed cost" icon={Ship} footer={<><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn onClick={() => void save(false)}>Save draft</Btn><Btn primary onClick={() => void save(true)}>Apply now</Btn></>}>
          <div className="space-y-4">
            <Field label="Goods received"><select className="fi" value={edit.receive_id} onChange={(e) => setEdit({ ...edit, receive_id: e.target.value })}><option value="">Choose…</option>{receives.map((r) => <option key={r.id} value={r.id}>{r.receive_number} · {r.supplier_name} · {fmtD(r.received_date)}</option>)}</select></Field>
            <Field label="Spread by"><select className="fi" value={edit.method} onChange={(e) => setEdit({ ...edit, method: e.target.value })}><option value="value">Value of each item</option><option value="quantity">Quantity of each item</option></select></Field>
            <div className="space-y-2">{edit.charges.map((c: any, i: number) => (
              <div key={i} className="flex gap-2"><input className="fi" value={c.name} onChange={(e) => setEdit({ ...edit, charges: edit.charges.map((x: any, j: number) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="Charge" />
                <input className="fi w-40 text-right" type="number" min={0} value={c.amount} onChange={(e) => setEdit({ ...edit, charges: edit.charges.map((x: any, j: number) => (j === i ? { ...x, amount: e.target.value } : x)) })} placeholder="Amount" />
                <button onClick={() => setEdit({ ...edit, charges: edit.charges.filter((_: any, j: number) => j !== i) })} className="icon-btn-danger" aria-label="Remove"><Trash2 className="h-4 w-4" /></button></div>))}
              <button onClick={() => setEdit({ ...edit, charges: [...edit.charges, { name: "", amount: "" }] })} className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><Plus className="h-4 w-4" /> Add charge</button>
            </div>
            <p className="text-sm font-semibold">Total {money(total)}</p>
            <p className="text-xs text-muted-foreground">Applying raises each item's average cost and posts the total to inventory (credit Accounts Payable): record the carrier's or agent's bill against it.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
