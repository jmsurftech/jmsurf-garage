// KRA VAT return (VAT3) for one month, and the withholding VAT certificates register.
//
// Output VAT: invoices (issue_date, items[].tax_rate, stored tax/total) less credit notes
// (issue_date) plus till sales (transactions.tax). Input VAT: bills (bill_date, tax) less
// vendor credits (credit_date) plus expenses with VAT (expense_date, tax_amount). Withholding
// VAT deducted by customers: payments_received.withholding_vat (payment_date).
// Each document's stored VAT and total are kept as they are; its lines only decide how that
// amount splits between 16%, 8%, zero-rated and exempt (as KRA eTIMS bands them).
import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Percent, FileSpreadsheet, Download, AlertTriangle, ReceiptText, HandCoins, CheckCircle2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { Panel, StatGrid, StatTile, TableWrap, EmptyState, Segmented, Pill } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { Button } from "@/components/ui/button";
import { formatKES } from "@/lib/format";
import { saveFile } from "@/lib/erpApi";
import { cn } from "@/lib/utils";

const sb: any = supabase;
const n = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const PIN = /^[AP]\d{9}[A-Z]$/;
const kraDate = (d?: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const monthRange = (m: string): [string, string] => { const [y, mo] = m.split("-").map(Number); const end = new Date(y, mo, 0).getDate(); return [`${m}-01`, `${m}-${String(end).padStart(2, "0")}`]; };
const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

/** Every row of a query, 1,000 at a time. */
async function all(build: () => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await build().order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function byIds(table: string, cols: string, ids: string[]): Promise<Map<string, any>> {
  const m = new Map<string, any>();
  const list = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < list.length; i += 150) {
    const { data, error } = await sb.from(table).select(cols).in("id", list.slice(i, i + 150));
    if (error) throw error;
    for (const x of data || []) m.set(x.id, x);
  }
  return m;
}

// ------------------------------------------------------------------ bands
export type Band = "standard" | "reduced" | "zero" | "exempt";
export const BANDS: [Band, string][] = [["standard", "Standard rate 16%"], ["reduced", "Reduced rate 8%"], ["zero", "Zero-rated"], ["exempt", "Exempt"]];

/** A line's VAT band: the item's KRA tax type when set (A exempt, B 16%, C zero, D non-VAT, E 8%), else its rate. */
export function bandOf(rate: number, kraType?: string | null): Band {
  const t = String(kraType || "").toUpperCase();
  if (t === "B") return "standard";
  if (t === "E") return "reduced";
  if (t === "C") return "zero";
  if (t === "A" || t === "D") return "exempt";
  return rate >= 15 ? "standard" : rate >= 7 ? "reduced" : "exempt";
}

type Split = Record<Band, { taxable: number; vat: number }>;
const emptySplit = (): Split => ({ standard: { taxable: 0, vat: 0 }, reduced: { taxable: 0, vat: 0 }, zero: { taxable: 0, vat: 0 }, exempt: { taxable: 0, vat: 0 } });

/**
 * Splits a sales document (taxable value = total − tax, VAT = tax as stored) between bands in
 * proportion to its lines, so document discounts, shipping and adjustments are spread fairly.
 */
export function splitDoc(doc: { items?: unknown; total?: unknown; tax?: unknown; prices_include_tax?: boolean }, kraTypes: Map<string, string>): Split {
  const out = emptySplit();
  const total = n(doc.total), tax = n(doc.tax), taxable = total - tax;
  const lines = (Array.isArray(doc.items) ? doc.items : []).map((l: any) => {
    const rate = n(l.tax_rate ?? l.vat_rate);
    const gross = l.amount !== undefined && l.amount !== null ? n(l.amount) : n(l.quantity ?? l.qty ?? 1) * n(l.rate ?? l.price) * (1 - Math.min(100, Math.max(0, n(l.discount))) / 100);
    const net = doc.prices_include_tax && rate > 0 ? (gross * 100) / (100 + rate) : gross;
    return { band: bandOf(rate, kraTypes.get(String(l.item_id || l.product_id || ""))), net, vat: rate > 0 ? (net * rate) / 100 : 0 };
  }).filter((l) => l.net !== 0);
  const netSum = lines.reduce((a, l) => a + l.net, 0);
  const vatSum = lines.reduce((a, l) => a + l.vat, 0);
  if (!lines.length || netSum === 0) {
    const b: Band = tax > 0 ? (taxable > 0 && Math.abs(tax / taxable - 0.08) < 0.005 ? "reduced" : "standard") : "exempt";
    out[b] = { taxable, vat: tax };
    return out;
  }
  for (const l of lines) {
    out[l.band].taxable += (taxable * l.net) / netSum;
    out[l.band].vat += vatSum > 0 ? (tax * l.vat) / vatSum : 0;
  }
  // VAT the lines did not explain (e.g. VAT typed on a document without rates) is standard rate.
  if (vatSum === 0 && tax !== 0) out.standard.vat += tax;
  return out;
}

// ------------------------------------------------------------------ data
type SaleRow = { band: Band; pin: string; name: string; serial: string; date: string; number: string; description: string; taxable: number; vat: number; relNumber: string; relDate: string; kind: "invoice" | "credit_note" };
type BuyRow = { pin: string; name: string; date: string; number: string; description: string; taxable: number; vat: number; relNumber: string; relDate: string; kind: "bill" | "vendor_credit" | "expense" };
type WhtRow = { id: string; payment_number: string; payment_date: string; customer_id: string | null; customer_name: string; pin: string; amount: number; withheld: number; certificate_number: string; certificate_date: string };

export type VatMonth = {
  sales: Split; returns: Split; pos: Split; output: number;
  saleRows: SaleRow[]; noPin: { taxable: number; vat: number; count: number };
  purchases: { taxable: number; vat: number }; buyRows: BuyRow[]; input: number; buyNoPin: number;
  wht: WhtRow[]; withheld: number; withheldCertified: number;
};

async function kraTypes(tenantId: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const [p, s] = await Promise.all([
    sb.from("products").select("id,etims_tax_type").eq("tenant_id", tenantId).not("etims_tax_type", "is", null).limit(20000),
    sb.from("services").select("id,etims_tax_type").eq("tenant_id", tenantId).not("etims_tax_type", "is", null).limit(20000),
  ]);
  for (const x of [...(p.data || []), ...(s.data || [])]) if (x.etims_tax_type) m.set(x.id, x.etims_tax_type);
  return m;
}

export async function loadWithholding(tenantId: string, from: string, to: string): Promise<WhtRow[]> {
  const pays = await all(() => sb.from("payments_received").select("id,payment_number,payment_date,customer_id,customer_name,amount,withholding_vat")
    .eq("tenant_id", tenantId).gt("withholding_vat", 0).gte("payment_date", from).lte("payment_date", to));
  const [custs, certs] = await Promise.all([
    byIds("customers", "id,name,kra_pin", pays.map((p) => p.customer_id)),
    (async () => { const m = new Map<string, any>(); const ids = pays.map((p) => p.id); for (let i = 0; i < ids.length; i += 150) { const { data } = await sb.from("wht_vat_certificates").select("payment_id,certificate_number,certificate_date").in("payment_id", ids.slice(i, i + 150)); for (const c of data || []) m.set(c.payment_id, c); } return m; })(),
  ]);
  return pays.map((p) => ({
    id: p.id, payment_number: p.payment_number || "", payment_date: p.payment_date, customer_id: p.customer_id,
    customer_name: custs.get(p.customer_id)?.name || p.customer_name || "—", pin: String(custs.get(p.customer_id)?.kra_pin || "").toUpperCase(),
    amount: n(p.amount), withheld: n(p.withholding_vat),
    certificate_number: certs.get(p.id)?.certificate_number || "", certificate_date: certs.get(p.id)?.certificate_date || "",
  })).sort((a, b) => a.payment_date.localeCompare(b.payment_date) || a.customer_name.localeCompare(b.customer_name));
}

export async function loadVatMonth(tenantId: string, month: string): Promise<VatMonth> {
  const [from, to] = monthRange(month);
  const notPending = (q: any) => q.or("approval_status.is.null,approval_status.not.in.(pending,rejected)");
  const [types, invoices, notes, tills, bills, vcs, exps, wht] = await Promise.all([
    kraTypes(tenantId),
    all(() => notPending(sb.from("invoices").select("id,invoice_number,issue_date,customer_id,customer_name,subject,items,total,tax,prices_include_tax,etims_sdc_id")
      .eq("tenant_id", tenantId).not("status", "in", "(draft,void,cancelled)").neq("source", "pos").gte("issue_date", from).lte("issue_date", to))),
    all(() => notPending(sb.from("credit_notes").select("id,credit_note_number,issue_date,customer_id,customer_name,invoice_id,reason,items,total,tax,prices_include_tax,etims_sdc_id")
      .eq("tenant_id", tenantId).not("status", "in", "(draft,void)").gte("issue_date", from).lte("issue_date", to))),
    all(() => sb.from("transactions").select("id,total,tax,refunded_amount").eq("tenant_id", tenantId).eq("status", "completed").is("invoice_id", null)
      .gte("created_at", `${from}T00:00:00+03:00`).lte("created_at", `${to}T23:59:59.999+03:00`)),
    all(() => notPending(sb.from("bills").select("id,bill_number,reference,bill_date,supplier_id,name,category,amount,tax")
      .eq("tenant_id", tenantId).not("status", "in", "(draft,void,cancelled)").gte("bill_date", from).lte("bill_date", to))),
    all(() => sb.from("vendor_credits").select("id,credit_number,credit_date,supplier_id,supplier_name,bill_id,reason,amount,items")
      .eq("tenant_id", tenantId).not("status", "in", "(draft,void)").gte("credit_date", from).lte("credit_date", to)),
    all(() => sb.from("expenses").select("id,expense_number,reference,expense_date,supplier_id,vendor_name,description,category_name,amount,tax_amount,approval_status")
      .eq("tenant_id", tenantId).neq("tax_amount", 0).gte("expense_date", from).lte("expense_date", to)),
    loadWithholding(tenantId, from, to),
  ]);
  const [custs, sups, relInv, relBills] = await Promise.all([
    byIds("customers", "id,name,kra_pin", [...invoices, ...notes].map((d) => d.customer_id)),
    byIds("suppliers", "id,name,kra_pin", [...bills, ...vcs, ...exps].map((d) => d.supplier_id)),
    byIds("invoices", "id,invoice_number,issue_date", notes.map((c) => c.invoice_id)),
    byIds("bills", "id,bill_number,reference,bill_date,amount,tax", vcs.map((v) => v.bill_id)),
  ]);
  const pinOf = (m: Map<string, any>, id: string | null) => String(m.get(id || "")?.kra_pin || "").trim().toUpperCase();
  const words = (items: unknown, fallback: string) => (fallback || (Array.isArray(items) ? items.map((l: any) => l?.name).filter(Boolean).join(", ") : "")).slice(0, 100);

  // Sales
  const sales = emptySplit(), returns = emptySplit(), pos = emptySplit();
  const saleRows: SaleRow[] = [];
  const noPin = { taxable: 0, vat: 0, count: 0 };
  const addSale = (d: any, kind: "invoice" | "credit_note", sign: 1 | -1) => {
    const split = splitDoc(d, types);
    const pin = pinOf(custs, d.customer_id);
    const target = sign === 1 ? sales : returns;
    for (const [b] of BANDS) {
      const x = split[b];
      if (!x.taxable && !x.vat) continue;
      target[b].taxable += x.taxable; target[b].vat += x.vat;
      if (b !== "standard" && b !== "reduced") continue;
      if (!PIN.test(pin)) { noPin.taxable += sign * x.taxable; noPin.vat += sign * x.vat; noPin.count++; continue; }
      const rel = kind === "credit_note" ? relInv.get(d.invoice_id) : null;
      saleRows.push({
        band: b, kind, pin, name: custs.get(d.customer_id)?.name || d.customer_name || "", serial: d.etims_sdc_id || "",
        date: d.issue_date, number: kind === "invoice" ? d.invoice_number : d.credit_note_number,
        description: words(d.items, kind === "invoice" ? d.subject : d.reason), taxable: r2(sign * x.taxable), vat: r2(sign * x.vat),
        relNumber: rel?.invoice_number || "", relDate: rel?.issue_date || "",
      });
    }
  };
  for (const d of invoices) addSale(d, "invoice", 1);
  for (const d of notes) addSale(d, "credit_note", -1);
  for (const t of tills) {
    const total = n(t.total), tax = n(t.tax), keep = total > 0 ? Math.max(0, 1 - n(t.refunded_amount) / total) : 0;
    const b: Band = tax > 0 ? "standard" : "exempt";
    pos[b].taxable += (total - tax) * keep; pos[b].vat += tax * keep;
    if (tax > 0) { noPin.taxable += (total - tax) * keep; noPin.vat += tax * keep; }
  }
  if (tills.length) noPin.count += tills.length;
  const output = BANDS.reduce((a, [b]) => a + sales[b].vat - returns[b].vat + pos[b].vat, 0);

  // Purchases
  const buyRows: BuyRow[] = [];
  for (const b of bills) {
    const vat = n(b.tax); if (!vat) continue;
    buyRows.push({ kind: "bill", pin: pinOf(sups, b.supplier_id), name: sups.get(b.supplier_id)?.name || String(b.name || "").split(" · ")[0], date: b.bill_date, number: b.reference || b.bill_number || "", description: String(b.category || b.name || "").slice(0, 100), taxable: r2(n(b.amount) - vat), vat: r2(vat), relNumber: "", relDate: "" });
  }
  for (const v of vcs) {
    // VAT on a vendor credit: from its lines' rates when they have them, else in the same share as the bill it credits.
    const lines = Array.isArray(v.items) ? v.items : [];
    let vat = lines.reduce((a: number, l: any) => { const rate = n(l.tax_rate); const amt = n(l.amount) || n(l.quantity) * n(l.unit_cost); return a + (rate > 0 ? (amt * rate) / (100 + rate) : 0); }, 0);
    const bill = relBills.get(v.bill_id);
    if (!vat && bill && n(bill.amount) > 0) vat = (n(v.amount) * n(bill.tax)) / n(bill.amount);
    if (!vat) continue;
    buyRows.push({ kind: "vendor_credit", pin: pinOf(sups, v.supplier_id), name: sups.get(v.supplier_id)?.name || v.supplier_name || "", date: v.credit_date, number: v.credit_number || "", description: String(v.reason || "Vendor credit").slice(0, 100), taxable: r2(-(n(v.amount) - vat)), vat: r2(-vat), relNumber: bill ? bill.reference || bill.bill_number || "" : "", relDate: bill?.bill_date || "" });
  }
  for (const e of exps) {
    if (["pending", "rejected"].includes(String(e.approval_status || ""))) continue;
    const vat = n(e.tax_amount); if (!vat) continue;
    buyRows.push({ kind: "expense", pin: pinOf(sups, e.supplier_id), name: sups.get(e.supplier_id)?.name || e.vendor_name || "", date: e.expense_date, number: e.reference || e.expense_number || "", description: String(e.description || e.category_name || "").slice(0, 100), taxable: r2(n(e.amount) - vat), vat: r2(vat), relNumber: "", relDate: "" });
  }
  buyRows.sort((a, b) => a.date.localeCompare(b.date));
  saleRows.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  const purchases = { taxable: buyRows.reduce((a, x) => a + x.taxable, 0), vat: buyRows.reduce((a, x) => a + x.vat, 0) };
  const withheld = wht.reduce((a, w) => a + w.withheld, 0);
  return {
    sales, returns, pos, output, saleRows, noPin, purchases, buyRows, input: purchases.vat, buyNoPin: buyRows.filter((x) => !PIN.test(x.pin)).length,
    wht, withheld, withheldCertified: wht.filter((w) => w.certificate_number).reduce((a, w) => a + w.withheld, 0),
  };
}

// ------------------------------------------------------------------ exports
const SALE_HEAD = ["PIN of Purchaser", "Name of Purchaser", "ETR Serial Number", "Invoice Date", "Invoice Number", "Description of Goods / Services", "Taxable Value (Ksh)", "Amount of VAT (Ksh)", "Relevant Invoice Number", "Relevant Invoice Date"];
const BUY_HEAD = ["PIN of Supplier", "Name of Supplier", "Invoice Date", "Invoice Number", "Description of Goods / Services", "Taxable Value (Ksh)", "Amount of VAT (Ksh)", "Relevant Invoice Number", "Relevant Invoice Date"];
const saleCells = (x: SaleRow) => [x.pin, x.name, x.serial, kraDate(x.date), x.number, x.description, x.taxable, x.vat, x.relNumber, kraDate(x.relDate)];
const buyCells = (x: BuyRow) => [x.pin, x.name, kraDate(x.date), x.number, x.description, x.taxable, x.vat, x.relNumber, kraDate(x.relDate)];

/** iTax CSV: no heading row, dd/mm/yyyy dates, plain numbers with two decimals. */
function itaxCsv(name: string, rows: (string | number)[][]) {
  const cell = (v: string | number) => (typeof v === "number" ? v.toFixed(2) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  saveFile(name, rows.map((r) => r.map(cell).join(",")).join("\r\n"), "text/csv;charset=utf-8");
}

async function workbook(month: string, d: VatMonth, credit: number) {
  const XLSX = await import("@e965/xlsx");
  const wb = XLSX.utils.book_new();
  const sum = summaryRows(d, credit);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`VAT return for ${monthName(month)}`], [], ["Line", "Taxable value (Ksh)", "VAT (Ksh)"], ...sum.map((s) => [s.label, s.taxable ?? "", s.vat])]), "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([SALE_HEAD, ...d.saleRows.filter((x) => x.band === "standard").map(saleCells)]), "Sales 16%");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([SALE_HEAD, ...d.saleRows.filter((x) => x.band === "reduced").map(saleCells)]), "Sales 8%");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Sales to customers without a PIN (incl. till sales)", "Taxable Value (Ksh)", "Amount of VAT (Ksh)"], ["Total", r2(d.noPin.taxable), r2(d.noPin.vat)]]), "Sales without PIN");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([BUY_HEAD, ...d.buyRows.map(buyCells)]), "Purchases");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["PIN of Withholder", "Name of Withholder", "Payment Date", "Payment Number", "Amount Paid (Ksh)", "VAT Withheld (Ksh)", "Certificate Number", "Certificate Date"], ...d.wht.map((w) => [w.pin, w.customer_name, kraDate(w.payment_date), w.payment_number, w.amount, w.withheld, w.certificate_number, kraDate(w.certificate_date)])]), "Withholding VAT");
  XLSX.writeFile(wb, `VAT3-${month}.xlsx`);
}

