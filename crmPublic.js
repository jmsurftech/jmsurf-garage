// ---------------------------------------------------------------------------
// Website lead forms (CRM → Web forms). Any website posts a form to
//   POST /api/public/web-lead/<form key>
// as JSON (from the embed script) or as a plain HTML form. The lead is created in
// the company's CRM with the form's lead source, given to the form's people in
// turn, and they get a bell. A hidden "website_url" field catches robots.
// ---------------------------------------------------------------------------
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const clip = (v, n) => str(v).slice(0, n);
const esc = (s) => str(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function db(path, { method = "GET", body, prefer = "return=representation" } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(15000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  const j = t ? JSON.parse(t) : null;
  if (!res.ok) throw new Error(str(j?.message) || `Database replied ${res.status}`);
  return j;
}

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (list.length >= 20) return true;
  list.push(now); hits.set(ip, list); if (hits.size > 5000) hits.clear();
  return false;
}

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 50_000) break; chunks.push(c); }
  const raw = Buffer.concat(chunks).toString("utf8");
  const type = str(req.headers["content-type"]);
  if (type.includes("application/json")) { try { return JSON.parse(raw || "{}"); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
}

export const isCrmPublicRoute = (p) => p.startsWith("/api/public/web-lead/");

export async function handleCrmPublic(req, res, pathname) {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const reply = (status, body, asHtml, redirect) => {
    if (asHtml && redirect) { res.writeHead(303, { ...cors, Location: redirect }); return res.end(); }
    if (asHtml) {
      res.writeHead(status, { ...cors, "Content-Type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank you</title><body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh;margin:0;color:#1f2328"><div style="max-width:420px;padding:24px;text-align:center"><p style="font-size:17px">${esc(body.message || body.error)}</p><p><a href="javascript:history.back()">Back</a></p></div>`);
    }
    res.writeHead(status, { ...cors, "Content-Type": "application/json" });
    return res.end(JSON.stringify(body));
  };
  if (req.method !== "POST") return reply(405, { ok: false, error: "Method not allowed" });
  const asHtml = !str(req.headers["content-type"]).includes("application/json");
  const key = pathname.split("/").pop().replace(/[^a-f0-9]/gi, "");
  const ip = str(req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",")[0].trim();
  if (limited(ip)) return reply(429, { ok: false, error: "Too many messages from your network. Please try again later." }, asHtml);
  try {
    const form = (await db(`crm_web_forms?form_key=eq.${key}&active=is.true&select=*`))[0];
    if (!form) return reply(404, { ok: false, error: "This form is no longer available." }, asHtml);
    const b = await readBody(req);
    if (str(b.website_url)) return reply(200, { ok: true, message: form.thank_you }, asHtml, form.redirect_url);
    const v = (k, n = 200) => (form.fields.includes(k) ? clip(b[k], n) : "");
    const first = v("first_name", 80), last = v("last_name", 80), company = v("partner_name", 160), email = v("email", 160).toLowerCase(), phone = v("phone", 40);
    if (!last && !first && !company) return reply(400, { ok: false, error: "Please enter your name." }, asHtml);
    if (email && !EMAIL.test(email)) return reply(400, { ok: false, error: "That email address does not look right." }, asHtml);
    if (!email && !phone) return reply(400, { ok: false, error: "Please give an email address or a phone number." }, asHtml);
    const owner = form.owner_ids?.length
      ? await db("rpc/crm_next_assignee", { method: "POST", body: { p_tenant: form.tenant_id, p_key: `webform:${form.id}`, p_users: form.owner_ids } }).catch(() => null)
      : null;
    const person = [first, last].filter(Boolean).join(" ");
    const [lead] = await db("crm_leads", { method: "POST", body: {
      tenant_id: form.tenant_id, type: "lead", name: company || person || "Website lead", contact_name: person || null, first_name: first || null, last_name: last || person || company,
      partner_name: company || null, email: email || null, phone: phone || null, mobile: v("mobile", 40) || null, title: v("title", 120) || null, website: v("website", 200) || null,
      city: v("city", 80) || null, country: v("country", 80) || null, description: v("description", 4000) || null,
      source: form.lead_source || "Website", medium: `Web form: ${form.name}`, lead_status: "New", salesperson_id: owner || null,
    } });
    await db(`crm_web_forms?id=eq.${form.id}`, { method: "PATCH", prefer: "return=minimal", body: { submissions: Number(form.submissions || 0) + 1, last_submitted_at: new Date().toISOString() } }).catch(() => undefined);
    await db("shop_notifications", { method: "POST", prefer: "return=minimal", body: {
      tenant_id: form.tenant_id, user_id: owner || null, role: owner ? null : "admin", kind: "crm_lead",
      title: `New lead from ${form.name}: ${person || company}`, body: clip(b.description, 160) || email || phone, link: `/crm/leads/${lead.id}`, entity_type: "crm_lead", entity_id: lead.id,
    } }).catch(() => undefined);
    return reply(200, { ok: true, message: form.thank_you, redirect: form.redirect_url || null }, asHtml, form.redirect_url);
  } catch (e) {
    console.error("[web-lead]", e.message);
    return reply(500, { ok: false, error: "Your message could not be sent. Please try again." }, asHtml);
  }
}
