import { publicBase } from "./hosts.js";
// ---------------------------------------------------------------------------
// Event alerts (System → Notifications). Database triggers queue an alert in
// alert_queue when something needs a person (approval, quote answered, lead or
// task assigned, tag added, leave, payment, meeting invitation). Every 20 s this
// sends each one on the channels the company chose for that event: the bell,
// email, SMS and WhatsApp. Scheduled reminders (meetings about to start, tasks
// and CRM to-dos due today) are added here too.
//
// Each (event, entity, slot, person, channel) is claimed once in alert_log, so
// a retry never sends twice. SMS and WhatsApp wait for the morning during quiet
// hours (20:00 to 07:00 Nairobi) unless the company switched quiet hours off.
// ---------------------------------------------------------------------------
import { sendForShop } from "./messaging.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";


/** Every event, its group in the settings screen, and the channels on by default. */
export const ALERT_EVENTS = {
  approval_requested: { group: "Approvals", label: "Something needs my approval", on: ["inapp", "email"] },
  approval_progress: { group: "Approvals", label: "My request passed a stage and moved on", on: ["inapp", "email"] },
  approval_decided: { group: "Approvals", label: "My request was approved or rejected", on: ["inapp", "email"] },
  quote_accepted: { group: "Sales", label: "A quote was accepted", on: ["inapp", "email"] },
  quote_declined: { group: "Sales", label: "A quote was declined", on: ["inapp", "email"] },
  quote_expired: { group: "Sales", label: "A quote expired", on: ["inapp"] },
  quote_invoiced: { group: "Sales", label: "A quote became an invoice", on: ["inapp"] },
  payment_received: { group: "Sales", label: "A customer paid", on: ["inapp"] },
  lead_assigned: { group: "CRM", label: "A lead or opportunity was given to me", on: ["inapp", "email"] },
  lead_tagged: { group: "CRM", label: "A tag was added to my lead", on: ["inapp"] },
  lead_won: { group: "CRM", label: "A deal was won", on: ["inapp", "email"] },
  lead_lost: { group: "CRM", label: "A deal was lost", on: ["inapp"] },
  activity_assigned: { group: "CRM", label: "A follow-up was given to me", on: ["inapp", "email"] },
  activity_due: { group: "CRM", label: "My follow-ups due today (morning)", on: ["inapp", "email"] },
  task_assigned: { group: "Projects", label: "A task was given to me", on: ["inapp", "email"] },
  task_due: { group: "Projects", label: "My tasks due today (morning)", on: ["inapp", "email"] },
  record_assigned: { group: "Projects", label: "Any other record was given to me", on: ["inapp"] },
  meeting_invited: { group: "Calendar", label: "I was invited to a meeting", on: ["inapp", "email"] },
  meeting_reminder: { group: "Calendar", label: "A meeting is about to start", on: ["inapp", "email"] },
  ticket_assigned: { group: "Service", label: "A ticket was given to me", on: ["inapp", "email"] },
  leave_requested: { group: "People", label: "Someone asked for leave", on: ["inapp", "email"] },
  leave_decided: { group: "People", label: "My leave was approved or declined", on: ["inapp", "email"] },
};
export const ALERT_CHANNELS = ["inapp", "email", "sms", "whatsapp"];

let sendEmail = null;
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const esc = (s) => str(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function db(path, { method = "GET", body, prefer = "return=representation" } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === "object" && data?.message ? data.message : `Database replied ${res.status}`);
  return data;
}
const rows = async (path) => { try { const d = await db(path); return Array.isArray(d) ? d : []; } catch (e) { console.error("[events]", e.message); return []; } };

/** Nairobi date, hour and the next 07:00 as an ISO time. */
function nairobi() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const hour = Number(p.hour);
  const morning = new Date(Date.parse(`${date}T07:00:00+03:00`) + (hour >= 7 ? 86400000 : 0)).toISOString();
  return { date, hour, morning };
}

/** The company's rules: { events: { key: { inapp, email, sms, whatsapp } }, quiet, meeting_minutes, morning_hour }. */
const settingsCache = new Map();
async function rulesFor(tenantId) {
  const hit = settingsCache.get(tenantId);
  if (hit && Date.now() - hit.at < 60_000) return hit.rules;
  const s = (await rows(`business_settings?tenant_id=eq.${tenantId}&select=business_name,erp_settings&limit=1`))[0];
  const n = s?.erp_settings?.notifications || {};
  const events = {};
  for (const [k, d] of Object.entries(ALERT_EVENTS)) {
    const saved = n.events?.[k] || {};
    events[k] = Object.fromEntries(ALERT_CHANNELS.map((c) => [c, saved[c] ?? d.on.includes(c)]));
  }
  const rules = {
    events, company: str(s?.business_name) || "JMSURF Garage",
    quiet: n.quiet !== false, meeting_minutes: Number(n.meeting_minutes ?? 30), morning_hour: Number(n.morning_hour ?? 8),
    origin: await companyOrigin(tenantId),
  };
  settingsCache.set(tenantId, { at: Date.now(), rules });
  return rules;
}

