// ---------------------------------------------------------------------------
// JMSURF Garage server area: specialist modules. Mounted by garage.js under /api/garage/s/.
// handle(req, res, subpath, { sendJson, readJsonBody }) answers one request; startJobs() starts background jobs.
//
// Everything the staff screens do goes straight to the database under their own sign-in (RLS).
// This file serves the no-login pages and the scheduled reminders. Public calls carry a random
// token (or a company slug for car listings); the token's record fixes the company, and every
// read and write below is scoped to that one tenant_id with the service key.
//
// POST /api/garage/s/pub/fleet          { token }                                  fleet portal
// POST /api/garage/s/pub/fleet/approve  { token, id, decision, name, lpo_no, note } fleet manager decides
// POST /api/garage/s/pub/check          { token }                                  driver daily check form
// POST /api/garage/s/pub/check/submit   { token, driver, odometer, answers, notes, photos[] }
// POST /api/garage/s/pub/yard           { slug }                                   public car listings
// POST /api/garage/s/pub/yard/car       { slug, id }
// POST /api/garage/s/pub/yard/enquiry   { slug, id, name, phone, message }
// POST /api/garage/s/pub/preorder       { token }                                  customer pre-order status
//
// Jobs (hourly, sends between 08:00 and 18:00 Nairobi time):
//   insurer reminders  claims invoiced and unpaid past the insurer's terms, SMS every N days
//   demurrage alerts   shipments at the port close to the end of their free days, SMS to the company
// ---------------------------------------------------------------------------
import { sendForShop } from "./messaging.js";
import { payLinkUrl } from "./paylinks.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{24,64}$/i;
const SLUG = /^[a-z0-9-]{2,63}$/;
const clip = (v, n) => str(v).slice(0, n) || null;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function db(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(15000),
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    console.error("[garage-specialist] db", path.split("?")[0], res.status, str(data?.message).slice(0, 200));
    throw new HttpError(res.status >= 500 ? 500 : 400, "Database error");
  }
  return data;
}
const one = async (path) => ((await db(path)) || [])[0] || null;
const rpc = (fn, args) => db(`rpc/${fn}`, { method: "POST", body: args });

// --- rate limits (per process) ---------------------------------------------------

const hits = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, "Too many requests. Wait a few minutes and try again.");
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 20000) hits.clear();
}
const ipOf = (req) => str(req.headers["cf-connecting-ip"]) || str(req.headers["x-forwarded-for"]).split(",").pop()?.trim() || req.socket?.remoteAddress || "?";

// --- company + module ------------------------------------------------------------

const moduleCache = new Map();
async function moduleOn(tenantId, key) {
  const k = `${tenantId}:${key}`;
  const hit = moduleCache.get(k);
  if (hit && hit.until > Date.now()) return hit.on;
  const on = await rpc("tenant_module_active", { p_tenant: tenantId, p_key: key }).then((r) => r === true, () => false);
  moduleCache.set(k, { on, until: Date.now() + 60_000 });
  return on;
}
async function requireModule(tenantId, key) {
  if (!(await moduleOn(tenantId, key))) throw new HttpError(404, "This page is not available");
}

async function company(tenantId) {
  const t = await one(`tenants?id=eq.${tenantId}&select=id,slug,business_name,logo_url,business_phone,contact_phone,is_active,deleted_at`);
  if (!t || t.is_active === false || t.deleted_at) throw new HttpError(404, "This page is not available");
  const s = await one(`business_settings?tenant_id=eq.${tenantId}&select=currency`).catch(() => null);
  return { name: t.business_name, logo_url: t.logo_url || null, phone: t.business_phone || t.contact_phone || null, currency: s?.currency || "KES", slug: t.slug };
}
const companyPhone = async (tenantId) => {
  const t = await one(`tenants?id=eq.${tenantId}&select=contact_phone,business_phone`).catch(() => null);
  return str(t?.contact_phone) || str(t?.business_phone) || null;
};

