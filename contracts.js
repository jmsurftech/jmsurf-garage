// ---------------------------------------------------------------------------
// Contracts (server side):
//
//  * Public contract link: our signature and stamp (private files) as short
//    links, the uploaded contract file, and "print, sign and upload" where the
//    other party sends back the signed copy to the same link.
//  * Daily job: contracts start (signed → active) on their start date, expiry
//    reminders before the end date (notice period, 30, 7 and 1 day), expiry,
//    and auto-renewal for the same term.
// ---------------------------------------------------------------------------
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const PUBLIC_SUPABASE_URL = (process.env.VITE_SUPABASE_URL || SUPABASE_URL).replace(/\/+$/, "");
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function db(path, { method = "GET", body, prefer = "return=representation" } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(30000),
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

async function signedUrl(path, seconds = 900) {
  if (!path) return null;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documents/${objectPath(path)}`, {
    method: "POST", signal: AbortSignal.timeout(20000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: seconds }),
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => ({}));
  const u = j.signedURL || j.signedUrl;
  return u ? `${PUBLIC_SUPABASE_URL}/storage/v1${u}` : null;
}

async function byToken(token) {
  if (!UUID.test(str(token))) return null;
  return await one(`contracts?share_token=eq.${enc(token)}&select=*`) || await one(`contracts?review_token=eq.${enc(token)}&select=*`);
}

let deliverEmail = null;
async function ownerEmail(userId) {
  if (!userId) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  return res?.ok ? str((await res.json().catch(() => ({}))).email) || null : null;
}
/** In-app alert, and an email to the contract owner for expiry, renewal and expiry reminders. */
async function notifyAndEmail(c, title, body) {
  await notify(c, title, body);
  if (!deliverEmail) return;
  const to = await ownerEmail(c.owner_id);
  if (!to) return;
  const t = await one(`tenants?id=eq.${c.tenant_id}&select=slug`).catch(() => null);
  const root = (process.env.ROOT_HOST || "garage.jmsurf.co.ke").replace(/^app./, "");
  const link = `https://${t?.slug ? t.slug : "app"}.${root}/contracts/${c.id}`;
  await deliverEmail(c.tenant_id, { to: [to], subject: title, text: `${body}

Open the contract: ${link}`, html: `<p style="font-size:15px;line-height:23px;margin:0">${body.replace(/[&<>]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[x])}</p><p style="margin-top:16px"><a href="${link}">Open the contract</a></p>` })
    .catch((e) => console.error("[contracts] email", e.message));
}
async function notify(c, title, body) {
  await db("shop_notifications", {
    method: "POST", prefer: "return=minimal",
    body: { tenant_id: c.tenant_id, kind: "contract", title, body, link: `/contracts/${c.id}`, user_id: c.owner_id || null, role: c.owner_id ? null : "admin", entity_type: "contract", entity_id: c.id },
  }).catch((e) => console.error("[contracts] notify", e.message));
}
const event = (c, kind, actor, body) => db("contract_events", { method: "POST", prefer: "return=minimal", body: { tenant_id: c.tenant_id, contract_id: c.id, kind, actor, body } })
  .catch((e) => console.error("[contracts] event", e.message));

/** Our signature and stamp, the contract file and the signed copy, as short links for the public page. */
async function assets(token) {
  const c = await byToken(token);
  if (!c || (c.status === "draft" && c.share_token === token)) return null;
  const req = await one(`signature_requests?doc_type=eq.contract&doc_id=eq.${c.id}&status=eq.signed&order=signed_at.desc&limit=1&select=signed_by,signed_by_name,signed_at`);
  const us = req?.signed_by ? await one(`user_signatures?tenant_id=eq.${c.tenant_id}&user_id=eq.${req.signed_by}&select=full_name,title,signature_path,stamp_path`) : null;
  const [signature_url, stamp_url, file_url, upload_url] = await Promise.all([
    signedUrl(us?.signature_path), signedUrl(us?.stamp_path), signedUrl(c.file_path), signedUrl(c.party_upload_path),
  ]);
  return {
    our: req ? { name: us?.full_name || req.signed_by_name, title: us?.title || null, at: req.signed_at, signature_url, stamp_url } : null,
    file_url, upload_url,
  };
}

const ALLOWED = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

/** "Print, sign and upload": the other party sends back the signed copy to the same link. */
async function upload(body) {
  const c = await byToken(body.token);
  if (!c || c.share_token !== body.token) return { status: 404, error: "This link is not valid" };
  if (!["sent", "amend_requested", "signed", "active"].includes(c.status)) return { status: 400, error: "This contract is not open for signing" };
  if (c.party_upload_path) return { status: 400, error: "A signed copy was already uploaded. Contact us to replace it." };
  const name = str(body.name).slice(0, 120);
  if (!name) return { status: 400, error: "Type your full name" };
  const ext = ALLOWED[str(body.type)];
  if (!ext) return { status: 400, error: "Upload a PDF, JPG or PNG" };
  const buf = Buffer.from(str(body.data).replace(/^data:[^,]*,/, ""), "base64");
  if (!buf.length || buf.length > 15 * 1024 * 1024) return { status: 400, error: "The file must be under 15 MB" };
  const path = `${c.tenant_id}/contracts/${c.id}/signed-by-party-${Date.now()}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/documents/${objectPath(path)}`, {
    method: "POST", signal: AbortSignal.timeout(60000), body: buf,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": str(body.type) },
  });
  if (!res.ok) return { status: 500, error: "The file could not be saved. Try again." };
  const status = c.status === "active" || c.status === "signed" ? c.status : c.start_date && c.start_date > new Date().toISOString().slice(0, 10) ? "signed" : "active";
  await db(`contracts?id=eq.${c.id}`, {
    method: "PATCH", prefer: "return=minimal",
    body: { party_upload_path: path, status, party_signer_name: c.party_signer_name || name, party_signed_at: c.party_signed_at || new Date().toISOString(), updated_at: new Date().toISOString() },
  });
  await event(c, "uploaded", name, "Uploaded the signed copy from the contract link");
  // Filed in Documents → Contracts, in this contract's folder.
  await db("documents", { method: "POST", prefer: "return=minimal", body: {
    tenant_id: c.tenant_id, entity_type: "contract", entity_id: c.id, entity_name: `${c.number} · ${c.party_name || ""} — ${c.title}`, name: `Signed copy from ${c.party_name || name}.${ext}`,
    category: "Signed copy (from the other party)", path, mime_type: str(body.type), size_bytes: buf.length, expires_on: c.end_date || null, uploaded_by_name: name,
  } }).catch((e) => console.error("[contracts] document", e.message));
  await notify(c, `${c.number}: signed copy received`, `${name} uploaded the signed copy of ${c.title}.`);
  return { status: 200, ok: true, contract_status: status };
}

