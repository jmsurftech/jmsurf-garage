import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CustomFieldInputs, missingCustomField, useCustomFields, type CustomValues } from "@/lib/customFields";
import { TagPickers, cleanTags, missingTag, useModuleTags, type TagValues } from "@/lib/reportingTags";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { X, FileText, Receipt, Paperclip, Repeat } from "lucide-react";
import { uploadDocument } from "@/components/DocumentsPanel";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useBusinessSettings, useLocations, useProducts, useStaff } from "@/hooks/useData";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { CustomerPicker, type PickedCustomer } from "@/components/books/CustomerPicker";
import { AutoGrowText, ItemTable, editTotals, newLine, toEditLines, toStoredLines, type EditLine, type Adjustments } from "@/components/books/ItemTable";
import { useTaxSettings } from "@/lib/tax";
import { currencyCode } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesKind } from "./SalesDocs";
import { useApprovalRule, submitForApproval } from "@/lib/approvals";
import { useErpSettings } from "@/pages/settings/ErpSettingsTabs";
import { erpApi } from "@/lib/erpApi";
import { linkToContract } from "@/lib/contractLink";

const sb: any = supabase;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86400000).toISOString().slice(0, 10);

const TERMS = [
  { label: "Due on Receipt", days: 0 }, { label: "Net 7", days: 7 }, { label: "Net 15", days: 15 },
  { label: "Net 30", days: 30 }, { label: "Net 45", days: 45 }, { label: "Net 60", days: 60 }, { label: "Due end of the month", days: -1 },
];

