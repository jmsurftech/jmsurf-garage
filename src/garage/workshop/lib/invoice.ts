/**
 * Invoices from a job. They are normal sales invoices (same table, numbering, stock,
 * accounting, payments, payment links and KRA eTIMS), linked back to the job.
 *
 * Parts already issued to the job are put back in the books just before the invoice is
 * saved, because the invoice takes them out of stock itself; nothing is counted twice.
 */
import { erpApi } from "@/lib/erpApi";
import { sb, must } from "./api";
import { jobTotals, toInvoiceItem, type MoneyLine, type Payer } from "./totals";

export async function createJobInvoice(opts: {
  tenantId: string;
  userId?: string | null;
  job: any;
  lines: (MoneyLine & { id: string })[];
  payer: Payer;
  customer: { id: string; name: string; phone?: string | null; email?: string | null };
  locationId?: string | null;
  dueDays?: number;
}): Promise<{ id: string; invoice_number: string }> {
  const { tenantId, job, lines, payer, customer } = opts;
  if (!lines.length) throw new Error("Nothing approved to invoice");
  const lineIds = lines.map((l) => l.id);
  const number = must(await sb.rpc("next_doc_number", { p_kind: "invoice" })) as string;
  const t = jobTotals(lines);
  const plate = job.vehicle?.plate ? ` · ${job.vehicle.plate}` : "";
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + (opts.dueDays ?? 0) * 86_400_000).toISOString().slice(0, 10);

  // 1. Issued parts back on the shelf (in the books), so the invoice can take them.
  const moved = Number(must(await sb.rpc("garage_parts_to_invoice", { p_job: job.id, p_lines: lineIds, p_back: true })) || 0);
  let inv: any;
  try {
    inv = must(await sb.from("invoices").insert({
      tenant_id: tenantId, invoice_number: number, customer_id: customer.id, customer_name: customer.name,
      customer_phone: customer.phone || null, customer_email: customer.email || null,
      reference: `${job.job_no}${plate}`, subject: payer === "customer" ? `Job ${job.job_no}` : `Job ${job.job_no} (${payer})`,
      issue_date: today, due_date: due, payment_terms: opts.dueDays ? `Net ${opts.dueDays}` : "Due on receipt",
      items: lines.map(toInvoiceItem), subtotal: t.subtotal, tax: t.tax, discount: 0, shipping: 0, adjustment: 0, total: t.total, prices_include_tax: false,
      notes: job.customer_notes || null, customer_notes: job.customer_notes || null,
      status: "sent", sent_at: new Date().toISOString(), created_by: opts.userId || null, allow_online_payment: true,
      location_id: opts.locationId || null, stock_location_id: opts.locationId || null,
    }).select("id, invoice_number").single());
  } catch (e) {
    // Put the parts back on the job when the invoice could not be saved.
    if (moved) await sb.rpc("garage_parts_to_invoice", { p_job: job.id, p_lines: lineIds, p_back: false });
    throw e;
  }
  must(await sb.rpc("garage_link_invoice", { p_job: job.id, p_invoice: inv.id, p_payer: payer, p_lines: lineIds, p_deposit: false }));

  // KRA eTIMS: sign straight away when the company asked for it (same rule as Sales → Invoices).
  const { data: bs } = await sb.from("business_settings").select("erp_settings").eq("tenant_id", tenantId).maybeSingle();
  const etims = bs?.erp_settings?.etims;
  if (etims?.auto_sign && etims?.initialised_at) erpApi("etims/sign-invoice", { id: inv.id }).catch(() => undefined);
  return inv;
}