/** The record a public token points at (app_records.data->>field = token). */
async function byToken(app, kind, field, token) {
  if (!TOKEN.test(str(token))) throw new HttpError(404, "This link does not work. Ask the garage for a new one.");
  const r = await one(`app_records?app=eq.${app}&kind=eq.${kind}&archived=eq.false&data->>${field}=eq.${enc(str(token))}&select=*&limit=1`);
  if (!r) throw new HttpError(404, "This link does not work. Ask the garage for a new one.");
  await requireModule(r.tenant_id, app);
  return r;
}

async function patchData(row, patch, cols = {}) {
  const fresh = await one(`app_records?id=eq.${row.id}&tenant_id=eq.${row.tenant_id}&select=data`);
  return db(`app_records?id=eq.${row.id}&tenant_id=eq.${row.tenant_id}`, { method: "PATCH", prefer: "return=representation", body: { ...cols, data: { ...(fresh?.data || {}), ...patch } } });
}
const event = (tenantId, recordId, body) =>
  db("app_record_events", { method: "POST", prefer: "return=minimal", body: { tenant_id: tenantId, record_id: recordId, kind: "system", body } }).catch(() => undefined);
/** SMS through the company's own messaging setup. Alerts to the company itself are staff alerts; others follow System → SMS → What uses SMS. */
const notify = (tenantId, to, text, event = "staff_alert") => (to ? sendForShop({ tenantId, channel: "sms", to, text, event }).catch(() => undefined) : undefined);

// --- fleet portal ----------------------------------------------------------------

function serviceDue(v) {
  const d = v.data || {};
  let due = false;
  if (num(d.every_km) > 0 && num(v.quantity) > 0 && num(d.last_km) + num(d.every_km) - num(v.quantity) <= 500) due = true;
  if (num(d.every_months) > 0 && d.last_date) {
    const at = new Date(d.last_date);
    if (!isNaN(at.getTime())) { at.setMonth(at.getMonth() + num(d.every_months)); if (at.getTime() - Date.now() <= 14 * 86400000) due = true; }
  }
  return due;
}

