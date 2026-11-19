import { supabase } from "@/integrations/supabase/client";

/** The database client without generated types for the garage tables. */
export const sb: any = supabase;

const offline = () => new Error("You are offline. This needs the internet; it was not done. Try again when you are back online.");

/** Staff call to the workshop server (/api/garage/w/…). Throws with the server's message. */
export async function wsApi<T = any>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (typeof navigator !== "undefined" && !navigator.onLine) throw offline();
  const res = await fetch(`/api/garage/w/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}) },
    body: JSON.stringify(body),
  }).catch((e) => { throw e instanceof TypeError ? offline() : e; });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.ok === false) throw new Error(out?.error || `Request failed (${res.status})`);
  return out as T;
}

/** Public call (no sign-in) for the estimate, tracking and booking pages. */
export async function pubApi<T = any>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`/api/garage/w/pub/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).catch(() => { throw new Error("Could not reach the garage. Check your internet and try again."); });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.ok === false) throw new Error(out?.error || `Request failed (${res.status})`);
  return out as T;
}

/** Throws the database error, if any, and returns the data. */
export function must<T>(r: { data: T; error: any }): T {
  if (r.error) throw new Error(r.error.message || "Not saved");
  return r.data;
}

/** Uploads a photo / video / voice note for a job (documents bucket, <tenant>/garage/<job>/…) and records it. */
export async function uploadMedia(tenantId: string, file: Blob & { name?: string }, meta: {
  job_id?: string | null; line_id?: string | null; vehicle_id?: string | null; inspection_id?: string | null;
  stage?: string; caption?: string | null; customer_visible?: boolean;
}) {
  if (file.size > 50 * 1024 * 1024) throw new Error("Files up to 50 MB");
  const type = file.type || "application/octet-stream";
  const kind = type.startsWith("image/") ? "photo" : type.startsWith("video/") ? "video" : type.startsWith("audio/") ? "voice" : "file";
  const name = String(file.name || `${kind}.${type.split("/")[1] || "bin"}`).replace(/[^a-z0-9.]+/gi, "-").toLowerCase();
  const path = `${tenantId}/garage/${meta.job_id || meta.vehicle_id || "general"}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${name}`;
  const up = await supabase.storage.from("documents").upload(path, file, { contentType: type });
  if (up.error) throw up.error;
  return must(await sb.from("garage_job_media").insert({
    tenant_id: tenantId, job_id: meta.job_id || null, line_id: meta.line_id || null, vehicle_id: meta.vehicle_id || null,
    inspection_id: meta.inspection_id || null, stage: meta.stage || "job", kind, path, mime_type: type,
    caption: meta.caption || null, customer_visible: meta.customer_visible ?? true,
  }).select("*").single());
}

const urlCache = new Map<string, { url: string; at: number }>();
/** Short-lived link to a stored file (cached for 40 minutes). */
export async function mediaUrl(path: string): Promise<string | null> {
  const hit = urlCache.get(path);
  if (hit && Date.now() - hit.at < 40 * 60_000) return hit.url;
  const { data } = await supabase.storage.from("documents").createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  urlCache.set(path, { url: data.signedUrl, at: Date.now() });
  return data.signedUrl;
}

/** Shrinks a phone photo before upload (longest side 1600 px, JPEG). Other files pass through. */
export async function shrinkPhoto(file: File): Promise<Blob & { name?: string }> {
  if (!file.type.startsWith("image/") || file.size < 400_000 || typeof document === "undefined") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
    if (!blob) return file;
    return Object.assign(blob, { name: file.name.replace(/\.\w+$/, ".jpg") });
  } catch { return file; }
}
