import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessSettings } from "@/hooks/useData";

const sb = supabase as any;

/** Documents that can require a signature (System → Approvals → Signing). */
export const SIGN_TYPES = [
  { key: "quote", label: "Quotations" },
  { key: "sales_order", label: "Sales orders" },
  { key: "invoice", label: "Invoices (and their delivery notes)" },
  { key: "credit_note", label: "Credit notes" },
  { key: "purchase_order", label: "Purchase orders" },
  { key: "bill", label: "Bills" },
  { key: "contract", label: "Contracts" },
] as const;
export type SignType = (typeof SIGN_TYPES)[number]["key"];
export type SigningRule = { enabled: boolean; signers: string[]; with_approval: boolean };

/** The signing rule for a document type (readable by every staff member). */
export function useSigningRule(type: SignType) {
  const { data: biz } = useBusinessSettings();
  const r = ((biz as any)?.signing_rules || {})[type] || {};
  return { enabled: !!r.enabled, signers: (r.signers || []) as string[], with_approval: !!r.with_approval } as SigningRule;
}

export type SignatureRequest = {
  id: string; doc_type: string; doc_id: string; doc_number: string | null; title: string | null; amount: number | null; signers: string[]; with_approval: boolean;
  status: "pending" | "signed" | "rejected" | "cancelled"; requested_by: string | null; requested_by_name: string | null;
  signed_by: string | null; signed_by_name: string | null; signed_at: string | null; reason: string | null; created_at: string;
};

/** The latest signing request of a document, and whether it may be sent. */
export function useDocSignature(type: SignType, docId: string | null | undefined) {
  const rule = useSigningRule(type);
  const qc = useQueryClient();
  const { data: req } = useQuery({
    queryKey: ["doc-signature", type, docId], enabled: !!docId && rule.enabled,
    queryFn: async () => ((await sb.from("signature_requests").select("*").eq("doc_type", type).eq("doc_id", docId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(1)).data?.[0] || null) as SignatureRequest | null,
  });
  const signed = req?.status === "signed";
  return {
    rule, req: req || null, signed,
    /** True while the document still needs its signature before it can be sent. */
    blocked: rule.enabled && !signed,
    submit: async (number: string | null, title: string, amount?: number) => {
      const { error } = await sb.rpc("submit_for_signing", { p_type: type, p_doc: docId, p_number: number, p_title: title, p_amount: amount ?? null });
      if (error) throw error;
      void qc.invalidateQueries({ queryKey: ["doc-signature", type, docId] });
      void qc.invalidateQueries({ queryKey: ["signature-requests"] });
    },
    refresh: () => qc.invalidateQueries({ queryKey: ["doc-signature", type, docId] }),
  };
}

/** A signer's saved signature and stamp. */
export type UserSignature = { user_id: string; full_name: string | null; title: string | null; signature_path: string | null; stamp_path: string | null };

/** A short-lived link to a signature or stamp image in the company's private files. */
export async function signatureUrl(path: string | null | undefined, seconds = 3600) {
  if (!path) return null;
  const { data } = await supabase.storage.from("documents").createSignedUrl(path, seconds);
  return data?.signedUrl || null;
}

/**
 * Cleans a photographed or scanned signature/stamp: white paper becomes transparent,
 * the ink is kept, and the image is cropped to the ink. Returns a PNG.
 */
export async function cleanInkImage(file: File, maxSide = 900): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    const px = d.data;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const light = (px[i] + px[i + 1] + px[i + 2]) / 3;
      // Paper (light, low saturation) fades out; ink stays.
      const sat = Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]);
      const alpha = light > 215 && sat < 40 ? 0 : light > 180 && sat < 40 ? Math.round(((215 - light) / 35) * 255) : px[i + 3];
      px[i + 3] = Math.min(px[i + 3], alpha);
      if (px[i + 3] > 40) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    ctx.putImageData(d, 0, 0);
    const pad = 6;
    const cx = Math.max(0, minX - pad), cy = Math.max(0, minY - pad);
    const cw = maxX > minX ? Math.min(w - cx, maxX - minX + pad * 2) : w, ch = maxY > minY ? Math.min(h - cy, maxY - minY + pad * 2) : h;
    const out = document.createElement("canvas"); out.width = cw; out.height = ch;
    out.getContext("2d")!.drawImage(c, cx, cy, cw, ch, 0, 0, cw, ch);
    return await new Promise<Blob>((ok, bad) => out.toBlob((b) => (b ? ok(b) : bad(new Error("Could not process the image"))), "image/png"));
  } finally { URL.revokeObjectURL(url); }
}
