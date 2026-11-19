import { formatKES } from "@/lib/format";
import { downloadDocument } from "@/lib/documents";
import type { Database } from "@/integrations/supabase/types";

type Transaction = Database["public"]["Tables"]["transactions"]["Row"];

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash", mpesa: "M-Pesa", card: "Card", split: "Split", credit: "Credit",
  mobile_money: "Mobile money", loyalty_points: "Loyalty points", credit_note: "Credit note", online: "Online",
};
export const methodLabel = (m: string | null | undefined) => METHOD_LABELS[String(m || "")] || String(m || "-");

/** The lines of a sale as "Coke x2, Bread x1". */
export function itemsSummary(t: { items?: unknown }) {
  const lines = Array.isArray(t.items) ? (t.items as any[]) : [];
  return lines.map((l) => `${l?.name ?? "Item"} x${Number(l?.quantity || 0)}`).join(", ");
}

/** One row per item sold, for item-level analysis. */
export function itemRows(transactions: Transaction[]) {
  return transactions.flatMap((t) =>
    (Array.isArray(t.items) ? (t.items as any[]) : []).map((l) => ({
      Date: new Date(t.created_at).toLocaleDateString("en-KE"),
      Time: new Date(t.created_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }),
      "Receipt #": t.id.slice(0, 8).toUpperCase(),
      Item: l?.name ?? "Item",
      SKU: l?.sku ?? "",
      Quantity: Number(l?.quantity || 0),
      "Unit price": Number(l?.price || 0),
      "Line total": Number(l?.quantity || 0) * Number(l?.price || 0),
      Payment: methodLabel(t.payment_method),
      Cashier: t.cashier_name || "-",
      Status: t.status,
    })),
  );
}

const csvCell = (c: unknown) => `"${String(c ?? "").replace(/"/g, '""')}"`;

export function exportSalesCSV(transactions: Transaction[], filename: string) {
  const headers = ["Date", "Time", "Receipt #", "Customer", "Cashier", "Payment", "Reference", "Items", "Subtotal", "VAT", "Discount", "Total", "Status"];
  const rows = transactions.map(t => [
    new Date(t.created_at).toLocaleDateString("en-KE"),
    new Date(t.created_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }),
    t.id.slice(0, 8).toUpperCase(),
    t.customer_name || "Walk-in",
    t.cashier_name || "-",
    methodLabel(t.payment_method),
    t.mpesa_ref || "",
    itemsSummary(t),
    t.subtotal,
    t.tax,
    t.discount,
    t.total,
    t.status,
  ]);

  const csv = [headers, ...rows].map(r => r.map(csvCell).join(",")).join("\n");
  downloadFile(csv, filename, "text/csv");
}

/** Item-level CSV: one row per product line of every sale. */
export function exportItemsCSV(transactions: Transaction[], filename: string) {
  const rows = itemRows(transactions);
  const headers = rows.length ? Object.keys(rows[0]) : ["Date", "Time", "Receipt #", "Item", "Quantity", "Line total"];
  const csv = [headers, ...rows.map((r) => headers.map((h) => (r as any)[h]))].map((r) => r.map(csvCell).join(",")).join("\n");
  downloadFile(csv, filename, "text/csv");
}

