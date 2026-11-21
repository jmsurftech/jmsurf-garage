import { APP_ORIGIN, ADMIN_ORIGIN } from "./hosts.js";
// ---------------------------------------------------------------------------
// Super admin CRM and owner alerts.
//
// POST /api/admin/crm/audience   {audience}             → how many people a campaign reaches
// POST /api/admin/crm/send       {id}                   → sends a saved campaign (email / SMS / WhatsApp)
// POST /api/admin/alerts/test    {}                     → a test alert on every chosen channel
//
// Owner alerts: database triggers queue platform_alert_queue rows (new
// sign-up, website enquiry, payment); every minute they go out on the channels
// chosen in Admin → Notifications (platform_settings key "owner_alerts").
// ---------------------------------------------------------------------------
import { createHash, randomBytes } from "node:crypto";
import { sendPlatform } from "./messaging.js";

const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const esc = (s) => str(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function db(path, { method = "GET", body, prefer = "return=representation" } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const t = await res.text();
  const j = t ? JSON.parse(t) : null;
  if (!res.ok) throw new Error(str(j?.message) || `Database replied ${res.status}`);
  return j;
}
const rows = async (p) => { const d = await db(p).catch(() => []); return Array.isArray(d) ? d : []; };

/** People a campaign goes to: leads (by stage) or companies (by subscription status). */
async function audienceOf(a) {
  const out = new Map();
  if (a?.type === "companies") {
    const tenants = await rows("tenants?select=id,business_name,contact_name,contact_email,business_email,contact_phone,business_phone&limit=5000");
    const subs = await rows("subscriptions?select=tenant_id,status,created_at&order=created_at.desc&limit=10000");
    const statusOf = new Map(); for (const s of subs) if (!statusOf.has(s.tenant_id)) statusOf.set(s.tenant_id, s.status);
    const want = Array.isArray(a.statuses) ? a.statuses : [];
    for (const t of tenants) {
      if (want.length && !want.includes(statusOf.get(t.id) || "none")) continue;
      out.set(t.id, { name: t.contact_name || t.business_name, company: t.business_name, email: t.contact_email || t.business_email, phone: t.contact_phone || t.business_phone });
    }
  } else {
    const stages = Array.isArray(a?.stages) && a.stages.length ? `&stage=in.(${a.stages.join(",")})` : "";
    for (const l of await rows(`platform_leads?select=id,name,company,email,phone${stages}&limit=10000`)) out.set(l.id, l);
  }
  return [...out.values()];
}
const fill = (text, p) => str(text).replace(/\{\{\s*name\s*\}\}/gi, str(p.name).split(" ")[0] || "there").replace(/\{\{\s*company\s*\}\}/gi, str(p.company) || "your company");

function mailHtml(subject, body) {
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2328"><table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6e8eb">
<tr><td style="background:#a8121b;color:#fff;padding:16px 24px;font-weight:bold">JMSURF Garage</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.6">${esc(body).replace(/\n/g, "<br>")}</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #eef0f2;color:#8a9199;font-size:11px">JMSURF Garage · Powered by JMSURF TECHNOLOGIES · <a href="https://jmsurfgarage.co.ke" style="color:#a8121b">jmsurfgarage.co.ke</a> · info@jmsurf.co.ke · +254 712 504 593</td></tr>
</table></td></tr></table></body></html>`;
}

export const isPlatformCrmRoute = (p) => p === "/api/admin/crm/audience" || p === "/api/admin/crm/send" || p === "/api/admin/alerts/test" || p === "/api/admin/company/open";



export async function handlePlatformCrm(req, res, pathname, body, { sendJson, requireSuperAdmin, deliverEmail }) {
  const who = await requireSuperAdmin(req);
  if (who.error) return sendJson(res, who.status || 403, { ok: false, error: who.error });
  try {
    // Opens a company at its own address with a one-time code in the address fragment (see
    // /auth/handoff): as the platform owner themselves (support: works even when the package has
    // ended), or as one of the company's people (they see exactly what that person sees).
    if (pathname === "/api/admin/company/open") {
      const id = str(body?.tenant_id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return sendJson(res, 400, { ok: false, error: "Choose a company" });
      const [t] = await rows(`tenants?id=eq.${id}&select=id,slug,owner_user_id,deleted_at`);
      if (!t?.slug) return sendJson(res, 404, { ok: false, error: "That company has no address yet" });
      if (t.deleted_at) return sendJson(res, 400, { ok: false, error: "Restore the company first" });
      const userId = str(body?.user_id) || str(who.user.id);
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return sendJson(res, 400, { ok: false, error: "Choose a person" });
      if (userId !== str(who.user.id) && userId !== str(t.owner_user_id) && !(await rows(`tenant_members?tenant_id=eq.${id}&user_id=eq.${userId}&status=eq.active&select=id`)).length) {
        return sendJson(res, 400, { ok: false, error: "That person is not in this company" });
      }
      const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
      const u = await fetch(`${URL_}/auth/v1/admin/users/${userId}`, { headers: H, signal: AbortSignal.timeout(15000) }).then((r) => r.json()).catch(() => ({}));
      if (!u?.email) return sendJson(res, 400, { ok: false, error: "That login has no email address" });
      const r = await fetch(`${URL_}/auth/v1/admin/generate_link`, { method: "POST", headers: H, signal: AbortSignal.timeout(15000), body: JSON.stringify({ type: "magiclink", email: u.email }) });
      const j = await r.json().catch(() => ({}));
      const th = j.hashed_token || j.properties?.hashed_token;
      if (!r.ok || !th) return sendJson(res, 502, { ok: false, error: "Could not open the company. Try again." });
      // Opening as yourself after two-step sign-in here: the new session there gets a support pass, so the
      // company's two-step screen does not ask again (a sign-in link only ever counts as the first step).
      let sp = "";
      if (userId === str(who.user.id)) {
        let aal = "";
        try { aal = JSON.parse(Buffer.from(str(who.authHeader).replace(/^Bearer\s+/i, "").split(".")[1], "base64url").toString("utf8")).aal || ""; } catch { aal = ""; }
        if (aal === "aal2") {
          sp = randomBytes(24).toString("hex");
          await db("support_passes", { method: "POST", prefer: "return=minimal", body: { token_hash: createHash("sha256").update(sp).digest("hex"), user_id: userId, tenant_id: id } });
        }
      }
      console.log(`[admin] ${who.user.id} opened company ${id} as ${userId}${sp ? " (support pass)" : ""}`);
      return sendJson(res, 200, { ok: true, url: `${APP_ORIGIN}/auth/handoff#th=${encodeURIComponent(th)}&co=${encodeURIComponent(t.slug)}${sp ? `&sp=${sp}` : ""}&next=${encodeURIComponent("/dashboard")}` });
    }
    if (pathname === "/api/admin/crm/audience") {
      const list = await audienceOf(body?.audience);
      return sendJson(res, 200, { ok: true, total: list.length, with_email: list.filter((p) => /@/.test(str(p.email))).length, with_phone: list.filter((p) => str(p.phone)).length });
    }
    if (pathname === "/api/admin/crm/send") {
      const [c] = await rows(`platform_campaigns?id=eq.${encodeURIComponent(str(body?.id))}&select=*`);
      if (!c) return sendJson(res, 404, { ok: false, error: "Campaign not found" });
      if (c.status === "sending") return sendJson(res, 409, { ok: false, error: "This campaign is already sending" });
      await db(`platform_campaigns?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "sending" } });
      const people = await audienceOf(c.audience);
      let sent = 0, failed = 0;
      for (const p of people) {
        let r;
        if (c.channel === "email") {
          if (!/@/.test(str(p.email))) continue;
          r = await deliverEmail({ to: str(p.email), subject: fill(c.subject || c.name, p), html: mailHtml(c.subject, fill(c.body, p)), text: fill(c.body, p) }).catch((e) => ({ ok: false, error: e.message }));
        } else {
          if (!str(p.phone)) continue;
          r = await sendPlatform(c.channel, str(p.phone), fill(c.body, p)).catch((e) => ({ ok: false, error: e.message }));
        }
        if (r?.ok) sent++; else failed++;
      }
      await db(`platform_campaigns?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: sent || !failed ? "sent" : "failed", sent_count: sent, failed_count: failed, sent_at: new Date().toISOString() } });
      return sendJson(res, 200, { ok: true, sent, failed });
    }
    if (pathname === "/api/admin/alerts/test") {
      const out = await sendOwnerAlert({ event: "test", title: "Test alert from JMSURF Garage", body: "Your owner alerts are working.", link: "/admin" }, true);
      return sendJson(res, 200, { ok: true, ...out });
    }
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: e.message });
  }
  return sendJson(res, 404, { ok: false, error: "Unknown route" });
}

