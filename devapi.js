// ---------------------------------------------------------------------------
// Developers & integrations.
//
//   Public REST API (company API key, "Authorization: Bearer jd_live_…"):
//     GET  /api/v1/company
//     GET  /api/v1/{customers|products|invoices|payments|quotes|sales-orders|bills}[?limit&offset&q&status&customer_id&updated_since]
//     GET  /api/v1/{resource}/{id}
//     POST /api/v1/customers, PATCH /api/v1/customers/{id}      (write keys)
//     POST /api/v1/products,  PATCH /api/v1/products/{id}       (write keys)
//   Settings (signed-in owner/manager): POST /api/erp/dev/{keys/create|keys/revoke|webhooks/test}
//   Webhooks: database triggers queue events (erp_webhook_queue); this delivers them signed
//   (X-JMSURF-Signature: t=…,v1=HMAC-SHA256(secret, t + "." + body)) with retries.
// ---------------------------------------------------------------------------
import { createHash, createHmac, randomBytes } from "node:crypto";

const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

async function db(path, { method = "GET", body, prefer = "return=representation", headers = {} } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { method, signal: AbortSignal.timeout(20000), headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: prefer, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text();
  const j = t ? JSON.parse(t) : null;
  if (!res.ok) throw new HttpError(res.status >= 500 ? 500 : 400, str(j?.message) || `Database replied ${res.status}`, "database_error");
  return { data: j, range: res.headers.get("content-range") };
}
const one = async (p) => (await db(p)).data?.[0] || null;

// ---- the public API -----------------------------------------------------------
const RESOURCES = {
  customers: { table: "customers", search: ["name", "phone", "email", "company_name"], write: ["name", "phone", "email", "address", "company_name", "kra_pin", "customer_type", "credit_limit", "notes", "tags"], required: ["name"] },
  products: { table: "products", search: ["name", "sku", "barcode"], write: ["name", "sku", "barcode", "price", "cost_price", "category", "description", "unit", "reorder_level", "is_active"], required: ["name", "sku", "price"] },
  invoices: { table: "invoices", search: ["invoice_number", "reference"], filters: ["status", "customer_id"] },
  payments: { table: "payments_received", search: ["reference"], filters: ["customer_id"] },
  quotes: { table: "quotes", search: ["quote_number", "reference"], filters: ["status", "customer_id"] },
  "sales-orders": { table: "sales_orders", search: ["reference"], filters: ["status", "customer_id"] },
  bills: { table: "bills", search: ["bill_number", "reference", "name"], filters: ["status"] },
};
const clean = (row) => { if (!row) return row; const { tenant_id, ...rest } = row; return rest; };

async function keyCaller(req) {
  const auth = str(req.headers.authorization);
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : str(req.headers["x-api-key"]);
  if (!/^jd_live_[A-Za-z0-9]{32}$/.test(key)) throw new HttpError(401, "Missing or invalid API key. Send Authorization: Bearer jd_live_…", "invalid_api_key");
  const row = await one(`erp_api_keys?key_hash=eq.${sha256(key)}&revoked_at=is.null&select=id,tenant_id,scopes,last_used_at`);
  if (!row) throw new HttpError(401, "This API key is not valid or was revoked", "invalid_api_key");
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 60_000) void db(`erp_api_keys?id=eq.${row.id}`, { method: "PATCH", prefer: "return=minimal", body: { last_used_at: new Date().toISOString() } }).catch(() => {});
  return { keyId: row.id, tenantId: row.tenant_id, write: (row.scopes || []).includes("write") };
}
const hits = new Map();
function limit(key, max) {
  const now = Date.now();
  const l = (hits.get(key) || []).filter((t) => now - t < 1000);
  if (l.length >= max) throw new HttpError(429, "Too many requests (10 per second per key). Slow down and retry.", "rate_limited");
  l.push(now); hits.set(key, l);
  if (hits.size > 20000) hits.clear();
}