type SumRow = { label: string; taxable?: number; vat: number; strong?: boolean };
function summaryRows(d: VatMonth, credit: number): SumRow[] {
  const out: SumRow[] = [];
  for (const [b, label] of BANDS) {
    const taxable = d.sales[b].taxable - d.returns[b].taxable + d.pos[b].taxable;
    const vat = d.sales[b].vat - d.returns[b].vat + d.pos[b].vat;
    out.push({ label: `Sales: ${label}`, taxable: r2(taxable), vat: r2(vat) });
  }
  out.push({ label: "Output VAT", vat: r2(d.output), strong: true });
  out.push({ label: "Purchases with VAT (bills, expenses, less vendor credits)", taxable: r2(d.purchases.taxable), vat: r2(d.purchases.vat) });
  out.push({ label: "Input VAT", vat: r2(d.input), strong: true });
  out.push({ label: "Withholding VAT deducted by customers", vat: r2(d.withheld) });
  if (credit) out.push({ label: "Credit brought forward from last month", vat: r2(credit) });
  const net = d.output - d.input - d.withheld - credit;
  out.push({ label: net >= 0 ? "VAT payable" : "VAT credit to carry forward", vat: r2(Math.abs(net)), strong: true });
  return out;
}

// ------------------------------------------------------------------ VAT return screen
const MonthPick = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <label className="inline-flex items-center gap-2 text-sm"><span className="text-muted-foreground">Month</span>
    <input type="month" className="fi h-9 w-auto" value={value} max={new Date().toISOString().slice(0, 7)} onChange={(e) => e.target.value && onChange(e.target.value)} /></label>
);
const Warn = ({ children }: { children: ReactNode }) => <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" /><span>{children}</span></p>;

