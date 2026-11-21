import { APP_ORIGIN, SHOP_ORIGIN } from "./hosts.js";
// ---------------------------------------------------------------------------
// Package renewal reminders to shops by email, SMS and WhatsApp.
//
// Stages (Nairobi calendar days): 3, 2 and 1 day before the package or trial
// ends, the moment it expires, 1, 2 and 3 days after, 1 and 2 weeks after, and
// then every week up to 12 weeks ("weekly"). Each stage goes once per channel
// per period (table subscription_reminders), so a renewal starts a fresh
// cycle. Settings live in platform_settings.renewal_reminders.
//
// The same loop marks ended packages as "expired" (the app locks the shop by
// the end date itself; the status keeps Admin lists honest).
//
// POST /api/reminders/preview   platform owner: who is due now
// POST /api/reminders/send      platform owner: { tenant_id, channels? } send now
// ---------------------------------------------------------------------------
import { sendPlatform } from "./messaging.js";
import { isPlatformAdmin } from "./platform.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DAY = 86_400_000;
const NAIROBI = 3 * 3600_000;

export const isReminderRoute = (pathname) => pathname.startsWith("/api/reminders/");

export const DEFAULT_REMINDERS = {
  enabled: false,
  email: true,
  sms: true,
  whatsapp: true,
  send_hour: 9,
  stages: ["-3", "-2", "-1", "0", "1", "2", "3", "7", "14", "weekly"],
  templates: {
    before: "Hi {name}, your JMSURF Garage {kind} for {shop} ends in {days} {dayword} ({date}). Renew now to keep working without interruption: {link}",
    today: "Hi {name}, your JMSURF Garage {kind} for {shop} has expired today. Renew now to get back to work: {link}",
    after: "Hi {name}, your JMSURF Garage {kind} for {shop} expired {days} {dayword} ago and the shop is locked until you renew. Your records are safe. Renew here: {link}. Need help? {support}",
  },
};

let sendEmail = null; // injected by server.js: ({ to, subject, html, text }) => Promise<{ ok }>

async function db(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(15000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) { const e = new Error(`Database error (${res.status}): ${str(data?.message)}`); e.status = res.status; e.code = data?.code; throw e; }
  return data;
}

async function settings() {
  const [row] = (await db(`platform_settings?key=eq.renewal_reminders&select=value&limit=1`)) || [];
  const v = row?.value || {};
  return { ...DEFAULT_REMINDERS, ...v, templates: { ...DEFAULT_REMINDERS.templates, ...(v.templates || {}) } };
}

async function supportLine() {
  const [row] = (await db(`cms_content?section=eq.contact&select=content&limit=1`).catch(() => [])) || [];
  const c = row?.content || {};
  return str(c.phone) || str(c.email) || "0712 504 593";
}

const nairobiDay = (ms) => Math.floor((ms + NAIROBI) / DAY);
const TRIAL = ["trial", "trialing"];
const AFTER_DAYS = [1, 2, 3, 7, 14];
const WEEKLY_UNTIL = 84; // 12 weeks after expiry

/** Whether the settings switch a stage on; weekly stages ("21", "28"…) follow "weekly". */
function stageEnabled(stage, stages) {
  if (stages.includes(stage)) return true;
  const n = Number(stage);
  return n > 14 && stages.includes("weekly");
}

/** Which stage (if any) a subscription is at right now. */
function stageFor(endMs, now, sendHour) {
  const diff = nairobiDay(endMs) - nairobiDay(now);
  const hour = new Date(now + NAIROBI).getUTCHours();
  if (now >= endMs && now - endMs < DAY) return "0"; // expired within the last day
  if (hour < sendHour) return null;
  if (diff >= 1 && diff <= 3) return `-${diff}`;
  const after = -diff;
  if (AFTER_DAYS.includes(after)) return String(after);
  if (after > 14 && after <= WEEKLY_UNTIL && after % 7 === 0) return String(after);
  return null;
}

function render(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ""));
}