/** The company's customer pages (custom domain when live, else app.jmsurfgarage.co.ke/<slug>). */
const companyOrigin = (tenantId) => publicBase(tenantId);

const contacts = (tenantId, users, roles) =>
  db("rpc/alert_contacts", { method: "POST", body: { p_tenant: tenantId, p_users: users || [], p_roles: roles || [] } }).then((d) => (Array.isArray(d) ? d : [])).catch((e) => { console.error("[events] contacts", e.message); return []; });

/** Claims one send; false when it already went (or is going) out. */
async function claim(a, slot, userId, channel, recipient) {
  const r = await db("alert_log?on_conflict=event,entity_id,slot,user_id,channel", {
    method: "POST", prefer: "resolution=ignore-duplicates,return=representation",
    body: { tenant_id: a.tenant_id, event: a.event, entity_id: a.entity_id || a.id, slot, user_id: userId, channel, recipient: recipient || null, status: "sending" },
  }).catch((e) => { console.error("[events] claim", e.message); return []; });
  return Array.isArray(r) && r.length ? r[0].id : null;
}
const finish = (id, ok, detail) => db(`alert_log?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: { status: ok ? "sent" : "failed", detail: str(detail).slice(0, 300) || null } }).catch(() => undefined);

function emailHtml(rules, a, name) {
  const link = a.link ? `${rules.origin}${a.link}` : rules.origin;
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2328">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6e8eb">
<tr><td style="background:#a8121b;color:#fff;padding:16px 24px;font-weight:bold;font-size:15px">${esc(rules.company)}</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 6px;color:#6a737d;font-size:13px">Hello ${esc(name || "there")},</p>
<h1 style="margin:0 0 10px;font-size:19px;line-height:1.35">${esc(a.title)}</h1>
${a.body ? `<p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#3b4148">${esc(a.body)}</p>` : ""}
<a href="${esc(link)}" style="display:inline-block;background:#a8121b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:bold;font-size:14px">Open in JMSURF Garage</a>
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #eef0f2;color:#8a9199;font-size:11px">You get this because of your company's notification settings (System → Notifications). Powered by JMSURF TECHNOLOGIES.</td></tr>
</table></td></tr></table></body></html>`;
}

/** Sends one alert to its people. Returns true when nothing is left for later. */
async function deliver(a, slot, { quietNow }) {
  const rules = await rulesFor(a.tenant_id);
  const ch = rules.events[a.event] || { inapp: true, email: false, sms: false, whatsapp: false };
  if (!ALERT_CHANNELS.some((c) => ch[c])) return true;
  const people = (await contacts(a.tenant_id, a.user_ids, a.roles)).filter((p) => p.user_id !== a.actor);
  let later = false;
  const text = `${rules.company}: ${a.title}${a.body ? ` - ${a.body}` : ""}`.slice(0, 300);
  for (const p of people) {
    if (ch.inapp) {
      const id = await claim(a, slot, p.user_id, "inapp", null);
      if (id) {
        const r = await db("shop_notifications", { method: "POST", prefer: "return=minimal", body: { tenant_id: a.tenant_id, kind: a.event, title: a.title, body: a.body, link: a.link, user_id: p.user_id, entity_type: a.entity_type, entity_id: a.entity_id } })
          .then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
        await finish(id, r.ok, r.error);
      }
    }
    if (ch.email && p.email && sendEmail) {
      const id = await claim(a, slot, p.user_id, "email", p.email);
      if (id) {
        const r = await sendEmail(a.tenant_id, { to: p.email, subject: a.title, html: emailHtml(rules, a, p.name), text: `${a.title}\n\n${a.body || ""}\n\n${rules.origin}${a.link || ""}` }).catch((e) => ({ ok: false, error: e.message }));
        await finish(id, r?.ok !== false, r?.error);
      }
    }
    for (const c of ["sms", "whatsapp"]) {
      if (!ch[c] || !p.phone) continue;
      if (rules.quiet && quietNow) { later = true; continue; }
      const id = await claim(a, slot, p.user_id, c, p.phone);
      if (id) {
        const r = await sendForShop({ tenantId: a.tenant_id, channel: c, to: p.phone, text, reference: `alert:${a.event}` }).catch((e) => ({ ok: false, error: e.message }));
        await finish(id, r?.ok !== false && !r?.error, r?.error);
      }
    }
  }
  return !later;
}

async function runQueue() {
  const now = nairobi();
  const quietNow = now.hour >= 20 || now.hour < 7;
  const due = await rows(`alert_queue?or=(status.eq.new,and(status.eq.waiting,next_at.lte.${new Date().toISOString()}))&order=created_at&limit=100`);
  for (const a of due) {
    try {
      const done = await deliver(a, a.id, { quietNow });
      await db(`alert_queue?id=eq.${a.id}`, { method: "PATCH", prefer: "return=minimal", body: done ? { status: "done", done_at: new Date().toISOString() } : { status: "waiting", next_at: now.morning } });
    } catch (e) {
      console.error("[events] alert failed", a.event, e.message);
      await db(`alert_queue?id=eq.${a.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed", detail: str(e.message).slice(0, 300) } }).catch(() => undefined);
    }
  }
}

