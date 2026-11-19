// ---------------------------------------------------------------------------
// HRM public routes (no login):
//
//  * /api/public/hr-registration-upload   a new hire's files (ID copy, KRA
//    certificate…) after they sent their details from /join/<token>. Checked
//    against the link token, the registration and the one-time upload key that
//    hr_registration_submit() returned (only its SHA-256 is stored). Saved to the
//    private documents bucket; HR sees them on the registration and, once
//    approved, on the employee.
//  * /api/pub/careers, /api/pub/careers/apply   the company's open vacancies
//    (recruitment jobs marked "Show on the careers page") and the apply form with
//    a CV. The company comes from the address (subdomain or own domain).
//
// Public routes are rate-limited per IP and never expose another company's data
// or anything private about a vacancy (salary budget, owner).
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const enc = encodeURIComponent;
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

async function db(path, { method = "GET", body, prefer = "return=representation" } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(20000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === "object" && data?.message ? data.message : `Database replied ${res.status}`);
  return data;
}
const rows = async (path) => { const d = await db(path); return Array.isArray(d) ? d : []; };
const one = async (path) => (await rows(path))[0] || null;
const objectPath = (p) => p.split("/").map(enc).join("/");

const hits = new Map();
function limit(req, key, max, windowMs = 60_000) {
  const ip = str(req.headers["x-forwarded-for"]).split(",")[0] || req.socket?.remoteAddress || "?";
  const k = `${key}:${ip}`;
  const now = Date.now();
  const list = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, "Too many requests. Try again in a few minutes.");
  list.push(now); hits.set(k, list);
  if (hits.size > 20000) hits.clear();
}

