// ---------------------------------------------------------------------------
// JMSURF SERVICE + JMSURF MARKETING + IoT: the parts of the record-engine apps
// that talk to the outside world.
//
//  Helpdesk     email-to-ticket from the company's own mailbox (IMAP, every 2
//               minutes); replies from DASH go out by email with [TKT-…] in the
//               subject so answers thread back onto the ticket.
//  Live chat    /chat.js widget for any website + /api/pub/chat/* (visitor),
//               agents answer on the conversation record (app_record_events).
//  Appointments public booking page data + slots, SMS confirmation, reminders.
//  Events       public registration; paid tickets become an invoice with an
//               M-Pesa prompt; paying it marks the registration paid (trigger).
//  eLearning    learner links (/learn?k=…) with lesson progress and quizzes.
//  Campaigns    email campaigns to lists (open tracking, unsubscribe), social
//               posts to Facebook / Instagram / LinkedIn / X, automation
//               journeys (SMS / email / WhatsApp steps).
//  IoT          devices post readings with their own key; thresholds alert.
//
// Settings: business_settings.erp_settings.engage; secrets in
// integration_secrets (helpdesk_imap_password, social_*). Public routes are
// rate-limited per IP and never expose another company's data.
// ---------------------------------------------------------------------------
import { createHash, randomBytes } from "node:crypto";
import { sendForShop } from "./messaging.js";
import { pushInvoiceForShop } from "./sendmoney.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ROOT_HOST = process.env.ROOT_HOST || "garage.jmsurf.co.ke";

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const enc = encodeURIComponent;
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function db(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(20000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  const j = t ? JSON.parse(t) : null;
  if (!res.ok) throw new Error(str(j?.message) || `Database error ${res.status}`);
  return j;
}
const one = async (path) => (await db(path))?.[0] || null;
const insert = async (table, body) => (await db(table, { method: "POST", prefer: "return=representation", body }))[0];
const patch = (path, body) => db(path, { method: "PATCH", prefer: "return=minimal", body });
const moduleOn = async (tenantId, key) => (await db("rpc/tenant_module_active", { method: "POST", body: { p_tenant: tenantId, p_key: key } }).catch(() => false)) === true;

let deliverEmail = async () => ({ ok: false, error: "Email is not configured" });

// ---- company context ---------------------------------------------------------
async function companyBySlug(slug) {
  if (!/^[a-z0-9-]{2,63}$/.test(str(slug))) return null;
  return one(`tenants?slug=eq.${enc(slug)}&is_active=eq.true&deleted_at=is.null&select=id,slug,business_name,business_phone,business_email,logo_url`);
}
async function engageSettings(tenantId) {
  const s = await one(`business_settings?tenant_id=eq.${tenantId}&select=id,erp_settings,business_name,business_phone,business_email`);
  return { id: s?.id, erp: s?.erp_settings || {}, e: s?.erp_settings?.engage || {}, name: s?.business_name || "", phone: s?.business_phone || "", email: s?.business_email || "" };
}
async function secret(tenantId, name) {
  return (await one(`integration_secrets?tenant_id=eq.${tenantId}&name=eq.${enc(name)}&select=value`))?.value || "";
}
const origin = (slug) => `https://${slug}.${ROOT_HOST}`;

async function notify(tenantId, title, body, link, kind = "engage") {
  await db("shop_notifications", { method: "POST", prefer: "return=minimal", body: { tenant_id: tenantId, kind, title: title.slice(0, 200), body: str(body).slice(0, 1000), link, sent_at: new Date().toISOString() } }).catch(() => {});
}
async function addEvent(tenantId, recordId, body, data = {}, kind = "message") {
  return insert("app_record_events", { tenant_id: tenantId, record_id: recordId, kind, body: str(body).slice(0, 20000), data, created_by: null });
}
// Records number themselves on insert from data._prefix (app_records_before trigger).

// ---- rate limit for public routes ----------------------------------------------------
const hits = new Map();
function limit(req, key, max, windowMs = 60_000) {
  const ip = str(req.headers["x-forwarded-for"]).split(",")[0] || req.socket?.remoteAddress || "?";
  const k = `${key}:${ip}`;
  const now = Date.now();
  const list = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, "Too many requests. Try again in a minute.");
  list.push(now); hits.set(k, list);
  if (hits.size > 20000) hits.clear();
}

// ---- customers ------------------------------------------------------------------------
const phone254 = (p) => { const d = str(p).replace(/\D/g, ""); return d.startsWith("0") ? `254${d.slice(1)}` : /^[17]\d{8}$/.test(d) ? `254${d}` : d; };
async function findOrCreateCustomer(tenantId, { name, phone, email }) {
  const ph = phone254(phone);
  const em = str(email).toLowerCase();
  let c = null;
  if (em) c = await one(`customers?tenant_id=eq.${tenantId}&email=ilike.${enc(em)}&select=id,name,phone,email`);
  if (!c && ph) c = await one(`customers?tenant_id=eq.${tenantId}&or=(phone.eq.${ph},phone.eq.0${ph.slice(3)})&select=id,name,phone,email`);
  if (c) return c;
  if (!str(name)) return null;
  return insert("customers", { tenant_id: tenantId, name: str(name).slice(0, 120), phone: ph ? `0${ph.slice(3)}` : "", email: em || null, source: "Website" }).catch(() => null);
}

// =============================================================================
// Helpdesk: email → tickets
// =============================================================================
let mailLib = null;
async function loadMail() {
  if (mailLib) return mailLib;
  mailLib = await import("./vendor-mail.js");
  return mailLib;
}

function ticketToken(subject) { return str(subject).match(/\[(TKT-\d+)\]/i)?.[1]?.toUpperCase() || null; }

async function intakeForTenant(tenantId, cfg) {
  const password = await secret(tenantId, "helpdesk_imap_password");
  if (!cfg.imap_host || !cfg.imap_user || !password) return { skipped: true };
  const { ImapFlow, simpleParser } = await loadMail();
  const client = new ImapFlow({ host: cfg.imap_host, port: Number(cfg.imap_port || 993), secure: cfg.imap_tls !== false, auth: { user: cfg.imap_user, pass: password }, logger: false, socketTimeout: 60_000 });
  let created = 0, threaded = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock(cfg.imap_folder || "INBOX");
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      for (const uid of (uids || []).slice(0, 50)) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg?.source) continue;
        const mail = await simpleParser(msg.source);
        const fromAddr = str(mail.from?.value?.[0]?.address).toLowerCase();
        const fromName = str(mail.from?.value?.[0]?.name) || fromAddr;
        const subject = str(mail.subject) || "(no subject)";
        const text = str(mail.text || "").replace(/\r/g, "").split(/\n-- ?\n|\nOn .{5,80} wrote:\n/)[0].slice(0, 20000);
        if (!fromAddr || fromAddr === str(cfg.imap_user).toLowerCase() || /mailer-daemon|no-?reply/i.test(fromAddr)) { await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); continue; }
        const token = ticketToken(subject);
        let ticket = token ? await one(`app_records?tenant_id=eq.${tenantId}&app=eq.helpdesk&kind=eq.ticket&number=eq.${enc(token)}&select=id,stage,number,title`) : null;
        if (ticket) {
          await addEvent(tenantId, ticket.id, text, { from: "customer", email: fromAddr, name: fromName, channel: "email" });
          if (["resolved", "closed", "waiting"].includes(ticket.stage)) await patch(`app_records?id=eq.${ticket.id}`, { stage: "in_progress", updated_at: new Date().toISOString() });
          threaded++;
        } else {
          const cust = await findOrCreateCustomer(tenantId, { name: fromName, email: fromAddr });
          const due = new Date(Date.now() + Number(cfg.sla_hours || 24) * 3600_000).toISOString().slice(0, 10);
          ticket = await insert("app_records", { tenant_id: tenantId, app: "helpdesk", kind: "ticket", title: subject.slice(0, 250), stage: "new", priority: "Normal", customer_id: cust?.id || null, due_date: due,
            data: { _prefix: "TKT-", channel: "Email", description: text.slice(0, 5000), from_email: fromAddr, from_name: fromName } });
          const number = ticket.number;
          await addEvent(tenantId, ticket.id, text, { from: "customer", email: fromAddr, name: fromName, channel: "email" });
          await notify(tenantId, `New ticket ${number}: ${subject}`, `From ${fromName} <${fromAddr}>`, `/apps/helpdesk/ticket/${ticket.id}`, "ticket");
          if (cfg.auto_ack !== false) {
            const s = await engageSettings(tenantId);
            await deliverEmail(tenantId, { to: fromAddr, subject: `[${number}] ${subject}`, text: `Hello ${fromName},\n\nThank you for contacting ${s.name}. Your request has been received as ticket ${number} and our team will reply soon. Reply to this email to add more details.\n\n${s.name}`, html: emailHtml(s.name, `<p>Hello ${esc(fromName)},</p><p>Thank you for contacting ${esc(s.name)}. Your request has been received as ticket <b>${esc(number)}</b> and our team will reply soon.</p><p>Reply to this email to add more details.</p>`) }).catch(() => {});
          }
          created++;
        }
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => client.close()); }
  return { created, threaded };
}