/* ------------------------------------------------------------- owner alerts */

let deliver = null;
export const OWNER_EVENTS = ["signup", "payment", "inquiry", "lead"];

async function ownerSettings() {
  const [[s], [g]] = await Promise.all([rows("platform_settings?key=eq.owner_alerts&select=value"), rows("platform_settings?key=eq.general&select=value")]);
  const v = s?.value || {};
  const set = (Array.isArray(v.emails) ? v.emails : []).filter((e) => /@/.test(e));
  // No alert address chosen yet: alerts go to the support email in General settings, never to nobody.
  const fallback = [str(g?.value?.support_email)].filter((e) => /@/.test(e));
  return {
    events: v.events || { signup: { email: true, sms: false, whatsapp: false }, payment: { email: true }, inquiry: { email: true }, lead: { email: false } },
    emails: set.length ? set : fallback,
    phones: (Array.isArray(v.phones) ? v.phones : []).filter(Boolean),
  };
}

async function sendOwnerAlert(a, everyChannel = false) {
  const s = await ownerSettings();
  const ch = everyChannel ? { email: true, sms: true, whatsapp: true } : s.events[a.event] || {};
  const link = `${ADMIN_ORIGIN}${a.link || "/admin"}`;
  const result = { email: 0, sms: 0, whatsapp: 0, errors: [] };
  if (!s.emails.length && !s.phones.length) result.errors.push("no alert recipients set (Admin → Notifications)");
  if (ch.email && deliver) for (const to of s.emails) {
    const r = await deliver({ to, subject: a.title, html: mailHtml(a.title, `${a.title}\n\n${a.body || ""}\n\n${link}`), text: `${a.title}\n\n${a.body || ""}\n\n${link}` }).catch((e) => ({ ok: false, error: e.message }));
    if (r?.ok) result.email++; else result.errors.push(`email ${to}: ${r?.error || "failed"}`);
  }
  for (const c of ["sms", "whatsapp"]) if (ch[c]) for (const to of s.phones) {
    const r = await sendPlatform(c, to, `JMSURF Garage: ${a.title}${a.body ? ` - ${a.body}` : ""}`.slice(0, 300)).catch((e) => ({ ok: false, error: e.message }));
    if (r?.ok) result[c]++; else result.errors.push(`${c} ${to}: ${r?.error || "failed"}`);
  }
  return result;
}

