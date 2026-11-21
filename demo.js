// ---------------------------------------------------------------------------
// The public demo (link on the website): GET /api/demo/start opens the shared
// demo company on app.jmsurfgarage.co.ke, signed in with a one-time code, no
// account needed. Its data is put back every night (demo_reset in the
// database). Nothing leaves the demo: SMS, WhatsApp and email are switched off
// for it (isDemoTenant), and its login cannot be changed.
// ---------------------------------------------------------------------------
import { randomBytes } from "node:crypto";
import { APP_ORIGIN } from "./hosts.js";

const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";

export const DEMO_EMAIL = "demo@jmsurf.co.ke";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const rest = (p, init = {}) => fetch(`${URL_}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) }, signal: AbortSignal.timeout(60000) });
const rpc = async (fn) => { const r = await rest(`rpc/${fn}`, { method: "POST", body: "{}" }); return r.ok ? r.json() : null; };

let demoTenant = null;
/** True for the demo company (its messages never go out). */
export async function isDemoTenant(tenantId) {
  if (!tenantId) return false;
  if (demoTenant === null) {
    const r = await rest("tenants?slug=eq.demo&select=id&limit=1").catch(() => null);
    const rows = r?.ok ? await r.json() : [];
    demoTenant = rows[0]?.id || "";
  }
  return demoTenant === tenantId;
}

/** Creates the demo login and company the first time, with sample data. */
async function ensureDemo() {
  let t = await rpc("demo_prepare");
  if (t) return t;
  const apps = await (await rest("platform_modules?is_active=eq.true&included=eq.false&select=key")).json().catch(() => []);
  const res = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: "POST", headers: H, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      email: DEMO_EMAIL, password: randomBytes(24).toString("base64url"), email_confirm: true,
      user_metadata: {
        full_name: "Demo Garage Owner", registration_type: "tenant", business_name: "JMSURF Demo Garage", business_email: DEMO_EMAIL,
        business_phone: "0700000000", contact_name: "Demo Garage Owner", store_slug: "demo", industry: "Automotive", business_type: "general",
        country: "KE", currency: "KES", start_apps: (Array.isArray(apps) ? apps : []).map((a) => a.key),
        // The platform's own demo company (the database requires a terms record for every company).
        terms_accepted: true, terms_version: "2026-11-14", terms_source: "demo",
      },
    }),
  });
  if (!res.ok && res.status !== 422) throw new Error(`Could not create the demo (${res.status})`);
  t = await rpc("demo_prepare");
  await rpc("demo_reset");
  await rpc("demo_books");
  demoTenant = null;
  return t;
}

const hits = new Map();
export async function handleDemoStart(req, res) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((x) => now - x < 3600e3);
  if (list.length >= 30) { res.writeHead(429, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Too many demo visits from your network. Try again later."); }
  list.push(now); hits.set(ip, list); if (hits.size > 5000) hits.clear();
  try {
    await ensureDemo();
    const r = await fetch(`${URL_}/auth/v1/admin/generate_link`, { method: "POST", headers: H, signal: AbortSignal.timeout(15000), body: JSON.stringify({ type: "magiclink", email: DEMO_EMAIL }) });
    const j = await r.json().catch(() => ({}));
    const th = j.hashed_token || j.properties?.hashed_token;
    if (!r.ok || !th) throw new Error("no sign-in code");
    const url = `${APP_ORIGIN}/auth/handoff#th=${encodeURIComponent(th)}&co=demo&next=${encodeURIComponent("/dashboard")}`;
    // ?json=1: the website asks with fetch (a service worker cannot turn that into the app page).
    if (/[?&]json=1/.test(req.url || "")) { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify({ url })); }
    res.writeHead(302, { Location: url, "Cache-Control": "no-store" });
    return res.end();
  } catch (e) {
    console.error("[demo]", e.message);
    res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo unavailable</title><body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0"><div style="text-align:center;padding:24px"><h1>The demo is being refreshed</h1><p>Try again in a minute.</p><a href="/">Back to the website</a></div>`);
  }
}

/** Puts the demo data back every night at 03:00 Nairobi. */
export function startDemoReset() {
  if (!URL_ || !KEY) return;
  let last = "";
  setInterval(async () => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    const day = `${p.year}-${p.month}-${p.day}`;
    if (p.hour !== "03" || last === day) return;
    last = day;
    const r = await rpc("demo_reset").catch(() => null);
    await rpc("demo_prepare").catch(() => null);
    // Opening balances and months of trading, so the demo books show a healthy company.
    await rpc("demo_books").catch(() => null);
    console.log("[demo] nightly reset:", r);
  }, 10 * 60_000).unref();
}