function emailHtml(company, inner, footer = "") {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#15171c"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:14px;overflow:hidden"><tr><td style="background:#a8121b;color:#fff;padding:16px 24px;font-weight:bold;font-size:16px">${esc(company)}</td></tr><tr><td style="padding:24px;font-size:15px;line-height:1.6">${inner}</td></tr><tr><td style="padding:14px 24px;font-size:12px;color:#6b7280;border-top:1px solid #eee">${footer || `${esc(company)} · Sent with JMSURF Garage`}</td></tr></table></td></tr></table></body></html>`;
}

async function helpdeskTick() {
  const rows = await db("business_settings?select=tenant_id,erp_settings&erp_settings->engage->helpdesk->>enabled=eq.true");
  for (const r of rows) {
    const cfg = r.erp_settings?.engage?.helpdesk || {};
    if (!(await moduleOn(r.tenant_id, "helpdesk"))) continue;
    await intakeForTenant(r.tenant_id, cfg).catch(async (e) => {
      console.error("[helpdesk]", r.tenant_id, e.message);
      const s = await engageSettings(r.tenant_id);
      const last = s.e.helpdesk?.last_error_at ? Date.parse(s.e.helpdesk.last_error_at) : 0;
      if (Date.now() - last > 6 * 3600_000) {
        await notify(r.tenant_id, "Helpdesk mailbox could not be read", e.message, "/settings?tab=service");
        await patch(`business_settings?id=eq.${s.id}`, { erp_settings: { ...s.erp, engage: { ...s.e, helpdesk: { ...(s.e.helpdesk || {}), last_error: str(e.message).slice(0, 300), last_error_at: new Date().toISOString() } } } }).catch(() => {});
      }
    });
  }
}

// =============================================================================
// Live chat (public widget)
// =============================================================================
export function chatWidgetJs(slug, base) {
  return `(function(){if(window.__dashChat)return;window.__dashChat=1;
var S=${JSON.stringify(slug)},B=${JSON.stringify(base)},K="dash-chat-"+S,tok=null,after=null,timer=null,open=false,cfg={};
try{tok=localStorage.getItem(K)}catch(e){}
function api(p,b){return fetch(B+"/api/pub/chat/"+p,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.assign({c:S},b||{}))}).then(function(r){return r.json()})}
function el(t,s,h){var e=document.createElement(t);if(s)e.style.cssText=s;if(h!=null)e.textContent=h;return e}
var col="#a8121b";
var btn=el("button","position:fixed;bottom:20px;right:20px;width:58px;height:58px;border-radius:50%;border:0;color:#fff;font-size:26px;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.25);z-index:2147483000");btn.setAttribute("aria-label","Chat with us");btn.innerHTML="&#128172;";
var box=el("div","position:fixed;bottom:90px;right:20px;width:340px;max-width:calc(100vw - 32px);height:460px;max-height:calc(100vh - 120px);background:#fff;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.3);display:none;flex-direction:column;overflow:hidden;font:14px/1.4 Arial,sans-serif;color:#15171c;z-index:2147483000");
var head=el("div","padding:14px 16px;color:#fff;font-weight:bold");var list=el("div","flex:1;overflow:auto;padding:12px;background:#f6f6f7");
var form=el("form","display:flex;gap:6px;padding:10px;border-top:1px solid #eee");var inp=el("input","flex:1;border:1px solid #ddd;border-radius:10px;padding:9px 10px;font:inherit");inp.placeholder="Type a message…";var send=el("button","border:0;border-radius:10px;padding:0 14px;color:#fff;font-weight:bold;cursor:pointer",'Send');
form.appendChild(inp);form.appendChild(send);
var intro=el("form","padding:14px;display:flex;flex-direction:column;gap:8px");
function field(ph,type){var i=el("input","border:1px solid #ddd;border-radius:10px;padding:9px 10px;font:inherit");i.placeholder=ph;if(type)i.type=type;intro.appendChild(i);return i}
var iname=field("Your name"),iphone=field("Phone number","tel"),iemail=field("Email (optional)","email"),imsg=el("textarea","border:1px solid #ddd;border-radius:10px;padding:9px 10px;font:inherit;min-height:70px");imsg.placeholder="How can we help?";intro.appendChild(imsg);var go=el("button","border:0;border-radius:10px;padding:10px;color:#fff;font-weight:bold;cursor:pointer","Start chat");intro.appendChild(go);
box.appendChild(head);box.appendChild(list);box.appendChild(form);
function paint(){btn.style.background=col;head.style.background=col;send.style.background=col;go.style.background=col;head.textContent=cfg.title||"Chat with us"}
function bubble(m){var me=m.from!=="agent";var w=el("div","display:flex;margin:6px 0;justify-content:"+(me?"flex-end":"flex-start"));var b=el("div","max-width:80%;padding:8px 11px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word;"+(me?"background:"+col+";color:#fff;border-bottom-right-radius:4px":"background:#fff;border:1px solid #eee;border-bottom-left-radius:4px"),m.body);w.appendChild(b);list.appendChild(w);list.scrollTop=list.scrollHeight}
function poll(){if(!tok)return;api("poll",{token:tok,after:after}).then(function(r){if(r.error){if(r.reset){tok=null;try{localStorage.removeItem(K)}catch(e){}showIntro()}return}(r.messages||[]).forEach(function(m){bubble(m);after=m.at})}).catch(function(){})}
function startPolling(){clearInterval(timer);timer=setInterval(poll,open?3000:15000);poll()}
function showIntro(){list.innerHTML="";list.appendChild(intro);form.style.display="none";if(cfg.greeting){var g=el("p","margin:0 0 6px;color:#555",cfg.greeting);intro.insertBefore(g,intro.firstChild)}}
function showChat(){if(intro.parentNode)intro.parentNode.removeChild(intro);form.style.display="flex"}
intro.onsubmit=function(e){e.preventDefault();if(!iname.value.trim()||!imsg.value.trim()){return}go.disabled=true;api("start",{name:iname.value,phone:iphone.value,email:iemail.value,message:imsg.value}).then(function(r){go.disabled=false;if(r.error){alert(r.error);return}tok=r.token;try{localStorage.setItem(K,tok)}catch(e){}list.innerHTML="";showChat();after=null;startPolling()})};
form.onsubmit=function(e){e.preventDefault();var t=inp.value.trim();if(!t||!tok)return;inp.value="";api("send",{token:tok,message:t}).then(function(r){if(r.error)alert(r.error);poll()})};
btn.onclick=function(){open=!open;box.style.display=open?"flex":"none";if(open&&tok){showChat();startPolling()}else if(open){showIntro()}else startPolling()};
api("config",{}).then(function(r){if(!r||r.error||!r.enabled)return;cfg=r;if(r.color)col=r.color;paint();document.body.appendChild(box);document.body.appendChild(btn);if(tok){showChat();startPolling()}});
})();`;
}

async function chatConversation(tenantId, token) {
  if (!/^[a-f0-9]{48}$/.test(str(token))) return null;
  return one(`app_records?tenant_id=eq.${tenantId}&app=eq.live_chat&kind=eq.conversation&data->>visitor_hash=eq.${sha(token)}&select=id,stage,title,customer_id`);
}

