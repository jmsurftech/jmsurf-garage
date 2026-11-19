import { supabase } from "@/integrations/supabase/client";

/** Calls a signed-in staff route on this app's server (/api/erp/…). Throws with the server's message. */
export async function erpApi<T = any>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const offline = () => new Error("You are offline. This needs the internet; it was not done. Try again when you are back online.");
  if (typeof navigator !== "undefined" && !navigator.onLine) throw offline();
  const res = await fetch(`/api/erp/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}) },
    body: JSON.stringify(body),
  }).catch((e) => { throw e instanceof TypeError ? offline() : e; });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.error || `Request failed (${res.status})`);
  return out as T;
}

/** Saves text or JSON as a file on this device. */
export function saveFile(name: string, content: BlobPart, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
