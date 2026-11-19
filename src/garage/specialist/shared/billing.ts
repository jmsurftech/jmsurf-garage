/**
 * Every specialist bill is a normal sales invoice: it then flows to the books,
 * KRA eTIMS, statements, payment links and reminders like any other invoice.
 */
import { sb, num, today } from "./db";
import { getPayLink } from "@/lib/payLink";
import { sendShopMessage } from "@/lib/messaging";

export interface BillLine {
  name: string;
  description?: string | null;
  quantity: number;
  rate: number;
  /** VAT percent on the line (0 = none). */
  tax_rate?: number;
  item_id?: string | null;
}

export const billTotal = (lines: BillLine[]) => {
  const subtotal = lines.reduce((a, l) => a + num(l.quantity) * num(l.rate), 0);
  const tax = lines.reduce((a, l) => a + num(l.quantity) * num(l.rate) * (num(l.tax_rate) / 100), 0);
  return { subtotal: Math.round(subtotal * 100) / 100, tax: Math.round(tax * 100) / 100, total: Math.round((subtotal + tax) * 100) / 100 };
};

/**
 * Creates the invoice and returns its id and number. `status` "sent" makes it payable
 * at once (gate payments, on-site towing); "draft" leaves it for review in Sales.
 */
export async function createInvoice(tenantId: string, input: {
  customerId: string;
  lines: BillLine[];
  subject?: string;
  reference?: string | null;
  notes?: string | null;
  source: string;
  status?: "draft" | "sent";
  dueDays?: number;
  /** Amount off the invoice total (e.g. the policy excess on an insurer's invoice). */
  discount?: number;
}): Promise<{ id: string; number: string }> {
  if (!input.customerId) throw new Error("Choose who the invoice is for first");
  const lines = input.lines.filter((l) => num(l.quantity) && num(l.rate) >= 0 && (num(l.rate) || l.name));
  if (!lines.length) throw new Error("There is nothing to invoice");
  const { data: c } = await sb.from("customers").select("name, email, phone, credit_days").eq("id", input.customerId).maybeSingle();
  const { data: no, error: nErr } = await sb.rpc("next_doc_number", { p_kind: "invoice" });
  if (nErr) throw nErr;
  const items = lines.map((l) => {
    const amount = Math.round(num(l.quantity) * num(l.rate) * 100) / 100;
    return { item_id: l.item_id || null, product_id: l.item_id || null, name: l.name, description: l.description || null, quantity: num(l.quantity), rate: num(l.rate), price: num(l.rate), amount, discount: 0, tax_rate: num(l.tax_rate) };
  });
  const t = billTotal(lines);
  const days = input.dueDays ?? (num(c?.credit_days) > 0 ? num(c.credit_days) : 0);
  const due = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const { data, error } = await sb.from("invoices").insert({
    tenant_id: tenantId, invoice_number: no, customer_id: input.customerId, customer_name: c?.name || null,
    customer_email: c?.email || null, customer_phone: c?.phone || null, items, subtotal: t.subtotal, tax: t.tax, discount: Math.max(0, num(input.discount)), total: Math.round((t.total - Math.max(0, num(input.discount))) * 100) / 100,
    status: input.status || "draft", issue_date: today(), due_date: due, payment_terms: days ? `Net ${days}` : "Due on Receipt",
    subject: input.subject || null, reference: input.reference || null, notes: input.notes || null, source: input.source,
  }).select("id, invoice_number").single();
  if (error) throw error;
  return { id: data.id, number: data.invoice_number };
}

/** The invoice's pay link (M-Pesa and cards through the company's payment setup). */
export async function invoicePayLink(invoiceId: string): Promise<string> {
  return getPayLink(invoiceId);
}

/** Texts the pay link to the customer. */
export async function smsPayLink(invoiceId: string, phone: string, text: string): Promise<string> {
  const link = await getPayLink(invoiceId);
  const r = await sendShopMessage("sms", phone, `${text} ${link}`);
  if (r && r.ok === false) throw new Error(r.error || "SMS not sent");
  return link;
}

export const invoiceBalance = (inv: any) => (inv ? Math.max(0, num(inv.total) - num(inv.amount_paid)) : 0);
