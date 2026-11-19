import { supabase } from "@/integrations/supabase/client";

const sb: any = supabase;
const norm = (v: unknown) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** What Garage AI read from a supplier invoice or receipt. */
export type ReadInvoice = {
  vendor?: string; vendor_pin?: string; vendor_type?: string; vendor_phone?: string; vendor_email?: string; vendor_address?: string;
  invoice_number?: string; date?: string; due_date?: string; subtotal?: number; tax?: number; total?: number; category?: string; description?: string;
  items?: { name?: string; quantity?: number; rate?: number; amount?: number }[];
};

/** Sends the file to Garage AI and returns what it read. */
export async function readSupplierInvoice(f: File): Promise<ReadInvoice> {
  if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(f.type)) throw new Error("Upload a photo (JPG, PNG) or a PDF");
  if (f.size > 20 * 1024 * 1024) throw new Error("That file is too large: 20 MB at most");
  const data = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = bad; r.readAsDataURL(f); });
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/ai/extract-expense", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify({ file: { name: f.name, type: f.type, data } }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Could not read the invoice");
  return (j.expense || {}) as ReadInvoice;
}

/** The vendor on the invoice: matched by KRA PIN or name, or added to Vendors (company or individual) when new. */
export async function vendorFor(tenantId: string, x: ReadInvoice): Promise<{ id: string; name: string; added: boolean } | null> {
  const name = String(x.vendor || "").trim();
  if (!name) return null;
  const pin = String(x.vendor_pin || "").trim().toUpperCase();
  const { data: all } = await sb.from("suppliers").select("id,name,kra_pin").eq("tenant_id", tenantId).limit(5000);
  const hit = ((all || []) as any[]).find((v) => (pin && String(v.kra_pin || "").toUpperCase() === pin) || norm(v.name) === norm(name));
  if (hit) return { id: hit.id, name: hit.name, added: false };
  const { data: made, error } = await sb.from("suppliers").insert({
    tenant_id: tenantId, name: name.slice(0, 200), supplier_type: x.vendor_type === "individual" ? "individual" : "company",
    kra_pin: /^[AP]\d{9}[A-Z]$/.test(pin) ? pin : null, phone: String(x.vendor_phone || "").trim() || null, email: String(x.vendor_email || "").trim() || null,
    address: String(x.vendor_address || "").trim() || null, is_active: true, onboarding_status: "pending", notes: "Added from an uploaded invoice",
  }).select("id,name").single();
  if (error) throw error;
  return { id: made.id, name: made.name, added: true };
}

const iso = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");

/** Bill lines from the invoice: its items, or one line for the whole amount. VAT rate from the invoice's VAT. */
export function billLinesFrom(x: ReadInvoice) {
  const sub = Number(x.subtotal) || (Number(x.total) || 0) - (Number(x.tax) || 0);
  const vat = Number(x.tax) > 0 && sub > 0 ? Math.round((Number(x.tax) / sub) * 100) : 0;
  const items = (Array.isArray(x.items) ? x.items : []).filter((i) => i?.name);
  const lines = items.length
    ? items.map((i) => { const q = Number(i.quantity) || 1; return { name: String(i.name).slice(0, 200), quantity: q, rate: Number(i.rate) || (Number(i.amount) || 0) / q, tax_rate: vat }; })
    : [{ name: String(x.description || x.category || "As per invoice").slice(0, 200), quantity: 1, rate: sub || Number(x.total) || 0, tax_rate: vat }];
  return { lines, date: iso(x.date), due: iso(x.due_date), reference: String(x.invoice_number || ""), category: String(x.category || "") };
}