async function fleetPortal(req, b) {
  limit(`fleet:${ipOf(req)}`, 120, 600_000);
  const fleet = await byToken("fleet_contracts", "fleet", "portal_token", b.token);
  const t = fleet.tenant_id;
  const [co, vehicles, approvals, checks] = await Promise.all([
    company(t),
    db(`app_records?tenant_id=eq.${t}&app=eq.fleet_contracts&kind=eq.fleet_vehicle&parent_id=eq.${fleet.id}&archived=eq.false&select=id,title,quantity,data&order=title.asc&limit=500`),
    db(`app_records?tenant_id=eq.${t}&app=eq.fleet_contracts&kind=eq.approval&parent_id=eq.${fleet.id}&archived=eq.false&select=id,title,stage,amount,data,created_at&order=created_at.desc&limit=60`),
    db(`app_records?tenant_id=eq.${t}&app=eq.fleet_contracts&kind=eq.daily_check&parent_id=eq.${fleet.id}&select=starts_at,data&order=starts_at.desc&limit=300`),
  ]);
  const vids = vehicles.map((v) => v.data?.vehicle_id).filter((x) => UUID.test(str(x)));
  const plateOf = new Map(vehicles.map((v) => [v.data?.vehicle_id, v.title]));
  const jobs = vids.length ? await db(`garage_jobs?tenant_id=eq.${t}&vehicle_id=in.(${vids.join(",")})&select=id,job_no,status,job_type,complaint,created_at,vehicle_id&order=created_at.desc&limit=150`).catch(() => []) : [];
  const year = new Date().getFullYear();
  const jobIds = jobs.filter((j) => new Date(j.created_at).getFullYear() === year).map((j) => j.id);
  const lines = jobIds.length ? await db(`garage_job_lines?job_id=in.(${jobIds.join(",")})&select=job_id,qty,rate`).catch(() => []) : [];
  const jobCost = new Map();
  for (const l of lines || []) jobCost.set(l.job_id, (jobCost.get(l.job_id) || 0) + num(l.qty) * num(l.rate));
  const invoices = fleet.customer_id
    ? await db(`invoices?tenant_id=eq.${t}&customer_id=eq.${fleet.customer_id}&status=not.in.(draft,void)&select=id,invoice_number,issue_date,total,amount_paid,status&order=issue_date.desc&limit=100`).catch(() => [])
    : [];
  const out = [];
  for (const i of invoices) {
    const balance = Math.max(0, num(i.total) - num(i.amount_paid));
    out.push({ invoice_number: i.invoice_number, issue_date: i.issue_date, total: num(i.total), balance, status: i.status, pay_url: balance > 0 && out.filter((x) => x.pay_url).length < 10 ? await payLinkUrl(t, i.id).catch(() => null) : null });
  }
  return {
    company: co,
    fleet: { title: fleet.title, manager: fleet.data?.manager || null },
    vehicles: vehicles.map((v) => ({
      plate: v.title, driver: v.data?.driver || null, department: v.data?.department || null, cost_centre: v.data?.cost_centre || null,
      service_due: serviceDue(v),
      spend: jobs.filter((j) => j.vehicle_id === v.data?.vehicle_id).reduce((a, j) => a + (jobCost.get(j.id) || 0), 0),
      last_check: checks.find((c) => c.data?.fleet_vehicle_id === v.id)?.starts_at || null,
    })),
    approvals: approvals.map((a) => ({ id: a.id, title: a.title, stage: a.stage, amount: num(a.amount), plate: a.data?.plate || null, lines: Array.isArray(a.data?.lines) ? a.data.lines.slice(0, 50) : [], lpo_no: a.data?.lpo_no || null, created_at: a.created_at })),
    jobs: jobs.map((j) => ({ id: j.id, job_no: j.job_no, status: j.status, job_type: j.job_type, complaint: str(j.complaint).slice(0, 200), created_at: j.created_at, plate: plateOf.get(j.vehicle_id) || "" })),
    invoices: out,
    spend: {
      year: Math.round(invoices.filter((i) => String(i.issue_date).startsWith(String(year))).reduce((a, i) => a + num(i.total), 0) * 100) / 100,
      balance: Math.round(out.reduce((a, i) => a + i.balance, 0) * 100) / 100,
    },
  };
}

async function fleetApprove(req, b) {
  limit(`fleet-approve:${ipOf(req)}`, 30, 600_000);
  const fleet = await byToken("fleet_contracts", "fleet", "portal_token", b.token);
  if (!UUID.test(str(b.id))) throw new HttpError(400, "Choose the request");
  const decision = b.decision === "approved" ? "approved" : b.decision === "declined" ? "declined" : null;
  if (!decision) throw new HttpError(400, "Approve or decline");
  const name = clip(b.name, 80);
  if (!name) throw new HttpError(400, "Enter your name");
  const lpo = clip(b.lpo_no, 60);
  if (decision === "approved" && fleet.data?.lpo_required && !lpo) throw new HttpError(400, "Enter the LPO / LSO number for this work");
  const a = await one(`app_records?id=eq.${b.id}&tenant_id=eq.${fleet.tenant_id}&app=eq.fleet_contracts&kind=eq.approval&parent_id=eq.${fleet.id}&select=*`);
  if (!a) throw new HttpError(404, "Request not found");
  if (a.stage !== "pending") throw new HttpError(409, "This request was already decided");
  await patchData(a, { decided_by: name, decided_at: new Date().toISOString(), lpo_no: lpo, decision_note: clip(b.note, 500) }, { stage: decision });
  await event(fleet.tenant_id, a.id, `${decision === "approved" ? "Approved" : "Declined"} online by ${name}${lpo ? ` on ${lpo}` : ""}.`);
  if (decision === "approved" && lpo) {
    await db("app_records", { method: "POST", prefer: "return=minimal", body: { tenant_id: fleet.tenant_id, app: "fleet_contracts", kind: "lpo", title: lpo, parent_id: fleet.id, stage: "open", amount: num(a.amount) || null, starts_at: new Date().toISOString(), data: { type: /lso/i.test(lpo) ? "LSO" : "LPO", plate: a.data?.plate || null, approval: a.id } } }).catch(() => undefined);
  }
  await notify(fleet.tenant_id, await companyPhone(fleet.tenant_id), `${fleet.title}: "${str(a.title).slice(0, 60)}" ${decision} by ${name}${lpo ? `, ${lpo}` : ""}.`);
  return { ok: true };
}