function messageFor(stage, sub, tenant, cfg, support) {
  const trial = sub.trial;
  const end = new Date(sub.end);
  const days = Math.abs(Number(stage));
  const vars = {
    name: str(tenant.contact_name).split(" ")[0] || "there",
    shop: str(tenant.business_name) || "your shop",
    plan: str(sub.plan_name) || "JMSURF Garage",
    kind: trial ? "free trial" : `${str(sub.plan_name) || ""} package`.trim(),
    days, dayword: days === 1 ? "day" : "days",
    date: end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" }),
    // Staff renew on the workspace address (app.), where the company comes from the sign-in.
    link: `${SHOP_ORIGIN || APP_ORIGIN}/billing`,
    support,
  };
  const key = stage === "0" ? "today" : stage.startsWith("-") ? "before" : "after";
  // Only staff are locked when a plan ends; customer ordering keeps working (owner rule 2026-11-16).
  const text = render(cfg.templates[key] || DEFAULT_REMINDERS.templates[key], vars) + (key === "before" ? "" : " Until you renew, your staff can only open the Billing page; your customers can still order.");
  const subject = stage === "0" ? `Your JMSURF Garage ${vars.kind} has expired`
    : stage.startsWith("-") ? `Your JMSURF Garage ${vars.kind} ends in ${days} ${vars.dayword}`
    : `Renew your JMSURF Garage ${vars.kind}`;
  return { text, subject, link: vars.link };
}

