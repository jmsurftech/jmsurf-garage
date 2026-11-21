// ---------------------------------------------------------------------------
// JMSURF Garage server area: workshop. Mounted by garage.js under /api/garage/w/.
// handle(req, res, subpath, { sendJson, readJsonBody }) answers one request; startJobs() starts background jobs.
//
// Reaches the database with the service key, always scoped to one company:
//   staff routes  → the company of the signed-in user (Authorization: Bearer <session>)
//   public routes → the company that owns the token / booking slug (nothing else is returned)
//
// Staff (POST, signed in):
//   send-estimate     { estimate_id, channel? }            SMS/WhatsApp the approval link /e/<token>
//   send-job          { job_id, kind: tag|ready|custom, channel?, text? }  job tag / ready message with /t/<token>
//   booking-confirm   { booking_id, channel? }             booking confirmation
//   deposit-stk       { invoice_id, phone, amount? }       M-Pesa prompt for a deposit / job invoice
//   stk-status        { request_id }
//   reminders/preview                                      what is due today (no sending)
//   reminders/run                                          send what is due now for this company
//   reminders/test    { kind, phone, lang? }               send one sample to a phone
// Public (POST, no sign-in):
//   pub/estimate          { token }                        the estimate to approve
//   pub/estimate/respond  { token, decisions: {line_id: approved|declined}, note? }
//   pub/track             { token }                        job tracking: status, photos, invoices, pay links
//   pub/track/rate        { token, rating, mechanic_rating?, comment? }
//   pub/book/info         { slug }                         garage + services + taken slots
//   pub/book              { slug, name, phone, plate, vehicle_desc?, service?, starts_at, notes? }
//
// Background (every 15 minutes): booking reminders (day before), service due by date or mileage,
// insurance / inspection / speed governor / PSV expiry and win-back. One message per due item
// (garage_reminder_log), consent respected (customers.garage_reminders_ok / garage_offers_ok /
// reminders_stopped), settings per company in garage_settings.reminders.
// The due rules match src/garage/workshop/lib/reminders.ts (unit tested there); keep them in step.
// ---------------------------------------------------------------------------
import { sendForShop } from "./messaging.js";
import { smsBase } from "./hosts.js";
import { pushInvoiceForShop, invoicePromptStatus } from "./sendmoney.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DAY = 86_400_000;
const NAIROBI = 3 * 3600_000;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

async function db(path, { method = "GET", body, prefer = "return=representation" } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(15000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const e = new HttpError(res.status >= 500 ? 500 : 400, data?.code === "P0001" && data?.message ? data.message : `Database error (${res.status})`);
    e.code = data?.code;
    if (res.status >= 500 || data?.code !== "P0001") console.error("[garage-w] db", path.split("?")[0], res.status, str(data?.message).slice(0, 200));
    throw e;
  }
  return data;
}
const rows = async (path) => { const d = await db(path); return Array.isArray(d) ? d : []; };
const one = async (path) => (await rows(path))[0] || null;