// --- driver daily check ------------------------------------------------------------

const CHECK_ITEMS = { tyres: "Tyres", lights: "Lights", oil: "Engine oil", coolant: "Coolant", brakes: "Brakes", wipers: "Wipers", mirrors: "Mirrors / glass", body: "Body", warning: "Warning lights", safety: "Safety kit" };

async function checkVehicle(token) {
  const v = await byToken("fleet_contracts", "fleet_vehicle", "check_token", token);
  const fleet = v.parent_id ? await one(`app_records?id=eq.${v.parent_id}&tenant_id=eq.${v.tenant_id}&select=id,title,stage,data,customer_id`) : null;
  if (!fleet || fleet.stage === "ended") throw new HttpError(404, "This link does not work. Ask the garage for a new one.");
  return { v, fleet };
}

async function checkForm(req, b) {
  limit(`check:${ipOf(req)}`, 60, 600_000);
  const { v, fleet } = await checkVehicle(b.token);
  return { company: await company(v.tenant_id), plate: v.title, driver: v.data?.driver || null, fleet: fleet.title };
}

async function uploadPhoto(tenantId, recordId, dataUrl, i) {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(str(dataUrl));
  if (!m) return;
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > 3 * 1024 * 1024) return;
  const ext = m[1] === "png" ? "png" : m[1] === "webp" ? "webp" : "jpg";
  const path = `${tenantId}/garage_fleet_check/${recordId}/${Date.now()}-${i}.${ext}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/documents/${path}`, {
    method: "POST", signal: AbortSignal.timeout(20000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": `image/${ext === "jpg" ? "jpeg" : ext}` }, body: bytes,
  }).catch(() => null);
  if (!r?.ok) return;
  await db("documents", { method: "POST", prefer: "return=minimal", body: { tenant_id: tenantId, entity_type: "garage_fleet_check", entity_id: recordId, entity_name: "Driver check", name: `Damage photo ${i + 1}.${ext}`, category: "Damage photo", path, mime_type: `image/${ext === "jpg" ? "jpeg" : ext}`, size_bytes: bytes.length, uploaded_by_name: "Driver" } }).catch(() => undefined);
}

async function checkSubmit(req, b) {
  limit(`check-submit:${ipOf(req)}`, 20, 600_000);
  limit(`check-token:${str(b.token)}`, 10, 3600_000);
  const { v, fleet } = await checkVehicle(b.token);
  const answers = {};
  const notes = {};
  for (const k of Object.keys(CHECK_ITEMS)) {
    answers[k] = b.answers?.[k] === "fault" ? "fault" : "ok";
    if (answers[k] === "fault") notes[k] = clip(b.notes?.[k], 200);
  }
  const faults = Object.keys(answers).filter((k) => answers[k] === "fault").map((k) => `${CHECK_ITEMS[k]}${notes[k] ? `: ${notes[k]}` : ""}`);
  const odometer = Math.max(0, Math.min(5_000_000, Math.round(num(b.odometer)))) || null;
  const now = new Date();
  const [rec] = await db("app_records", {
    method: "POST", prefer: "return=representation",
    body: {
      tenant_id: v.tenant_id, app: "fleet_contracts", kind: "daily_check", parent_id: fleet.id, title: `${v.title} · ${now.toISOString().slice(0, 10)}`,
      stage: faults.length ? "faults" : "ok", starts_at: now.toISOString(),
      data: { plate: v.title, fleet_vehicle_id: v.id, driver: clip(b.driver, 80), odometer, answers, notes, faults: faults.join("; ") || null, source: "driver link" },
    },
  });
  if (odometer && odometer > num(v.quantity)) await db(`app_records?id=eq.${v.id}&tenant_id=eq.${v.tenant_id}`, { method: "PATCH", prefer: "return=minimal", body: { quantity: odometer } }).catch(() => undefined);
  const photos = Array.isArray(b.photos) ? b.photos.slice(0, 6) : [];
  for (let i = 0; i < photos.length; i++) await uploadPhoto(v.tenant_id, rec.id, photos[i], i);
  if (faults.length) {
    await notify(v.tenant_id, await companyPhone(v.tenant_id), `Driver check ${v.title} (${fleet.title}): ${faults.join("; ").slice(0, 300)}`);
    if (fleet.data?.phone) await notify(v.tenant_id, fleet.data.phone, `${v.title}: driver reported ${faults.length} fault(s) today. The garage has been told.`, "manual");
  }
  return { ok: true, faults: faults.length };
}