function emailHtml(subject, text, link) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;">
<tr><td style="padding:28px 32px;">
<p style="margin:0 0 18px;font-size:18px;font-weight:bold;color:#f97316;">JMSURF Garage</p>
<p style="margin:0 0 14px;font-size:17px;font-weight:bold;color:#0f172a;">${esc(subject)}</p>
<p style="margin:0 0 22px;font-size:15px;line-height:23px;">${esc(text.replace(link, "").replace(/[:\s.]+$/, ""))}.</p>
<a href="${link}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px;">Renew now</a>
<p style="margin:24px 0 0;font-size:12px;color:#6b7280;">You are receiving this because you run a shop on JMSURF Garage.</p>
</td></tr></table></td></tr></table></body></html>`;
}

/** Subscriptions of live shops with their end date. */
async function loadSubscriptions(tenantId) {
  const subs = await db(
    `subscriptions?select=id,tenant_id,plan_name,price,status,trial_ends_at,current_period_end,billing_cycle` +
      (tenantId ? `&tenant_id=eq.${tenantId}` : `&status=in.(active,trial,trialing,expired,past_due)`) + `&order=created_at.desc`,
  );
  const latest = new Map();
  for (const s of subs || []) if (!latest.has(s.tenant_id)) latest.set(s.tenant_id, s);
  const ids = [...latest.keys()];
  if (!ids.length) return [];
  const tenants = await db(`tenants?id=in.(${ids.join(",")})&deleted_at=is.null&select=id,slug,business_name,contact_name,contact_email,contact_phone,business_email,business_phone`);
  const byId = new Map((tenants || []).map((t) => [t.id, t]));
  return [...latest.values()]
    .filter((s) => byId.has(s.tenant_id))
    .map((s) => {
      // Paying clears trial_ends_at, so an expired row that still has it was a trial.
      const status = str(s.status);
      const trial = TRIAL.includes(status) || (status === "expired" && !!s.trial_ends_at);
      const end = trial && s.trial_ends_at ? s.trial_ends_at : s.current_period_end || s.trial_ends_at;
      return { ...s, end, trial, tenant: byId.get(s.tenant_id) };
    })
    .filter((s) => s.end);
}

/** Sends one stage to one shop on the chosen channels; skips channels already sent. */
async function deliver(sub, stage, cfg, channels, support, { force = false } = {}) {
  const t = sub.tenant;
  const msg = messageFor(stage, sub, t, cfg, support);
  const email = [t.contact_email, t.business_email].map(str).find((e) => EMAIL.test(e));
  const phone = [t.contact_phone, t.business_phone].map(str).find((p) => p.replace(/\D/g, "").length >= 9);
  const results = {};
  for (const channel of channels) {
    const recipient = channel === "email" ? email : phone;
    if (!recipient) { results[channel] = { ok: false, error: `No ${channel === "email" ? "email address" : "phone number"}` }; continue; }
    const stageKey = force ? `manual-${new Date().toISOString().slice(0, 16)}` : stage;
    // Claim the slot first so two servers never send the same reminder.
    try {
      await db("subscription_reminders", {
        method: "POST", prefer: "return=minimal",
        body: { tenant_id: t.id, subscription_id: sub.id, period_end: sub.end, stage: stageKey, channel, recipient, status: "sending" },
      });
    } catch (e) {
      if (e.status === 409 || e.code === "23505") { results[channel] = { ok: true, skipped: true }; continue; }
      throw e;
    }
    let r;
    try {
      r = channel === "email"
        ? await (sendEmail ? sendEmail({ to: recipient, subject: msg.subject, text: msg.text, html: emailHtml(msg.subject, msg.text, msg.link) }) : { ok: false, error: "Email is not set up" })
        : await sendPlatform(channel, recipient, msg.text);
    } catch (e) { r = { ok: false, error: e.message }; }
    await db(`subscription_reminders?subscription_id=eq.${sub.id}&period_end=eq.${encodeURIComponent(sub.end)}&stage=eq.${encodeURIComponent(stageKey)}&channel=eq.${channel}`, {
      method: "PATCH", body: { status: r?.ok ? "sent" : "failed", detail: str(r?.error || r?.response || "").slice(0, 300) || null },
    }).catch(() => {});
    results[channel] = { ok: !!r?.ok, error: r?.ok ? undefined : r?.error };
  }
  return results;
}

const channelsOf = (cfg) => ["email", "sms", "whatsapp"].filter((c) => cfg[c]);

/** Marks live packages whose end date has passed as expired. */
async function expireEnded(now) {
  for (const sub of await loadSubscriptions()) {
    if (!["active", "trial", "trialing", "past_due"].includes(str(sub.status))) continue;
    if (Date.parse(sub.end) > now) continue;
    await db(`subscriptions?id=eq.${sub.id}&status=eq.${encodeURIComponent(str(sub.status))}`, {
      method: "PATCH", prefer: "return=minimal", body: { status: "expired", updated_at: new Date(now).toISOString() },
    }).catch((e) => console.error("[reminders] could not mark expired", sub.tenant_id, e.message));
  }
}

async function runOnce() {
  try { await expireEnded(Date.now()); } catch (e) { console.error("[reminders] expiry sweep failed", e.message); }
  const cfg = await settings();
  if (!cfg.enabled) return;
  const channels = channelsOf(cfg);
  if (!channels.length) return;
  const support = await supportLine();
  const now = Date.now();
  for (const sub of await loadSubscriptions()) {
    const stage = stageFor(Date.parse(sub.end), now, Number(cfg.send_hour ?? 9));
    if (!stage || !stageEnabled(stage, cfg.stages || [])) continue;
    try { await deliver(sub, stage, cfg, channels, support); }
    catch (e) { console.error("[reminders] failed for", sub.tenant_id, e.message); }
  }
}

export function startReminders(emailSender) {
  sendEmail = emailSender;
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await runOnce(); } catch (e) { console.error("[reminders] run failed", e.message); } finally { busy = false; }
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 15 * 60_000).unref();
}

// ------------------------------------------------------------------ routes

async function requireOwner(req) {
  const auth = str(req.headers.authorization);
  if (!auth.startsWith("Bearer ")) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON_KEY }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) return false;
  const user = await r.json().catch(() => null);
  if (!user?.id) return false;
  return isPlatformAdmin(user.id, req);
}

export async function handleReminderRequest(req, res, pathname, body, sendJson) {
  if (!SUPABASE_URL || !SERVICE_KEY) return sendJson(res, 500, { ok: false, error: "Not configured" });
  if (!(await requireOwner(req))) return sendJson(res, 403, { ok: false, error: "Only the platform owner can do this" });
  const cfg = await settings();
  const now = Date.now();

  if (pathname === "/api/reminders/preview") {
    const rows = (await loadSubscriptions()).map((s) => {
      const endMs = Date.parse(s.end);
      return {
        tenant_id: s.tenant_id, shop: s.tenant.business_name, slug: s.tenant.slug, plan: s.plan_name, status: s.status, end: s.end,
        days: nairobiDay(endMs) - nairobiDay(now), stage: stageFor(endMs, now, 0),
        email: !!EMAIL.test(str(s.tenant.contact_email || s.tenant.business_email)), phone: !!str(s.tenant.contact_phone || s.tenant.business_phone),
      };
    }).filter((r) => r.days <= 7 && r.days >= -14).sort((a, b) => a.days - b.days);
    return sendJson(res, 200, { ok: true, rows });
  }

  if (pathname === "/api/reminders/send") {
    const [sub] = await loadSubscriptions(str(body.tenant_id));
    if (!sub) return sendJson(res, 404, { ok: false, error: "Shop not found" });
    const endMs = Date.parse(sub.end);
    const diff = nairobiDay(endMs) - nairobiDay(now);
    const stage = now >= endMs ? (diff >= -1 ? "0" : String(Math.max(2, -diff))) : `-${Math.max(1, diff)}`;
    const chosen = Array.isArray(body.channels) ? body.channels.filter((c) => ["email", "sms", "whatsapp"].includes(c)) : channelsOf(cfg);
    const results = await deliver(sub, stage, cfg, chosen.length ? chosen : ["email"], await supportLine(), { force: true });
    return sendJson(res, 200, { ok: Object.values(results).some((r) => r.ok), results });
  }

  return sendJson(res, 404, { ok: false, error: "Unknown route" });
}
