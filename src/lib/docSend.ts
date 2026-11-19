import { supabase } from "@/integrations/supabase/client";
import { buildDocPdf, fmtMoney } from "@/lib/doc-pdf";
import { loadDocModel, type DocumentKind } from "@/lib/docModels";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/** Which sender (System → Email → Who sends what) a document goes out from. */
export function mailPurpose(kind: string): string {
  if (["quote", "sales_order", "estimate"].includes(kind)) return "quotes";
  if (["invoice", "credit_note", "payment", "receipt", "delivery_note", "statement"].includes(kind)) return kind === "statement" ? "statements" : "invoices";
  if (["po", "bill", "rfq", "requisition", "vendor_credit", "supplier_payment"].includes(kind)) return "purchasing";
  return "other";
}

/** Emails a document to the customer with its PDF attached (shop's own mail server, or JMSURF's). */
export async function emailDocument(input: { kind: DocumentKind; id: string; to: string[]; subject: string; message: string }) {
  const { model, filename } = await loadDocModel(input.kind, input.id);
  const pdf = toBase64(await buildDocPdf(model));
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sign in again to send email");
  const res = await fetch("/api/email/document", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ to: input.to, subject: input.subject, message: input.message, pdf, filename, purpose: mailPurpose(input.kind) }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out?.ok) throw new Error(out?.error || "The email was not sent");
  return out;
}

/** Emails several documents in one message (e.g. a statement and the unpaid invoices), each as a PDF. */
export async function emailDocuments(input: { docs: { kind: DocumentKind; id: string }[]; to: string[]; subject: string; message: string; purpose?: string }) {
  const attachments: { filename: string; pdf: string }[] = [];
  for (const d of input.docs) {
    const { model, filename } = await loadDocModel(d.kind, d.id);
    attachments.push({ filename, pdf: toBase64(await buildDocPdf(model)) });
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sign in again to send email");
  const res = await fetch("/api/email/document", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ to: input.to, subject: input.subject, message: input.message, attachments, purpose: input.purpose || mailPurpose(input.docs[0]?.kind || "other") }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out?.ok) throw new Error(out?.error || "The email was not sent");
  return out;
}

/** Kenyan mobile → 2547XXXXXXXX for wa.me links; null when it is not a phone number. */
export function waNumber(phone?: string | null): string | null {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length === 9 && /^[71]/.test(d)) return `254${d}`;
  if (d.length === 10 && d.startsWith("0")) return `254${d.slice(1)}`;
  if (d.length === 12 && d.startsWith("254")) return d;
  return d.length >= 10 ? d : null;
}

/** Opens WhatsApp with a short summary of the document for the customer. */
export function shareOnWhatsApp(phone: string | null | undefined, text: string) {
  const n = waNumber(phone);
  const url = `https://wa.me/${n || ""}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener");
}

export const docSummary = (title: string, number: string | null | undefined, total: number, currency = "KES", extra = "") =>
  `${title} ${number || ""}\nAmount: ${currency} ${fmtMoney(total)}${extra ? `\n${extra}` : ""}`;

/**
 * Share link: the document's PDF stored privately for this company, opened by a link
 * that stops working after `days`. Anyone with the link can view and download it.
 */
export async function shareDocumentLink(kind: DocumentKind, id: string, tenantId: string, days = 30): Promise<string> {
  const { model, filename } = await loadDocModel(kind, id);
  const bytes = await buildDocPdf(model);
  const path = `${tenantId}/shared/${kind}-${id}-${Date.now().toString(36)}.pdf`;
  const store = (supabase as any).storage.from("documents");
  const up = await store.upload(path, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
  if (up.error) throw up.error;
  const signed = await store.createSignedUrl(path, Math.round(days * 86400), { download: filename });
  if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error("Could not create the link");
  return signed.data.signedUrl as string;
}