// --- vehicle yard listings --------------------------------------------------------------

async function yardCompany(slug) {
  const s = str(slug).toLowerCase();
  if (!SLUG.test(s)) throw new HttpError(404, "Page not found");
  const t = await one(`tenants?slug=eq.${enc(s)}&is_active=eq.true&deleted_at=is.null&select=id`);
  if (!t) throw new HttpError(404, "Page not found");
  await requireModule(t.id, "vehicle_yard");
  return t.id;
}
const LISTED = "at_sea,at_port,prep,in_yard,reserved";
const publicCar = (c) => ({
  id: c.id, title: c.title, stage: c.stage, price: num(c.amount) || null, created_at: c.created_at,
  make: c.data?.make || null, model: c.data?.model || null, year: c.data?.year || null, mileage: c.data?.mileage || null,
  colour: c.data?.colour || null, engine_cc: c.data?.engine_cc || null, fuel: c.data?.fuel || null, transmission: c.data?.transmission || null,
  body: c.data?.body || null, location: c.data?.location || null, features: c.data?.features || null, description: c.data?.description || null,
  photos: (Array.isArray(c.data?.photos) ? c.data.photos : []).filter((u) => /^https:\/\//.test(str(u))).slice(0, 20),
});

async function yardList(req, b) {
  limit(`yard:${ipOf(req)}`, 240, 600_000);
  const t = await yardCompany(b.slug);
  const cars = await db(`app_records?tenant_id=eq.${t}&app=eq.vehicle_yard&kind=eq.car&archived=eq.false&stage=in.(${LISTED})&select=id,title,stage,amount,data,created_at&order=created_at.desc&limit=500`);
  return { company: await company(t), cars: cars.filter((c) => c.data?.listed !== false).map(publicCar) };
}

async function yardCar(req, b) {
  limit(`yard:${ipOf(req)}`, 240, 600_000);
  const t = await yardCompany(b.slug);
  if (!UUID.test(str(b.id))) throw new HttpError(404, "This car is no longer listed");
  const c = await one(`app_records?id=eq.${b.id}&tenant_id=eq.${t}&app=eq.vehicle_yard&kind=eq.car&archived=eq.false&stage=in.(${LISTED})&select=id,title,stage,amount,data,created_at`);
  if (!c || c.data?.listed === false) throw new HttpError(404, "This car is no longer listed");
  return { company: await company(t), car: publicCar(c) };
}

async function yardEnquiry(req, b) {
  limit(`yard-enq:${ipOf(req)}`, 6, 3600_000);
  const t = await yardCompany(b.slug);
  const name = clip(b.name, 80);
  const phone = clip(str(b.phone).replace(/[^\d+]/g, ""), 20);
  if (!name || !phone || phone.replace(/\D/g, "").length < 9) throw new HttpError(400, "Enter your name and phone number");
  const car = UUID.test(str(b.id)) ? await one(`app_records?id=eq.${b.id}&tenant_id=eq.${t}&app=eq.vehicle_yard&kind=eq.car&select=id,title,number`) : null;
  await db("app_records", { method: "POST", prefer: "return=minimal", body: { tenant_id: t, app: "vehicle_yard", kind: "enquiry", title: name, stage: "new", data: { phone, car: car?.id || null, message: clip(b.message, 1000), source: "website" } } });
  await notify(t, await companyPhone(t), `Car enquiry: ${name} ${phone}${car ? ` about ${car.number || ""} ${car.title}` : ""}.`);
  return { ok: true };
}

// --- pre-order status -------------------------------------------------------------------

async function preorder(req, b) {
  limit(`pre:${ipOf(req)}`, 60, 600_000);
  const p = await byToken("imports", "preorder", "token", b.token);
  let eta = null;
  if (UUID.test(str(p.data?.order))) {
    const o = await one(`app_records?id=eq.${p.data.order}&tenant_id=eq.${p.tenant_id}&select=data`);
    if (UUID.test(str(o?.data?.shipment))) {
      const s = await one(`app_records?id=eq.${o.data.shipment}&tenant_id=eq.${p.tenant_id}&select=due_date`);
      eta = s?.due_date ? String(s.due_date).slice(0, 10) : null;
    }
  }
  return {
    company: await company(p.tenant_id), number: p.number, title: p.title, stage: p.stage, spec: p.data?.spec || null,
    price: num(p.amount) || null, deposit: num(p.data?.deposit), expected: p.due_date ? String(p.due_date).slice(0, 10) : null, eta,
  };
}

// --- router ---------------------------------------------------------------------------

const ROUTES = {
  "pub/fleet": fleetPortal,
  "pub/fleet/approve": fleetApprove,
  "pub/check": checkForm,
  "pub/check/submit": checkSubmit,
  "pub/yard": yardList,
  "pub/yard/car": yardCar,
  "pub/yard/enquiry": yardEnquiry,
  "pub/preorder": preorder,
};

export async function handle(req, res, subpath, { sendJson, readJsonBody }) {
  const fn = ROUTES[str(subpath).replace(/\/+$/, "")];
  if (!fn) return sendJson(res, 404, { error: "Not found" });
  if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST" });
  if (!SUPABASE_URL || !SERVICE_KEY) return sendJson(res, 503, { error: "Not available right now" });
  try {
    // Driver checks carry up to six photos.
    const body = await readJsonBody(req, subpath === "pub/check/submit" ? 12_000_000 : 100_000);
    return sendJson(res, 200, await fn(req, body || {}));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : /too large/i.test(str(e?.message)) ? 413 : 500;
    if (status === 500) console.error("[garage-specialist]", subpath, e?.message || e);
    return sendJson(res, status, { error: status === 500 ? "Something went wrong. Try again." : status === 413 ? "The photos are too large. Send fewer photos." : e.message });
  }
}

// --- jobs -----------------------------------------------------------------------------

const nairobiHour = () => (new Date().getUTCHours() + 3) % 24;
const daysSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);

