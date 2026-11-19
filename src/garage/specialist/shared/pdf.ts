/**
 * Specialist documents (claim estimates, release notes, sale agreements, hire
 * contracts, statements) rendered by the same PDF engine as invoices, with the
 * company's own header, logo and document settings.
 */
import { buildDocPdf, type DocModel, type DocItem } from "@/lib/doc-pdf";
import { loadCompany } from "@/lib/docModels";
import { uploadDocument } from "@/components/DocumentsPanel";
import { supabase } from "@/integrations/supabase/client";
import { num } from "./db";

export type DocInput = Omit<DocModel, "company" | "settings"> & { settings?: DocModel["settings"] };

export async function makePdf(tenantId: string, input: DocInput): Promise<Uint8Array> {
  const { company, biz } = await loadCompany(tenantId);
  return buildDocPdf({ ...input, company, settings: input.settings ?? null, currency: input.currency || biz?.currency || "KES" });
}

export function saveBytes(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function downloadPdf(tenantId: string, input: DocInput, filename: string) {
  saveBytes(await makePdf(tenantId, input), filename);
}

/** Stores the PDF with the record's documents and returns a link that works for `days` days (to send to an assessor or customer). */
export async function storePdfLink(tenantId: string, input: DocInput, filename: string, entity: { type: string; id: string; name: string; category: string }, days = 14): Promise<string> {
  const bytes = await makePdf(tenantId, input);
  const file = new File([bytes], filename, { type: "application/pdf" });
  const doc = await uploadDocument(tenantId, file, { entity_type: entity.type, entity_id: entity.id, entity_name: entity.name, name: filename, category: entity.category });
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.path!, days * 86400);
  if (error || !data?.signedUrl) throw error || new Error("Could not make a link");
  return data.signedUrl;
}

export const item = (name: string, qty: number, unit_price: number, description?: string | null, tax_rate = 0): DocItem => ({
  name, description: description || null, qty: num(qty), unit_price: num(unit_price), tax_rate, amount: Math.round(num(qty) * num(unit_price) * 100) / 100,
});

export const totalsOf = (items: DocItem[]) => {
  const subtotal = items.reduce((a, i) => a + num(i.amount), 0);
  const tax = items.reduce((a, i) => a + num(i.amount) * (num(i.tax_rate) / 100), 0);
  return { subtotal: Math.round(subtotal * 100) / 100, tax: Math.round(tax * 100) / 100, total: Math.round((subtotal + tax) * 100) / 100 };
};

export const party = (label: string, name: string, lines: (string | null | undefined)[] = []) => ({ label, name: name || "—", lines: lines.filter(Boolean) as string[] });