export function VatReturnReport() {
  const tenantId = useTenantId();
  const { can } = usePermissions();
  const { toast } = useToast();
  const [month, setMonth] = useState(lastMonth);
  const [credit, setCredit] = useState("");
  const [tab, setTab] = useState<"summary" | "sales" | "purchases" | "wht">("summary");
  const allowed = can("reports.taxes", "view");
  const mayExport = can("reports.taxes", "export");
  const { data, isLoading, error } = useQuery({
    queryKey: ["vat-return", tenantId, month], enabled: !!tenantId && allowed,
    queryFn: () => loadVatMonth(tenantId!, month),
  });
  const cf = Math.max(0, n(credit));
  const rows = useMemo(() => (data ? summaryRows(data, cf) : []), [data, cf]);
  if (!allowed) return <EmptyState icon={Percent} title="You cannot see tax reports" description="Ask the owner to allow Taxes in your role's reports." />;
  const net = data ? data.output - data.input - data.withheld - cf : 0;
  const run = async (f: () => void | Promise<void>) => { try { await f(); } catch (e: any) { toast({ title: "File not made", description: e.message, variant: "destructive" }); } };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <MonthPick value={month} onChange={setMonth} />
        <label className="inline-flex items-center gap-2 text-sm"><span className="text-muted-foreground">Credit brought forward</span>
          <input type="number" min={0} step="0.01" className="fi h-9 w-32" value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="0.00" /></label>
        {mayExport && data && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => run(() => workbook(month, data, cf))}><FileSpreadsheet /> Excel (all schedules)</Button>
            <Button size="sm" variant="outline" onClick={() => run(() => itaxCsv(`VAT3-sales-16-${month}.csv`, data.saleRows.filter((x) => x.band === "standard").map(saleCells)))}><Download /> Sales 16% CSV</Button>
            <Button size="sm" variant="outline" onClick={() => run(() => itaxCsv(`VAT3-sales-8-${month}.csv`, data.saleRows.filter((x) => x.band === "reduced").map(saleCells)))}><Download /> Sales 8% CSV</Button>
            <Button size="sm" variant="outline" onClick={() => run(() => itaxCsv(`VAT3-purchases-${month}.csv`, data.buyRows.map(buyCells)))}><Download /> Purchases CSV</Button>
          </div>
        )}
      </div>
      {isLoading ? <OrbLoader label="Working out the VAT return…" /> : error ? <EmptyState icon={Percent} title="The VAT return could not load" description={(error as Error).message} /> : data && <>
        <StatGrid>
          <StatTile label="Output VAT" value={formatKES(data.output)} icon={ReceiptText} tone="primary" />
          <StatTile label="Input VAT" value={formatKES(data.input)} icon={FileSpreadsheet} tone="info" />
          <StatTile label="Withholding VAT" value={formatKES(data.withheld)} icon={HandCoins} tone="muted" hint={data.wht.length ? `Certificates for ${formatKES(data.withheldCertified)}` : undefined} />
          <StatTile label={net >= 0 ? "VAT payable" : "Credit to carry forward"} value={formatKES(Math.abs(net))} icon={Percent} tone={net >= 0 ? "danger" : "success"} hint={`For ${monthName(month)}, due by the 20th of the next month`} />
        </StatGrid>
        {data.buyNoPin > 0 && <Warn>{data.buyNoPin} purchase{data.buyNoPin === 1 ? " has" : "s have"} no supplier KRA PIN. iTax only accepts input VAT with the supplier's PIN: add it on the vendor.</Warn>}
        {data.wht.some((w) => !w.certificate_number) && <Warn>Some withholding VAT has no certificate number yet. Record certificates under Withholding VAT certificates.</Warn>}
        <Segmented value={tab} onChange={(v) => setTab(v as typeof tab)} options={[{ value: "summary", label: "Summary" }, { value: "sales", label: "Sales schedule", count: data.saleRows.length }, { value: "purchases", label: "Purchases schedule", count: data.buyRows.length }, { value: "wht", label: "Withholding VAT", count: data.wht.length }]} />
        {tab === "summary" && (
          <Panel flush title={`VAT return · ${monthName(month)}`} icon={Percent} description="Sales and purchases by the document date, using the VAT stored on each document.">
            <TableWrap><table className="dt">
              <thead><tr><th>Line</th><th className="num">Taxable value</th><th className="num">VAT</th></tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i} className={cn(r.strong && "font-semibold")}><td>{r.label}</td><td className="num">{r.taxable === undefined ? "" : formatKES(r.taxable)}</td><td className="num">{formatKES(r.vat)}</td></tr>)}</tbody>
            </table></TableWrap>
            <p className="px-3 py-2 text-xs text-muted-foreground">Sales to customers without a KRA PIN, till sales included: {formatKES(data.noPin.taxable)} taxable, {formatKES(data.noPin.vat)} VAT. These go in iTax as one total, not invoice by invoice.</p>
          </Panel>
        )}
        {tab === "sales" && (
          <Panel flush title="Sales to customers with a KRA PIN" icon={ReceiptText} description="16% and 8% invoices, credit notes as minus lines.">
            {data.saleRows.length === 0 ? <EmptyState icon={ReceiptText} title="No sales to customers with a PIN this month" /> : <TableWrap><table className="dt">
              <thead><tr><th>Rate</th><th>PIN</th><th>Customer</th><th>CU serial</th><th>Date</th><th>Number</th><th>Description</th><th className="num">Taxable</th><th className="num">VAT</th><th>For invoice</th></tr></thead>
              <tbody>{data.saleRows.map((x, i) => <tr key={i}><td>{x.band === "standard" ? "16%" : "8%"}</td><td className="font-mono text-xs">{x.pin}</td><td>{x.name}</td><td className="font-mono text-xs">{x.serial || "—"}</td><td>{kraDate(x.date)}</td><td>{x.number}</td><td className="max-w-[220px] truncate" title={x.description}>{x.description}</td><td className="num">{formatKES(x.taxable)}</td><td className="num">{formatKES(x.vat)}</td><td>{x.relNumber}</td></tr>)}</tbody>
            </table></TableWrap>}
          </Panel>
        )}
        {tab === "purchases" && (
          <Panel flush title="Purchases with VAT" icon={FileSpreadsheet} description="Bills and expenses with VAT; vendor credits as minus lines.">
            {data.buyRows.length === 0 ? <EmptyState icon={FileSpreadsheet} title="No purchases with VAT this month" /> : <TableWrap><table className="dt">
              <thead><tr><th>PIN</th><th>Supplier</th><th>Date</th><th>Invoice number</th><th>Description</th><th className="num">Taxable</th><th className="num">VAT</th><th>From</th></tr></thead>
              <tbody>{data.buyRows.map((x, i) => <tr key={i}><td className="font-mono text-xs">{x.pin || <Pill tone="warning">No PIN</Pill>}</td><td>{x.name}</td><td>{kraDate(x.date)}</td><td>{x.number}</td><td className="max-w-[220px] truncate" title={x.description}>{x.description}</td><td className="num">{formatKES(x.taxable)}</td><td className="num">{formatKES(x.vat)}</td><td className="text-xs text-muted-foreground">{x.kind === "bill" ? "Bill" : x.kind === "expense" ? "Expense" : "Vendor credit"}</td></tr>)}</tbody>
            </table></TableWrap>}
          </Panel>
        )}
        {tab === "wht" && <WhtTable rows={data.wht} editable onSaved={() => undefined} />}
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ withholding VAT certificates
function WhtTable({ rows, editable, onSaved }: { rows: WhtRow[]; editable: boolean; onSaved: () => void }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [edit, setEdit] = useState<Record<string, { no: string; date: string }>>({});
  const [busy, setBusy] = useState("");
  if (!rows.length) return <Panel><EmptyState icon={HandCoins} title="No withholding VAT in this period" description="Withholding VAT shows here when a payment is recorded with VAT withheld by the customer." /></Panel>;
  const save = async (w: WhtRow) => {
    const e = edit[w.id] || { no: w.certificate_number, date: w.certificate_date };
    setBusy(w.id);
    const { error } = await sb.from("wht_vat_certificates").upsert({ tenant_id: tenantId, payment_id: w.id, certificate_number: e.no.trim() || null, certificate_date: e.date || null, updated_at: new Date().toISOString() }, { onConflict: "payment_id" });
    setBusy("");
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: e.no.trim() ? `Certificate ${e.no.trim()} saved` : "Certificate cleared" });
    setEdit((x) => { const c = { ...x }; delete c[w.id]; return c; });
    qc.invalidateQueries({ queryKey: ["vat-return"] }); qc.invalidateQueries({ queryKey: ["wht-certs"] });
    onSaved();
  };
  return (
    <Panel flush title="Withholding VAT deducted by customers" icon={HandCoins} description="Enter each certificate number as it arrives from the customer (or from iTax).">
      <TableWrap><table className="dt">
        <thead><tr><th>Date</th><th>Customer</th><th>PIN</th><th>Payment</th><th className="num">Paid</th><th className="num">Withheld</th><th>Certificate number</th><th>Certificate date</th>{editable && <th />}</tr></thead>
        <tbody>{rows.map((w) => {
          const e = edit[w.id];
          const changed = !!e && (e.no !== w.certificate_number || e.date !== w.certificate_date);
          return (
            <tr key={w.id}>
              <td>{kraDate(w.payment_date)}</td><td>{w.customer_name}</td><td className="font-mono text-xs">{w.pin || "—"}</td><td>{w.payment_number}</td>
              <td className="num">{formatKES(w.amount)}</td><td className="num">{formatKES(w.withheld)}</td>
              {editable ? <>
                <td><input className="fi h-8 w-40 text-xs" value={e?.no ?? w.certificate_number} placeholder="Not received" onChange={(ev) => setEdit({ ...edit, [w.id]: { no: ev.target.value, date: e?.date ?? w.certificate_date } })} /></td>
                <td><input type="date" className="fi h-8 w-auto text-xs" value={e?.date ?? w.certificate_date} onChange={(ev) => setEdit({ ...edit, [w.id]: { no: e?.no ?? w.certificate_number, date: ev.target.value } })} /></td>
                <td>{changed ? <Button size="sm" variant="outline" onClick={() => save(w)} disabled={busy === w.id}><Save /> Save</Button> : w.certificate_number ? <CheckCircle2 className="h-4 w-4 text-success" /> : null}</td>
              </> : <>
                <td>{w.certificate_number || <Pill tone="warning">Not received</Pill>}</td><td>{kraDate(w.certificate_date)}</td>
              </>}
            </tr>
          );
        })}</tbody>
      </table></TableWrap>
    </Panel>
  );
}