/** Form row: label column on the left, input on the right (stacked on phones). */
function Row({ label, required, children, hint }: { label: string; required?: boolean; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center sm:gap-4">
      <label className={cn("text-sm", required ? "font-medium text-destructive" : "text-foreground")}>{label}{required && "*"}</label>
      <div className="max-w-xl">{children}{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</div>
    </div>
  );
}

export default function SalesDocForm({ kind }: { kind: SalesKind }) {
  const isQuote = kind !== "invoice";
  const isOrder = kind === "sales_order";
  const table = kind === "invoice" ? "invoices" : isOrder ? "sales_orders" : "quotes";
  const numberCol = isQuote ? "quote_number" : "invoice_number";
  const customEntity = kind === "invoice" ? "invoice" : isOrder ? "sales_order" : "quote";
  const customFields = useCustomFields(customEntity);
  const [custom, setCustom] = useState<CustomValues>({});
  // Reporting tags are kept on invoices only.
  const invoiceTags = useModuleTags("invoices");
  const [tags, setTags] = useState<TagValues>({});
  const base = kind === "invoice" ? "/sales/invoices" : isOrder ? "/sales/orders" : "/sales/quotes";
  const label = kind === "invoice" ? "Invoice" : isOrder ? "Sales Order" : "Quote";
  const { id } = useParams<{ id?: string }>();
  const [params] = useSearchParams();
  const cloneId = params.get("clone");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const tenantId = useTenantId();
  const { user, profile } = useAuth() as any;
  const { data: biz } = useBusinessSettings();
  const { data: staff = [] } = useStaff();
  const approval = useApprovalRule(kind);
  const { data: products = [] } = useProducts();
  const { settings: erpSettings } = useErpSettings();

  const [loading, setLoading] = useState(!!(id || cloneId));
  const [saving, setSaving] = useState<null | "draft" | "send">(null);
  const [existing, setExisting] = useState<any>(null);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [number, setNumber] = useState("");
  const [reference, setReference] = useState("");
  const [issueDate, setIssueDate] = useState(today());
  const [validUntil, setValidUntil] = useState(addDays(today(), 30));
  const [terms, setTerms] = useState("Due on Receipt");
  const [dueDate, setDueDate] = useState(today());
  const [salesperson, setSalesperson] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [lines, setLines] = useState<EditLine[]>([newLine()]);
  const [adj, setAdj] = useState<Adjustments>({ discount: 0, shipping: 0, adjustment: 0 });
  const taxDefaults = useTaxSettings();
  const [inclusive, setInclusive] = useState<boolean>(() => (existing ? !!existing.prices_include_tax : !!taxDefaults.pricesIncludeTax));
  const [notes, setNotes] = useState("");
  const [tc, setTc] = useState("");
  // Zoho's extras: branch, delivery method (sales orders), online payment (invoices), attachments, make recurring.
  const { data: locations = [] } = useLocations();
  const [locationId, setLocationId] = useState("");
  const [delivery, setDelivery] = useState("");
  const [onlinePay, setOnlinePay] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [recur, setRecur] = useState(false);
  const [peek, setPeek] = useState("");
  useEffect(() => { if (!locationId && !id && (locations as any[]).length) setLocationId(((locations as any[]).find((l) => l.is_main) || (locations as any[])[0]).id); }, [locations]); // eslint-disable-line react-hooks/exhaustive-deps
  // The number the document will get, shown as Zoho does (taken for real when it is saved).
  useEffect(() => { if (!id && tenantId) void sb.rpc("peek_doc_number", { p_kind: kind }).then(({ data }: any) => { if (data) setPeek(String(data)); }); }, [tenantId, id, kind]);
  const maxFiles = kind === "quote" ? 5 : 10;

  // Defaults from Settings (terms & notes) for new documents.
  useEffect(() => {
    if (id || cloneId || !biz) return;
    setNotes((n) => n || (isQuote ? biz.quote_notes : biz.invoice_notes) || (isQuote ? "Looking forward for your business." : "Thanks for your business."));
    setTc((t) => t || (isQuote ? biz.quote_terms : biz.invoice_terms) || "");
    const d = Number(biz.payment_terms_days || 0);
    const preset = TERMS.find((t) => t.days === d);
    if (!isQuote && preset) { setTerms(preset.label); setDueDate(addDays(today(), d)); }
  }, [biz, id, cloneId, isQuote]);

  // Started from samples (Sales → Samples → Invoice): their items.
  const [fromSample, setFromSample] = useState<string | null>(null);
  useEffect(() => {
    if (id || cloneId || kind !== "invoice") return;
    let pre: any = null;
    try { pre = JSON.parse(sessionStorage.getItem("dash-invoice-prefill") || "null"); sessionStorage.removeItem("dash-invoice-prefill"); } catch { /* none */ }
    if (!pre?.items?.length) return;
    void (async () => {
      const ids = pre.items.map((x: any) => x.item_id).filter(Boolean);
      const { data: prods } = await sb.from("products").select("id,name,price,vat_rate,unit").in("id", ids);
      setLines(pre.items.map((x: any) => { const p = (prods || []).find((y: any) => y.id === x.item_id); return { ...newLine(), item_id: x.item_id, name: p?.name || x.name, unit: p?.unit, quantity: Number(x.quantity) || 1, rate: Number(p?.price) || 0, tax_rate: Number(p?.vat_rate) || 0 }; }));
      setFromSample(pre.sample_id || null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Started from a customer page: that customer.
  useEffect(() => {
    const cid = params.get("customer");
    if (!cid || id || cloneId) return;
    void sb.from("customers").select("id, name, phone, email, salesperson_id").eq("id", cid).maybeSingle().then(({ data }: any) => {
      if (data) { setCustomer({ id: data.id, name: data.name, phone: data.phone, email: data.email }); if (data.salesperson_id) setSalesperson(data.salesperson_id); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Me as the salesperson by default.
  // Only once: after that, clearing it means the document has no salesperson.
  const spDefaulted = useRef(false);
  useEffect(() => { if (spDefaulted.current || id || cloneId || !user?.id) return; spDefaulted.current = true; if (!salesperson) setSalesperson(user.id); }, [user?.id, id, cloneId, salesperson]);

  // Load the record being edited or cloned.
  useEffect(() => {
    const src = id || cloneId;
    if (!src) return;
    (async () => {
      const { data, error } = await sb.from(table).select("*").eq("id", src).maybeSingle();
      setLoading(false);
      if (error || !data) { toast({ title: "Not found", variant: "destructive" }); return navigate(base); }
      if (id) { setExisting(data); setNumber(data[numberCol] || ""); setReference(data.reference || ""); setIssueDate(String(data.issue_date || data.created_at || today()).slice(0, 10)); }
      setCustomer(data.customer_id ? { id: data.customer_id, name: data.customer_name, phone: data.customer_phone, email: data.customer_email } : null);
      if (isOrder) setValidUntil(data.expected_shipment_date ? String(data.expected_shipment_date).slice(0, 10) : addDays(today(), 7));
      else if (isQuote) setValidUntil(data.valid_until ? String(data.valid_until).slice(0, 10) : addDays(today(), 30));
      else { setTerms(data.payment_terms || "Due on Receipt"); setDueDate(data.due_date ? String(data.due_date).slice(0, 10) : today()); }
      setSalesperson(data.salesperson_id || "");
      setSubject(data.subject || "");
      setLocationId(data.location_id || "");
      if (isOrder) { setTerms(data.payment_terms || "Due on Receipt"); setDelivery(data.delivery_method || ""); }
      if (kind === "invoice") setOnlinePay(data.allow_online_payment !== false);
      const l = toEditLines(data.items);
      setLines(l.length ? l : [newLine()]);
      setAdj({ discount: Number(data.discount || 0), shipping: Number(data.shipping || 0), adjustment: Number(data.adjustment || 0) });
      setNotes(data.customer_notes || data.notes || "");
      setTc(data.terms || "");
      setCustom(data.custom || {});
      if (kind === "invoice") setTags(data.tags || {});
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cloneId]);

  const onTerms = (label: string) => {
    setTerms(label);
    const t = TERMS.find((x) => x.label === label);
    if (!t) return;
    if (t.days === -1) { const d = new Date(issueDate); setDueDate(new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)); }
    else setDueDate(addDays(issueDate, t.days));
  };

  // The customer's own credit terms (Customers → Payment terms) win over the company default.
  // A saved document keeps its terms until another customer is picked.
  const termsFor = useRef<string | null>(null);
  useEffect(() => {
    if (isQuote || !customer?.id) return;
    if (termsFor.current === null && (id || cloneId)) { termsFor.current = customer.id; return; }
    if (termsFor.current === customer.id) return;
    termsFor.current = customer.id;
    void sb.from("customers").select("credit_days").eq("id", customer.id).maybeSingle().then(({ data }: any) => {
      const d = Number(data?.credit_days || 0);
      if (d <= 0) return;
      setTerms(TERMS.find((x) => x.days === d)?.label || `Net ${d}`);
      setDueDate(addDays(issueDate, d));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id]);

  const salespeople = useMemo(() => (staff as any[]).map((s) => ({ id: s.user_id, name: s.display_name || s.email || "Staff" })), [staff]);

  const save = async (mode: "draft" | "send") => {
    if (!customer) return toast({ title: "Select a customer", variant: "destructive" });
    const stored = toStoredLines(lines);
    if (!stored.length) return toast({ title: "Add at least one item", variant: "destructive" });
    const missing = missingCustomField(customFields, custom);
    if (missing) return toast({ title: `Fill in ${missing}`, variant: "destructive" });
    const missingT = kind === "invoice" ? missingTag(invoiceTags, "invoices", tags) : null;
    if (missingT) return toast({ title: `Choose ${missingT}`, variant: "destructive" });
    // Serial-tracked items list exactly one serial number per unit sold before the invoice is issued.
    if (kind === "invoice" && mode === "send") {
      for (const l of lines) {
        const p = l.item_id ? (products as any[]).find((x) => x.id === l.item_id) : null;
        if (p?.track_serials && (l.serials || []).length !== l.quantity) return toast({ title: `${l.name}: choose ${l.quantity} serial number(s)`, description: `${(l.serials || []).length} chosen. Use "Serial numbers" under the item.`, variant: "destructive" });
        // Items preferences: "Prevent stock from going below zero".
        const prefs = (biz as any)?.items_prefs || {};
        if (p && p.product_type !== "service" && !p.track_serials && prefs.track_inventory !== false && prefs.negative_stock === "block" && (!existing || existing.status === "draft") && l.quantity > Number(p.stock ?? 0)) {
          return toast({ title: `${l.name}: only ${Number(p.stock ?? 0)} in stock`, description: "Stock cannot go below zero (System → Items). Receive stock first or reduce the quantity.", variant: "destructive" });
        }
        const lotQty = (l.lots || []).reduce((a, x) => a + (Number(x.qty) || 0), 0);
        if (lotQty > l.quantity + 0.0001) return toast({ title: `${l.name}: batches add up to more than ${l.quantity}`, variant: "destructive" });
      }
    }
    setSaving(mode);
    try {
      let num = number;
      if (!existing) {
        const { data, error } = await sb.rpc("next_doc_number", { p_kind: kind });
        if (error) throw error;
        num = data;
      }
      const t = editTotals(lines, adj, inclusive);
      const sp = salespeople.find((s) => s.id === salesperson);
      // With approval switched on, a new or changed document waits as a draft until it is approved.
      const needsApproval = approval.needs(t.total) && (!existing || existing.approval_status !== "approved" || Number(existing.total) !== t.total);
      if (needsApproval) mode = "draft";
      const payload: Record<string, unknown> = {
        tenant_id: tenantId, [numberCol]: num, customer_id: customer.id, customer_name: customer.name,
        customer_phone: customer.phone || null, customer_email: customer.email || null,
        reference: reference.trim() || null, issue_date: issueDate, subject: subject.trim() || null,
        salesperson_id: sp?.id || null, salesperson_name: sp?.name || null,
        items: stored, subtotal: t.subtotal, tax: t.tax, discount: adj.discount, shipping: adj.shipping, adjustment: adj.adjustment, total: t.total, prices_include_tax: inclusive,
        customer_notes: notes.trim() || null, notes: notes.trim() || null, terms: tc.trim() || null, custom,
        updated_at: new Date().toISOString(),
      };
      if (isQuote && !isOrder) payload.valid_until = validUntil || null;
      if (isOrder) payload.expected_shipment_date = validUntil || null;
      if (kind === "quote" && params.get("lead") && !existing) payload.lead_id = params.get("lead");
      // Made from a CRM deal: the document belongs to the deal (the deal moves on as it does).
      if (params.get("deal") && !existing && /^[0-9a-f-]{36}$/i.test(params.get("deal") || "")) payload.deal_id = params.get("deal");
      if (kind === "invoice") payload.tags = cleanTags(tags);
      if (kind === "invoice") { payload.payment_terms = terms; payload.due_date = dueDate || null; payload.allow_online_payment = onlinePay; }
      if (isOrder) { payload.payment_terms = terms; payload.delivery_method = delivery.trim() || null; }
      payload.location_id = locationId || null;
      if (!existing) { payload.status = mode === "send" ? "sent" : "draft"; payload.created_by = user?.id; if (mode === "send") payload.sent_at = new Date().toISOString(); }
      else if (mode === "send" && existing.status === "draft") { payload.status = "sent"; payload.sent_at = new Date().toISOString(); }

      const q = existing ? sb.from(table).update(payload).eq("id", existing.id).select("id").single() : sb.from(table).insert(payload).select("id").single();
      const { data, error } = await q;
      if (error) throw error;
      // A changed total re-checks paid / partially paid against the payments already applied.
      if (existing && !isQuote) await sb.rpc("invoice_refresh_paid", { p_invoice: data.id });
      if (needsApproval) { await submitForApproval(kind, data.id, num, customer.name, t.total); toast({ title: "Sent for approval", description: "You can send it to the customer once it is approved." }); }
      // KRA eTIMS: sign the invoice as soon as it is sent, when the company asked for it.
      if (kind === "invoice" && mode === "send" && !needsApproval && erpSettings?.etims?.auto_sign && erpSettings?.etims?.initialised_at) {
        erpApi("etims/sign-invoice", { id: data.id }).then(() => qc.invalidateQueries({ queryKey: ["zdocs"] })).catch((e: any) => toast({ title: "KRA eTIMS did not sign it", description: e.message, variant: "destructive" }));
      }
      qc.invalidateQueries({ queryKey: ["zdocs"] });
      qc.invalidateQueries({ queryKey: ["doc-model"] });
      toast({ title: `${label} ${num} ${existing ? "updated" : "saved"}` });
      if (fromSample) await sb.from("sample_issues").update({ status: "converted", invoice_id: data.id }).eq("id", fromSample);
      if (!existing) await linkToContract(kind === "invoice" ? "invoice" : isOrder ? "sales_order" : "quote", data.id);
      const entity = kind === "invoice" ? "invoice" : isOrder ? "sales_order" : "quote";
      for (const file of files) await uploadDocument(tenantId!, file, { entity_type: entity, entity_id: data.id, entity_name: num, category: "Attachment", name: file.name }).catch(() => null);
      if (files.length) qc.invalidateQueries({ queryKey: ["documents"] });
      // Save and Send opens the email to the customer; Make Recurring opens the repeat settings.
      const next = new URLSearchParams();
      if (mode === "send" && !needsApproval) next.set("send", "1");
      if (recur && kind === "invoice") next.set("recur", "1");
      navigate(`${base}/${data.id}${next.toString() ? `?${next}` : ""}`);
    } catch (e: any) {
      toast({ title: "Not saved", description: e.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <OrbLoader label="Loading…" />;
  const Icon = isQuote ? FileText : Receipt;
  const title = existing ? `Edit ${label}` : `New ${label}`;

  return (
    <div className="flex min-h-[calc(100svh-6rem)] flex-col rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
        <Icon className="h-5 w-5 text-primary" />
        <h1 className="flex-1 font-display text-xl font-bold">{title}</h1>
        <Button size="icon" variant="ghost" onClick={() => navigate(existing ? `${base}/${existing.id}` : base)} aria-label="Close"><X /></Button>
      </div>

      <div className="flex-1 space-y-8 bg-card px-4 py-6 sm:px-6">
        <section className="space-y-4">
          <Row label="Customer Name" required>
            <CustomerPicker value={customer} onChange={setCustomer} />
          </Row>
          {(locations as any[]).length > 0 && <Row label="Location"><select className="fi max-w-xs" value={locationId} onChange={(e) => setLocationId(e.target.value)}>{(locations as any[]).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Row>}
        </section>

        <section className="space-y-4 border-t border-border pt-6">
          <Row label={`${label}#`} required hint={existing ? undefined : "Given automatically when you save"}>
            <input className="fi bg-muted/40" value={existing ? number : peek || "Given when saved"} readOnly title="Numbering is set under System → Document numbers" />
          </Row>
          <Row label={kind === "invoice" ? "Order Number" : "Reference#"}><input className="fi" value={reference} onChange={(e) => setReference(e.target.value)} /></Row>
          <div className="grid gap-4 xl:grid-cols-2">
            <Row label={isOrder ? "Order Date" : `${label} Date`} required>
              <input className="fi" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </Row>
            {isQuote ? (
              <Row label={isOrder ? "Expected Shipment Date" : "Expiry Date"}><input className="fi" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Row>
            ) : (
              <Row label="Terms">
                <select className="fi" value={terms} onChange={(e) => onTerms(e.target.value)}>
                  {TERMS.map((t) => <option key={t.label}>{t.label}</option>)}
                  {!TERMS.some((t) => t.label === terms) && <option>{terms}</option>}
                </select>
              </Row>
            )}
          </div>
          {isOrder && <div className="grid gap-4 xl:grid-cols-2">
            <Row label="Payment Terms"><select className="fi" value={terms} onChange={(e) => setTerms(e.target.value)}>{TERMS.map((t) => <option key={t.label}>{t.label}</option>)}{!TERMS.some((t) => t.label === terms) && <option>{terms}</option>}</select></Row>
            <Row label="Delivery Method"><input className="fi" list="so-delivery" value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="Choose or type" /><datalist id="so-delivery">{["Our delivery", "Customer collects", "Courier", "Rider", "G4S", "Wells Fargo", "Fargo Courier", "Road freight"].map((x) => <option key={x} value={x} />)}</datalist></Row>
          </div>}
          {!isQuote && <Row label="Due Date"><input className="fi" type="date" value={dueDate} onChange={(e) => { setDueDate(e.target.value); setTerms("Custom"); }} /></Row>}
          <Row label="Salesperson">
            <div className="flex gap-2">
              <select className="fi" value={salesperson} onChange={(e) => { spDefaulted.current = true; setSalesperson(e.target.value); }}>
                <option value="">No salesperson</option>
                {salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {salesperson && <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => { spDefaulted.current = true; setSalesperson(""); }} aria-label="Remove salesperson" title="Remove salesperson"><X /></Button>}
            </div>
          </Row>
          {!isOrder && <Row label="Description"><AutoGrowText className="fi" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={`Let your customer know what this ${label.toLowerCase()} is for`} /></Row>}
        </section>

        <CustomFieldInputs entity={customEntity} values={custom} onChange={setCustom} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" />
        {kind === "invoice" && <TagPickers module="invoices" values={tags} onChange={setTags} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" />}

        <section className="border-t border-border pt-6">
          <ItemTable inclusive={inclusive} onInclusive={setInclusive} tracing={kind === "invoice"} stockLocationId={existing?.stock_location_id || null} lines={lines} onChange={setLines} adjustments={adj} onAdjustments={setAdj} defaultVat={Number(biz?.default_vat_rate || 16)} currency={currencyCode() || "KES"}
            rateFor={customer?.id ? async (itemId) => { const { data } = await (supabase as any).rpc("price_for", { p_customer: customer.id, p_product: itemId }); return data === null || data === undefined ? null : Number(data); } : undefined} />
        </section>

        <section className="grid gap-6 border-t border-border pt-6 lg:grid-cols-2">
          <div>
            <p className="mb-1.5 text-sm font-medium">Customer Notes</p>
            <AutoGrowText className="fi min-h-[90px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">Will be displayed on the {isQuote ? "quote" : "invoice"}</p>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">Terms & Conditions</p>
            <AutoGrowText className="fi min-h-[90px]" value={tc} onChange={(e) => setTc(e.target.value)} placeholder="Enter the terms and conditions of your business to be displayed in your transaction" />
          </div>
        </section>
        <section className="grid gap-6 border-t border-border pt-6 lg:grid-cols-2">
          <div>
            <p className="mb-1.5 text-sm font-medium">Attach File(s) to {label}</p>
            <label className="flex max-w-md cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm hover:border-primary"><Paperclip className="h-4 w-4 text-muted-foreground" /> Upload File
              <input type="file" multiple className="hidden" onChange={(e) => { const add = Array.from(e.target.files || []).filter((x) => x.size <= 10 * 1024 * 1024); setFiles((cur) => [...cur, ...add].slice(0, maxFiles)); e.target.value = ""; }} /></label>
            <p className="mt-1 text-xs text-muted-foreground">You can upload a maximum of {maxFiles} files, 10MB each.</p>
            {files.length > 0 && <ul className="mt-2 max-w-md space-y-1 text-sm">{files.map((x, i) => <li key={i} className="flex items-center gap-2 rounded-lg bg-muted/60 px-2 py-1"><Paperclip className="h-4 w-4 text-muted-foreground" /><span className="flex-1 truncate">{x.name}</span><button type="button" className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${x.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button></li>)}</ul>}
          </div>
          {kind === "invoice" && (
            <div>
              <p className="mb-1.5 text-sm font-medium">Online payment</p>
              <label className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2.5 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={onlinePay} onChange={(e) => setOnlinePay(e.target.checked)} /> Let the customer pay this invoice with M-Pesa (from the invoice link and the customer portal)</label>
            </div>
          )}
        </section>
        <p className="text-xs text-muted-foreground">Prepared by {profile?.display_name || "you"}.</p>
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
        <Button variant="outline" onClick={() => save("draft")} disabled={!!saving}>{saving === "draft" && <OrbSpinner state="working" />} Save as Draft</Button>
        <Button onClick={() => save("send")} disabled={!!saving}>{saving === "send" && <OrbSpinner state="working" />} Save and Send</Button>
        <Button variant="ghost" onClick={() => navigate(existing ? `${base}/${existing.id}` : base)} disabled={!!saving}>Cancel</Button>
        <span className="flex-1" />
        {kind === "invoice" && !existing?.is_recurring && <label className="flex items-center gap-2 text-sm font-medium text-primary"><input type="checkbox" className="h-4 w-4 accent-primary" checked={recur} onChange={(e) => setRecur(e.target.checked)} /><Repeat className="h-4 w-4" /> Make Recurring</label>}
        <span className="text-right text-sm"><span className="block font-semibold">Total Amount: {currencyCode() || "KES"} {editTotals(lines, adj, inclusive).total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span><span className="block text-xs text-muted-foreground">Total Quantity: {lines.reduce((a, l) => a + (Number(l.quantity) || 0), 0)}</span></span>
      </div>
    </div>
  );
}