export const isContractsPublicRoute = (p) => p === "/api/public/contract-assets" || p === "/api/public/contract-upload";

export async function handleContractsPublic(req, res, pathname, search, readJsonBody, sendJson) {
  if (!SUPABASE_URL || !SERVICE_KEY) return sendJson(res, 503, { error: "Not available right now" });
  try {
    if (pathname === "/api/public/contract-assets") {
      const a = await assets(new URLSearchParams(search || "").get("token"));
      return a ? sendJson(res, 200, a) : sendJson(res, 404, { error: "This link is not valid" });
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST" });
    const out = await upload(await readJsonBody(req, 22_000_000));
    return sendJson(res, out.status, out.status === 200 ? out : { error: out.error });
  } catch (e) {
    console.error("[contracts]", pathname, e);
    return sendJson(res, 500, { error: "Something went wrong" });
  }
}

// ------------------------------------------------------------------ daily job
const nairobiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

async function tick() {
  const today = nairobiToday();
  // Employment contracts keep the employee record (HRM) in step: its contract end date follows the contract.
  for (const c of await rows(`contracts?party_kind=eq.employee&party_id=not.is.null&status=in.(active,signed)&end_date=not.is.null&select=tenant_id,party_id,end_date`)) {
    await db(`hr_employees?id=eq.${c.party_id}&tenant_id=eq.${c.tenant_id}&or=(contract_end.is.null,contract_end.neq.${c.end_date})`, { method: "PATCH", prefer: "return=minimal", body: { contract_end: c.end_date } })
      .catch((e) => console.error("[contracts] hr sync", e.message));
  }
  // Signed contracts start on their start date.
  for (const c of await rows(`contracts?status=eq.signed&start_date=lte.${today}&select=id,tenant_id,number,title,owner_id`)) {
    await db(`contracts?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "active", updated_at: new Date().toISOString() } });
    await event(c, "note", "DASH", "The contract started today");
  }
  const live = await rows(`contracts?status=in.(active,signed)&end_date=not.is.null&end_date=lte.${addDays(today, 120)}&select=*`);
  for (const c of live) {
    const left = daysBetween(today, c.end_date);
    if (left < 0) {
      if (c.renewal === "auto") {
        const term = c.start_date ? Math.max(1, daysBetween(c.start_date, c.end_date)) : 365;
        const start = addDays(c.end_date, 1), end = addDays(start, term);
        await db(`contracts?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { start_date: start, end_date: end, reminded: [], updated_at: new Date().toISOString() } });
        await event(c, "renewed", "DASH", `Renewed automatically until ${end}`);
        await notifyAndEmail(c, `${c.number} renewed`, `${c.title} with ${c.party_name || "the other party"} renewed automatically until ${end}.`);
      } else {
        await db(`contracts?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "expired", updated_at: new Date().toISOString() } });
        await event(c, "expired", "DASH", "The contract reached its end date");
        await notifyAndEmail(c, `${c.number} has expired`, `${c.title} with ${c.party_name || "the other party"} ended on ${c.end_date}. Renew it or close it.`);
      }
      continue;
    }
    const marks = [...new Set([Number(c.notice_days) || 0, 30, 7, 1, 0])].filter((n) => n >= 0).sort((a, b) => b - a);
    const due = marks.find((n) => left <= n && !(c.reminded || []).includes(String(n)));
    if (due === undefined) continue;
    await db(`contracts?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { reminded: [...(c.reminded || []), ...marks.filter((n) => n >= due && left <= n).map(String)] } });
    const when = left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`;
    await event(c, "reminder", "DASH", `Ends ${when}`);
    await notifyAndEmail(c, `${c.number} ends ${when}`, `${c.title} with ${c.party_name || "the other party"} ends on ${c.end_date}.${c.renewal === "auto" ? " It renews automatically." : " Renew it, or give notice in time."}`);
  }
}

export function startContractJobs(deliver) {
  deliverEmail = deliver || null;
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await tick(); } catch (e) { console.error("[contracts] job failed", e.message); } finally { busy = false; }
  };
  setTimeout(run, 90_000).unref();
  setInterval(run, 60 * 60_000).unref();
}
