// ---------------------------------------------------------------------------
// Notebook reminders: when a note's reminder time comes, its owner gets an
// in-app alert, and an email and/or SMS when the note asks for them.
// ---------------------------------------------------------------------------
import { sendForShop } from "./messaging.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const esc = (s) => str(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

async function db(path, { method = "GET", body, prefer = "return=representation" } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers: { ...headers, Prefer: prefer }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Database replied ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
async function userEmail(userId) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!res?.ok) return null;
  return str((await res.json().catch(() => ({}))).email) || null;
}
const when = (iso) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

async function tick(deliverEmail) {
  const due = await db(`notes?remind_at=lte.${encodeURIComponent(new Date().toISOString())}&reminded_at=is.null&done=eq.false&select=*&limit=100`);
  for (const n of due || []) {
    // Claim it first so two servers never send the same reminder twice.
    const claimed = await db(`notes?id=eq.${n.id}&reminded_at=is.null`, { method: "PATCH", body: { reminded_at: new Date().toISOString() } }).catch(() => []);
    if (!claimed?.length) continue;
    const title = str(n.title) || str(n.body).split("\n")[0].slice(0, 80) || "Your note";
    const text = str(n.body).slice(0, 600);
    const by = Array.isArray(n.remind_by) && n.remind_by.length ? n.remind_by : ["app"];
    const errors = [];
    await db("shop_notifications", { method: "POST", prefer: "return=minimal", body: { tenant_id: n.tenant_id, kind: "note", title: `Reminder: ${title}`, body: text.slice(0, 280) || `Set for ${when(n.remind_at)}`, link: `/notebook?note=${n.id}`, user_id: n.user_id, entity_type: "note", entity_id: n.id } })
      .catch((e) => errors.push(`app: ${e.message}`));
    if (by.includes("email") && deliverEmail) {
      const to = await userEmail(n.user_id);
      if (to) {
        await deliverEmail(n.tenant_id, {
          to: [to], subject: `Reminder: ${title}`, text: `${title}\n\n${text}\n\nSet for ${when(n.remind_at)} in your JMSURF Garage notebook.`,
          html: `<p style="font-size:15px;font-weight:700;margin:0 0 8px">${esc(title)}</p><p style="font-size:14px;line-height:22px;white-space:pre-line;margin:0">${esc(text)}</p><p style="font-size:12px;color:#6b7280;margin-top:16px">Set for ${esc(when(n.remind_at))} in your JMSURF Garage notebook.</p>`,
        }).catch((e) => errors.push(`email: ${e.message}`));
      } else errors.push("email: no email address");
    }
    if (by.includes("sms")) {
      const [p] = await db(`profiles?user_id=eq.${n.user_id}&select=phone&limit=1`).catch(() => []);
      if (p?.phone) {
        const r = await sendForShop({ tenantId: n.tenant_id, channel: "sms", to: p.phone, userId: n.user_id, text: `Reminder: ${title}${text && text !== title ? ` - ${text.slice(0, 300)}` : ""}` }).catch((e) => ({ ok: false, error: e.message }));
        if (r && r.ok === false) errors.push(`sms: ${r.error}`);
      } else errors.push("sms: add your phone number in My profile");
    }
    if (errors.length) await db(`notes?id=eq.${n.id}`, { method: "PATCH", prefer: "return=minimal", body: { remind_error: errors.join("; ").slice(0, 500) } }).catch(() => {});
  }
}

export function startNoteJobs(deliverEmail) {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await tick(deliverEmail); } catch (e) { console.error("[notes] reminders", e.message); } finally { busy = false; }
  };
  setTimeout(run, 45_000).unref();
  setInterval(run, 60_000).unref();
}
