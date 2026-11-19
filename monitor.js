// ---------------------------------------------------------------------------
// Health monitoring inside the app server.
//
// * Uptime: every 5 minutes the website, database API and sign-in service are
//   checked and recorded. Two failures in a row send a "down" email; the
//   first success afterwards sends a "recovered" email.
// * Errors: browsers report crashes to /api/telemetry/error. Every 15 minutes
//   new errors are emailed as one summary.
// Alerts go to the support email in the admin settings.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";
const SITE_URL = (process.env.PUBLIC_ORIGIN || "https://garage.jmsurf.co.ke").replace(/\/+$/, "");

let sendMail = null; // injected by server.js: ({ to, subject, html, text }) => Promise

async function db(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

async function alertRecipient() {
  try {
    const rows = await db("platform_settings?key=eq.general&select=value&limit=1");
    return rows?.[0]?.value?.support_email || process.env.ALERT_EMAIL || "";
  } catch { return process.env.ALERT_EMAIL || ""; }
}

async function notify(subject, lines) {
  if (!sendMail) return;
  const to = await alertRecipient();
  if (!to) return;
  const text = lines.join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${lines.map((l) => `<p style="margin:0 0 8px">${escapeHtml(l)}</p>`).join("")}<p style="color:#888;font-size:12px">JMSURF Garage monitoring · ${new Date().toISOString()}</p></div>`;
  try { await sendMail({ to, subject: `[JMSURF Garage] ${subject}`, text, html }); }
  catch (e) { console.error("[monitor] alert email failed", e.message); }
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ------------------------------------------------------------- uptime */

const CHECKS = [
  { service: "Website", url: () => `${SITE_URL}/`, headers: {} },
  { service: "Database API", url: () => `${SUPABASE_URL}/rest/v1/plans?select=id&limit=1`, headers: () => ({ apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }) },
  { service: "Sign-in", url: () => `${SUPABASE_URL}/auth/v1/health`, headers: () => ({ apikey: ANON_KEY }) },
];
const state = new Map(); // service -> { fails, down }

async function runCheck(check) {
  const started = Date.now();
  try {
    const res = await fetch(check.url(), {
      headers: typeof check.headers === "function" ? check.headers() : check.headers,
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    const ms = Date.now() - started;
    return { ok: res.ok, ms, detail: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, detail: String(e?.cause?.code || e?.name || e?.message || "error").slice(0, 120) };
  }
}

async function uptimeTick() {
  const results = await Promise.all(CHECKS.map(async (c) => ({ service: c.service, ...(await runCheck(c)) })));
  try { await db("uptime_checks", { method: "POST", body: results, prefer: "return=minimal" }); }
  catch (e) { console.error("[monitor] could not save checks", e.message); }

  for (const r of results) {
    const s = state.get(r.service) || { fails: 0, down: false };
    if (r.ok) {
      if (s.down) await notify(`${r.service} is back up`, [`${r.service} is responding again (${r.ms} ms).`]);
      state.set(r.service, { fails: 0, down: false });
    } else {
      s.fails += 1;
      if (s.fails === 2 && !s.down) {
        s.down = true;
        await notify(`${r.service} is down`, [
          `${r.service} failed two checks in a row.`,
          `Last error: ${r.detail || "no response"}.`,
          `Status page: ${SITE_URL}/status`,
        ]);
      }
      state.set(r.service, s);
    }
  }
}

async function pruneOld() {
  const cutoff = new Date(Date.now() - 120 * 864e5).toISOString();
  await db(`uptime_checks?checked_at=lt.${cutoff}`, { method: "DELETE" }).catch(() => {});
  await db(`app_errors?created_at=lt.${cutoff}`, { method: "DELETE" }).catch(() => {});
}

/* ------------------------------------------------------------ errors */

const recent = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return list.length > 20;
}

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));

/** POST /api/telemetry/error — body: { message, stack, path, tenant_slug } */
export async function handleErrorReport(req, res, body, sendJson) {
  const ip = String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  if (rateLimited(ip)) return sendJson(res, 429, { ok: false });
  const message = clip(body?.message, 500);
  if (!message) return sendJson(res, 400, { ok: false });
  const stack = clip(body?.stack, 4000);
  const firstFrame = (stack || "").split("\n").slice(0, 2).join("|");
  const fingerprint = createHash("sha1").update(`${message}|${firstFrame}`).digest("hex").slice(0, 16);
  try {
    await db("app_errors", {
      method: "POST", prefer: "return=minimal",
      body: {
        fingerprint, message, stack,
        path: clip(body?.path, 300),
        source: body?.source === "server" ? "server" : "browser",
        tenant_slug: clip(body?.tenant_slug, 60),
        user_agent: clip(req.headers["user-agent"], 300),
      },
    });
  } catch (e) { console.error("[monitor] could not save error", e.message); }
  return sendJson(res, 200, { ok: true });
}

async function errorDigest() {
  const rows = await db("app_errors?emailed=eq.false&select=id,fingerprint,message,path,tenant_slug,created_at&order=created_at.asc&limit=500");
  if (!rows?.length) return;
  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r.fingerprint) || { message: r.message, count: 0, shops: new Set(), paths: new Set() };
    g.count++; if (r.tenant_slug) g.shops.add(r.tenant_slug); if (r.path) g.paths.add(r.path);
    groups.set(r.fingerprint, g);
  }
  const lines = [`${rows.length} new error report${rows.length === 1 ? "" : "s"} (${groups.size} different problem${groups.size === 1 ? "" : "s"}):`];
  for (const g of [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 15)) {
    lines.push(`• ${g.count}× ${g.message}${g.shops.size ? ` — shops: ${[...g.shops].slice(0, 5).join(", ")}` : ""}${g.paths.size ? ` — pages: ${[...g.paths].slice(0, 3).join(", ")}` : ""}`);
  }
  lines.push(`Details: ${SITE_URL}/admin/health`);
  await notify(`${rows.length} new app error${rows.length === 1 ? "" : "s"}`, lines);
  const ids = rows.map((r) => r.id).join(",");
  await db(`app_errors?id=in.(${ids})`, { method: "PATCH", body: { emailed: true } }).catch(() => {});
}

export function startMonitor(mailer) {
  sendMail = mailer;
  if (!SUPABASE_URL || !SERVICE_KEY) { console.warn("[monitor] not started: missing Supabase settings"); return; }
  let busyU = false, busyE = false;
  const u = async () => { if (busyU) return; busyU = true; try { await uptimeTick(); } catch (e) { console.error("[monitor]", e.message); } finally { busyU = false; } };
  const e = async () => { if (busyE) return; busyE = true; try { await errorDigest(); } catch (err) { console.error("[monitor] digest", err.message); } finally { busyE = false; } };
  setTimeout(u, 20_000).unref();
  setInterval(u, 5 * 60 * 1000).unref();
  setInterval(e, 15 * 60 * 1000).unref();
  setInterval(() => { pruneOld(); }, 24 * 3600 * 1000).unref();
}