async function api(req, url, body) {
  const who = await keyCaller(req);
  limit(who.keyId, 10);
  const parts = url.pathname.replace(/^\/api\/v1\/?/, "").replace(/\/+$/, "").split("/");
  const [name, id] = parts;
  if (name === "company" && req.method === "GET") {
    const t = await one(`tenants?id=eq.${who.tenantId}&select=business_name,slug,business_type,business_email,business_phone,business_address,logo_url`);
    return { status: 200, body: t };
  }
  const r = RESOURCES[name];
  if (!r || parts.length > 2) throw new HttpError(404, "Unknown endpoint. See /developers in your JMSURF Garage settings.", "not_found");
  if (id && !UUID.test(id)) throw new HttpError(404, "Not found", "not_found");
  const base = `${r.table}?tenant_id=eq.${who.tenantId}`;
  if (req.method === "GET" && id) {
    const row = await one(`${base}&id=eq.${id}&select=*`);
    if (!row) throw new HttpError(404, "Not found", "not_found");
    return { status: 200, body: clean(row) };
  }
  if (req.method === "GET") {
    const n = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    let q = `${base}&select=*&order=created_at.desc&limit=${n}&offset=${offset}`;
    for (const f of r.filters || []) { const v = str(url.searchParams.get(f)); if (v) q += `&${f}=eq.${encodeURIComponent(v)}`; }
    const since = str(url.searchParams.get("updated_since") || url.searchParams.get("created_since"));
    if (since && !Number.isNaN(Date.parse(since))) q += `&created_at=gte.${encodeURIComponent(new Date(since).toISOString())}`;
    const s = str(url.searchParams.get("q")).replace(/[(),*]/g, " ").trim();
    if (s) q += `&or=(${r.search.map((c) => `${c}.ilike.*${encodeURIComponent(s)}*`).join(",")})`;
    const res = await db(q, { headers: { Prefer: "count=exact" } });
    const total = Number(String(res.range || "").split("/")[1]) || 0;
    return { status: 200, body: { data: (res.data || []).map(clean), total, limit: n, offset, has_more: offset + n < total } };
  }
  if (!r.write) throw new HttpError(405, `${name} are read-only through the API`, "method_not_allowed");
  if (!who.write) throw new HttpError(403, "This key is read-only. Create a key with write access.", "insufficient_scope");
  const data = Object.fromEntries(Object.entries(body || {}).filter(([k]) => r.write.includes(k)));
  if (req.method === "POST" && !id) {
    for (const k of r.required) if (data[k] === undefined || data[k] === "") throw new HttpError(422, `\`${k}\` is required`, "validation_error");
    if (name === "products") { data.category = data.category || "General"; data.cost_price = data.cost_price ?? 0; }
    const res = await db(r.table, { method: "POST", body: { ...data, tenant_id: who.tenantId } });
    return { status: 201, body: clean(res.data?.[0]) };
  }
  if (req.method === "PATCH" && id) {
    if (!Object.keys(data).length) throw new HttpError(422, `Send at least one of: ${r.write.join(", ")}`, "validation_error");
    const res = await db(`${base}&id=eq.${id}`, { method: "PATCH", body: data });
    if (!res.data?.length) throw new HttpError(404, "Not found", "not_found");
    return { status: 200, body: clean(res.data[0]) };
  }
  throw new HttpError(405, "Method not allowed", "method_not_allowed");
}

// ---- settings (signed-in) -------------------------------------------------------
async function sessionCaller(req) {
  const auth = str(req.headers.authorization);
  if (!auth.startsWith("Bearer ")) throw new HttpError(401, "Sign in first");
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) throw new HttpError(401, "Sign in first");
  const user = await r.json();
  const prof = await one(`profiles?user_id=eq.${user.id}&select=tenant_id`);
  if (!prof?.tenant_id) throw new HttpError(403, "No company");
  const roles = (await db(`user_roles?user_id=eq.${user.id}&select=role`)).data.map((x) => String(x.role));
  if (!roles.some((x) => ["admin", "manager"].includes(x))) throw new HttpError(403, "Only owners and managers can manage API keys and webhooks");
  return { user, tenantId: prof.tenant_id };
}
const ALPHA = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SETTINGS = {
  "keys/create": async (who, b) => {
    const bytes = randomBytes(32);
    let s = ""; for (let i = 0; i < 32; i++) s += ALPHA[bytes[i] % ALPHA.length];
    const key = `jd_live_${s}`;
    const scopes = b.write ? ["read", "write"] : ["read"];
    const res = await db("erp_api_keys", { method: "POST", body: { tenant_id: who.tenantId, name: str(b.name).slice(0, 60) || "API key", prefix: key.slice(0, 14), key_hash: sha256(key), scopes, created_by: who.user.id } });
    return { id: res.data[0].id, key, scopes };
  },
  "keys/revoke": async (who, b) => { await db(`erp_api_keys?id=eq.${encodeURIComponent(str(b.id))}&tenant_id=eq.${who.tenantId}`, { method: "PATCH", prefer: "return=minimal", body: { revoked_at: new Date().toISOString() } }); return { ok: true }; },
  "webhooks/test": async (who, b) => {
    const h = await one(`erp_webhooks?id=eq.${encodeURIComponent(str(b.id))}&tenant_id=eq.${who.tenantId}&select=*`);
    if (!h) throw new HttpError(404, "Webhook not found");
    return deliverOne(h, "test.ping", { message: "Test event from JMSURF Garage" });
  },
};