// =============================================================================
// Appointments
// =============================================================================
const pad = (n) => String(n).padStart(2, "0");
function bookingCfg(e) {
  const b = e.booking || {};
  return { enabled: !!b.enabled, from: b.open_from || "08:00", to: b.open_to || "17:00", days: Array.isArray(b.days) && b.days.length ? b.days.map(Number) : [1, 2, 3, 4, 5, 6], tz: Number(b.tz_offset ?? 180), sms: b.sms_confirm !== false, notice: Number(b.min_notice_hours ?? 2) };
}
/** Free start times (ISO) on a date for an appointment type, in the company's time zone (default EAT, UTC+3). */
async function freeSlots(tenantId, cfg, type, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Pick a date");
  const minutes = Math.max(10, Number(type.data?.minutes || 30));
  const cap = Math.max(1, Number(type.data?.capacity || 1));
  const local = new Date(`${date}T00:00:00Z`);
  if (!cfg.days.includes(local.getUTCDay())) return [];
  const [fh, fm] = cfg.from.split(":").map(Number); const [th, tm] = cfg.to.split(":").map(Number);
  const startUtc = Date.parse(`${date}T${pad(fh)}:${pad(fm)}:00Z`) - cfg.tz * 60_000;
  const endUtc = Date.parse(`${date}T${pad(th)}:${pad(tm)}:00Z`) - cfg.tz * 60_000;
  const taken = await db(`app_records?tenant_id=eq.${tenantId}&app=eq.appointments&kind=eq.booking&stage=in.(booked,confirmed)&starts_at=lt.${new Date(endUtc).toISOString()}&ends_at=gt.${new Date(startUtc).toISOString()}&data->>type=eq.${type.id}&select=starts_at,ends_at`);
  const out = [];
  for (let t = startUtc; t + minutes * 60_000 <= endUtc; t += minutes * 60_000) {
    if (t < Date.now() + cfg.notice * 3600_000) continue;
    const overlap = taken.filter((b) => Date.parse(b.starts_at) < t + minutes * 60_000 && Date.parse(b.ends_at) > t).length;
    if (overlap < cap) out.push(new Date(t).toISOString());
  }
  return out;
}

async function bookingReminderTick() {
  const soon = new Date(Date.now() + 24 * 3600_000).toISOString();
  const rows = await db(`app_records?app=eq.appointments&kind=eq.booking&stage=in.(booked,confirmed)&starts_at=gt.${new Date().toISOString()}&starts_at=lt.${soon}&data->>reminded=is.null&select=id,tenant_id,title,starts_at,data&limit=200`);
  for (const b of rows) {
    const ph = str(b.data?.phone);
    await patch(`app_records?id=eq.${b.id}`, { data: { ...b.data, reminded: new Date().toISOString() } });
    if (!ph) continue;
    const s = await engageSettings(b.tenant_id);
    const when = new Date(Date.parse(b.starts_at) + bookingCfg(s.e).tz * 60_000).toISOString().replace("T", " ").slice(0, 16);
    await sendForShop({ tenantId: b.tenant_id, channel: "sms", to: ph, text: `Reminder: your appointment "${b.title}" with ${s.name} is on ${when}. Reply or call ${s.phone || "us"} to change it.` }).catch(() => {});
  }
}

// =============================================================================
// Email campaigns
// =============================================================================
async function campaignRecipients(tenantId, campaign) {
  const listId = str(campaign.data?.list);
  const list = uuidRe.test(listId) ? await one(`app_records?id=eq.${listId}&tenant_id=eq.${tenantId}&select=data`) : null;
  const source = str(list?.data?.source || "All customers");
  const out = new Map();
  const add = (email, name) => { const e = str(email).toLowerCase(); if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !out.has(e)) out.set(e, str(name)); };
  if (source === "All customers") (await db(`customers?tenant_id=eq.${tenantId}&email=not.is.null&select=name,email&limit=20000`)).forEach((c) => add(c.email, c.name));
  if (source === "CRM leads") (await db(`crm_leads?tenant_id=eq.${tenantId}&email=not.is.null&select=name,contact_name,email&limit=20000`)).forEach((c) => add(c.email, c.contact_name || c.name));
  if (source === "Customers with a balance") {
    const inv = await db(`invoices?tenant_id=eq.${tenantId}&status=in.(sent,overdue,partially_paid)&select=customer_id&limit=20000`);
    const ids = [...new Set(inv.map((i) => i.customer_id).filter(Boolean))];
    for (let i = 0; i < ids.length; i += 150) (await db(`customers?id=in.(${ids.slice(i, i + 150).join(",")})&email=not.is.null&select=name,email`)).forEach((c) => add(c.email, c.name));
  }
  str(list?.data?.emails).split(/[\s,;]+/).forEach((e) => add(e, ""));
  const unsub = new Set((await db(`marketing_unsubscribes?tenant_id=eq.${tenantId}&select=email&limit=50000`)).map((u) => u.email));
  return [...out].filter(([e]) => !unsub.has(e));
}

function md(text) {
  // Plain text with blank-line paragraphs, **bold**, links and {name}.
  return esc(text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#a8121b">$1</a>').replace(/\n/g, "<br>")}</p>`).join("");
}

async function queueCampaign(tenantId, campaignId) {
  const c = await one(`app_records?id=eq.${campaignId}&tenant_id=eq.${tenantId}&app=eq.email_marketing&kind=eq.campaign&select=*`);
  if (!c) throw new HttpError(404, "Campaign not found");
  if (c.stage === "sent") throw new HttpError(409, "This campaign was already sent");
  const rec = await campaignRecipients(tenantId, c);
  if (!rec.length) throw new HttpError(400, "No one to send to: the list has no email addresses (or they all unsubscribed).");
  for (let i = 0; i < rec.length; i += 500) {
    await db("marketing_sends?on_conflict=campaign_id,email", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: rec.slice(i, i + 500).map(([email, name]) => ({ tenant_id: tenantId, campaign_id: c.id, email, name: name || null })) });
  }
  await patch(`app_records?id=eq.${c.id}`, { stage: "scheduled", data: { ...c.data, queued_at: new Date().toISOString(), recipients: rec.length }, starts_at: c.starts_at || new Date().toISOString() });
  return { recipients: rec.length };
}

async function campaignTick(base) {
  // Scheduled campaigns whose time has come get their recipients queued.
  const due = await db(`app_records?app=eq.email_marketing&kind=eq.campaign&stage=eq.scheduled&starts_at=lte.${new Date().toISOString()}&data->>queued_at=is.null&select=id,tenant_id&limit=20`);
  for (const c of due) await queueCampaign(c.tenant_id, c.id).catch((e) => console.error("[campaign]", e.message));
  // Send up to 60 queued emails a minute.
  const queued = await db("marketing_sends?status=eq.queued&select=id,tenant_id,campaign_id,email,name,token&order=created_at&limit=60");
  const camps = new Map();
  for (const q of queued) {
    let c = camps.get(q.campaign_id);
    if (!c) {
      const rec = await one(`app_records?id=eq.${q.campaign_id}&select=id,title,data,starts_at,stage,tenant_id`);
      const t = await one(`tenants?id=eq.${q.tenant_id}&select=slug,business_name`);
      c = { rec, t }; camps.set(q.campaign_id, c);
    }
    if (!c.rec || (c.rec.starts_at && Date.parse(c.rec.starts_at) > Date.now())) continue;
    const o = c.t?.slug ? origin(c.t.slug) : base;
    const name = q.name || "there";
    const body = md(str(c.rec.data?.body).replace(/\{name\}/g, name));
    const pre = str(c.rec.data?.preheader);
    const html = emailHtml(c.t?.business_name || "", `${pre ? `<div style="display:none;max-height:0;overflow:hidden">${esc(pre)}</div>` : ""}${body}<img src="${o}/api/m/o/${q.token}.gif" width="1" height="1" alt="" style="display:block">`,
      `${esc(c.t?.business_name || "")} · <a href="${o}/api/m/u/${q.token}" style="color:#6b7280">Unsubscribe</a>`);
    const r = await deliverEmail(q.tenant_id, { to: q.email, subject: c.rec.title.replace(/\{name\}/g, name), html, text: str(c.rec.data?.body).replace(/\{name\}/g, name) + `\n\nUnsubscribe: ${o}/api/m/u/${q.token}` }).catch((e) => ({ ok: false, error: e.message }));
    await patch(`marketing_sends?id=eq.${q.id}`, r.ok ? { status: "sent", sent_at: new Date().toISOString() } : { status: "failed", error: str(r.error).slice(0, 300) });
  }
  // Finished campaigns.
  for (const [id, c] of camps) {
    const left = await db(`marketing_sends?campaign_id=eq.${id}&status=eq.queued&select=id&limit=1`);
    if (!left.length && c.rec?.stage !== "sent") {
      const sent = (await db(`marketing_sends?campaign_id=eq.${id}&status=eq.sent&select=id`)).length;
      await patch(`app_records?id=eq.${id}`, { stage: "sent", data: { ...c.rec.data, sent_count: sent, finished_at: new Date().toISOString() } });
    }
  }
}