/** Signed link (1 hour) to a file in the documents bucket. */
async function signedUrl(path) {
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documents/${path.split("/").map(enc).join("/")}`, {
      method: "POST", signal: AbortSignal.timeout(10000),
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    const d = await r.json().catch(() => null);
    const u = d?.signedURL || d?.signedUrl;
    return u ? `${SUPABASE_URL}/storage/v1${u.startsWith("/") ? u : `/${u}`}` : null;
  } catch { return null; }
}

// --- who is calling ------------------------------------------------------------

async function staff(req) {
  const auth = str(req.headers["authorization"]);
  if (!auth.startsWith("Bearer ")) throw new HttpError(401, "Sign in first");
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON_KEY }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) throw new HttpError(401, "Sign in first");
  const user = await r.json().catch(() => null);
  if (!user?.id) throw new HttpError(401, "Sign in first");
  const profile = await one(`profiles?user_id=eq.${enc(user.id)}&select=tenant_id,display_name&limit=1`);
  if (!profile?.tenant_id) throw new HttpError(403, "No company on this account");
  return { userId: user.id, tenantId: profile.tenant_id, name: profile.display_name || "" };
}

// Simple per-key rate limit for the public routes.
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 20000) hits.clear();
  return list.length > max;
}
const ipOf = (req) => str(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress).split(",")[0].trim();

// --- company, texts ---------------------------------------------------------------

async function garage(tenantId) {
  const [t, s] = await Promise.all([
    one(`tenants?id=eq.${enc(tenantId)}&select=id,slug,business_name,business_phone,contact_phone,logo_url`),
    one(`garage_settings?tenant_id=eq.${enc(tenantId)}&select=*`),
  ]);
  return { tenant: t, settings: s || {} };
}
const garageName = (t) => str(t?.business_name) || "the garage";
const garagePhone = (t) => str(t?.business_phone || t?.contact_phone);
/** A customer link for SMS/WhatsApp (token or slug in the path): the company's own domain, else app.jmsurfgarage.co.ke, without https://. */
const publicLink = async (tenantId, path) => `${await smsBase(tenantId)}${path}`;
const fmtDate = (iso, withTime = false) => new Date(iso).toLocaleString("en-GB", {
  day: "numeric", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : { year: "numeric" }), timeZone: "Africa/Nairobi",
});
const formatPlate = (p) => { const m = str(p).match(/^([A-Z]+)(\d+)([A-Z]*)$/); return m ? `${m[1]} ${m[2]}${m[3]}` : str(p); };
const render = (template, vars) => String(template || "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] === null || vars[k] === undefined ? "" : String(vars[k]))).replace(/[ \t]{2,}/g, " ").trim();

// --- reminders settings (same defaults as src/garage/workshop/lib/reminders.ts) ------

const DEFAULT_KINDS = {
  service: { on: true, lead_days: 7, text_en: "Hi {name}, {plate} is due for service on {date}. Book at {garage}: {link} or call {phone}.", text_sw: "Habari {name}, {plate} inahitaji service tarehe {date}. Weka nafasi {garage}: {link} au piga {phone}." },
  insurance: { on: true, lead_days: 14, text_en: "Hi {name}, the insurance for {plate} expires on {date}. Renew in time to stay covered. {garage} {phone}", text_sw: "Habari {name}, bima ya {plate} inaisha tarehe {date}. Lipia mapema. {garage} {phone}" },
  inspection: { on: true, lead_days: 14, text_en: "Hi {name}, the inspection for {plate} expires on {date}. We can prepare it for you: {link} {garage}", text_sw: "Habari {name}, ukaguzi wa {plate} unaisha tarehe {date}. Tunaweza kuiandaa: {link} {garage}" },
  speed_governor: { on: true, lead_days: 14, text_en: "Hi {name}, the speed governor certificate for {plate} expires on {date}. Call {garage} on {phone}.", text_sw: "Habari {name}, cheti cha speed governor cha {plate} kinaisha {date}. Piga {garage} {phone}." },
  psv: { on: false, lead_days: 14, text_en: "Hi {name}, the PSV licence for {plate} expires on {date}. Call {garage} on {phone}.", text_sw: "Habari {name}, leseni ya PSV ya {plate} inaisha {date}. Piga {garage} {phone}." },
  winback: { on: false, lead_days: 0, text_en: "Hi {name}, it has been a while since {plate} visited {garage}. Book a check-up: {link}", text_sw: "Habari {name}, ni muda tangu {plate} itembelee {garage}. Weka nafasi ya ukaguzi: {link}" },
  booking: { on: true, lead_days: 1, text_en: "Reminder: {plate} is booked at {garage} on {date}. To change it call {phone}.", text_sw: "Kumbusho: {plate} imewekwa {garage} tarehe {date}. Kubadilisha piga {phone}." },
};
function reminderSettings(saved) {
  const s = saved && typeof saved === "object" ? saved : {};
  const kinds = {};
  for (const k of Object.keys(DEFAULT_KINDS)) kinds[k] = { ...DEFAULT_KINDS[k], ...(s.kinds?.[k] || {}) };
  return { enabled: false, channel: "sms", lang: "en", send_hour: 9, lead_km: 500, ...s, kinds, winback_months: Array.isArray(s.winback_months) ? s.winback_months : [6, 12] };
}

const nairobiDay = (ms) => Math.floor((ms + NAIROBI) / DAY);
const dayOf = (v) => nairobiDay(Date.parse(String(v).length === 10 ? `${v}T00:00:00+03:00` : v));
const isoDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);

function estimatedMileage(v, now) {
  if (v.mileage === null || v.mileage === undefined) return null;
  if (!v.km_per_day || !v.mileage_at) return Number(v.mileage);
  return Math.round(Number(v.mileage) + Math.max(0, (now - Date.parse(v.mileage_at)) / DAY) * Number(v.km_per_day));
}

/** Same rules as dueItems() in lib/reminders.ts. */
function dueItems(v, cfg, now) {
  const today = nairobiDay(now);
  const out = [];
  const k = cfg.kinds;
  if (k.service?.on) {
    let hit = null;
    if (v.next_service_date) {
      const d = dayOf(v.next_service_date);
      if (today >= d - (Number(k.service.lead_days) || 0) && today <= d + 7) hit = { kind: "service", due: v.next_service_date.slice(0, 10), key: `service:${v.id}:${v.next_service_date.slice(0, 10)}` };
    }
    if (!hit && v.next_service_km) {
      const est = estimatedMileage(v, now);
      if (est !== null && est >= Number(v.next_service_km) - (Number(cfg.lead_km) || 0)) hit = { kind: "service", due: `${v.next_service_km} km`, key: `service:${v.id}:km${v.next_service_km}` };
    }
    if (hit) out.push(hit);
  }
  for (const [kind, col] of [["insurance", "insurance_expiry"], ["inspection", "inspection_expiry"], ["speed_governor", "speed_governor_expiry"], ["psv", "psv_expiry"]]) {
    const val = v[col];
    if (!k[kind]?.on || !val) continue;
    const d = dayOf(val);
    if (today >= d - (Number(k[kind].lead_days) || 0) && today <= d + 7) out.push({ kind, due: val.slice(0, 10), key: `${kind}:${v.id}:${val.slice(0, 10)}` });
  }
  if (k.winback?.on && v.last_service_at) {
    const last = dayOf(v.last_service_at);
    for (const months of cfg.winback_months || []) {
      const d = new Date(Date.parse(v.last_service_at));
      d.setUTCMonth(d.getUTCMonth() + Number(months));
      const at = nairobiDay(d.getTime());
      if (today >= at && today <= at + 14) out.push({ kind: "winback", due: isoDay(at), key: `winback${months}:${v.id}:${isoDay(last)}` });
    }
  }
  return out;
}

function bookingDue(startsAt, cfg, now) {
  if (!cfg.kinds.booking?.on) return false;
  const hour = new Date(now + NAIROBI).getUTCHours();
  const lead = Math.max(1, Number(cfg.kinds.booking.lead_days) || 1);
  const start = Date.parse(startsAt);
  if (!(start > now)) return false;
  const diff = nairobiDay(start) - nairobiDay(now);
  return diff >= 1 && diff <= lead && hour >= (Number(cfg.send_hour) || 0);
}

function kmPerDay(readings) {
  const r = [...readings].sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
  if (r.length < 2) return null;
  const days = (Date.parse(r[r.length - 1].recorded_at) - Date.parse(r[0].recorded_at)) / DAY;
  const km = Number(r[r.length - 1].mileage) - Number(r[0].mileage);
  return days >= 7 && km > 0 ? km / days : null;
}

/** Claims a reminder slot (unique per company + kind + due key), so it is sent once only, even with two servers. */
async function claim(tenantId, kind, key, extra) {
  try {
    await db("garage_reminder_log", { method: "POST", prefer: "return=minimal", body: { tenant_id: tenantId, kind, due_key: key, status: "sending", ...extra } });
    return true;
  } catch (e) {
    if (e.code === "23505" || e.status === 409) return false;
    throw e;
  }
}
async function settle(tenantId, kind, key, r) {
  await db(`garage_reminder_log?tenant_id=eq.${enc(tenantId)}&kind=eq.${enc(kind)}&due_key=eq.${enc(key)}`, {
    method: "PATCH", prefer: "return=minimal",
    body: { status: r?.ok ? "sent" : r?.skipped ? "skipped" : "failed", detail: str(r?.error).slice(0, 300) || null, channel: r?.channel || null, recipient: r?.to || null },
  }).catch(() => {});
}

const EVENT_FOR = { booking: "booking_reminder", service: "service_due", insurance: "document_expiry", inspection: "document_expiry", speed_governor: "document_expiry", psv: "document_expiry", winback: "win_back" };

/** Runs reminders for one company. `dry` lists what is due without sending. */
async function runCompany(tenantId, { dry = false, now = Date.now() } = {}) {
  const { tenant, settings } = await garage(tenantId);
  if (!tenant) return { due: [] };
  const cfg = reminderSettings(settings.reminders);
  const due = [];
  const vars = { garage: garageName(tenant), phone: garagePhone(tenant), link: await publicLink(tenantId, `/book/${tenant.slug}`) };
  const text = (kind, lang, extra) => render((lang === "sw" ? cfg.kinds[kind].text_sw : cfg.kinds[kind].text_en) || DEFAULT_KINDS[kind].text_en, { ...vars, ...extra });

  // Bookings starting soon.
  const from = new Date(now).toISOString(), to = new Date(now + 3 * DAY).toISOString();
  const bookings = await rows(`garage_bookings?tenant_id=eq.${enc(tenantId)}&status=in.(pending,confirmed)&reminder_sent_at=is.null&starts_at=gte.${enc(from)}&starts_at=lt.${enc(to)}&select=id,name,phone,plate,starts_at,customer_id&limit=500`);
  for (const b of bookings) {
    if (!bookingDue(b.starts_at, cfg, now) || !str(b.phone)) continue;
    const msg = text("booking", cfg.lang, { name: str(b.name).split(" ")[0], plate: formatPlate(b.plate) || "your vehicle", date: fmtDate(b.starts_at, true) });
    due.push({ kind: "booking", key: `booking:${b.id}`, to: b.phone, text: msg, booking_id: b.id });
  }

  // Vehicles with an owner who has a phone.
  const vehicles = await rows(`garage_vehicles?tenant_id=eq.${enc(tenantId)}&customer_id=not.is.null&select=id,plate,customer_id,mileage,next_service_date,next_service_km,last_service_at,insurance_expiry,inspection_expiry,speed_governor_expiry,psv_expiry&limit=5000`);
  if (vehicles.length) {
    const ids = [...new Set(vehicles.map((v) => v.customer_id))];
    const customers = new Map();
    for (let i = 0; i < ids.length; i += 150) {
      for (const c of await rows(`customers?id=in.(${ids.slice(i, i + 150).join(",")})&select=id,name,phone,garage_reminders_ok,garage_offers_ok,reminders_stopped`)) customers.set(c.id, c);
    }
    for (const v of vehicles) {
      const c = customers.get(v.customer_id);
      if (!c || !str(c.phone) || c.reminders_stopped) continue;
      let items = dueItems(v, cfg, now);
      if (!items.length && !(v.next_service_km && v.mileage)) continue;
      if (v.next_service_km && v.mileage && !items.some((x) => x.kind === "service")) {
        const log = await rows(`garage_mileage_log?vehicle_id=eq.${v.id}&select=mileage,recorded_at&order=recorded_at.desc&limit=10`).catch(() => []);
        const kpd = kmPerDay(log);
        if (kpd) items = dueItems({ ...v, km_per_day: kpd, mileage_at: log[0]?.recorded_at }, cfg, now);
      }
      for (const it of items) {
        // Service and document reminders need reminder consent; win-back is an offer and needs offers consent.
        if (it.kind === "winback" ? !c.garage_offers_ok : c.garage_reminders_ok === false) continue;
        const date = /^\d{4}-\d{2}-\d{2}$/.test(it.due) ? fmtDate(it.due) : it.due;
        due.push({ kind: it.kind, key: it.key, to: c.phone, vehicle_id: v.id, customer_id: c.id,
          text: text(it.kind, cfg.lang, { name: str(c.name).split(" ")[0], plate: formatPlate(v.plate), date }) });
      }
    }
  }

  if (dry || !cfg.enabled) return { due, enabled: !!cfg.enabled };
  let sent = 0, failed = 0;
  for (const d of due) {
    if (!(await claim(tenantId, d.kind, d.key, { vehicle_id: d.vehicle_id || null, customer_id: d.customer_id || null, booking_id: d.booking_id || null }))) continue;
    let r;
    try { r = await sendForShop({ tenantId, channel: cfg.channel === "whatsapp" ? "whatsapp" : "sms", to: d.to, text: d.text, reference: `garage-${d.kind}`, event: EVENT_FOR[d.kind] || "manual" }); }
    catch (e) { r = { ok: false, error: e.message }; }
    await settle(tenantId, d.kind, d.key, r);
    if (d.booking_id && r?.ok) await db(`garage_bookings?id=eq.${d.booking_id}`, { method: "PATCH", prefer: "return=minimal", body: { reminder_sent_at: new Date().toISOString() } }).catch(() => {});
    if (r?.ok) sent++; else failed++;
  }
  return { due, sent, failed, enabled: true };
}

async function runAll() {
  const list = await rows(`garage_settings?select=tenant_id,reminders&limit=5000`);
  for (const s of list) {
    if (!reminderSettings(s.reminders).enabled) continue;
    try { await runCompany(s.tenant_id); } catch (e) { console.error("[garage-w] reminders failed for", s.tenant_id, e.message); }
  }
}

export function startJobs() {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await runAll(); } catch (e) { console.error("[garage-w] reminder run failed", e.message); } finally { busy = false; }
  };
  setTimeout(tick, 90_000).unref();
  setInterval(tick, 15 * 60_000).unref();
}

// --- staff routes ----------------------------------------------------------------

async function jobBits(tenantId, jobId) {
  const job = await one(`garage_jobs?id=eq.${enc(jobId)}&tenant_id=eq.${enc(tenantId)}&select=*`);
  if (!job) throw new HttpError(404, "Job not found");
  const [vehicle, customer] = await Promise.all([
    job.vehicle_id ? one(`garage_vehicles?id=eq.${job.vehicle_id}&select=plate,make,model`) : null,
    job.customer_id ? one(`customers?id=eq.${job.customer_id}&select=name,phone`) : null,
  ]);
  return { job, vehicle, customer };
}

async function staffRoute(req, res, sub, body, sendJson) {
  const me = await staff(req);
  const t = me.tenantId;
  const channel = body.channel === "whatsapp" ? "whatsapp" : "sms";

  if (sub === "send-estimate") {
    if (!UUID.test(str(body.estimate_id))) throw new HttpError(400, "Choose the estimate");
    const est = await one(`garage_estimates?id=eq.${enc(body.estimate_id)}&tenant_id=eq.${enc(t)}&select=*`);
    if (!est) throw new HttpError(404, "Estimate not found");
    const { job, vehicle, customer } = await jobBits(t, est.job_id);
    const to = str(body.phone) || str(customer?.phone);
    if (!to) throw new HttpError(400, "The customer has no phone number");
    const { tenant } = await garage(t);
    const link = await publicLink(t, `/e/${est.token}`);
    const text = str(body.text) || `${garageName(tenant)}: the ${est.kind === "extra" ? "extra work" : "estimate"} for ${formatPlate(vehicle?.plate) || job.job_no} is ready. Approve or decline each item here: ${link}`;
    const r = await sendForShop({ tenantId: t, channel, to, text, userId: me.userId, reference: `garage-estimate-${est.id}`, event: "estimate_ready" });
    if (r.ok) {
      await db(`garage_estimates?id=eq.${est.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: ["draft", "expired"].includes(est.status) ? "sent" : est.status, sent_at: new Date().toISOString(), sent_via: r.channel || channel } });
      await db("garage_job_events", { method: "POST", prefer: "return=minimal", body: { tenant_id: t, job_id: job.id, kind: "estimate_sent", note: `Estimate v${est.version} sent by ${r.channel || channel}`, by_user: me.userId, by_name: me.name } });
      if (["checked_in", "diagnosing", "in_progress", "waiting_parts"].includes(job.status)) {
        await db(`garage_jobs?id=eq.${job.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "waiting_approval" } }).catch(() => {});
      }
    }
    return sendJson(res, r.ok ? 200 : 400, { ok: !!r.ok, error: r.ok ? undefined : r.error, link: `https://${link}`, channel: r.channel });
  }

  if (sub === "send-job") {
    if (!UUID.test(str(body.job_id))) throw new HttpError(400, "Choose the job");
    const { job, vehicle, customer } = await jobBits(t, body.job_id);
    const to = str(body.phone) || str(customer?.phone);
    if (!to) throw new HttpError(400, "The customer has no phone number");
    const { tenant } = await garage(t);
    const link = await publicLink(t, `/t/${job.tracking_token}`);
    const plate = formatPlate(vehicle?.plate) || "your vehicle";
    const kind = str(body.kind) || "tag";
    const text = kind === "custom" ? str(body.text)
      : kind === "ready" ? `${garageName(tenant)}: ${plate} is ready for collection. Details and payment: ${link}`
      : `${garageName(tenant)}: we have received ${plate}, job ${job.job_no}. Follow progress here: ${link}`;
    if (!text) throw new HttpError(400, "Type the message");
    const r = await sendForShop({ tenantId: t, channel, to, text, userId: me.userId, reference: kind === "ready" ? `repair-${job.id}` : `garage-job-${job.id}`, event: kind === "ready" ? "car_ready" : kind === "tag" ? "job_checked_in" : "manual" });
    if (r.ok) {
      await db("garage_job_events", { method: "POST", prefer: "return=minimal", body: { tenant_id: t, job_id: job.id, kind: "message", note: `${kind === "ready" ? "Ready message" : kind === "tag" ? "Job tag" : "Message"} sent by ${r.channel || channel}`, by_user: me.userId, by_name: me.name } });
      if (kind === "ready") await db(`garage_jobs?id=eq.${job.id}`, { method: "PATCH", prefer: "return=minimal", body: { ready_sms_sent_at: new Date().toISOString() } }).catch(() => {});
    }
    return sendJson(res, r.ok ? 200 : 400, { ok: !!r.ok, error: r.ok ? undefined : r.error, link: `https://${link}` });
  }

  if (sub === "booking-confirm") {
    if (!UUID.test(str(body.booking_id))) throw new HttpError(400, "Choose the booking");
    const b = await one(`garage_bookings?id=eq.${enc(body.booking_id)}&tenant_id=eq.${enc(t)}&select=*`);
    if (!b) throw new HttpError(404, "Booking not found");
    if (!str(b.phone)) throw new HttpError(400, "The booking has no phone number");
    const { tenant } = await garage(t);
    const text = `${garageName(tenant)}: ${formatPlate(b.plate) || "your vehicle"} is booked for ${fmtDate(b.starts_at, true)} (ref ${b.booking_no}). To change it call ${garagePhone(tenant)}.`;
    const r = await sendForShop({ tenantId: t, channel, to: b.phone, text, userId: me.userId, reference: `garage-booking-${b.id}`, event: "booking_confirmed" });
    if (r.ok) await db(`garage_bookings?id=eq.${b.id}`, { method: "PATCH", prefer: "return=minimal", body: { confirm_sent_at: new Date().toISOString() } });
    return sendJson(res, r.ok ? 200 : 400, { ok: !!r.ok, error: r.ok ? undefined : r.error });
  }

  if (sub === "deposit-stk") {
    if (!UUID.test(str(body.invoice_id))) throw new HttpError(400, "Choose the invoice");
    let r;
    try { r = await pushInvoiceForShop(t, str(body.invoice_id), str(body.phone), Number(body.amount) || undefined, "garage"); }
    catch (e) { r = { error: e.message || "M-Pesa prompts are not available", status: 409 }; }
    if (r?.error) return sendJson(res, r.status || 400, { ok: false, error: r.error });
    return sendJson(res, 200, { ok: true, request_id: r.request_id });
  }

  if (sub === "stk-status") {
    if (!UUID.test(str(body.request_id))) throw new HttpError(400, "Unknown request");
    const s = await invoicePromptStatus(t, str(body.request_id));
    return sendJson(res, 200, { ok: true, status: s.status, receipt: s.mpesa_receipt || null });
  }

  if (sub === "reminders/preview") {
    const r = await runCompany(t, { dry: true });
    return sendJson(res, 200, { ok: true, enabled: r.enabled, due: r.due.map(({ kind, key, to, text }) => ({ kind, key, to, text })) });
  }
  if (sub === "reminders/run") {
    const r = await runCompany(t);
    if (!r.enabled) return sendJson(res, 400, { ok: false, error: "Switch reminders on first" });
    return sendJson(res, 200, { ok: true, sent: r.sent || 0, failed: r.failed || 0 });
  }
  if (sub === "reminders/test") {
    const kind = str(body.kind);
    if (!DEFAULT_KINDS[kind]) throw new HttpError(400, "Choose the reminder");
    const { tenant, settings } = await garage(t);
    const cfg = reminderSettings(settings.reminders);
    const tpl = (body.lang === "sw" ? cfg.kinds[kind].text_sw : cfg.kinds[kind].text_en) || DEFAULT_KINDS[kind].text_en;
    const text = render(tpl, { name: str(me.name).split(" ")[0], plate: "KXX 000X", date: fmtDate(new Date(Date.now() + 7 * DAY).toISOString()), garage: garageName(tenant), phone: garagePhone(tenant), link: await publicLink(t, `/book/${tenant.slug}`) });
    const r = await sendForShop({ tenantId: t, channel: cfg.channel === "whatsapp" ? "whatsapp" : "sms", to: str(body.phone), text, userId: me.userId, reference: "garage-test", event: "test" });
    return sendJson(res, r.ok ? 200 : 400, { ok: !!r.ok, error: r.ok ? undefined : r.error, text });
  }

  return sendJson(res, 404, { error: "Not found" });
}