export const isDevRoute = (p) => p.startsWith("/api/v1/") || p.startsWith("/api/erp/dev/");
export async function handleDev(req, res, pathname, readJsonBody, sendJson) {
  try {
    const url = new URL(req.url || "/", "http://x");
    if (pathname.startsWith("/api/v1/")) {
      if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, PATCH" }); return res.end(); }
      const body = ["POST", "PATCH"].includes(req.method) ? await readJsonBody(req).catch(() => { throw new HttpError(400, "The body must be JSON", "invalid_json"); }) : {};
      const out = await api(req, url, body);
      return sendJson(res, out.status, out.body);
    }
    const fn = SETTINGS[pathname.slice("/api/erp/dev/".length)];
    if (!fn || req.method !== "POST") throw new HttpError(404, "Unknown route");
    const who = await sessionCaller(req);
    return sendJson(res, 200, await fn(who, await readJsonBody(req).catch(() => ({}))));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("[devapi]", pathname, e);
    return sendJson(res, status, { error: status === 500 ? "Something went wrong" : e.message, code: e.code || (status === 500 ? "internal_error" : undefined) });
  }
}

// ---- webhook delivery ------------------------------------------------------------
async function deliverOne(h, event, data) {
  const body = JSON.stringify({ type: event, created_at: new Date().toISOString(), data });
  const ts = Math.floor(Date.now() / 1000);
  const sig = `t=${ts},v1=${createHmac("sha256", h.secret).update(`${ts}.${body}`).digest("hex")}`;
  const started = Date.now();
  const r = await fetch(h.url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json", "User-Agent": "JMSURF-DASH-Webhooks/1.0", "X-JMSURF-Event": event, "X-JMSURF-Signature": sig }, body }).catch((e) => ({ ok: false, status: 0, statusText: e.message }));
  const ms = Date.now() - started;
  const error = r.ok ? null : `HTTP ${r.status} ${r.statusText || ""}`.trim();
  await db(`erp_webhooks?id=eq.${h.id}`, { method: "PATCH", prefer: "return=minimal", body: { last_status: r.status, last_error: error, last_sent_at: new Date().toISOString() } }).catch(() => {});
  await db("erp_webhook_deliveries", { method: "POST", prefer: "return=minimal", body: { tenant_id: h.tenant_id, webhook_id: h.id, event, status: r.status, ms, error } }).catch(() => {});
  return { ok: !!r.ok, status: r.status, ms, error };
}

/** Signed delivery of one event to one of the company's webhooks (also used by workflow rules). */
export const deliverSignedWebhook = (h, event, data) => deliverOne(h, event, clean(data));

async function webhookTick() {
  const due = (await db(`erp_webhook_queue?done_at=is.null&next_at=lte.${encodeURIComponent(new Date().toISOString())}&select=*&order=id&limit=50`)).data || [];
  const hooksByTenant = new Map();
  for (const q of due) {
    if (!hooksByTenant.has(q.tenant_id)) hooksByTenant.set(q.tenant_id, (await db(`erp_webhooks?tenant_id=eq.${q.tenant_id}&is_active=is.true&select=*`)).data || []);
    const hooks = hooksByTenant.get(q.tenant_id).filter((h) => (h.events || []).includes(q.event));
    let failed = 0;
    for (const h of hooks) { const r = await deliverOne(h, q.event, clean(q.payload)); if (!r.ok) failed++; }
    const attempts = q.attempts + 1;
    if (!failed || attempts >= 6) {
      await db(`erp_webhook_queue?id=eq.${q.id}`, { method: "PATCH", prefer: "return=minimal", body: { done_at: new Date().toISOString(), attempts, last_error: failed ? "gave up after 6 tries" : null } });
    } else {
      // 1, 4, 16, 64, 256 minutes
      await db(`erp_webhook_queue?id=eq.${q.id}`, { method: "PATCH", prefer: "return=minimal", body: { attempts, next_at: new Date(Date.now() + 4 ** (attempts - 1) * 60_000).toISOString(), last_error: `${failed} endpoint(s) failed` } });
    }
  }
  // Delivered events are kept a week.
  if (Math.random() < 0.02) await db(`erp_webhook_queue?done_at=lt.${encodeURIComponent(new Date(Date.now() - 7 * 864e5).toISOString())}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
}

export function startWebhooks() {
  if (!URL_ || !KEY) return;
  let busy = false;
  setInterval(async () => {
    if (busy) return; busy = true;
    try { await webhookTick(); } catch (e) { console.error("[webhooks]", e.message); } finally { busy = false; }
  }, 15_000).unref();
}