// =============================================================================
// Social media
// =============================================================================
async function publishPost(tenantId, post) {
  const s = await engageSettings(tenantId);
  const cfg = s.e.social || {};
  const text = [str(post.data?.body), str(post.data?.link)].filter(Boolean).join("\n\n");
  const image = str(post.data?.image_url);
  const channels = Array.isArray(post.data?.channels) ? post.data.channels : [];
  const log = {};
  const graph = async (path, params) => {
    const r = await fetch(`https://graph.facebook.com/v21.0/${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(str(j.error?.message) || `Facebook replied ${r.status}`);
    return j;
  };
  for (const ch of channels) {
    try {
      if (ch === "Facebook") {
        const token = await secret(tenantId, "social_fb_page_token");
        if (!cfg.fb_page_id || !token) throw new Error("Connect the Facebook Page in System → Service & Marketing");
        const j = image ? await graph(`${cfg.fb_page_id}/photos`, { url: image, caption: text, access_token: token })
          : await graph(`${cfg.fb_page_id}/feed`, { message: str(post.data?.body), ...(post.data?.link ? { link: post.data.link } : {}), access_token: token });
        log[ch] = { ok: true, id: j.post_id || j.id };
      } else if (ch === "Instagram") {
        const token = await secret(tenantId, "social_fb_page_token");
        if (!cfg.ig_user_id || !token) throw new Error("Connect the Instagram business account in System → Service & Marketing");
        if (!image) throw new Error("Instagram posts need a picture (Image URL)");
        const m = await graph(`${cfg.ig_user_id}/media`, { image_url: image, caption: text, access_token: token });
        const p = await graph(`${cfg.ig_user_id}/media_publish`, { creation_id: m.id, access_token: token });
        log[ch] = { ok: true, id: p.id };
      } else if (ch === "LinkedIn") {
        const token = await secret(tenantId, "social_linkedin_token");
        if (!cfg.linkedin_org || !token) throw new Error("Connect the LinkedIn page in System → Service & Marketing");
        const r = await fetch("https://api.linkedin.com/rest/posts", { method: "POST", signal: AbortSignal.timeout(30000),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "LinkedIn-Version": "202409", "X-Restli-Protocol-Version": "2.0.0" },
          body: JSON.stringify({ author: `urn:li:organization:${str(cfg.linkedin_org).replace(/\D/g, "")}`, commentary: text, visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false }) });
        if (!r.ok) throw new Error(`LinkedIn replied ${r.status}: ${str(await r.text()).slice(0, 160)}`);
        log[ch] = { ok: true, id: r.headers.get("x-restli-id") || "" };
      } else if (ch === "X (Twitter)") {
        const token = await secret(tenantId, "social_x_token");
        if (!token) throw new Error("Connect X in System → Service & Marketing");
        const r = await fetch("https://api.twitter.com/2/tweets", { method: "POST", signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ text: text.slice(0, 280) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(str(j.detail || j.title) || `X replied ${r.status}`);
        log[ch] = { ok: true, id: j.data?.id };
      } else {
        log[ch] = { ok: false, error: "Post this one by hand (no publishing API)." };
      }
    } catch (e) { log[ch] = { ok: false, error: str(e.message).slice(0, 300) }; }
  }
  const okAll = Object.values(log).length > 0 && Object.values(log).every((x) => x.ok);
  await patch(`app_records?id=eq.${post.id}`, { stage: okAll ? "published" : post.stage, data: { ...post.data, publish_log: log, published_at: new Date().toISOString() } });
  const bad = Object.entries(log).filter(([, v]) => !v.ok);
  if (bad.length) await notify(tenantId, `Social post not fully published: ${post.title}`, bad.map(([k, v]) => `${k}: ${v.error}`).join("\n"), `/apps/social/post/${post.id}`);
  return log;
}
async function socialTick() {
  const due = await db(`app_records?app=eq.social&kind=eq.post&stage=eq.scheduled&starts_at=lte.${new Date().toISOString()}&data->>published_at=is.null&select=*&limit=20`);
  for (const p of due) if (await moduleOn(p.tenant_id, "social")) await publishPost(p.tenant_id, p).catch((e) => console.error("[social]", e.message));
}

// =============================================================================
// Automation journeys
// =============================================================================
const fill = (tpl, x) => str(tpl).replace(/\{name\}/g, x.name || "there").replace(/\{company\}/g, x.company || "").replace(/\{amount\}/g, x.amount || "").replace(/\{invoice\}/g, x.invoice || "");
async function journeySubjects(tenantId, j) {
  const since = str(j.data?.started_at) || j.updated_at;
  const t = str(j.data?.trigger);
  if (t === "Lead created") return (await db(`crm_leads?tenant_id=eq.${tenantId}&created_at=gte.${enc(since)}&select=id,name,contact_name,phone,mobile,email&limit=500`)).map((l) => ({ type: "lead", id: l.id, name: l.contact_name || l.name, phone: l.mobile || l.phone, email: l.email }));
  if (t === "Customer created") return (await db(`customers?tenant_id=eq.${tenantId}&created_at=gte.${enc(since)}&select=id,name,phone,email&limit=500`)).map((c) => ({ type: "customer", id: c.id, name: c.name, phone: c.phone, email: c.email }));
  if (t === "Invoice overdue" || t === "Invoice paid") {
    const q = t === "Invoice paid" ? `status=eq.paid&updated_at=gte.${enc(since)}` : `status=in.(sent,overdue,partially_paid)&due_date=lt.${new Date().toISOString().slice(0, 10)}`;
    return (await db(`invoices?tenant_id=eq.${tenantId}&${q}&select=id,invoice_number,customer_name,customer_phone,customer_email,total,amount_paid&limit=500`))
      .map((i) => ({ type: "invoice", id: i.id, name: i.customer_name, phone: i.customer_phone, email: i.customer_email, invoice: i.invoice_number, amount: `KES ${Math.round(Number(i.total) - Number(i.amount_paid)).toLocaleString()}` }));
  }
  if (t === "No purchase in 30 days") {
    const cut = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const recent = new Set((await db(`invoices?tenant_id=eq.${tenantId}&issue_date=gte.${cut}&select=customer_id&limit=20000`)).map((i) => i.customer_id));
    const older = await db(`invoices?tenant_id=eq.${tenantId}&issue_date=lt.${cut}&issue_date=gte.${new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10)}&select=customer_id,customer_name,customer_phone,customer_email&limit=5000`);
    const seen = new Set();
    return older.filter((i) => i.customer_id && !recent.has(i.customer_id) && !seen.has(i.customer_id) && seen.add(i.customer_id)).map((i) => ({ type: "customer", id: `${i.customer_id}:${cut.slice(0, 7)}`, name: i.customer_name, phone: i.customer_phone, email: i.customer_email }));
  }
  if (t === "Form submitted") return (await db(`app_records?tenant_id=eq.${tenantId}&app=eq.surveys&kind=eq.response&created_at=gte.${enc(since)}&select=id,title,data&limit=500`)).map((r) => ({ type: "response", id: r.id, name: r.title, phone: r.data?.phone, email: r.data?.email }));
  return [];
}
async function journeyTick() {
  const journeys = await db("app_records?app=eq.marketing_automation&kind=eq.journey&stage=eq.running&select=*&limit=200");
  for (const j of journeys) {
    if (!(await moduleOn(j.tenant_id, "marketing_automation"))) continue;
    if (!j.data?.started_at) { await patch(`app_records?id=eq.${j.id}`, { data: { ...j.data, started_at: new Date().toISOString() } }); continue; }
    const subjects = await journeySubjects(j.tenant_id, j).catch(() => []);
    const steps = Array.isArray(j.data?.steps) ? j.data.steps : [];
    if (!steps.length) continue;
    const firstWait = Number(steps[0]?.wait || 0);
    for (let i = 0; i < subjects.length; i += 200) {
      await db("journey_enrollments?on_conflict=journey_id,subject_type,subject_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal",
        body: subjects.slice(i, i + 200).map((s) => ({ tenant_id: j.tenant_id, journey_id: j.id, subject_type: s.type, subject_id: String(s.id), name: s.name || null, phone: s.phone || null, email: s.email || null, next_at: new Date(Date.now() + firstWait * 86400_000).toISOString(), log: [{ vars: { invoice: s.invoice, amount: s.amount } }] })) });
    }
  }
  const due = await db(`journey_enrollments?done=eq.false&next_at=lte.${new Date().toISOString()}&select=*&limit=200`);
  const cache = new Map();
  for (const e of due) {
    let j = cache.get(e.journey_id);
    if (!j) { j = await one(`app_records?id=eq.${e.journey_id}&select=id,stage,data,tenant_id`); cache.set(e.journey_id, j); }
    if (!j || j.stage !== "running") { await patch(`journey_enrollments?id=eq.${e.id}`, { done: true }); continue; }
    const steps = Array.isArray(j.data?.steps) ? j.data.steps : [];
    const step = steps[e.step];
    if (!step) { await patch(`journey_enrollments?id=eq.${e.id}`, { done: true }); continue; }
    const s = await engageSettings(e.tenant_id);
    const vars = { name: e.name, company: s.name, ...(e.log?.[0]?.vars || {}) };
    const msg = fill(step.message, vars);
    const ch = str(step.channel).toLowerCase();
    let r;
    if (ch.startsWith("email")) r = e.email ? await deliverEmail(e.tenant_id, { to: e.email, subject: msg.split("\n")[0].slice(0, 120) || s.name, text: msg, html: emailHtml(s.name, md(msg)) }).catch((x) => ({ ok: false, error: x.message })) : { ok: false, error: "no email" };
    else r = e.phone ? await sendForShop({ tenantId: e.tenant_id, channel: ch.startsWith("whatsapp") ? "whatsapp" : "sms", to: e.phone, text: msg }).catch((x) => ({ ok: false, error: x.message })) : { ok: false, error: "no phone" };
    const next = steps[e.step + 1];
    await patch(`journey_enrollments?id=eq.${e.id}`, { step: e.step + 1, done: !next, next_at: new Date(Date.now() + Number(next?.wait || 0) * 86400_000).toISOString(), log: [...(e.log || []), { step: e.step, at: new Date().toISOString(), ok: !!r?.ok, error: r?.ok ? undefined : str(r?.error).slice(0, 200) }] });
  }
}

// =============================================================================
// IoT
// =============================================================================
async function iotIngest(req, body) {
  const key = str(req.headers["x-device-key"] || body.key);
  if (!/^dk_[A-Za-z0-9]{32,}$/.test(key)) throw new HttpError(401, "Missing or invalid device key");
  const dev = await one(`app_records?app=eq.iot&kind=eq.device&data->>key_hash=eq.${sha(key)}&select=id,tenant_id,title,stage,data`);
  if (!dev) throw new HttpError(401, "Unknown device key");
  const readings = Array.isArray(body.readings) ? body.readings.slice(0, 50) : [body];
  const rows = readings.map((r) => ({ tenant_id: dev.tenant_id, device_id: dev.id, metric: str(r.metric || dev.data?.metric || "value").slice(0, 60), value: Number.isFinite(Number(r.value)) ? Number(r.value) : null, unit: str(r.unit || dev.data?.unit).slice(0, 20) || null, payload: r }));
  await db("iot_readings", { method: "POST", prefer: "return=minimal", body: rows });
  const last = rows[rows.length - 1];
  const min = dev.data?.min === "" || dev.data?.min == null ? null : Number(dev.data.min);
  const max = dev.data?.max === "" || dev.data?.max == null ? null : Number(dev.data.max);
  const out = last.value !== null && ((min !== null && last.value < min) || (max !== null && last.value > max));
  await patch(`app_records?id=eq.${dev.id}`, { stage: "online", data: { ...dev.data, last_value: last.value, last_unit: last.unit, last_seen: new Date().toISOString(), alarm: out || undefined } });
  if (out && !dev.data?.alarm) {
    const text = `${dev.title}: ${last.metric} is ${last.value}${last.unit ? ` ${last.unit}` : ""} (allowed ${min ?? "-∞"} to ${max ?? "∞"}).`;
    await notify(dev.tenant_id, `Device alert: ${dev.title}`, text, `/apps/iot/device/${dev.id}`, "iot");
    if (dev.data?.alert_phone) await sendForShop({ tenantId: dev.tenant_id, channel: "sms", to: dev.data.alert_phone, text: `ALERT ${text}` }).catch(() => {});
  }
  return { ok: true, stored: rows.length, alarm: !!out };
}
async function iotOfflineTick() {
  const cut = new Date(Date.now() - 15 * 60_000).toISOString();
  const stale = await db(`app_records?app=eq.iot&kind=eq.device&stage=eq.online&data->>last_seen=lt.${cut}&select=id,tenant_id,title&limit=500`);
  for (const d of stale) {
    await patch(`app_records?id=eq.${d.id}`, { stage: "offline" });
    await notify(d.tenant_id, `Device offline: ${d.title}`, "No reading for 15 minutes.", `/apps/iot/device/${d.id}`, "iot");
  }
}

// =============================================================================
// eLearning
// =============================================================================
async function learnerByToken(k) {
  if (!/^[a-f0-9]{40}$/.test(str(k))) throw new HttpError(404, "This learning link is not valid");
  const en = await one(`app_records?app=eq.elearning&kind=eq.enrollment&data->>link_hash=eq.${sha(k)}&select=*`);
  if (!en) throw new HttpError(404, "This learning link is not valid");
  const course = await one(`app_records?id=eq.${en.parent_id}&select=id,title,data,tenant_id`);
  if (!course) throw new HttpError(404, "Course not found");
  return { en, course };
}

// =============================================================================
// Routes
// =============================================================================
const PUBLIC = new Set(["/chat.js", "/api/pub/chat/config", "/api/pub/chat/start", "/api/pub/chat/send", "/api/pub/chat/poll", "/api/pub/book/info", "/api/pub/book/slots", "/api/pub/book",
  "/api/pub/events", "/api/pub/events/register", "/api/pub/learn", "/api/pub/learn/progress", "/api/iot/ingest"]);
export const isEngageRoute = (p) => PUBLIC.has(p) || p.startsWith("/api/m/o/") || p.startsWith("/api/m/u/");

/** Public routes. slugFromHost(req) gives the company of the address (subdomain or own domain). */
export async function handleEngageRequest(req, res, pathname, search, body, sendJson, slugFromHost) {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-device-key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  const q = new URLSearchParams(search || "");
  try {
    if (pathname === "/api/iot/ingest") { limit(req, "iot", 600); return sendJson(res, 200, await iotIngest(req, body || {})); }
    if (pathname.startsWith("/api/m/o/")) {
      const token = pathname.slice(9).replace(/\.gif$/, "");
      if (/^[a-f0-9]{36}$/.test(token)) {
        const s = await one(`marketing_sends?token=eq.${token}&select=id,open_count,opened_at`);
        if (s) await patch(`marketing_sends?id=eq.${s.id}`, { open_count: Number(s.open_count) + 1, opened_at: s.opened_at || new Date().toISOString() }).catch(() => {});
      }
      res.writeHead(200, { "Content-Type": "image/gif", "Cache-Control": "no-store" });
      return res.end(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
    }
    if (pathname.startsWith("/api/m/u/")) {
      const token = pathname.slice(9);
      let msg = "This link is not valid.";
      if (/^[a-f0-9]{36}$/.test(token)) {
        const s = await one(`marketing_sends?token=eq.${token}&select=tenant_id,email`);
        if (s) {
          await db("marketing_unsubscribes?on_conflict=tenant_id,email", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: { tenant_id: s.tenant_id, email: s.email } });
          const t = await one(`tenants?id=eq.${s.tenant_id}&select=business_name`);
          msg = `${esc(s.email)} will not receive marketing emails from ${esc(t?.business_name || "this company")} again.`;
        }
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title><body style="font-family:Arial,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f6f6f7"><div style="background:#fff;padding:32px;border-radius:18px;max-width:420px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.08)"><h1 style="font-size:22px">You're unsubscribed</h1><p style="color:#555">${msg}</p></div></body>`);
    }

    const slug = str(q.get("c") || body?.c) || (await slugFromHost(req));
    const co = await companyBySlug(slug);
    if (!co) throw new HttpError(404, "Company not found");
    const st = await engageSettings(co.id);

    if (pathname === "/chat.js") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" });
      return res.end(chatWidgetJs(co.slug, origin(co.slug)));
    }
    if (pathname.startsWith("/api/pub/chat/")) {
      limit(req, "chat", 60);
      const chat = st.e.chat || {};
      const on = chat.enabled && (await moduleOn(co.id, "live_chat"));
      if (pathname === "/api/pub/chat/config") return sendJson(res, 200, on ? { enabled: true, title: chat.title || `Chat with ${co.business_name}`, greeting: chat.greeting || "Hi! Leave your name and question and we'll answer right here.", color: /^#[0-9a-f]{6}$/i.test(chat.color || "") ? chat.color : "#a8121b" } : { enabled: false });
      if (!on) throw new HttpError(403, "Chat is not available");
      if (pathname === "/api/pub/chat/start") {
        limit(req, "chat-start", 5, 600_000);
        const name = str(body.name).slice(0, 80); const message = str(body.message).slice(0, 2000);
        if (!name || !message) throw new HttpError(400, "Enter your name and a message");
        const token = randomBytes(24).toString("hex");
        const cust = await findOrCreateCustomer(co.id, { name, phone: body.phone, email: body.email });
        const conv = await insert("app_records", { tenant_id: co.id, app: "live_chat", kind: "conversation", title: name, stage: "waiting", customer_id: cust?.id || null,
          data: { channel: "Website", visitor_hash: sha(token), phone: str(body.phone).slice(0, 30), email: str(body.email).slice(0, 120), page: str(req.headers.referer).slice(0, 300) } });
        await addEvent(co.id, conv.id, message, { from: "visitor", name });
        await notify(co.id, `New website chat from ${name}`, message.slice(0, 200), `/apps/live_chat/conversation/${conv.id}`, "chat");
        return sendJson(res, 200, { token });
      }
      const conv = await chatConversation(co.id, body.token);
      if (!conv) return sendJson(res, 200, { error: "Chat ended", reset: true });
      if (pathname === "/api/pub/chat/send") {
        const message = str(body.message).slice(0, 2000);
        if (!message) throw new HttpError(400, "Type a message");
        await addEvent(co.id, conv.id, message, { from: "visitor", name: conv.title });
        if (conv.stage === "closed") await patch(`app_records?id=eq.${conv.id}`, { stage: "waiting" });
        return sendJson(res, 200, { ok: true });
      }
      if (pathname === "/api/pub/chat/poll") {
        const after = str(body.after);
        const rows = await db(`app_record_events?record_id=eq.${conv.id}&kind=eq.message${after && !Number.isNaN(Date.parse(after)) ? `&created_at=gt.${enc(after)}` : ""}&select=body,data,created_at&order=created_at&limit=100`);
        return sendJson(res, 200, { messages: rows.map((m) => ({ from: m.data?.from === "agent" ? "agent" : "visitor", body: m.body, at: m.created_at })), closed: conv.stage === "closed" });
      }
    }

    if (pathname.startsWith("/api/pub/book")) {
      limit(req, "book", 40);
      const cfg = bookingCfg(st.e);
      if (!cfg.enabled || !(await moduleOn(co.id, "appointments"))) throw new HttpError(403, "Online booking is not open");
      const types = await db(`app_records?tenant_id=eq.${co.id}&app=eq.appointments&kind=eq.appointment_type&archived=eq.false&select=id,title,amount,data&order=title`);
      if (pathname === "/api/pub/book/info") return sendJson(res, 200, { company: co.business_name, logo: co.logo_url, phone: co.business_phone, days: cfg.days, from: cfg.from, to: cfg.to, types: types.filter((t) => t.data?.online !== false).map((t) => ({ id: t.id, name: t.title, minutes: Number(t.data?.minutes || 30), price: Number(t.amount || 0), description: t.data?.description || "" })) });
      const type = types.find((t) => t.id === str(q.get("type") || body.type));
      if (!type) throw new HttpError(404, "Choose a service");
      if (pathname === "/api/pub/book/slots") return sendJson(res, 200, { slots: await freeSlots(co.id, cfg, type, str(q.get("date"))) });
      if (pathname === "/api/pub/book") {
        limit(req, "book-make", 5, 600_000);
        const name = str(body.name).slice(0, 80); const ph = phone254(body.phone);
        if (!name || !/^254[17]\d{8}$/.test(ph)) throw new HttpError(400, "Enter your name and a valid phone number");
        const start = str(body.start);
        const free = await freeSlots(co.id, cfg, type, new Date(Date.parse(start) + cfg.tz * 60_000).toISOString().slice(0, 10));
        if (!free.includes(start)) throw new HttpError(409, "That time was just taken. Pick another.");
        const minutes = Number(type.data?.minutes || 30);
        const cust = await findOrCreateCustomer(co.id, { name, phone: ph, email: body.email });
        const rec = await insert("app_records", { tenant_id: co.id, app: "appointments", kind: "booking", title: `${type.title}: ${name}`, stage: "booked", customer_id: cust?.id || null,
          starts_at: start, ends_at: new Date(Date.parse(start) + minutes * 60_000).toISOString(), amount: type.amount || null, data: { _prefix: "APT-", type: type.id, phone: `0${ph.slice(3)}`, email: str(body.email), notes: str(body.note).slice(0, 1000), source: "Online booking" } });
        const number = rec.number;
        const when = new Date(Date.parse(start) + cfg.tz * 60_000).toISOString().replace("T", " ").slice(0, 16);
        if (cfg.sms) await sendForShop({ tenantId: co.id, channel: "sms", to: ph, text: `${co.business_name}: your ${type.title} is booked for ${when} (ref ${number}). Call ${co.business_phone || "us"} to change it.` }).catch(() => {});
        await notify(co.id, `New online booking ${number}`, `${name} · ${type.title} · ${when}`, `/apps/appointments/booking/${rec.id}`, "booking");
        return sendJson(res, 200, { ok: true, number, when });
      }
    }

    if (pathname.startsWith("/api/pub/events")) {
      limit(req, "events", 40);
      if (!(st.e.events?.enabled) || !(await moduleOn(co.id, "events"))) throw new HttpError(403, "Event registration is not open");
      if (pathname === "/api/pub/events") {
        const evs = await db(`app_records?tenant_id=eq.${co.id}&app=eq.events&kind=eq.event&stage=eq.published&archived=eq.false&or=(starts_at.is.null,starts_at.gte.${new Date(Date.now() - 86400_000).toISOString()})&select=id,number,title,starts_at,ends_at,amount,quantity,data&order=starts_at`);
        const regs = evs.length ? await db(`app_records?tenant_id=eq.${co.id}&app=eq.events&kind=eq.registration&parent_id=in.(${evs.map((e) => e.id).join(",")})&stage=neq.cancelled&select=parent_id`) : [];
        return sendJson(res, 200, { company: co.business_name, logo: co.logo_url, events: evs.map((e) => ({ id: e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, venue: e.data?.venue || "", price: Number(e.amount || 0), description: e.data?.description || "", seats_left: e.quantity ? Math.max(0, Number(e.quantity) - regs.filter((r) => r.parent_id === e.id).length) : null })) });
      }
      if (pathname === "/api/pub/events/register") {
        limit(req, "events-reg", 5, 600_000);
        const ev = uuidRe.test(str(body.event)) ? await one(`app_records?id=eq.${body.event}&tenant_id=eq.${co.id}&app=eq.events&kind=eq.event&stage=eq.published&select=*`) : null;
        if (!ev) throw new HttpError(404, "Event not found");
        const name = str(body.name).slice(0, 80); const ph = phone254(body.phone);
        if (!name || !/^254[17]\d{8}$/.test(ph)) throw new HttpError(400, "Enter your name and a valid phone number");
        if (ev.quantity) {
          const taken = (await db(`app_records?parent_id=eq.${ev.id}&kind=eq.registration&stage=neq.cancelled&select=id`)).length;
          if (taken >= Number(ev.quantity)) throw new HttpError(409, "This event is full");
        }
        const cust = await findOrCreateCustomer(co.id, { name, phone: ph, email: body.email });
        const price = Number(ev.amount || 0);
        const reg = await insert("app_records", { tenant_id: co.id, app: "events", kind: "registration", title: name, stage: price > 0 ? "registered" : "paid", parent_id: ev.id, customer_id: cust?.id || null, amount: price > 0 ? 0 : null,
          data: { _prefix: "TIX-", phone: `0${ph.slice(3)}`, email: str(body.email), source: "Online" } });
        const number = reg.number;
        let invoice = null; let pay = null;
        if (price > 0) {
          const invNo = await db("rpc/next_doc_number", { method: "POST", body: { p_kind: "invoice", p_tenant: co.id } }).catch(() => null);
          invoice = await insert("invoices", { tenant_id: co.id, invoice_number: invNo || `INV-${Date.now().toString(36).toUpperCase()}`, customer_id: cust?.id || null, customer_name: name, customer_phone: `0${ph.slice(3)}`, customer_email: str(body.email) || null,
            items: [{ name: `Ticket: ${ev.title}`, description: number, quantity: 1, rate: price, price, amount: price, tax_rate: 0 }], subtotal: price, tax: 0, discount: 0, total: price, status: "sent", source: "event",
            issue_date: new Date().toISOString().slice(0, 10), due_date: new Date().toISOString().slice(0, 10), notes: `Ticket ${number} for ${ev.title}` });
          pay = await pushInvoiceForShop(co.id, invoice.id, ph, price, "portal").catch((e) => ({ error: e.message }));
        }
        if (invoice) await patch(`app_records?id=eq.${reg.id}`, { data: { ...reg.data, invoice_id: invoice.id, invoice_number: invoice.invoice_number } });
        if (!price) await sendForShop({ tenantId: co.id, channel: "sms", to: ph, text: `${co.business_name}: you're registered for ${ev.title} (ticket ${number}). See you there!` }).catch(() => {});
        return sendJson(res, 200, { ok: true, ticket: number, price, invoice: invoice?.invoice_number || null, prompt: pay ? (pay.error ? { error: pay.error } : { sent: true }) : null });
      }
    }

    if (pathname === "/api/pub/learn" || pathname === "/api/pub/learn/progress") {
      limit(req, "learn", 60);
      const { en, course } = await learnerByToken(q.get("k") || body.k);
      const lessons = Array.isArray(course.data?.lessons) ? course.data.lessons : [];
      const done = new Set(Array.isArray(en.data?.done) ? en.data.done : []);
      if (pathname === "/api/pub/learn/progress") {
        const i = Number(body.lesson);
        const l = lessons[i];
        if (!l) throw new HttpError(404, "Lesson not found");
        if (str(l.answer) && str(body.answer).toLowerCase() !== str(l.answer).toLowerCase()) return sendJson(res, 200, { ok: false, error: "Not quite. Try again." });
        done.add(i);
        const pct = lessons.length ? Math.round((done.size / lessons.length) * 100) : 100;
        await patch(`app_records?id=eq.${en.id}`, { quantity: pct, stage: pct >= 100 ? "completed" : "in_progress", data: { ...en.data, done: [...done], last_at: new Date().toISOString() } });
        return sendJson(res, 200, { ok: true, progress: pct });
      }
      return sendJson(res, 200, { company: co.business_name, course: { title: course.title, description: course.data?.description || "" }, learner: en.title,
        lessons: lessons.map((l, i) => ({ i, title: l.title, minutes: Number(l.minutes || 0), link: l.link || "", body: l.body || "", question: l.question || "", done: done.has(i) })),
        progress: Number(en.quantity || 0) });
    }
    throw new HttpError(404, "Not found");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("[engage]", pathname, e);
    return sendJson(res, status, { error: status === 500 ? "Something went wrong" : e.message });
  }
}