export function exportSalesExcel(transactions: Transaction[], filename: string) {
  import("@e965/xlsx").then(XLSX => {
    const data = transactions.map(t => ({
      Date: new Date(t.created_at).toLocaleDateString("en-KE"),
      Time: new Date(t.created_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }),
      "Receipt #": t.id.slice(0, 8).toUpperCase(),
      Customer: t.customer_name || "Walk-in",
      Cashier: t.cashier_name || "-",
      Payment: methodLabel(t.payment_method),
      Reference: t.mpesa_ref || "",
      Items: itemsSummary(t),
      Subtotal: Number(t.subtotal),
      VAT: Number(t.tax),
      Discount: Number(t.discount),
      Total: Number(t.total),
      Status: t.status,
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Sales");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemRows(transactions)), "Items sold");
    XLSX.writeFile(wb, filename);
  });
}

export function exportSalesPDF(transactions: Transaction[], totals: { sales: number; vat: number; profit: number; count: number }, filename: string, businessName?: string) {
  void downloadDocument({
    title: "Sales Report", business: { name: businessName || "Our shop" }, filename,
    meta: [["Generated", new Date().toLocaleDateString()], ["Sales", String(totals.count)]],
    columns: [{ label: "Date", width: 15 }, { label: "Receipt", width: 11 }, { label: "Items", width: 34 }, { label: "Payment", width: 12 }, { label: "Cashier", width: 13 }, { label: "Total", align: "right", width: 15 }],
    rows: transactions.map((t) => [
      new Date(t.created_at).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
      t.id.slice(0, 8).toUpperCase(), itemsSummary(t), methodLabel(t.payment_method), t.cashier_name || "-", formatKES(Number(t.total)),
    ]),
    totals: [["Sales", formatKES(totals.sales)], ["VAT collected", formatKES(totals.vat)], ["Gross profit", formatKES(totals.profit), true]],
  });
}

export function exportVATPDF(vatData: { rate: string; amount: number; description: string }[], totalVat: number, filename: string, businessName?: string) {
  void downloadDocument({
    title: "VAT Statement", business: { name: businessName || "Our shop" }, filename,
    meta: [["Generated", new Date().toLocaleDateString()]],
    columns: [{ label: "VAT rate", width: 20 }, { label: "Description", width: 55 }, { label: "VAT amount", align: "right", width: 25 }],
    rows: vatData.map((v) => [v.rate, v.description, formatKES(v.amount)]),
    totals: [["Total VAT collected", formatKES(totalVat), true]],
  });
}

export interface TopProductRow {
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  vat?: number;
  profit: number;
  margin: number;
}

export function exportTopProductsExcel(rows: TopProductRow[], filename: string, meta?: { from?: string; to?: string; location?: string }) {
  import("@e965/xlsx").then(XLSX => {
    const data = rows.map((p, i) => ({
      Rank: i + 1,
      Product: p.name,
      "Qty Sold": p.qty,
      Revenue: Number(p.revenue.toFixed(2)),
      Cost: Number(p.cost.toFixed(2)),
      VAT: Number((p.vat || 0).toFixed(2)),
      Profit: Number(p.profit.toFixed(2)),
      "Margin %": Number(p.margin.toFixed(2)),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    if (meta) {
      XLSX.utils.sheet_add_aoa(ws, [
        [`Period: ${meta.from || "-"} to ${meta.to || "-"}`],
        [`Location: ${meta.location || "All"}`],
        [],
      ], { origin: -1 });
    }
    XLSX.utils.book_append_sheet(wb, ws, "Top Selling");
    XLSX.writeFile(wb, filename);
  });
}

export function exportTopProductsPDF(rows: TopProductRow[], filename: string, meta?: { from?: string; to?: string; location?: string; businessName?: string }) {
  void downloadDocument({
    title: "Top Selling Products", business: { name: meta?.businessName || "Our shop" }, filename,
    meta: [["Period", `${meta?.from || "-"} to ${meta?.to || "-"}`], ["Branch", meta?.location || "All"]],
    columns: [{ label: "#", width: 6 }, { label: "Product", width: 34 }, { label: "Qty", align: "right", width: 9 }, { label: "Revenue", align: "right", width: 14 }, { label: "Cost", align: "right", width: 13 }, { label: "Profit", align: "right", width: 14 }, { label: "Margin", align: "right", width: 10 }],
    rows: rows.map((p, n) => [n + 1, p.name, p.qty, formatKES(p.revenue), formatKES(p.cost), formatKES(p.profit), `${p.margin.toFixed(1)}%`]),
  });
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