const fmtTime = (iso) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Meetings about to start, and (each morning) tasks and follow-ups due today. */
async function runScheduled() {
  const now = nairobi();
  const quietNow = now.hour >= 20 || now.hour < 7;
  const soon = new Date(Date.now() + 24 * 3600_000).toISOString();
  const meetings = await rows(`calendar_events?start_at=gte.${new Date().toISOString()}&start_at=lte.${soon}&select=id,tenant_id,title,start_at,location,attendees,created_by&limit=500`);
  for (const m of meetings) {
    const rules = await rulesFor(m.tenant_id);
    const mins = (Date.parse(m.start_at) - Date.now()) / 60000;
    if (mins > rules.meeting_minutes) continue;
    const users = [...new Set([...(m.attendees || []), m.created_by].filter(Boolean))];
    await deliver({ id: m.id, tenant_id: m.tenant_id, event: "meeting_reminder", title: `Starting ${mins < 2 ? "now" : `in ${Math.round(mins)} min`}: ${m.title}`, body: [fmtTime(m.start_at), m.location].filter(Boolean).join(" · "), link: "/calendar", user_ids: users, roles: [], entity_type: "calendar_event", entity_id: m.id }, `m${rules.meeting_minutes}`, { quietNow });
  }
  const tenants = await rows("business_settings?select=tenant_id,erp_settings");
  for (const t of tenants) {
    const morning = Number(t.erp_settings?.notifications?.morning_hour ?? 8);
    if (now.hour < morning || now.hour >= 20) continue;
    const tasks = await rows(`app_records?tenant_id=eq.${t.tenant_id}&app=eq.projects&kind=eq.task&due_date=lte.${now.date}&archived=is.false&assigned_to=not.is.null&select=id,number,title,stage,due_date,assigned_to&limit=1000`);
    const open = tasks.filter((x) => !/done|complete|closed|cancel/i.test(str(x.stage)));
    for (const [uid, list] of groupBy(open, "assigned_to")) {
      const late = list.filter((x) => x.due_date < now.date).length;
      await deliver({ id: `${uid}`, tenant_id: t.tenant_id, event: "task_due", title: `${list.length} task${list.length === 1 ? "" : "s"} due today${late ? ` (${late} overdue)` : ""}`, body: list.slice(0, 6).map((x) => x.title || x.number).join(" · "), link: "/apps/projects", user_ids: [uid], roles: [], entity_type: "task", entity_id: uid }, now.date, { quietNow });
    }
    const todos = await rows(`crm_activities?tenant_id=eq.${t.tenant_id}&done=is.false&due_date=lte.${now.date}&assigned_to=not.is.null&select=id,summary,due_date,assigned_to,lead_id&limit=1000`);
    for (const [uid, list] of groupBy(todos, "assigned_to")) {
      await deliver({ id: `${uid}`, tenant_id: t.tenant_id, event: "activity_due", title: `${list.length} follow-up${list.length === 1 ? "" : "s"} due today`, body: list.slice(0, 6).map((x) => x.summary || "Follow-up").join(" · "), link: "/crm/activities", user_ids: [uid], roles: [], entity_type: "crm_activity", entity_id: uid }, now.date, { quietNow });
    }
  }
}
function groupBy(list, key) {
  const m = new Map();
  for (const x of list) { const k = x[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}

export function startEventAlerts(emailSender) {
  sendEmail = emailSender;
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await runQueue(); } catch (e) { console.error("[events] queue failed", e.message); } finally { busy = false; }
  };
  let sBusy = false;
  const sched = async () => {
    if (sBusy) return;
    sBusy = true;
    try { await runScheduled(); } catch (e) { console.error("[events] schedule failed", e.message); } finally { sBusy = false; }
  };
  setTimeout(tick, 20_000).unref();
  setInterval(tick, 20_000).unref();
  setTimeout(sched, 60_000).unref();
  setInterval(sched, 5 * 60_000).unref();
}