// ---- staff routes (POST /api/erp/engage/*) -------------------------------------
const mgr = (who) => { if (!who.owner && !who.manager) throw new HttpError(403, "Only admins and managers can do this"); };
async function recordFor(who, id, app, kind) {
  if (!uuidRe.test(str(id))) throw new HttpError(400, "Invalid record");
  const r = await one(`app_records?id=eq.${id}&tenant_id=eq.${who.tenantId}&app=eq.${app}${kind ? `&kind=eq.${kind}` : ""}&select=*`);
  if (!r) throw new HttpError(404, "Record not found");
  return r;
}
export const engageRoutes = {
  "/api/erp/engage/ticket-reply": async (who, b) => {
    const t = await recordFor(who, b.id, "helpdesk", "ticket");
    const to = str(t.data?.from_email) || (t.customer_id ? str((await one(`customers?id=eq.${t.customer_id}&select=email`))?.email) : "");
    if (!to) throw new HttpError(400, "This ticket has no email address to reply to");
    const text = str(b.body);
    if (!text) throw new HttpError(400, "Write a reply");
    const s = await engageSettings(who.tenantId);
    const r = await deliverEmail(who.tenantId, { to, subject: `[${t.number}] ${t.title.replace(/^\[TKT-\d+\]\s*/i, "")}`, text: `${text}\n\n${s.name}`, html: emailHtml(s.name, md(text)), replyTo: s.e.helpdesk?.imap_user || undefined });
    if (!r.ok) throw new HttpError(502, `Not sent: ${r.error}`);
    await addEvent(who.tenantId, t.id, text, { from: "agent", channel: "email", to, user_id: who.user.id });
    if (b.stage && ["in_progress", "waiting", "resolved"].includes(b.stage)) await patch(`app_records?id=eq.${t.id}`, { stage: b.stage, updated_at: new Date().toISOString() });
    return { ok: true };
  },
  "/api/erp/engage/helpdesk-test": async (who) => {
    mgr(who);
    const s = await engageSettings(who.tenantId);
    const r = await intakeForTenant(who.tenantId, { ...(s.e.helpdesk || {}), auto_ack: s.e.helpdesk?.auto_ack });
    if (r.skipped) throw new HttpError(400, "Fill in the mailbox server, address and password first.");
    return r;
  },
  "/api/erp/engage/chat-reply": async (who, b) => {
    const c = await recordFor(who, b.id, "live_chat", "conversation");
    const text = str(b.body).slice(0, 2000);
    if (!text) throw new HttpError(400, "Type a message");
    const name = str((await one(`profiles?user_id=eq.${who.user.id}&select=display_name`))?.display_name) || "Agent";
    await addEvent(who.tenantId, c.id, text, { from: "agent", name, user_id: who.user.id });
    if (c.stage === "waiting") await patch(`app_records?id=eq.${c.id}`, { stage: "active", assigned_to: c.assigned_to || who.user.id });
    return { ok: true };
  },
  "/api/erp/engage/campaign-send": async (who, b) => { mgr(who); return queueCampaign(who.tenantId, str(b.id)); },
  "/api/erp/engage/campaign-test": async (who, b) => {
    mgr(who);
    const c = await recordFor(who, b.id, "email_marketing", "campaign");
    const s = await engageSettings(who.tenantId);
    const to = str(b.to) || who.user.email;
    const r = await deliverEmail(who.tenantId, { to, subject: `[Test] ${c.title}`, html: emailHtml(s.name, md(str(c.data?.body).replace(/\{name\}/g, "Customer"))), text: str(c.data?.body) });
    if (!r.ok) throw new HttpError(502, `Not sent: ${r.error}`);
    return { ok: true, to };
  },
  "/api/erp/engage/campaign-stats": async (who, b) => {
    const c = await recordFor(who, b.id, "email_marketing", "campaign");
    const rows = await db(`marketing_sends?campaign_id=eq.${c.id}&select=status,opened_at&limit=50000`);
    return { total: rows.length, sent: rows.filter((r) => r.status === "sent").length, failed: rows.filter((r) => r.status === "failed").length, queued: rows.filter((r) => r.status === "queued").length, opened: rows.filter((r) => r.opened_at).length };
  },
  "/api/erp/engage/social-publish": async (who, b) => { mgr(who); return { log: await publishPost(who.tenantId, await recordFor(who, b.id, "social", "post")) }; },
  "/api/erp/engage/iot-key": async (who, b) => {
    mgr(who);
    const d = await recordFor(who, b.id, "iot", "device");
    const key = `dk_${randomBytes(24).toString("hex")}`;
    await patch(`app_records?id=eq.${d.id}`, { data: { ...d.data, key_hash: sha(key), key_hint: `${key.slice(0, 7)}…${key.slice(-4)}` } });
    return { key, endpoint: `https://app.${ROOT_HOST}/api/iot/ingest` };
  },
  "/api/erp/engage/iot-readings": async (who, b) => {
    const d = await recordFor(who, b.id, "iot", "device");
    return { readings: await db(`iot_readings?device_id=eq.${d.id}&select=metric,value,unit,created_at&order=created_at.desc&limit=200`) };
  },
  "/api/erp/engage/learn-link": async (who, b) => {
    const en = await recordFor(who, b.id, "elearning", "enrollment");
    const k = randomBytes(20).toString("hex");
    await patch(`app_records?id=eq.${en.id}`, { data: { ...en.data, link_hash: sha(k) } });
    const t = await one(`tenants?id=eq.${who.tenantId}&select=slug`);
    const url = `${origin(t.slug)}/learn?k=${k}`;
    if (b.sms && en.data?.phone) await sendForShop({ tenantId: who.tenantId, channel: "sms", to: en.data.phone, text: `Your course is ready: ${url}` }).catch(() => {});
    return { url };
  },
  "/api/erp/engage/settings-secret": async (who, b) => {
    mgr(who);
    const allowed = ["helpdesk_imap_password", "social_fb_page_token", "social_linkedin_token", "social_x_token"];
    const name = str(b.name);
    if (!allowed.includes(name)) throw new HttpError(400, "Unknown setting");
    await db(`integration_secrets?tenant_id=eq.${who.tenantId}&name=eq.${name}`, { method: "DELETE", prefer: "return=minimal" });
    if (str(b.value)) await db("integration_secrets", { method: "POST", prefer: "return=minimal", body: { tenant_id: who.tenantId, name, value: str(b.value), updated_at: new Date().toISOString() } });
    return { ok: true };
  },
};
/** One-time sign-in code (hashed magic-link token) for the signed-in person. */
async function signInCode(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: "POST", signal: AbortSignal.timeout(15000), headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "magiclink", email }) });
  const j = await r.json().catch(() => ({}));
  const th = j.hashed_token || j.properties?.hashed_token;
  if (!r.ok || !th) throw new HttpError(502, "Could not open it. Try again.");
  return th;
}
// Moving between company addresses: each address gets a session of its own
// (sharing one refresh token between addresses would sign both out).
engageRoutes["/api/erp/session/handoff"] = async (who) => {
  if (!who.user.email) throw new HttpError(400, "Your login has no email address");
  return { th: await signInCode(who.user.email) };
};
// Linked logins: open a company of another login of the same person (linked by the
// platform owner or by proving its password), signed in as that login.
engageRoutes["/api/erp/session/switch-account"] = async (who, b) => {
  const target = str(b.user_id); const tenant = str(b.tenant_id);
  if (!/^[0-9a-f-]{36}$/i.test(target) || !/^[0-9a-f-]{36}$/i.test(tenant)) throw new HttpError(400, "Choose a company");
  const [a, z] = [who.user.id, target].sort();
  if (!(await one(`account_links?user_a=eq.${a}&user_b=eq.${z}&select=id`))) throw new HttpError(403, "That login is not linked to yours");
  const slugRes = await db("rpc/switch_company_for", { method: "POST", body: { p_user: target, p_tenant: tenant } });
  const u = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${target}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }, signal: AbortSignal.timeout(15000) }).then((r) => r.json()).catch(() => ({}));
  if (!u?.email) throw new HttpError(400, "That login has no email address");
  return { th: await signInCode(u.email), slug: typeof slugRes === "string" ? slugRes : str(slugRes) };
};
const linkTries = new Map();
engageRoutes["/api/erp/session/link-login"] = async (who, b) => {
  const now = Date.now(); const tries = (linkTries.get(who.user.id) || []).filter((t) => now - t < 15 * 60_000);
  if (tries.length >= 5) throw new HttpError(429, "Too many tries. Wait 15 minutes and try again.");
  tries.push(now); linkTries.set(who.user.id, tries);
  const email = str(b.email).toLowerCase(); const password = String(b.password || "");
  if (!email || !password) throw new HttpError(400, "Enter the other login's email and password");
  if (email === str(who.user.email).toLowerCase()) throw new HttpError(400, "That is the login you are using now");
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anon, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.user?.id) throw new HttpError(400, "That email and password did not match a JMSURF Garage login");
  // The check opened a session for the other login: end it straight away.
  await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: anon, Authorization: `Bearer ${j.access_token}` } }).catch(() => {});
  const [a, z] = [who.user.id, j.user.id].sort();
  await db("account_links?on_conflict=user_a,user_b", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: { user_a: a, user_b: z, created_by: who.user.id } });
  return { ok: true, email };
};
// JMSURF CALL CENTRE (app.jmsurfcallcentre.co.ke): a one-time sign-in code that opens
// a session of its own there, so DASH keeps its session.
engageRoutes["/api/erp/callcentre/handoff"] = async (who, b) => {
  // The call centre has its own sign-up and billing: anyone may open it (it starts a free trial).
  if (!who.user.email) throw new HttpError(400, "Your login has no email address");
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: "POST", signal: AbortSignal.timeout(15000), headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "magiclink", email: who.user.email }) });
  const j = await r.json().catch(() => ({}));
  const th = j.hashed_token || j.properties?.hashed_token;
  if (!r.ok || !th) throw new HttpError(502, "Could not open the Call Centre. Try again.");
  const next = str(b.next).startsWith("/") ? str(b.next).slice(0, 200) : "/";
  return { url: `https://app.jmsurfcallcentre.co.ke/auth/handoff#th=${encodeURIComponent(th)}&next=${encodeURIComponent(next)}` };
};
export { HttpError as EngageError };