/** JMSURF answered a support ticket: email the person who opened it (they also see it in the bell). */
async function emailTicketReplies() {
  if (!deliver) return;
  for (const m of await rows("platform_ticket_messages?from_jmsurf=eq.true&emailed_at=is.null&order=created_at&limit=25&select=id,body,ticket_id,platform_tickets(number,subject,opener_name,opener_email,tenants(slug))")) {
    const t = m.platform_tickets || {};
    const to = str(t.opener_email);
    let detail = "";
    if (/@/.test(to)) {
      const slug = str(t.tenants?.slug);
      // Staff work on app. (the company comes from their sign-in).
      const link = slug ? `${APP_ORIGIN}/help?ticket=${m.ticket_id}` : `${APP_ORIGIN}/login`;
      const subject = `Re: [Ticket #${t.number}] ${str(t.subject)}`;
      const text = `Hello ${str(t.opener_name).split(" ")[0] || "there"},

JMSURF support replied to your ticket #${t.number} (${str(t.subject)}):

${str(m.body)}

Reply or close the ticket here: ${link}`;
      const r = await deliver({ to, subject, html: mailHtml(subject, text), text }).catch((e) => ({ ok: false, error: e.message }));
      if (!r?.ok) detail = str(r?.error) || "failed";
    }
    // Marked either way so one bad address never blocks the queue; the reply is in the app regardless.
    await db(`platform_ticket_messages?id=eq.${m.id}`, { method: "PATCH", prefer: "return=minimal", body: { emailed_at: new Date().toISOString() } }).catch(() => {});
    if (detail) console.warn("[tickets] reply email failed:", detail);
  }
}