// --- public routes -----------------------------------------------------------------

async function estimateByToken(token) {
  if (!TOKEN.test(str(token))) throw new HttpError(404, "This link is not valid");
  const est = await one(`garage_estimates?token=eq.${enc(token)}&select=*`);
  if (!est || est.status === "draft" || est.status === "superseded") throw new HttpError(404, "This estimate is not available. Ask the garage for a new link.");
  return est;
}

async function publicGarage(tenantId) {
  const { tenant } = await garage(tenantId);
  return { name: garageName(tenant), phone: garagePhone(tenant), logo_url: tenant?.logo_url || null, slug: tenant?.slug || null };
}

async function publicRoute(req, res, sub, body, sendJson) {
  const ip = ipOf(req);
  if (limited(`pub:${ip}`, 120, 60_000)) throw new HttpError(429, "Too many requests. Wait a minute and try again.");

  if (sub === "pub/estimate") {
    const est = await estimateByToken(body.token);
    const { job, vehicle } = await jobBits(est.tenant_id, est.job_id);
    const expired = est.expires_at && Date.parse(est.expires_at) < Date.now() && ["sent", "viewed"].includes(est.status);
    if (expired) await db(`garage_estimates?id=eq.${est.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "expired" } }).catch(() => {});
    if (est.status === "sent") await db(`garage_estimates?id=eq.${est.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "viewed", viewed_at: new Date().toISOString() } }).catch(() => {});
    const photos = [];
    for (const m of await rows(`garage_job_media?job_id=eq.${job.id}&customer_visible=eq.true&stage=in.(inspection,job,check_in)&kind=eq.photo&select=path,caption,line_id&order=created_at&limit=24`)) {
      const url = await signedUrl(m.path);
      if (url) photos.push({ url, caption: m.caption, line_id: m.line_id });
    }
    return sendJson(res, 200, {
      ok: true, garage: await publicGarage(est.tenant_id),
      estimate: {
        version: est.version, kind: est.kind, status: expired ? "expired" : est.status === "sent" ? "viewed" : est.status, lines: est.lines,
        subtotal: est.subtotal, tax: est.tax, total: est.total, approved_total: est.approved_total, deposit_amount: est.deposit_amount,
        message: est.message, expires_at: est.expires_at, responded_at: est.responded_at,
      },
      job: { job_no: job.job_no, complaint: job.complaint, findings: job.findings, tracking_token: job.tracking_token },
      vehicle: vehicle ? { plate: formatPlate(vehicle.plate), make: vehicle.make, model: vehicle.model } : null,
      photos,
    });
  }

  if (sub === "pub/estimate/respond") {
    if (limited(`respond:${ip}`, 10, 60_000)) throw new HttpError(429, "Too many requests. Wait a minute and try again.");
    const est = await estimateByToken(body.token);
    if (!["sent", "viewed"].includes(est.status)) throw new HttpError(409, est.status === "expired" ? "This estimate has expired. Ask the garage for a new one." : "You have already answered this estimate.");
    if (est.expires_at && Date.parse(est.expires_at) < Date.now()) throw new HttpError(409, "This estimate has expired. Ask the garage for a new one.");
    const decisions = body.decisions && typeof body.decisions === "object" ? body.decisions : {};
    const now = new Date().toISOString();
    const lines = (Array.isArray(est.lines) ? est.lines : []).map((l) => {
      const d = decisions[l.id];
      return { ...l, decision: d === "approved" || d === "declined" ? d : "declined" };
    });
    const r2 = (n) => Math.round(n * 100) / 100;
    const gross = (l) => { const n = r2(Number(l.qty || 0) * Number(l.rate || 0) * (1 - Math.min(100, Math.max(0, Number(l.discount) || 0)) / 100)); return r2(n + r2(n * (Number(l.tax_rate) || 0) / 100)); };
    const approvedTotal = r2(lines.filter((l) => l.decision === "approved").reduce((s, l) => s + gross(l), 0));
    const yes = lines.filter((l) => l.decision === "approved").length;
    const status = yes === 0 ? "declined" : yes === lines.length ? "approved" : "partly_approved";
    const note = str(body.note).slice(0, 1000) || null;
    await db(`garage_estimates?id=eq.${est.id}`, { method: "PATCH", prefer: "return=minimal", body: { lines, status, approved_total: approvedTotal, responded_at: now, responded_via: "link", customer_note: note } });
    for (const l of lines) {
      if (!UUID.test(str(l.id))) continue;
      await db(`garage_job_lines?id=eq.${l.id}&job_id=eq.${est.job_id}&tenant_id=eq.${est.tenant_id}`, {
        method: "PATCH", prefer: "return=minimal", body: { approved: l.decision === "approved", approved_at: now, approved_via: "link" },
      }).catch(() => {});
    }
    await db("garage_job_events", { method: "POST", prefer: "return=minimal", body: {
      tenant_id: est.tenant_id, job_id: est.job_id, kind: "approval", by_name: "Customer (link)",
      note: `Estimate v${est.version}: ${yes} of ${lines.length} approved${note ? ` · "${note}"` : ""}`,
    } });
    await db("shop_notifications", { method: "POST", prefer: "return=minimal", body: {
      tenant_id: est.tenant_id, kind: "garage_approval", title: status === "declined" ? "Estimate declined" : "Estimate approved",
      body: `${yes} of ${lines.length} items approved (${approvedTotal.toLocaleString("en-KE")})`, link: `/garage/jobs/${est.job_id}`, sent_at: now,
    } }).catch(() => {});
    return sendJson(res, 200, { ok: true, status, approved_total: approvedTotal });
  }

  if (sub === "pub/track") {
    if (!TOKEN.test(str(body.token))) throw new HttpError(404, "This link is not valid");
    const job = await one(`garage_jobs?tracking_token=eq.${enc(body.token)}&select=*`);
    if (!job) throw new HttpError(404, "This link is not valid");
    const [vehicle, events, media, links, lines] = await Promise.all([
      job.vehicle_id ? one(`garage_vehicles?id=eq.${job.vehicle_id}&select=plate,make,model,colour`) : null,
      rows(`garage_job_events?job_id=eq.${job.id}&kind=eq.status&select=to_status,at&order=at`),
      rows(`garage_job_media?job_id=eq.${job.id}&customer_visible=eq.true&kind=in.(photo,video)&select=path,caption,kind,stage,created_at&order=created_at&limit=40`),
      rows(`garage_job_invoices?job_id=eq.${job.id}&select=invoice_id,payer,is_deposit`),
      rows(`garage_job_lines?job_id=eq.${job.id}&approved=eq.true&status=neq.cancelled&select=description,kind,qty,status&order=sort`),
    ]);
    const photos = [];
    for (const m of media) { const url = await signedUrl(m.path); if (url) photos.push({ url, caption: m.caption, kind: m.kind, stage: m.stage, at: m.created_at }); }
    const invoices = [];
    for (const l of links.filter((x) => x.payer === "customer")) {
      const inv = await one(`invoices?id=eq.${l.invoice_id}&tenant_id=eq.${job.tenant_id}&select=id,invoice_number,total,amount_paid,status,etims_status,etims_qr_url,etims_rcpt_no`);
      if (!inv || ["draft", "void", "cancelled"].includes(inv.status)) continue;
      let pay = null;
      const balance = Math.max(0, Number(inv.total) - Number(inv.amount_paid || 0));
      if (balance > 0.5) {
        let link = await one(`invoice_pay_links?invoice_id=eq.${inv.id}&revoked_at=is.null&select=token`);
        if (!link) {
          await db("invoice_pay_links", { method: "POST", prefer: "return=minimal", body: { tenant_id: job.tenant_id, invoice_id: inv.id } }).catch(() => {});
          link = await one(`invoice_pay_links?invoice_id=eq.${inv.id}&revoked_at=is.null&select=token`);
        }
        pay = link?.token ? `/pay/${link.token}` : null;
      }
      invoices.push({ number: inv.invoice_number, total: Number(inv.total), balance, deposit: l.is_deposit, status: inv.status, pay, etims_qr_url: inv.etims_status === "signed" ? inv.etims_qr_url : null, etims_rcpt_no: inv.etims_status === "signed" ? inv.etims_rcpt_no : null });
    }
    const pendingEstimate = await one(`garage_estimates?job_id=eq.${job.id}&status=in.(sent,viewed)&select=token&order=version.desc&limit=1`);
    return sendJson(res, 200, {
      ok: true, garage: await publicGarage(job.tenant_id),
      job: {
        job_no: job.job_no, status: job.status, job_type: job.job_type, complaint: job.complaint, customer_notes: job.customer_notes,
        promised_at: job.promised_at, ready_at: job.ready_at, collected_at: job.collected_at, checked_in_at: job.checked_in_at,
        approved_total: job.approved_total, rating: job.rating, mechanic_rating: job.mechanic_rating, rated: !!job.rated_at,
        estimate_token: pendingEstimate?.token || null,
      },
      vehicle: vehicle ? { plate: formatPlate(vehicle.plate), make: vehicle.make, model: vehicle.model, colour: vehicle.colour } : null,
      timeline: events, photos, invoices, work: lines,
    });
  }

  if (sub === "pub/track/rate") {
    if (!TOKEN.test(str(body.token))) throw new HttpError(404, "This link is not valid");
    const job = await one(`garage_jobs?tracking_token=eq.${enc(body.token)}&select=id,tenant_id,status,rated_at`);
    if (!job) throw new HttpError(404, "This link is not valid");
    if (!["ready", "collected"].includes(job.status)) throw new HttpError(409, "You can rate the job once the car is ready");
    if (job.rated_at) throw new HttpError(409, "Thank you, you have already rated this job");
    const rating = Math.round(Number(body.rating));
    const mech = body.mechanic_rating ? Math.round(Number(body.mechanic_rating)) : null;
    if (!(rating >= 1 && rating <= 5) || (mech !== null && !(mech >= 1 && mech <= 5))) throw new HttpError(400, "Choose 1 to 5 stars");
    await db(`garage_jobs?id=eq.${job.id}`, { method: "PATCH", prefer: "return=minimal", body: { rating, mechanic_rating: mech, rating_comment: str(body.comment).slice(0, 1000) || null, rated_at: new Date().toISOString() } });
    await db("garage_job_events", { method: "POST", prefer: "return=minimal", body: { tenant_id: job.tenant_id, job_id: job.id, kind: "rating", by_name: "Customer (link)", note: `${rating}/5${mech ? `, mechanic ${mech}/5` : ""}` } });
    return sendJson(res, 200, { ok: true });
  }

  if (sub === "pub/book/info" || sub === "pub/book") {
    const slug = str(body.slug).toLowerCase();
    if (!SLUG.test(slug)) throw new HttpError(404, "Garage not found");
    const tenant = await one(`tenants?slug=eq.${enc(slug)}&is_active=eq.true&deleted_at=is.null&select=id,slug,business_name,business_phone,contact_phone,logo_url`);
    if (!tenant) throw new HttpError(404, "Garage not found");
    const s = (await one(`garage_settings?tenant_id=eq.${tenant.id}&select=*`)) || {};
    if (!s.booking_enabled) throw new HttpError(404, "This garage is not taking online bookings");
    const slotMin = Math.min(240, Math.max(15, Number(s.slot_minutes) || 60));
    const bays = await rows(`garage_bays?tenant_id=eq.${tenant.id}&active=eq.true&select=id`);
    const capacity = Math.max(1, bays.length);

    if (sub === "pub/book/info") {
      const from = new Date().toISOString(), to = new Date(Date.now() + 21 * DAY).toISOString();
      const taken = await rows(`garage_bookings?tenant_id=eq.${tenant.id}&status=in.(pending,confirmed)&starts_at=gte.${enc(from)}&starts_at=lt.${enc(to)}&select=starts_at`);
      const counts = {};
      for (const b of taken) counts[b.starts_at.slice(0, 16)] = (counts[b.starts_at.slice(0, 16)] || 0) + 1;
      return sendJson(res, 200, {
        ok: true, garage: { name: garageName(tenant), phone: garagePhone(tenant), logo_url: tenant.logo_url || null },
        intro: s.booking_intro || "", services: s.booking_services || [], slot_minutes: slotMin,
        open_hour: Number(s.open_hour ?? 8), close_hour: Number(s.close_hour ?? 17), open_days: s.open_days || [1, 2, 3, 4, 5, 6],
        full: Object.entries(counts).filter(([, n]) => n >= capacity).map(([k]) => k),
      });
    }

    if (limited(`book:${ip}`, 5, 10 * 60_000)) throw new HttpError(429, "Too many bookings from this connection. Call the garage instead.");
    const name = str(body.name).slice(0, 120), phone = str(body.phone).replace(/[^\d+]/g, "").slice(0, 20);
    const plate = str(body.plate).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    const start = Date.parse(str(body.starts_at));
    if (!name) throw new HttpError(400, "Enter your name");
    if (!/^(\+?254|0)[17]\d{8}$/.test(phone)) throw new HttpError(400, "Enter a valid phone number (07XXXXXXXX)");
    if (!plate) throw new HttpError(400, "Enter the number plate");
    if (!Number.isFinite(start) || start < Date.now() + 15 * 60_000 || start > Date.now() + 60 * DAY) throw new HttpError(400, "Choose a time from the list");
    const local = new Date(start + NAIROBI);
    const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
    const dow = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
    if (hour < Number(s.open_hour ?? 8) || hour + slotMin / 60 > Number(s.close_hour ?? 17) + 0.001 || !(s.open_days || [1, 2, 3, 4, 5, 6]).includes(dow)) throw new HttpError(400, "The garage is closed at that time");
    const startIso = new Date(start).toISOString();
    const same = await rows(`garage_bookings?tenant_id=eq.${tenant.id}&status=in.(pending,confirmed)&starts_at=eq.${enc(startIso)}&select=id`);
    if (same.length >= capacity) throw new HttpError(409, "That time was just taken. Choose another.");
    const local0 = phone.startsWith("+254") ? `0${phone.slice(4)}` : phone.startsWith("254") ? `0${phone.slice(3)}` : phone;
    const intl = `254${local0.slice(1)}`;
    const cust = await one(`customers?tenant_id=eq.${tenant.id}&phone=in.(${[local0, intl, `+${intl}`].map((p) => `"${p}"`).join(",")})&select=id&limit=1`);
    const veh = await one(`garage_vehicles?tenant_id=eq.${tenant.id}&plate=eq.${enc(plate)}&select=id,customer_id`);
    const [booking] = await db("garage_bookings", { method: "POST", body: {
      tenant_id: tenant.id, name, phone: local0, plate, vehicle_desc: str(body.vehicle_desc).slice(0, 120) || null,
      service: str(body.service).slice(0, 120) || null, notes: str(body.notes).slice(0, 1000) || null,
      starts_at: startIso, ends_at: new Date(start + slotMin * 60_000).toISOString(), source: "online", status: "pending",
      customer_id: cust?.id || veh?.customer_id || null, vehicle_id: veh?.id || null, created_by: null,
    } });
    await db("shop_notifications", { method: "POST", prefer: "return=minimal", body: {
      tenant_id: tenant.id, kind: "garage_booking", title: "New online booking", body: `${formatPlate(plate)} · ${fmtDate(startIso, true)} · ${name}`, link: "/garage/bookings", sent_at: new Date().toISOString(),
    } }).catch(() => {});
    const text = `${garageName(tenant)}: we have your booking for ${formatPlate(plate)} on ${fmtDate(startIso, true)} (ref ${booking.booking_no}). We will confirm shortly.`;
    sendForShop({ tenantId: tenant.id, channel: "sms", to: local0, text, reference: `garage-booking-${booking.id}`, event: "booking_confirmed" })
      .then((r) => r?.ok && db(`garage_bookings?id=eq.${booking.id}`, { method: "PATCH", prefer: "return=minimal", body: { confirm_sent_at: new Date().toISOString() } }))
      .catch(() => {});
    return sendJson(res, 200, { ok: true, booking_no: booking.booking_no, starts_at: startIso });
  }

  return sendJson(res, 404, { error: "Not found" });
}

export async function handle(req, res, subpath, { sendJson, readJsonBody }) {
  if (!SUPABASE_URL || !SERVICE_KEY) return sendJson(res, 503, { ok: false, error: "Not configured" });
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Use POST" });
  const sub = str(subpath).replace(/^\/+|\/+$/g, "");
  try {
    const body = (await readJsonBody(req).catch(() => ({}))) || {};
    if (sub.startsWith("pub/")) return await publicRoute(req, res, sub, body, sendJson);
    return await staffRoute(req, res, sub, body, sendJson);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error("[garage-w]", sub, e?.message || e);
    return sendJson(res, status, { ok: false, error: status >= 500 ? "Something went wrong. Try again." : e.message });
  }
}