/** Decodes a base64 file and stores it in the private documents bucket. */
async function store(path, type, data, maxBytes) {
  const buf = Buffer.from(str(data).replace(/^data:[^,]*,/, ""), "base64");
  if (!buf.length) throw new HttpError(400, "The file is empty");
  if (buf.length > maxBytes) throw new HttpError(400, `Files up to ${Math.round(maxBytes / 1048576)} MB`);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/documents/${objectPath(path)}`, {
    method: "POST", signal: AbortSignal.timeout(60000), body: buf,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": type },
  });
  if (!res.ok) throw new HttpError(500, "The file could not be saved. Try again.");
  return buf.length;
}
const safeName = (n, ext) => `${str(n).replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "file"}.${ext}`;

async function notify(tenantId, title, body, link) {
  await db("shop_notifications", { method: "POST", prefer: "return=minimal", body: { tenant_id: tenantId, kind: "hrm", title: title.slice(0, 200), body: str(body).slice(0, 1000), link, role: "admin" } })
    .catch((e) => console.error("[hr-public] notify", e.message));
}

// ---------------------------------------------------------------- registration files
const REG_TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
const REG_CATEGORIES = ["ID copy", "KRA PIN certificate", "NSSF card", "SHA card", "Academic certificates", "Certificate of good conduct", "Bank details", "Passport photo", "Other"];
const REG_MAX_FILES = 10;

async function registrationUpload(req, body) {
  limit(req, "hr-reg-upload", 30, 10 * 60_000);
  const token = str(body.token), id = str(body.id), key = str(body.key);
  if (!/^[0-9a-f]{36}$/.test(token) || !UUID.test(id) || !/^[0-9a-f]{64}$/.test(key)) throw new HttpError(404, "This link is not valid");
  const link = await one(`hr_registration_links?token=eq.${enc(token)}&select=id,tenant_id`);
  const reg = link ? await one(`hr_registrations?id=eq.${id}&tenant_id=eq.${link.tenant_id}&link_id=eq.${link.id}&select=id,tenant_id,status,first_name,last_name,upload_key_hash,file_count,created_at`) : null;
  if (!reg || !reg.upload_key_hash || reg.upload_key_hash !== sha(key)) throw new HttpError(404, "This link is not valid");
  if (reg.status !== "submitted") throw new HttpError(400, "HR has already looked at your details. Send further files to HR directly.");
  if (Date.now() - Date.parse(reg.created_at) > 24 * 3600_000) throw new HttpError(400, "Uploads closed 24 hours after you sent your details. Send further files to HR directly.");
  if (Number(reg.file_count) >= REG_MAX_FILES) throw new HttpError(400, `Up to ${REG_MAX_FILES} files`);
  const ext = REG_TYPES[str(body.type)];
  if (!ext) throw new HttpError(400, "Upload a PDF, JPG or PNG");
  const category = REG_CATEGORIES.includes(str(body.category)) ? str(body.category) : "Other";
  const who = `${reg.first_name} ${reg.last_name}`.trim();
  const path = `${reg.tenant_id}/hr_registration/${reg.id}/${Date.now()}-${safeName(body.name, ext)}`;
  // Count first so parallel uploads cannot pass the cap.
  const counted = await db(`hr_registrations?id=eq.${reg.id}&file_count=eq.${Number(reg.file_count)}&select=id`, { method: "PATCH", body: { file_count: Number(reg.file_count) + 1 } });
  if (!Array.isArray(counted) || !counted.length) throw new HttpError(409, "Another file is uploading. Try again in a moment.");
  const size = await store(path, str(body.type), body.data, 10 * 1024 * 1024);
  await db("documents", { method: "POST", prefer: "return=minimal", body: {
    tenant_id: reg.tenant_id, entity_type: "hr_registration", entity_id: reg.id, entity_name: who,
    name: `${category} · ${who}.${ext}`, category, path, mime_type: str(body.type), size_bytes: size, uploaded_by_name: who,
  } });
  return { ok: true };
}

// ---------------------------------------------------------------- careers page
async function companyBySlug(slug) {
  if (!/^[a-z0-9-]{2,63}$/.test(str(slug))) return null;
  return one(`tenants?slug=eq.${enc(slug)}&is_active=eq.true&deleted_at=is.null&select=id,slug,business_name,logo_url`);
}
const moduleOn = async (tenantId, key) => (await db("rpc/tenant_module_active", { method: "POST", body: { p_tenant: tenantId, p_key: key } }).catch(() => false)) === true;
const openJobs = (tenantId) => rows(`app_records?tenant_id=eq.${tenantId}&app=eq.recruitment&kind=eq.job&stage=eq.open&archived=eq.false&data->>public=eq.true&select=id,number,title,quantity,data,created_at&order=created_at.desc&limit=100`);
const publicJob = (j) => ({ id: j.id, number: j.number, title: j.title, openings: j.quantity ? Number(j.quantity) : null, department: j.data?.department || "", location: j.data?.location || "", type: j.data?.type || "", description: j.data?.description || "", posted: j.created_at, closes: j.data?.closes || null });
const CV_TYPES = { "application/pdf": "pdf", "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" };

async function careers(req, pathname, body, co) {
  limit(req, "careers", 60);
  if (!(await moduleOn(co.id, "recruitment"))) throw new HttpError(403, "Job applications are not open");
  const jobs = await openJobs(co.id);
  if (pathname === "/api/pub/careers") return { company: co.business_name, logo: co.logo_url, jobs: jobs.map(publicJob) };
  limit(req, "careers-apply", 5, 10 * 60_000);
  const job = jobs.find((j) => j.id === str(body.job));
  if (!job) throw new HttpError(404, "This vacancy is closed");
  const name = str(body.name).replace(/\s+/g, " ").slice(0, 100);
  const email = str(body.email).toLowerCase().slice(0, 160);
  const phone = str(body.phone).replace(/[^0-9+]/g, "").slice(0, 16);
  if (name.split(" ").length < 2) throw new HttpError(400, "Enter your full name");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Enter a valid email address");
  if (phone.length < 9) throw new HttpError(400, "Enter a valid phone number");
  const cvExt = CV_TYPES[str(body.cv?.type)];
  if (!cvExt) throw new HttpError(400, "Attach your CV as a PDF or Word file");
  const dup = await one(`app_records?tenant_id=eq.${co.id}&app=eq.recruitment&kind=eq.applicant&parent_id=eq.${job.id}&data->>email=eq.${enc(email)}&select=id`);
  if (dup) throw new HttpError(409, "You have already applied for this vacancy");
  const [rec] = await db("app_records", { method: "POST", body: {
    tenant_id: co.id, app: "recruitment", kind: "applicant", title: name, stage: "new", parent_id: job.id,
    data: { email, phone, source: "Website", notes: str(body.note).slice(0, 3000) },
  } });
  const path = `${co.id}/applicant/${rec.id}/${Date.now()}-${safeName(body.cv?.name || "cv", cvExt)}`;
  try {
    const size = await store(path, str(body.cv.type), body.cv.data, 8 * 1024 * 1024);
    await db("documents", { method: "POST", prefer: "return=minimal", body: {
      tenant_id: co.id, entity_type: "applicant", entity_id: rec.id, entity_name: name, name: `CV · ${name}.${cvExt}`, category: "CV",
      path, mime_type: str(body.cv.type), size_bytes: size, uploaded_by_name: name,
    } });
  } catch (e) {
    await db(`app_records?id=eq.${rec.id}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
    throw e;
  }
  await db("app_record_events", { method: "POST", prefer: "return=minimal", body: { tenant_id: co.id, record_id: rec.id, kind: "system", body: `Applied from the careers page for ${job.title}`, created_by: null } }).catch(() => {});
  await notify(co.id, `New application: ${job.title}`, `${name} applied from the careers page.`, `/apps/recruitment/applicant?open=${rec.id}`);
  return { ok: true };
}

// ---------------------------------------------------------------- routes
export const isHrPublicRoute = (p) => p === "/api/public/hr-registration-upload" || p === "/api/pub/careers" || p === "/api/pub/careers/apply";

export async function handleHrPublic(req, res, pathname, search, readJsonBody, sendJson, slugFromHost) {
  if (!SUPABASE_URL || !SERVICE_KEY) return sendJson(res, 503, { error: "Not available right now" });
  try {
    if (pathname === "/api/public/hr-registration-upload") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST" });
      return sendJson(res, 200, await registrationUpload(req, await readJsonBody(req, 15_000_000)));
    }
    const q = new URLSearchParams(search || "");
    const body = req.method === "POST" ? await readJsonBody(req, 12_000_000) : {};
    if (pathname === "/api/pub/careers/apply" && req.method !== "POST") return sendJson(res, 405, { error: "Use POST" });
    const co = await companyBySlug(str(q.get("c") || body?.c) || (await slugFromHost(req)));
    if (!co) throw new HttpError(404, "Company not found");
    return sendJson(res, 200, await careers(req, pathname, body || {}, co));
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error("[hr-public]", pathname, e);
    return sendJson(res, 500, { error: "Something went wrong" });
  }
}
