// Builds each business document on the shared classic design (lib/documents).
import { formatKES, currencyCode } from "@/lib/format";
import type { DocBusiness, DocSpec } from "@/lib/documents";

const d = (v?: string | null) => (v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
const up = (s?: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "");
const lineItems = (items: any) => (Array.isArray(items) ? items : []);

export function invoiceSpec(inv: any, business: DocBusiness): DocSpec {
  const items = lineItems(inv.items);
  const subtotal = Number(inv.subtotal ?? items.reduce((s: number, i: any) => s + Number(i.price) * Number(i.quantity), 0));
  const totals: [string, string, boolean?][] = [["Subtotal", formatKES(subtotal)]];
  if (Number(inv.discount) > 0) totals.push(["Discount", `− ${formatKES(Number(inv.discount))}`]);
  if (Number(inv.tax) > 0) totals.push(["VAT", formatKES(Number(inv.tax))]);
  totals.push(["Total due", formatKES(Number(inv.total)), true]);
  if (Number(inv.amount_paid) > 0) { totals.push(["Paid", formatKES(Number(inv.amount_paid))]); totals.push(["Balance", formatKES(Math.max(0, Number(inv.total) - Number(inv.amount_paid))), true]); }
  return {
    title: "Invoice", number: inv.invoice_number, status: up(inv.status), business,
    meta: [["Invoice date", d(inv.created_at)], ...(inv.due_date ? [["Due date", d(inv.due_date)] as [string, string]] : []), ["Currency", currencyCode()]],
    parties: [{ label: "Bill to", lines: [inv.customer_name || "Customer", inv.customer_phone, inv.customer_email, inv.customer_address] }],
    columns: [{ label: "#", width: 6 }, { label: "Description", width: 46 }, { label: "Qty", align: "right", width: 10 }, { label: "Unit price", align: "right", width: 18 }, { label: "Amount", align: "right", width: 20 }],
    rows: items.map((i: any, n: number) => [n + 1, i.name, Number(i.quantity), formatKES(Number(i.price)), formatKES(Number(i.price) * Number(i.quantity))]),
    totals, amountInWords: Number(inv.total), notes: inv.notes,
    signatures: ["Received by (name, signature, date)"],
    filename: `Invoice-${inv.invoice_number}.pdf`,
  };
}

export function quoteSpec(q: any, business: DocBusiness): DocSpec {
  const items = lineItems(q.items);
  const subtotal = Number(q.subtotal ?? items.reduce((s: number, i: any) => s + Number(i.price) * Number(i.quantity), 0));
  const totals: [string, string, boolean?][] = [["Subtotal", formatKES(subtotal)]];
  if (Number(q.discount) > 0) totals.push(["Discount", `− ${formatKES(Number(q.discount))}`]);
  if (Number(q.tax) > 0) totals.push(["VAT", formatKES(Number(q.tax))]);
  totals.push(["Total", formatKES(Number(q.total)), true]);
  return {
    title: "Quotation", number: q.quote_number, status: up(q.status), business,
    meta: [["Date", d(q.created_at)], ...(q.valid_until ? [["Valid until", d(q.valid_until)] as [string, string]] : [])],
    parties: [{ label: "Prepared for", lines: [q.customer_name || "Customer", q.customer_phone, q.customer_email] }],
    columns: [{ label: "#", width: 6 }, { label: "Description", width: 46 }, { label: "Qty", align: "right", width: 10 }, { label: "Unit price", align: "right", width: 18 }, { label: "Amount", align: "right", width: 20 }],
    rows: items.map((i: any, n: number) => [n + 1, i.name, Number(i.quantity), formatKES(Number(i.price)), formatKES(Number(i.price) * Number(i.quantity))]),
    totals, amountInWords: Number(q.total), notes: q.notes,
    sections: [{ title: "Terms", body: `Prices are valid${q.valid_until ? ` until ${d(q.valid_until)}` : " for 30 days"}. Goods remain the property of ${business.name} until paid in full.` }],
    signatures: ["Prepared by", "Accepted by (name, signature, date)"],
    filename: `Quote-${q.quote_number}.pdf`,
  };
}

export function purchaseOrderSpec(po: any, items: any[], productMap: Record<string, any>, business: DocBusiness, variantLabel?: (id: string) => string): DocSpec {
  const foreign = !!po.currency;
  const rows = items.map((i: any, n: number) => {
    const name = productMap[i.product_id]?.name || "Item";
    const v = i.variant_id && variantLabel ? variantLabel(i.variant_id) : "";
    return [n + 1, v ? `${name} (${v})` : name, Number(i.quantity), Number(i.received_quantity || 0),
      foreign && i.foreign_unit_cost != null ? `${po.currency} ${Number(i.foreign_unit_cost).toLocaleString()}` : formatKES(Number(i.unit_cost)),
      formatKES(Number(i.quantity) * Number(i.unit_cost))];
  });
  const totals: [string, string, boolean?][] = [];
  if (foreign) totals.push([`Order total (${po.currency})`, `${po.currency} ${Number(po.foreign_total || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`], ["Exchange rate", `1 ${po.currency} = ${po.exchange_rate}`]);
  totals.push(["Total", formatKES(Number(po.total)), true]);
  if (Number(po.amount_paid) > 0) totals.push(["Paid", formatKES(Number(po.amount_paid))], ["Balance", formatKES(Math.max(0, Number(po.total) - Number(po.amount_paid))), true]);
  return {
    title: "Purchase Order", number: String(po.id).slice(0, 8).toUpperCase(), status: `${up(po.status)} · ${up(po.payment_status || "unpaid")}`, business: { ...business, payment: null },
    meta: [["Order date", d(po.created_at)], ...(po.received_at ? [["Received", d(po.received_at)] as [string, string]] : [])],
    parties: [{ label: "Supplier", lines: [po.supplier_name || "Supplier"] }, { label: "Deliver to", lines: [business.name, business.address, business.phone] }],
    columns: [{ label: "#", width: 5 }, { label: "Item", width: 37 }, { label: "Ordered", align: "right", width: 11 }, { label: "Received", align: "right", width: 11 }, { label: foreign ? `Unit cost` : "Unit cost", align: "right", width: 17 }, { label: "Line total", align: "right", width: 19 }],
    rows, totals, amountInWords: Number(po.total), notes: po.notes,
    signatures: ["Ordered by", "Supplier signature", "Received by"],
    filename: `PO-${String(po.id).slice(0, 8).toUpperCase()}.pdf`,
  };
}

export function deliveryNoteSpec(dn: any, business: DocBusiness): DocSpec {
  const items = lineItems(dn.items);
  return {
    title: "Delivery Note", number: dn.delivery_number, status: up(dn.status), business: { ...business, payment: null },
    meta: [["Date", d(dn.created_at)], ["Rider", dn.rider_name || "—"]],
    parties: [{ label: "Deliver to", lines: [dn.customer_name, dn.customer_address, dn.customer_phone] }],
    columns: [{ label: "#", width: 8 }, { label: "Item", width: 62 }, { label: "Quantity", align: "right", width: 15 }, { label: "Checked", align: "center", width: 15 }],
    rows: items.map((i: any, n: number) => [n + 1, i.name || i.product_name || "Item", Number(i.quantity), "☐"]),
    notes: dn.notes, signatures: ["Dispatched by", "Delivered by (rider)", "Received in good order by"],
    filename: `Delivery-${dn.delivery_number}.pdf`,
  };
}

export function packingListSpec(pl: any, business: DocBusiness, packedBy?: string): DocSpec {
  const items = lineItems(pl.items);
  return {
    title: "Packing List", number: pl.packing_number || String(pl.id).slice(0, 8).toUpperCase(), status: up(pl.status), business: { ...business, payment: null },
    meta: [["Date", d(pl.created_at)], ["Packed by", packedBy || "—"]],
    parties: [{ label: "Customer", lines: [pl.customer_name, pl.customer_phone] }],
    columns: [{ label: "#", width: 8 }, { label: "Item", width: 62 }, { label: "Quantity", align: "right", width: 15 }, { label: "Packed", align: "center", width: 15 }],
    rows: items.map((i: any, n: number) => [n + 1, i.name || i.product_name || "Item", Number(i.quantity), "☐"]),
    notes: pl.notes, signatures: ["Packed by", "Checked by"],
    filename: `Packing-list-${String(pl.id).slice(0, 8)}.pdf`,
  };
}