/** Claims invoiced to insurers and unpaid past their terms: SMS the insurer's claims phone every N days. */
async function insurerReminders() {
  const claims = await db(`app_records?app=eq.insurance&kind=eq.claim&stage=eq.invoiced&archived=eq.false&select=id,tenant_id,parent_id,number,title,data,updated_at&limit=2000`);
  const insurers = new Map();
  for (const c of claims || []) {
    const invId = c.data?.invoice_insurer_id;
    if (!UUID.test(str(invId)) || !UUID.test(str(c.parent_id))) continue;
    if (!(await moduleOn(c.tenant_id, "insurance"))) continue;
    if (!insurers.has(c.parent_id)) insurers.set(c.parent_id, await one(`app_records?id=eq.${c.parent_id}&tenant_id=eq.${c.tenant_id}&select=id,title,data`));
    const ins = insurers.get(c.parent_id);
    const phone = str(ins?.data?.phone);
    const every = num(ins?.data?.remind_every) || 7;
    if (!phone || every <= 0 || daysSince(c.data?.last_reminded) < every) continue;
    const inv = await one(`invoices?id=eq.${invId}&tenant_id=eq.${c.tenant_id}&select=invoice_number,issue_date,total,amount_paid,status`);
    if (!inv || ["paid", "void", "draft"].includes(inv.status)) continue;
    const bal = num(inv.total) - num(inv.amount_paid);
    const terms = num(ins?.data?.terms_days) || 30;
    if (bal <= 0.005 || daysSince(inv.issue_date) <= terms) continue;
    // Claim the reminder first so two servers never both send it.
    const claimed = await db(`app_records?id=eq.${c.id}&tenant_id=eq.${c.tenant_id}&updated_at=eq.${enc(c.updated_at)}`, { method: "PATCH", prefer: "return=representation", body: { data: { ...(c.data || {}), last_reminded: new Date().toISOString() } } }).catch(() => []);
    if (!claimed?.length) continue;
    const co = await company(c.tenant_id).catch(() => null);
    await notify(c.tenant_id, phone, `${co?.name || "Garage"}: claim ${c.data?.claim_no || c.number} (${c.data?.plate || c.title}), invoice ${inv.invoice_number}, ${Math.round(bal).toLocaleString("en-KE")} unpaid for ${Math.floor(daysSince(inv.issue_date))} days. Kindly arrange payment.`, "debt_reminder");
    await event(c.tenant_id, c.id, "Automatic payment reminder sent to the insurer.");
  }
}