export function startOwnerAlerts(deliverEmail) {
  deliver = deliverEmail;
  if (!URL_ || !KEY) return;
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      for (const a of await rows("platform_alert_queue?status=eq.new&order=created_at&limit=50")) {
        const r = await sendOwnerAlert(a).catch((e) => ({ errors: [e.message] }));
        await db(`platform_alert_queue?id=eq.${a.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "done", done_at: new Date().toISOString(), detail: (r.errors || []).join("; ").slice(0, 500) || null } }).catch(() => {});
      }
      await emailTicketReplies().catch(() => {});
    } finally { busy = false; }
  };
  setTimeout(tick, 30_000).unref();
  setInterval(tick, 60_000).unref();
}

/* ------------------------------------------------------------- lead intake from other JMSURF products */

let intakeKey = { at: 0, value: "" };
async function leadKey() {
  if (Date.now() - intakeKey.at < 300_000) return intakeKey.value;
  const [s] = await rows("platform_settings?key=eq.lead_intake&select=value");
  intakeKey = { at: Date.now(), value: str(s?.value?.key) };
  return intakeKey.value;
}
const intakeHits = new Map();
const PRODUCTS = ["dash", "callcentre", "mail", "isp", "sms", "rms", "pay", "other"];

/**
 * POST /api/public/lead (header x-lead-key): JMSURF ISP, SMS, RMS and the other
 * products send each new sign-up here, with "how did you hear about us".
 */
export async function handleLeadIntake(req, res, body, sendJson) {
  const ip = str(req.headers["x-forwarded-for"]).split(",")[0] || req.socket.remoteAddress;
  const list = (intakeHits.get(ip) || []).filter((t) => Date.now() - t < 60_000);
  if (list.length >= 60) return sendJson(res, 429, { ok: false, error: "Slow down" });
  list.push(Date.now()); intakeHits.set(ip, list);
  const key = await leadKey();
  if (!key || str(req.headers["x-lead-key"]) !== key) return sendJson(res, 401, { ok: false, error: "Bad key" });
  const b = body || {};
  const name = str(b.name || b.company).slice(0, 200);
  if (!name) return sendJson(res, 400, { ok: false, error: "name is required" });
  const product = PRODUCTS.includes(str(b.product)) ? str(b.product) : "other";
  const details = Object.fromEntries(Object.entries(b.details && typeof b.details === "object" ? b.details : {}).slice(0, 20).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 300)]));
  await db("platform_leads", { method: "POST", prefer: "return=minimal", body: {
    name, company: str(b.company).slice(0, 200) || null, email: str(b.email).slice(0, 200) || null, phone: str(b.phone).slice(0, 40) || null,
    country: str(b.country).slice(0, 2).toUpperCase() || "KE", source: "signup", stage: "trial", product,
    heard_from: str(b.heard_from).slice(0, 60) || null, details: { ...details, ...(b.heard_detail ? { heard_detail: str(b.heard_detail).slice(0, 200) } : {}) },
    notes: str(b.notes).slice(0, 1000) || null,
  } });
  await db("platform_alert_queue", { method: "POST", prefer: "return=minimal", body: { event: "signup", title: `New ${product.toUpperCase()} sign-up: ${str(b.company) || name}`, body: [name, b.email, b.phone, b.heard_from ? `heard via ${b.heard_from}` : ""].filter(Boolean).join(" · "), link: "/admin/leads" } });
  return sendJson(res, 200, { ok: true });
}