/**
 * Repairs: text the customer once when a job becomes "Ready for collection".
 * Front desk: tell the host (bell + SMS) once when their visitor signs in.
 */
async function workshopTick() {
  const since = encodeURIComponent(new Date(Date.now() - 2 * 864e5).toISOString());
  const ready = await db(`app_records?app=eq.repairs&stage=eq.ready&updated_at=gte.${since}&data->>ready_sms_at=is.null&select=id,tenant_id,number,title,amount,customer_id,data&limit=50`).catch(() => []);
  for (const r of ready) {
    const d = r.data || {};
    const [cust, t] = await Promise.all([
      r.customer_id ? one(`customers?id=eq.${r.customer_id}&select=name,phone`).catch(() => null) : null,
      one(`tenants?id=eq.${r.tenant_id}&select=business_name,business_phone`).catch(() => null),
    ]);
    const phone = str(d.phone) || str(cust?.phone);
    let result = { ok: false, error: "no phone number" };
    if (phone) {
      const balance = Math.max(0, Number(r.amount || 0) - Number(d.deposit || 0));
      const item = [str(d.item_type), str(d.brand_model)].filter(Boolean).join(" ") || "item";
      const text = `Hi ${str(cust?.name).split(" ")[0] || "there"}, your ${item} (job ${r.number || ""}) is ready for collection at ${t?.business_name || "our shop"}.${balance ? ` Balance: KES ${Math.round(balance).toLocaleString("en-KE")}.` : ""}${t?.business_phone ? ` Call ${t.business_phone}.` : ""}`;
      result = await sendForShop({ tenantId: r.tenant_id, channel: "sms", to: phone, text, reference: `repair-${r.id}` }).catch((e) => ({ ok: false, error: e.message }));
    }
    await patch(`app_records?id=eq.${r.id}`, { data: { ...d, ready_sms_at: new Date().toISOString(), ready_sms: result.ok ? "sent" : str(result.error).slice(0, 120) } }).catch(() => {});
  }
  const visits = await db(`app_records?app=eq.frontdesk&stage=eq.signed_in&updated_at=gte.${since}&data->>host_told_at=is.null&select=id,tenant_id,title,employee_id,data&limit=50`).catch(() => []);
  for (const v of visits) {
    const d = v.data || {};
    const host = v.employee_id ? await one(`hr_employees?id=eq.${v.employee_id}&select=user_id,first_name,phone`).catch(() => null) : null;
    const who = [v.title, str(d.company) && `(${str(d.company)})`].filter(Boolean).join(" ");
    if (host?.user_id) await insert("shop_notifications", { tenant_id: v.tenant_id, user_id: host.user_id, kind: "visitor", title: `${who} is at reception to see you`, body: str(d.purpose) || "Visitor signed in", link: "/apps/frontdesk", sent_at: new Date().toISOString() }).catch(() => {});
    if (host?.phone) await sendForShop({ tenantId: v.tenant_id, channel: "sms", to: host.phone, text: `${who} is at reception to see you${str(d.purpose) ? ` (${str(d.purpose)})` : ""}.`, reference: `visit-${v.id}` }).catch(() => {});
    await patch(`app_records?id=eq.${v.id}`, { data: { ...d, host_told_at: new Date().toISOString() } }).catch(() => {});
  }
}

export function startEngageJobs(deliver, base = `https://app.${ROOT_HOST}`) {
  if (deliver) deliverEmail = deliver;
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  const every = (ms, name, fn) => { setTimeout(() => void fn().catch((e) => console.error(`[${name}]`, e.message)), 30_000 + Math.random() * 30_000); setInterval(() => void fn().catch((e) => console.error(`[${name}]`, e.message)), ms); };
  every(2 * 60_000, "helpdesk", helpdeskTick);
  every(2 * 60_000, "workshop", workshopTick);
  every(60_000, "campaign", () => campaignTick(base));
  every(60_000, "social", socialTick);
  every(10 * 60_000, "journey", journeyTick);
  every(5 * 60_000, "iot", iotOfflineTick);
  every(30 * 60_000, "booking", bookingReminderTick);
}