/** Withholding VAT certificates: every payment with VAT withheld, by customer and month, and which certificates came in. */
export function WhtCertificatesReport() {
  const tenantId = useTenantId();
  const { can } = usePermissions();
  const { toast } = useToast();
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 7));
  const [view, setView] = useState<"summary" | "payments">("summary");
  const [show, setShow] = useState<"all" | "missing" | "received">("all");
  const allowed = can("reports.taxes", "view");
  const range: [string, string] = [monthRange(from)[0], monthRange(to)[1]];
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["wht-certs", tenantId, range.join()], enabled: !!tenantId && allowed,
    queryFn: () => loadWithholding(tenantId!, range[0], range[1]),
  });
  const rows = data.filter((w) => show === "all" || (show === "missing" ? !w.certificate_number : !!w.certificate_number));
  const groups = useMemo(() => {
    const m = new Map<string, { month: string; customer: string; pin: string; payments: number; withheld: number; received: number }>();
    for (const w of rows) {
      const k = `${w.payment_date.slice(0, 7)}|${w.customer_id || w.customer_name}`;
      const g = m.get(k) || { month: w.payment_date.slice(0, 7), customer: w.customer_name, pin: w.pin, payments: 0, withheld: 0, received: 0 };
      g.payments++; g.withheld += w.withheld; if (w.certificate_number) g.received += w.withheld;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => a.month.localeCompare(b.month) || a.customer.localeCompare(b.customer));
  }, [rows]);
  if (!allowed) return <EmptyState icon={HandCoins} title="You cannot see tax reports" description="Ask the owner to allow Taxes in your role's reports." />;
  const total = data.reduce((a, w) => a + w.withheld, 0);
  const got = data.filter((w) => w.certificate_number).reduce((a, w) => a + w.withheld, 0);
  const exportXlsx = async () => {
    try {
      const XLSX = await import("@e965/xlsx");
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Month", "Customer", "PIN", "Payments", "VAT withheld (Ksh)", "With certificate (Ksh)", "Certificate missing (Ksh)"], ...groups.map((g) => [monthName(g.month), g.customer, g.pin, g.payments, r2(g.withheld), r2(g.received), r2(g.withheld - g.received)])]), "By customer and month");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Payment date", "Customer", "PIN", "Payment number", "Amount paid (Ksh)", "VAT withheld (Ksh)", "Certificate number", "Certificate date"], ...rows.map((w) => [kraDate(w.payment_date), w.customer_name, w.pin, w.payment_number, w.amount, w.withheld, w.certificate_number, kraDate(w.certificate_date)])]), "Payments");
      XLSX.writeFile(wb, `withholding-vat-${from}-to-${to}.xlsx`);
    } catch (e: any) { toast({ title: "File not made", description: e.message, variant: "destructive" }); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <MonthPick value={from} onChange={setFrom} /><span className="text-sm text-muted-foreground">to</span><input type="month" className="fi h-9 w-auto" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        <Segmented value={show} onChange={(v) => setShow(v as typeof show)} options={[{ value: "all", label: "All" }, { value: "missing", label: "Missing certificate" }, { value: "received", label: "Received" }]} />
        {can("reports.taxes", "export") && <Button size="sm" variant="outline" className="ml-auto" onClick={exportXlsx} disabled={!rows.length}><FileSpreadsheet /> Excel</Button>}
      </div>
      <StatGrid>
        <StatTile label="VAT withheld" value={formatKES(total)} icon={HandCoins} tone="primary" />
        <StatTile label="Certificates received" value={formatKES(got)} icon={CheckCircle2} tone="success" />
        <StatTile label="Certificates missing" value={formatKES(total - got)} icon={AlertTriangle} tone={total - got > 0 ? "warning" : "muted"} hint={`${data.filter((w) => !w.certificate_number).length} payments`} />
        <StatTile label="Customers" value={new Set(data.map((w) => w.customer_id || w.customer_name)).size} icon={ReceiptText} tone="muted" />
      </StatGrid>
      <Segmented value={view} onChange={(v) => setView(v as typeof view)} options={[{ value: "summary", label: "By customer and month" }, { value: "payments", label: "Payments", count: rows.length }]} />
      {isLoading ? <OrbLoader label="Loading withholding VAT…" /> : error ? <EmptyState icon={HandCoins} title="This report could not load" description={(error as Error).message} />
        : view === "payments" ? <WhtTable rows={rows} editable onSaved={() => undefined} />
        : groups.length === 0 ? <Panel><EmptyState icon={HandCoins} title="No withholding VAT in this period" /></Panel>
        : <Panel flush title="Withholding VAT by customer and month" icon={HandCoins}>
            <TableWrap><table className="dt">
              <thead><tr><th>Month</th><th>Customer</th><th>PIN</th><th className="num">Payments</th><th className="num">Withheld</th><th className="num">With certificate</th><th className="num">Missing</th></tr></thead>
              <tbody>{groups.map((g, i) => <tr key={i}><td>{monthName(g.month)}</td><td className="font-medium">{g.customer}</td><td className="font-mono text-xs">{g.pin || "—"}</td><td className="num">{g.payments}</td><td className="num">{formatKES(g.withheld)}</td><td className="num">{formatKES(g.received)}</td><td className={cn("num", g.withheld - g.received > 0.005 && "text-warning")}>{formatKES(g.withheld - g.received)}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={4}>Total</td><td className="num">{formatKES(groups.reduce((a, g) => a + g.withheld, 0))}</td><td className="num">{formatKES(groups.reduce((a, g) => a + g.received, 0))}</td><td className="num">{formatKES(groups.reduce((a, g) => a + g.withheld - g.received, 0))}</td></tr></tfoot>
            </table></TableWrap>
          </Panel>}
    </div>
  );
}

/** Accounting → VAT return: the return and the certificates register on one page. */
export default function VatReturnPage() {
  const [tab, setTab] = useState<"return" | "wht">("return");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold">VAT return</h1>
        <p className="text-sm text-muted-foreground">KRA VAT3 for a month, with the sales and purchases schedules for iTax.</p>
      </div>
      <Segmented value={tab} onChange={(v) => setTab(v as typeof tab)} options={[{ value: "return", label: "VAT return (VAT3)" }, { value: "wht", label: "Withholding VAT certificates" }]} />
      {tab === "return" ? <VatReturnReport /> : <WhtCertificatesReport />}
    </div>
  );
}