/** Shipments at the port close to the end of their free days: one SMS a day to the company. */
async function demurrageAlerts() {
  const rows = await db(`app_records?app=eq.imports&kind=eq.shipment&stage=in.(at_port,clearing)&archived=eq.false&select=id,tenant_id,number,title,data,updated_at&limit=2000`);
  const today = new Date().toISOString().slice(0, 10);
  for (const s of rows || []) {
    const arrived = s.data?.arrived;
    if (!arrived || s.data?.demurrage_alerted === today) continue;
    const until = new Date(arrived);
    if (isNaN(until.getTime())) continue;
    until.setUTCDate(until.getUTCDate() + num(s.data?.free_days));
    const left = Math.round((until.getTime() - new Date(today).getTime()) / 86400000);
    if (left > 2) continue;
    if (!(await moduleOn(s.tenant_id, "imports"))) continue;
    const claimed = await db(`app_records?id=eq.${s.id}&tenant_id=eq.${s.tenant_id}&updated_at=eq.${enc(s.updated_at)}`, { method: "PATCH", prefer: "return=representation", body: { data: { ...(s.data || {}), demurrage_alerted: today } } }).catch(() => []);
    if (!claimed?.length) continue;
    const text = left >= 0
      ? `Shipment ${s.number || ""} ${s.title}: free days at the port end ${until.toISOString().slice(0, 10)} (${left} day(s) left).`
      : `Shipment ${s.number || ""} ${s.title}: ${-left} day(s) of demurrage so far${num(s.data?.demurrage_rate) ? `, about ${Math.round(-left * num(s.data.demurrage_rate)).toLocaleString("en-KE")}` : ""}.`;
    await notify(s.tenant_id, await companyPhone(s.tenant_id), text);
    await event(s.tenant_id, s.id, "Demurrage alert sent.");
  }
}

let running = false;
async function tick() {
  if (running || !SUPABASE_URL || !SERVICE_KEY) return;
  const h = nairobiHour();
  if (h < 8 || h >= 18) return;
  running = true;
  try {
    await insurerReminders().catch((e) => console.warn("[garage-specialist] reminders", e?.message));
    await demurrageAlerts().catch((e) => console.warn("[garage-specialist] demurrage", e?.message));
  } finally { running = false; }
}

export function startJobs() {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  setTimeout(() => void tick(), 90_000).unref?.();
  setInterval(() => void tick(), 3600_000).unref?.();
}
