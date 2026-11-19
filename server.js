import "./fetchTimeout.js";
import { createServer } from "node:http";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { configurePayments, isPaymentsRoute, handlePaymentsRequest, startPayheroReconciler } from "./payments.js";
import { handleSendMoneyRequest, startSendMoneyReconciler, startInvoicePromptReconciler } from "./sendmoney.js";
import { configureStaff, isStaffRoute, handleStaffRequest, domainVerifyResponse } from "./staff.js";
import { shopBrand, brandHtml, serveBrandAsset, subdomainSlug } from "./shopBrand.js";
import { isGatewayRoute, handleGatewayRequest, startGatewayReconciler } from "./gateways.js";
import { startRecurringScheduler } from "./recurring.js";
import { startMonitor, handleErrorReport } from "./monitor.js";
import { isMessagingRoute, handleMessagingRequest } from "./messaging.js";
import { isHubRoute, handleHubRequest, startHubReconciler } from "./hub.js";
import { startReminders, isReminderRoute, handleReminderRequest } from "./reminders.js";
import { startCustomerAlerts } from "./alerts.js";
import { startEventAlerts } from "./events.js";
import { startWorkflows } from "./workflows.js";
import { archiveAssets, archivedAsset } from "./assetArchive.js";
import { isPlatformCrmRoute, handlePlatformCrm, startOwnerAlerts, handleLeadIntake } from "./platformcrm.js";
import { isCrmPublicRoute, handleCrmPublic } from "./crmPublic.js";
import { isCcBillingRoute, handleCcBilling, startCcBilling } from "./ccbilling.js";
import { isDevRoute, handleDev, startWebhooks } from "./devapi.js";
import { handleDemoStart, startDemoReset, isDemoTenant } from "./demo.js";
import { isWaterRoute, handleWaterRequest, startWaterAlerts } from "./water.js";
import { isGarageRoute, handleGarageRequest, startGarageJobs } from "./garage.js";
import { isShopRoute, handleShopRequest, setShopMailer } from "./shop.js";
import { isPortalUpload } from "./portal.js";
import { isErpRoute, handleErpRequest, startErpJobs } from "./erp.js";
import { isContractsPublicRoute, handleContractsPublic, startContractJobs } from "./contracts.js";
import { isHrPublicRoute, handleHrPublic } from "./hrPublic.js";
import { isPayLinkRoute, handlePayLink, startPayLinkReconciler } from "./paylinks.js";
import { startNoteJobs } from "./notes.js";
import { isAiRoute, handleAiRequest } from "./ai.js";
import { startMigrationJobs, handleMigrateCallback, handleQboCallback, handleSourceCallback } from "./migrate.js";
import { isEngageRoute, handleEngageRequest, startEngageJobs } from "./engage.js";
import { requestStore, isPlatformAdmin } from "./platform.js";
import { noindexHtml, indexableHtml, companyRobots, companyRobotsTxt, companySitemap } from "./companySeo.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "dist");
const indexFile = path.join(distDir, "index.html");

// Website pages with their text already in the HTML for search engines, AI assistants and
// link previews (written by scripts/prerender.mjs at build time; path → snapshot file).
const seoDir = path.join(__dirname, "seo-pages");
let seoRoutes = {};
try { seoRoutes = JSON.parse(readFileSync(path.join(seoDir, "routes.json"), "utf8")); } catch { /* not built: plain page everywhere */ }
const SITE_HOST = "garage.jmsurf.co.ke";
/** The website itself; every other garage.jmsurf.co.ke address is a workspace (kept out of search results). */
const isWorkspaceHost = (host) => host.endsWith(`.${SITE_HOST}`) && host !== `www.${SITE_HOST}`;
const port = Number(process.env.PORT || 3000);

// A standalone deployment (one shop on its own domain) sets SHOP_ORIGIN, e.g.
// https://garage.jmsurf.co.ke; otherwise each shop lives on <slug>.garage.jmsurf.co.ke.
const SHOP_ORIGIN = (process.env.SHOP_ORIGIN || "").replace(/\/+$/, "");
const shopOrigin = (slug) => SHOP_ORIGIN || `https://${slug}.garage.jmsurf.co.ke`;
/** Staff sign in and work on app.garage.jmsurf.co.ke (the company comes from the membership): links in staff emails go there. */
const STAFF_ORIGIN = SHOP_ORIGIN || (process.env.APP_ORIGIN || "https://app.garage.jmsurf.co.ke").replace(/\/+$/, "");

// Backend address used to verify the signed-in user and read the saved
// email settings. Falls back to the values baked in at build time.
const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ""
).replace(/\/+$/, "");
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.JMSURF_SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const DB_ORIGINS = (() => {
  const u = (process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  return u.startsWith("https://") ? `${u} ${u.replace(/^https:/, "wss:")}` : "";
})();

// Only this app's own code runs; data comes from the JMSURF database and API
// addresses; card checkout opens on Paystack. Injected scripts are refused.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Cloudflare adds its Web Analytics beacon to every page.
  // Meta Pixel and Google Analytics load only when their IDs are set (see /tracking.js).
  "script-src 'self' 'inline-speculation-rules' https://static.cloudflareinsights.com https://connect.facebook.net https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  // The database lives on the website address; the staff ERP (its own address) calls it there too.
  `connect-src 'self' blob: data: ${DB_ORIGINS} https://garage.jmsurf.co.ke https://*.garage.jmsurf.co.ke wss://*.garage.jmsurf.co.ke https://cloudflareinsights.com https://www.facebook.com https://connect.facebook.net https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'self' blob: https://app.jmsurfcallcentre.co.ke https://checkout.paystack.com https://*.paystack.co https://www.youtube-nocookie.com https://player.vimeo.com",
  "form-action 'self' https://checkout.paystack.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join("; ");

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function resolveFilePath(urlPath) {
  const safePath = decodeURIComponent(urlPath.split("?")[0]);
  const requestedPath = safePath === "/" ? "/index.html" : safePath;
  const fullPath = path.normalize(path.join(distDir, requestedPath));

  if (!fullPath.startsWith(distDir)) {
    return null;
  }

  return fullPath;
}

// A shop's own domain (e.g. order.myshop.co.ke) is served by this app too.
// The page is stamped with the shop's slug so it starts exactly like the
// shop's garage.jmsurf.co.ke subdomain. Lookups are cached for a minute.
const domainCache = new Map();
async function customDomainSlug(rawHost) {
  const host = String(rawHost || "").split(":")[0].trim().toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || /^[\d.]+$/.test(host) || host === "garage.jmsurf.co.ke" || host.endsWith(".garage.jmsurf.co.ke")) return null;
  if (!/^[a-z0-9.-]{3,253}$/.test(host) || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const hit = domainCache.get(host);
  if (hit && hit.until > Date.now()) return hit.slug;
  let slug = null;
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_domains?host=eq.${encodeURIComponent(host)}&kind=eq.custom&status=in.(approved,active)&select=tenants(slug,is_active,deleted_at)&limit=1`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }, signal: AbortSignal.timeout(5000) },
    );
    const [row] = response.ok ? await response.json() : [];
    const t = row?.tenants;
    if (t?.slug && t.is_active && !t.deleted_at) slug = t.slug;
  } catch { return hit?.slug ?? null; }
  domainCache.set(host, { slug, until: Date.now() + 60_000 });
  if (domainCache.size > 5000) domainCache.clear();
  return slug;
}

/** Whether a company has switched its public website on (Settings → Website); cached a minute. */
const siteEnabledCache = new Map();
async function companySiteEnabled(slug) {
  const hit = siteEnabledCache.get(slug);
  if (hit && hit.until > Date.now()) return hit.on;
  let on = false;
  try {
    const h = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
    const tr = await fetch(`${SUPABASE_URL}/rest/v1/tenants?slug=eq.${encodeURIComponent(slug)}&is_active=eq.true&deleted_at=is.null&select=id&limit=1`, { headers: h, signal: AbortSignal.timeout(5000) });
    const [t] = tr.ok ? await tr.json() : [];
    if (t?.id) {
      const sr = await fetch(`${SUPABASE_URL}/rest/v1/business_settings?tenant_id=eq.${t.id}&select=erp_settings&limit=1`, { headers: h, signal: AbortSignal.timeout(5000) });
      const [row] = sr.ok ? await sr.json() : [];
      on = row?.erp_settings?.shop?.site_enabled === true;
    }
  } catch { return hit?.on ?? false; }
  siteEnabledCache.set(slug, { on, until: Date.now() + 60_000 });
  if (siteEnabledCache.size > 5000) siteEnabledCache.clear();
  return on;
}

/** The company whose address this is (subdomain or custom domain), with its website state; null elsewhere. */
async function companyAddress(req) {
  const host = shopHost(req);
  const slug = (await customDomainSlug(host)) || subdomainSlug(host);
  if (!slug) return null;
  return { slug, origin: `https://${host}`, siteEnabled: SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? await companySiteEnabled(slug) : false };
}

/** The address the visitor used (a shop worker may forward it). */
function shopHost(req) {
  const fwd = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const raw = /\.garage\.jmsurf\.co\.ke$/i.test(fwd.split(":")[0]) ? fwd : req.headers.host;
  return String(raw || "").split(":")[0].trim().toLowerCase();
}

async function fileExists(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Email service
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}

async function readJsonBody(req, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

/** Confirms the caller is signed in; returns the user record. */
async function requireUser(req) {
  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { error: "Sign in first", status: 401 };
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { error: "The server is missing its backend address", status: 500 };
  }

  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
  });
  if (!userResponse.ok) {
    return { error: "Sign in first", status: 401 };
  }
  const user = await userResponse.json();
  if (!user?.id) return { error: "Sign in first", status: 401 };
  return { user, authHeader };
}

/** Confirms the caller is signed in and is the platform owner (super admin). */
async function requireSuperAdmin(req) {
  const base = await requireUser(req);
  if (base.error) return base;

  const isAdmin = await isPlatformAdmin(base.user.id, req);
  if (isAdmin !== true) {
    return { error: "Only the platform owner can do this", status: 403 };
  }

  return base;
}


/** Email settings taken straight from the server's own configuration. */
function envSmtp() {
  const host = process.env.SMTP_HOST || "";
  const username = process.env.SMTP_USERNAME || process.env.SMTP_USER || "";
  const password = process.env.SMTP_PASSWORD || process.env.SMTP_PASS || "";
  if (!host || !username || !password) return null;
  return {
    host,
    port: process.env.SMTP_PORT || "465",
    username,
    password,
    from_email: process.env.SMTP_FROM_EMAIL || username,
    from_name: process.env.SMTP_FROM_NAME || "JMSURF Garage",
    encryption: process.env.SMTP_ENCRYPTION || "",
    provider: process.env.RESEND_API_KEY ? "resend" : "",
    resend_api_key: process.env.RESEND_API_KEY || "",
  };
}

/**
 * Reads the email settings saved in the admin portal. Tries the backend key,
 * then the signed-in caller, then the server's own settings, so mail keeps
 * going out even when one of those is missing.
 */
async function loadSavedSmtp(authHeader) {
  const attempts = [];
  if (SUPABASE_SERVICE_ROLE_KEY) {
    attempts.push({
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    });
  }
  if (SUPABASE_ANON_KEY && authHeader) {
    attempts.push({ apikey: SUPABASE_ANON_KEY, Authorization: authHeader });
  }
  if (SUPABASE_ANON_KEY) attempts.push({ apikey: SUPABASE_ANON_KEY });

  if (SUPABASE_URL) {
    for (const headers of attempts) {
      try {
        const response = await fetch(
          `${SUPABASE_URL}/rest/v1/platform_settings?key=eq.smtp&select=value&limit=1`,
          { headers },
        );
        if (!response.ok) continue;
        const rows = await response.json();
        const value = rows?.[0]?.value;
        if (value && (value.host || value.resend_api_key)) return value;
      } catch {
        // try the next way in
      }
    }
  }

  return envSmtp();
}

function normalizeSmtp(raw) {
  if (!raw || !raw.host || !raw.username || !raw.password) return null;
  const port = parseInt(String(raw.port || "465"), 10) || 465;
  const encryptionInput = String(raw.encryption || "").trim().toLowerCase();
  let encryption = encryptionInput;
  if (!encryption) encryption = port === 465 ? "ssl" : "starttls";
  if (["smtps", "tls_ssl"].includes(encryption)) encryption = "ssl";
  if (encryption === "tls") encryption = "starttls";

  return {
    host: String(raw.host).trim(),
    port,
    username: String(raw.username).trim(),
    password: String(raw.password),
    fromEmail: String(raw.from_email || raw.fromEmail || raw.username).trim(),
    fromName: String(raw.from_name || raw.fromName || "JMSURF Garage").trim(),
    encryption,
  };
}

/**
 * Reads Resend settings out of the saved email settings.
 * Returns null when Resend is not the selected provider.
 */
function normalizeResend(raw) {
  if (!raw) return null;
  const provider = String(raw.provider || "").trim().toLowerCase();
  const apiKey = String(raw.resend_api_key || raw.resendApiKey || "").trim();
  if (provider !== "resend" || !apiKey) return null;
  const fromEmail = String(raw.from_email || raw.fromEmail || "").trim();
  if (!fromEmail) return null;
  return {
    provider: "resend",
    apiKey,
    fromEmail,
    fromName: String(raw.from_name || raw.fromName || "JMSURF Garage").trim(),
  };
}

// JMSURF Mail (api.jmsurfmail.co.ke) is the first route for every email DASH sends, from
// noreply@jmsurf.co.ke; the saved Resend/SMTP settings stay as the backup route.
const JMSURF_MAIL_KEY = process.env.JMSURF_MAIL_KEY || "";
const JMSURF_MAIL_FROM = process.env.JMSURF_MAIL_FROM || "JMSURF Garage <noreply@jmsurf.co.ke>";
const JMSURF_MAIL_URL = (process.env.JMSURF_MAIL_URL || "https://api.jmsurfmail.co.ke").replace(/\/+$/, "");

/** Sends through JMSURF Mail; null when it is not configured. */
async function sendViaJmsurfMail({ to, subject, html, text, replyTo, fromName, attachments, bcc }) {
  if (!JMSURF_MAIL_KEY) return null;
  const address = (JMSURF_MAIL_FROM.match(/<([^>]+)>/) || [null, JMSURF_MAIL_FROM])[1].trim();
  const name = String(fromName || JMSURF_MAIL_FROM.replace(/\s*<.*$/, "") || "JMSURF Garage").replace(/[<>"]/g, "").trim();
  const from = name ? `${name} <${address}>` : address;
  const recipients = Array.isArray(to) ? to : [to];
  try {
    const response = await fetch(`${JMSURF_MAIL_URL}/api/v1/emails`, {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${JMSURF_MAIL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: recipients, subject, html: html || undefined, text: text || undefined, reply_to: replyTo || undefined,
        bcc: bcc?.length ? bcc : undefined, tags: ["dash"],
        attachments: attachments?.length ? attachments.map((a) => ({ filename: a.filename, content: a.content, content_type: a.contentType })) : undefined,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, stage: "sent", from, server: "JMSURF Mail", accepted: recipients, response: `JMSURF Mail accepted the message (id ${payload?.id || "unknown"})` };
    return { ok: false, stage: "send", from, server: "JMSURF Mail", error: payload?.error || `JMSURF Mail replied with ${response.status}` };
  } catch (error) {
    return { ok: false, stage: "connect", from, server: "JMSURF Mail", error: `Could not reach JMSURF Mail. ${error?.message || String(error)}` };
  }
}

/** Sends one message through the Resend API. */
async function sendViaResend(config, { to, subject, html, text, replyTo, attachments }) {
  const from = config.fromName ? `${config.fromName} <${config.fromEmail}>` : config.fromEmail;
  const recipients = Array.isArray(to) ? to : [to];
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        html: html || undefined,
        text: text || undefined,
        reply_to: replyTo || undefined,
        attachments: attachments?.length ? attachments.map((a) => ({ filename: a.filename, content: a.content })) : undefined,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        stage: "send",
        from,
        server: "Resend",
        error: payload?.message || payload?.error?.message || `Resend replied with ${response.status}`,
      };
    }
    return {
      ok: true,
      stage: "sent",
      from,
      server: "Resend",
      accepted: recipients,
      response: `Resend accepted the message (id ${payload?.id || "unknown"})`,
    };
  } catch (error) {
    return {
      ok: false,
      stage: "connect",
      from,
      server: "Resend",
      error: `Could not reach Resend. ${error?.message || String(error)}`,
    };
  }
}

function buildTransport(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.encryption === "ssl" || config.port === 465,
    requireTLS: config.encryption === "starttls",
    auth: { user: config.username, pass: config.password },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
    // Certificates are checked unless the operator explicitly opts out.
    tls: { rejectUnauthorized: process.env.SMTP_TLS_INSECURE !== "true" },
  });
}

function describeMailError(error) {
  const code = error?.code || "";
  const message = error?.response || error?.message || String(error);
  if (code === "EAUTH") {
    return `The mail server rejected the username or password. ${message}`;
  }
  if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ESOCKET") {
    return `Could not connect to the mail server. ${message}`;
  }
  if (code === "EENVELOPE") {
    return `The mail server refused the sender or recipient address. ${message}`;
  }
  return message;
}

async function handleEmailTest(req, res) {
  const auth = await requireSuperAdmin(req);
  if (auth.error) return sendJson(res, auth.status, { ok: false, error: auth.error });

  const body = await readJsonBody(req);
  const to = String(body.to || auth.user.email || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return sendJson(res, 400, { ok: false, error: "Enter a valid email address to send the test to" });
  }

  // Prefer the values typed into the form so the test reflects what is on screen.
  const saved = await loadSavedSmtp(auth.authHeader);
  const resend = normalizeResend(body.smtp) || normalizeResend(saved);
  if (resend) {
    const result = await sendViaResend(resend, {
      to,
      subject: "JMSURF Garage email test",
      text: "This is a test message from JMSURF Garage. Your email settings are working.",
      html: "<p>This is a test message from JMSURF Garage.</p><p>Your email settings are working.</p>",
    });
    return sendJson(res, 200, { ...result, to });
  }

  const config = normalizeSmtp(body.smtp) || normalizeSmtp(saved);
  if (!config) {
    return sendJson(res, 200, {
      ok: false,
      stage: "settings",
      error: "No email settings were found. Fill in the server, username and password, then press Save & Sync.",
    });
  }

  const server = `${config.host}:${config.port} (${config.encryption})`;
  const transport = buildTransport(config);

  try {
    await transport.verify();
  } catch (error) {
    transport.close();
    return sendJson(res, 200, {
      ok: false,
      stage: "connect",
      server,
      error: describeMailError(error),
    });
  }

  const from = config.fromName
    ? `${config.fromName} <${config.fromEmail}>`
    : config.fromEmail;

  try {
    const info = await transport.sendMail({
      from,
      to,
      subject: "JMSURF Garage email test",
      text: "This is a test message from JMSURF Garage. Your email settings are working.",
      html: "<p>This is a test message from JMSURF Garage.</p><p>Your email settings are working.</p>",
    });
    return sendJson(res, 200, {
      ok: true,
      stage: "sent",
      to,
      from,
      server,
      accepted: info.accepted,
      response: info.response,
    });
  } catch (error) {
    return sendJson(res, 200, {
      ok: false,
      stage: "send",
      server,
      from,
      error: describeMailError(error),
    });
  } finally {
    transport.close();
  }
}

/** Tells the admin portal why email or account tools are unavailable. */
async function handleEmailStatus(req, res) {
  const auth = await requireSuperAdmin(req);
  if (auth.error) return sendJson(res, auth.status, { ok: false, error: auth.error });

  const saved = await loadSavedSmtp(auth.authHeader);
  const resend = normalizeResend(saved);
  const smtp = normalizeSmtp(saved);
  return sendJson(res, 200, {
    ok: true,
    backendKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    emailReady: Boolean(JMSURF_MAIL_KEY || resend || smtp),
    method: JMSURF_MAIL_KEY ? `JMSURF Mail (backup: ${resend ? "Resend" : smtp ? "SMTP" : "none"})` : resend ? "Resend" : smtp ? "SMTP" : "none",
    host: smtp?.host || null,
    from: JMSURF_MAIL_KEY ? JMSURF_MAIL_FROM : resend?.fromEmail || smtp?.fromEmail || null,
  });
}

async function handleEmailSend(req, res) {
  const auth = await requireSuperAdmin(req);
  if (auth.error) return sendJson(res, auth.status, { ok: false, error: auth.error });

  const body = await readJsonBody(req);
  const recipients = (Array.isArray(body.to) ? body.to : [body.to])
    .map((address) => String(address || "").trim())
    .filter(Boolean);
  if (recipients.length === 0) {
    return sendJson(res, 400, { ok: false, error: "A recipient email address is required" });
  }
  if (!body.subject || !(body.html || body.text)) {
    return sendJson(res, 400, { ok: false, error: "A subject and message are required" });
  }

  const viaMail = await sendViaJmsurfMail({ to: recipients, subject: String(body.subject), html: body.html, text: body.text, replyTo: body.replyTo, fromName: body.fromName });
  if (viaMail?.ok) return sendJson(res, 200, viaMail);
  const saved = await loadSavedSmtp(auth.authHeader);
  const resend = normalizeResend(saved);
  if (resend) {
    const result = await sendViaResend(resend, {
      to: recipients,
      subject: String(body.subject),
      html: body.html,
      text: body.text,
      replyTo: body.replyTo,
    });
    return sendJson(res, 200, result);
  }

  const config = normalizeSmtp(saved);
  if (!config) {
    return sendJson(res, 200, { ok: false, stage: "settings", error: "Email settings are not saved yet" });
  }

  const transport = buildTransport(config);
  const from = config.fromName
    ? `${body.fromName || config.fromName} <${config.fromEmail}>`
    : config.fromEmail;

  try {
    const info = await transport.sendMail({
      from,
      to: recipients,
      replyTo: body.replyTo || undefined,
      subject: String(body.subject),
      text: body.text || undefined,
      html: body.html || undefined,
    });
    return sendJson(res, 200, { ok: true, from, accepted: info.accepted, response: info.response });
  } catch (error) {
    return sendJson(res, 200, { ok: false, stage: "send", from, error: describeMailError(error) });
  } finally {
    transport.close();
  }
}

// --- Shared helpers for the system emails ------------------------------------

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Wraps message content in the JMSURF Garage email shell. */
function emailShell(title, innerHtml) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background-color:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
<tr><td style="padding:28px 32px;">
<p style="margin:0 0 18px;font-size:18px;font-weight:bold;color:#0f172a;">JMSURF Garage</p>
<p style="margin:0 0 14px;font-size:16px;font-weight:bold;color:#0f172a;">${esc(title)}</p>
${innerHtml}
<p style="margin:24px 0 0;font-size:13px;line-height:20px;color:#6b7280;">JMSURF Garage · Powered by JMSURF TECHNOLOGIES, Nairobi, Kenya<br>Support: jmsurftech@gmail.com</p>
</td></tr></table></td></tr></table></body></html>`;
}

/** Sends a message using the email settings saved in the admin portal. */
async function deliverSavedSmtp({ to, subject, html, text, replyTo }) {
  const viaMail = await sendViaJmsurfMail({ to, subject, html, text, replyTo });
  if (viaMail?.ok) return viaMail;
  if (viaMail) console.warn("[mail] JMSURF Mail failed, using the backup route:", viaMail.error);
  const saved = await loadSavedSmtp();
  const resend = normalizeResend(saved);
  if (resend) {
    return sendViaResend(resend, { to, subject, html, text, replyTo });
  }
  const config = normalizeSmtp(saved);
  if (!config) {
    return { ok: false, stage: "settings", error: "Email settings are not saved yet" };
  }
  const transport = buildTransport(config);
  const from = config.fromName
    ? `${config.fromName} <${config.fromEmail}>`
    : config.fromEmail;
  try {
    const info = await transport.sendMail({ from, to, subject, html, text, replyTo });
    return { ok: true, from, accepted: info.accepted, response: info.response };
  } catch (error) {
    return { ok: false, stage: "send", from, error: describeMailError(error) };
  } finally {
    transport.close();
  }
}

const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// --- Shop mail servers --------------------------------------------------------

/** A shop's own mail server, or null when it uses the JMSURF mail server. */
async function tenantSmtp(tenantId) {
  if (!tenantId || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const [s] = await adminRows(
    `business_settings?tenant_id=eq.${encodeURIComponent(tenantId)}` +
      `&select=use_platform_smtp,smtp_host,smtp_port,smtp_username,smtp_password,smtp_from_email,smtp_from_name,smtp_encryption,business_name,business_email,erp_settings&limit=1`,
  );
  // Replies go to the company (System → Email: reply-to), never to JMSURF; optional copies of everything sent.
  const em = s?.erp_settings?.email || {};
  const valid = (v) => (emailRegex.test(String(v || "").trim()) ? String(v).trim() : null);
  const replyTo = valid(em.reply_to) || valid(s?.business_email) || null;
  const bcc = String(em.bcc || "").split(/[,;\s]+/).map(valid).filter(Boolean).slice(0, 3);
  // Sender per purpose (System → Email → Who sends what): { quotes: { email, name }, invoices: …, other: … }.
  const senders = {};
  for (const [k, v] of Object.entries(em.senders || {})) if (v && (valid(v.email) || String(v.name || "").trim())) senders[k] = { email: valid(v.email), name: String(v.name || "").trim() || null };
  if (!s || s.use_platform_smtp || !s.smtp_host || !s.smtp_username || !s.smtp_password) return { shopName: em.from_name || s?.business_name || null, config: null, replyTo, bcc, senders };
  return {
    shopName: s.business_name || null, replyTo, bcc, senders,
    config: normalizeSmtp({
      host: s.smtp_host, port: s.smtp_port, username: s.smtp_username, password: s.smtp_password,
      from_email: s.smtp_from_email || s.smtp_username, from_name: s.smtp_from_name || s.business_name,
      encryption: s.smtp_encryption === "tls" ? "starttls" : s.smtp_encryption,
    }),
  };
}

/** Sends through one SMTP configuration. */
async function sendViaSmtp(config, { to, subject, html, text, replyTo, fromName, attachments, bcc }) {
  const transport = buildTransport(config);
  const from = `${fromName || config.fromName} <${config.fromEmail}>`;
  try {
    const files = (attachments || []).map((a) => ({ filename: a.filename, content: Buffer.from(a.content, "base64"), contentType: a.contentType }));
    const info = await transport.sendMail({ from, to, subject, html, text, replyTo, bcc: bcc?.length ? bcc : undefined, attachments: files.length ? files : undefined });
    return { ok: true, from, server: `${config.host}:${config.port}`, accepted: info.accepted, response: info.response };
  } catch (error) {
    return { ok: false, stage: "send", from, server: `${config.host}:${config.port}`, error: describeMailError(error) };
  } finally {
    transport.close();
  }
}

/**
 * Sends a shop's email: through its own mail server when it has saved one,
 * otherwise through the JMSURF mail server with the shop's name as sender.
 */
async function deliverForTenant(tenantId, message) {
  // Nothing leaves the public demo.
  if (await isDemoTenant(tenantId)) return { ok: true, demo: true, from: "demo" };
  const shop = await tenantSmtp(tenantId);
  // The sender chosen for this kind of email (quotes, invoices, statements…), else "everything else", else the default.
  const who = shop?.senders?.[message.purpose] || shop?.senders?.other || null;
  message = { ...message, replyTo: message.replyTo || who?.email || shop?.replyTo || undefined, bcc: shop?.bcc };
  if (shop?.config) {
    // The company's own mail server sends from that address (its provider must allow it).
    const config = who?.email ? { ...shop.config, fromEmail: who.email } : shop.config;
    return sendViaSmtp(config, { ...message, fromName: who?.name || shop.config.fromName });
  }
  // The JMSURF mail server sends from its own address with the company's name; replies go to the chosen address.
  const fromName = who?.name || shop?.shopName || undefined;
  const viaMail = await sendViaJmsurfMail({ ...message, fromName });
  if (viaMail?.ok) return viaMail;
  if (viaMail) console.warn("[mail] JMSURF Mail failed for a company email, using the backup route:", viaMail.error);
  const saved = await loadSavedSmtp();
  const resend = normalizeResend(saved);
  if (resend) return sendViaResend({ ...resend, fromName: fromName || resend.fromName }, message);
  const config = normalizeSmtp(saved);
  if (!config) return { ok: false, stage: "settings", error: "No mail server is configured yet" };
  return sendViaSmtp(config, { ...message, fromName: fromName || config.fromName });
}

/** Owner/manager test of the shop's email setup (own server or JMSURF's). */
async function handleTenantEmailTest(req, res) {
  const auth = await requireUser(req);
  if (auth.error) return sendJson(res, auth.status, { ok: false, error: auth.error });
  const [profile] = await adminRows(`profiles?user_id=eq.${encodeURIComponent(auth.user.id)}&select=tenant_id&limit=1`);
  const roles = (await adminRows(`user_roles?user_id=eq.${encodeURIComponent(auth.user.id)}&select=role`)).map((r) => String(r.role));
  if (!profile?.tenant_id || !roles.some((r) => ["admin", "manager", "super_admin"].includes(r))) {
    return sendJson(res, 403, { ok: false, error: "Only the shop owner or a manager can test email" });
  }
  const body = await readJsonBody(req);
  const to = String(body.to || "").trim();
  if (!emailRegex.test(to)) return sendJson(res, 400, { ok: false, error: "Enter a valid email address" });
  if (throttled(`tenant-test:${auth.user.id}`, 15_000)) {
    return sendJson(res, 429, { ok: false, error: "Wait a few seconds before sending another test" });
  }

  const shop = await tenantSmtp(profile.tenant_id);
  const message = {
    to,
    subject: "Email test from JMSURF Garage",
    text: "Your shop's email settings are working.",
    html: emailShell("Email is working", `<p style="margin:0;font-size:15px;line-height:22px;">Receipts and messages from <strong>${esc(shop?.shopName || "your shop")}</strong> will reach customers.</p>`),
  };

  // Test the values typed on screen when an own server is being set up.
  const typed = body.smtp && !body.use_platform ? body.smtp : null;
  if (typed?.host) {
    const stored = shop?.config;
    const config = normalizeSmtp({
      host: typed.host, port: typed.port, username: typed.username,
      password: typed.password || stored?.password || "",
      from_email: typed.from_email || typed.username, from_name: typed.from_name || shop?.shopName,
      encryption: typed.encryption === "tls" ? "starttls" : typed.encryption,
    });
    if (!config) return sendJson(res, 400, { ok: false, error: "Fill in the server, username and password" });
    return sendJson(res, 200, { ...(await sendViaSmtp(config, message)), via: "shop" });
  }
  const result = await deliverForTenant(profile.tenant_id, message);
  return sendJson(res, 200, { ...result, via: shop?.config ? "shop" : "jmsurf" });
}
const recentSends = new Map();

/** Keeps public routes from being used to spray email. */
function throttled(key, ms = 45_000) {
  const now = Date.now();
  const last = recentSends.get(key) || 0;
  if (now - last < ms) return true;
  recentSends.set(key, now);
  if (recentSends.size > 5000) recentSends.clear();
  return false;
}

/** Admin (service key) REST read; returns the rows or []. */
/**
 * Where a company address that no longer belongs to a company should go: an old slug forwards to the
 * company's current address, an address never used goes to the company finder. Any lookup error means
 * "serve the page as usual", so a database hiccup never sends a real company's visitors away.
 */
const slugMoves = new Map();
async function slugMove(host) {
  const slug = subdomainSlug(host);
  if (!slug || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const hit = slugMoves.get(slug);
  if (hit && hit.until > Date.now()) return hit.to;
  try {
    let to = null;
    const [live] = await strictRows(`tenants?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`);
    if (!live) {
      const [old] = await strictRows(`tenant_slug_history?slug=eq.${encodeURIComponent(slug)}&select=tenant_id&limit=1`);
      const [now] = old ? await strictRows(`tenants?id=eq.${encodeURIComponent(old.tenant_id)}&select=slug,deleted_at&limit=1`) : [];
      to = now?.slug && !now.deleted_at && now.slug !== slug ? `https://${now.slug}.garage.jmsurf.co.ke` : "https://app.garage.jmsurf.co.ke";
    }
    // Only "this company exists" is cached; a redirect is always looked up fresh, so a company that
    // signs up a moment after someone tried its address is never sent away.
    if (!to) slugMoves.set(slug, { to, until: Date.now() + 60_000 });
    if (slugMoves.size > 5000) slugMoves.clear();
    return to;
  } catch {
    return null;
  }
}

async function adminRows(pathAndQuery) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return [];
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * The welcome and signup emails are sent from public pages, so they are only
 * delivered for an account that really registered a shop in the last hour.
 * Returns that account's shop, or null.
 */
async function recentlyRegisteredShop(email) {
  if (!SUPABASE_SERVICE_ROLE_KEY || !emailRegex.test(email)) return null;
  try {
    const lookup = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=50`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
    );
    if (!lookup.ok) return null;
    const payload = await lookup.json();
    const user = (payload?.users || []).find((u) => String(u.email || "").toLowerCase() === email);
    if (!user || Date.now() - Date.parse(user.created_at || "") > 60 * 60_000) return null;
    const [tenant] = await adminRows(
      `tenants?owner_user_id=eq.${encodeURIComponent(user.id)}&select=slug,business_name,contact_name,contact_phone&limit=1`,
    );
    return tenant ? { user, tenant } : null;
  } catch {
    return null;
  }
}

/** Only allows links that point back at our own shop addresses. */
function safeTarget(value, fallback = SHOP_ORIGIN ? `${SHOP_ORIGIN}/login` : "https://garage.jmsurf.co.ke/login") {
  const candidate = String(value || "").trim();
  if (SHOP_ORIGIN && (candidate === SHOP_ORIGIN || candidate.startsWith(`${SHOP_ORIGIN}/`))) return candidate;
  return /^https:\/\/([a-z0-9-]+\.)*garage\.jmsurf\.co\.ke(\/|$)/i.test(candidate) ? candidate : fallback;
}

// --- Account verification -----------------------------------------------------

async function handleEmailVerify(req, res) {
  const body = await readJsonBody(req);
  const email = String(body.email || "").trim().toLowerCase();
  const generic = {
    ok: true,
    message: "If that email is registered, a verification link is on its way.",
  };
  if (!emailRegex.test(email) || email.length > 254) {
    return sendJson(res, 400, { ok: false, error: "Enter a valid email address" });
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return sendJson(res, 200, {
      ok: false,
      error: "The server cannot create verification links yet. Add the backend service key and redeploy.",
    });
  }
  if (throttled(`verify:${email}`)) return sendJson(res, 200, generic);

  const adminHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  // Look the person up so an already-verified account is not emailed again.
  let user = null;
  const lookup = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=50`,
    { headers: adminHeaders },
  );
  if (lookup.ok) {
    const payload = await lookup.json();
    user = (payload?.users || []).find(
      (u) => String(u.email || "").toLowerCase() === email,
    ) || null;
  }
  if (!user) return sendJson(res, 200, generic);
  if (user.email_confirmed_at) {
    return sendJson(res, 200, {
      ok: true,
      alreadyVerified: true,
      message: "This email is already verified. You can sign in.",
    });
  }

  const target = safeTarget(body.redirectTo);
  let link = null;
  let linkType = "magiclink";
  for (const attempt of ["magiclink", "recovery"]) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ type: attempt, email, redirect_to: target }),
    });
    if (response.ok) {
      link = await response.json();
      linkType = attempt;
      break;
    }
  }
  if (!link) {
    recentSends.delete(`verify:${email}`);
    return sendJson(res, 200, {
      ok: false,
      error: "We could not create a verification link for this account. Please contact support.",
    });
  }

  const hashed = link.hashed_token || link.properties?.hashed_token;
  // The public address (garage.jmsurf.co.ke), never the database's internal one: mail filters
  // mark the internal sslip.io host as spam and people should only ever see our own domain.
  const publicAuth = (process.env.VITE_SUPABASE_URL || "https://garage.jmsurf.co.ke").replace(/\/+$/, "");
  const url = hashed
    ? `${publicAuth}/auth/v1/verify?token=${encodeURIComponent(hashed)}&type=${encodeURIComponent(linkType)}&redirect_to=${encodeURIComponent(target)}`
    : link.action_link || link.properties?.action_link;
  if (!url) {
    recentSends.delete(`verify:${email}`);
    return sendJson(res, 200, {
      ok: false,
      error: "We could not create a verification link for this account. Please contact support.",
    });
  }

  const html = emailShell(
    "Confirm your email address",
    `<p style="margin:0 0 14px;font-size:15px;line-height:22px;">Confirm your email address to activate your JMSURF Garage account.</p>
<p style="margin:0 0 22px;"><a href="${esc(url)}" style="background-color:#0f172a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:15px;display:inline-block;">Confirm email address</a></p>
<p style="margin:0 0 14px;font-size:14px;line-height:21px;color:#4b5563;">If the button does not work, copy this address into your browser:<br>${esc(url)}</p>
<p style="margin:0;font-size:14px;line-height:21px;color:#4b5563;">If you did not create this account, you can ignore this message.</p>`,
  );

  const result = await deliverSavedSmtp({
    to: email,
    subject: "Confirm your JMSURF Garage email address",
    html,
    text: `Confirm your JMSURF Garage email address:\n\n${url}\n\nIf you did not create this account, ignore this message.`,
  });
  if (!result.ok) {
    recentSends.delete(`verify:${email}`);
    return sendJson(res, 200, result);
  }
  return sendJson(res, 200, generic);
}

// --- Forgotten password ---------------------------------------------------------

/** Where a user's reset link should land: their shop address, else www. */
async function shopResetUrl(userId) {
  const [profile] = await adminRows(`profiles?user_id=eq.${encodeURIComponent(userId)}&select=tenant_id&limit=1`);
  if (profile?.tenant_id) {
    const [tenant] = await adminRows(`tenants?id=eq.${encodeURIComponent(profile.tenant_id)}&select=slug&limit=1`);
    if (tenant?.slug) return `${STAFF_ORIGIN}/reset-password`;
  }
  return `${STAFF_ORIGIN}/reset-password`;
}

/**
 * Emails a one-time reset link. Nothing about the account changes until the
 * owner of the mailbox follows the link, and the answer is the same whether
 * or not the address is registered.
 */
async function handlePasswordReset(req, res) {
  const body = await readJsonBody(req);
  const email = String(body.email || "").trim().toLowerCase();
  const generic = { ok: true, success: true, message: "If that email is registered, a reset link is on its way." };
  if (!emailRegex.test(email) || email.length > 254) {
    return sendJson(res, 400, { ok: false, error: "Enter a valid email address" });
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return sendJson(res, 503, { ok: false, error: "Password reset is unavailable right now. Contact support." });
  }
  if (throttled(`reset:${email}`, 60_000)) return sendJson(res, 200, generic);

  const adminHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
  const linkResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ type: "recovery", email }),
  });
  if (!linkResponse.ok) return sendJson(res, 200, generic); // unknown address
  const link = await linkResponse.json().catch(() => null);
  const hashed = link?.hashed_token || link?.properties?.hashed_token;
  const userId = link?.id || link?.user?.id;
  if (!hashed || !userId) return sendJson(res, 200, generic);

  // The link opens the shop's own reset page, which exchanges the one-time
  // token for a session and then asks for the new password.
  const url = `${await shopResetUrl(userId)}?token_hash=${encodeURIComponent(hashed)}&type=recovery`;
  const html = emailShell(
    "Reset your password",
    `<p style="margin:0 0 14px;font-size:15px;line-height:22px;">Someone asked to reset the password for your JMSURF Garage account.</p>
<p style="margin:0 0 22px;"><a href="${esc(url)}" style="background-color:#0f172a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:15px;display:inline-block;">Choose a new password</a></p>
<p style="margin:0 0 14px;font-size:14px;line-height:21px;color:#4b5563;">If the button does not work, copy this address into your browser:<br>${esc(url)}</p>
<p style="margin:0;font-size:14px;line-height:21px;color:#4b5563;">If you did not ask for this, ignore this message. Your password stays the same.</p>`,
  );
  const result = await deliverSavedSmtp({
    to: email,
    subject: "Reset your JMSURF Garage password",
    html,
    text: `Reset your JMSURF Garage password:\n\n${url}\n\nIf you did not ask for this, ignore this message.`,
  });
  if (!result.ok) {
    recentSends.delete(`reset:${email}`);
    console.error("password reset email failed:", result.error);
  }
  return sendJson(res, 200, generic);
}

// --- Sign in with a phone number ------------------------------------------------

/**
 * Turns a phone number into the account email, but only when the password
 * is right, so it cannot be used to discover who has an account.
 */
/**
 * Sign-up with an email whose login is left over from a removed shop: the
 * login has no profile, owns no shop and has no sales, so nothing is lost by
 * releasing it. Anything else (or any lookup error) is left alone.
 */
async function strictRows(pathAndQuery) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`lookup ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("lookup shape");
  return rows;
}

// --- Email unsubscribe (link in marketing/notification emails) ---------------

async function handleUnsubscribe(req, res) {
  const body = await readJsonBody(req).catch(() => ({}));
  const token = String(body.token || "").trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return sendJson(res, 200, { ok: false, valid: false, reason: "invalid" });
  if (!SUPABASE_SERVICE_ROLE_KEY) return sendJson(res, 500, { ok: false, error: "Not configured" });
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (throttled(`unsub:${ip}`, 1500)) return sendJson(res, 429, { ok: false, error: "Please wait a moment" });

  const [row] = await adminRows(`email_unsubscribe_tokens?token=eq.${encodeURIComponent(token)}&select=email,used_at&limit=1`);
  if (!row) return sendJson(res, 200, { ok: false, valid: false, reason: "invalid" });
  if (row.used_at) return sendJson(res, 200, { ok: true, valid: false, reason: "already_unsubscribed" });
  if (!body.confirm) return sendJson(res, 200, { ok: true, valid: true });

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
  const mark = await fetch(`${SUPABASE_URL}/rest/v1/email_unsubscribe_tokens?token=eq.${encodeURIComponent(token)}&used_at=is.null`, {
    method: "PATCH", headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ used_at: new Date().toISOString() }),
  });
  if (!mark.ok) return sendJson(res, 200, { ok: false, error: "Could not process the request. Please try again." });
  const marked = await mark.json().catch(() => []);
  if (!Array.isArray(marked) || marked.length === 0) return sendJson(res, 200, { ok: true, success: false, reason: "already_unsubscribed" });
  await fetch(`${SUPABASE_URL}/rest/v1/suppressed_emails?on_conflict=email`, {
    method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ email: String(row.email || "").toLowerCase(), reason: "unsubscribe" }),
  }).catch(() => null);
  return sendJson(res, 200, { ok: true, success: true });
}

async function handleReleaseOrphan(req, res) {
  const body = await readJsonBody(req).catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const no = () => sendJson(res, 200, { ok: true, released: false });
  if (!SUPABASE_SERVICE_ROLE_KEY || !emailRegex.test(email)) return no();
  const ip = String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (throttled(`release-orphan:${ip}`, 5_000)) return sendJson(res, 429, { ok: false, error: "Wait a few seconds and try again." });
  try {
    const auth = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
    const lookup = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=50`, { headers: auth });
    if (!lookup.ok) return no();
    const user = ((await lookup.json())?.users || []).find((u) => String(u.email || "").toLowerCase() === email);
    if (!user?.id) return no();
    const id = encodeURIComponent(user.id);
    const [profiles, tenants, roles, sales] = await Promise.all([
      strictRows(`profiles?user_id=eq.${id}&select=user_id&limit=1`),
      strictRows(`tenants?owner_user_id=eq.${id}&select=id&limit=1`),
      strictRows(`user_roles?user_id=eq.${id}&select=role`),
      strictRows(`transactions?cashier_id=eq.${id}&select=id&limit=1`),
    ]);
    const owners = await strictRows(`platform_admins?user_id=eq.${id}&select=user_id&limit=1`);
    if (profiles.length || tenants.length || sales.length || owners.length || roles.some((r) => r.role === "super_admin")) return no();
    if (roles.length) {
      const del = await fetch(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${id}`, { method: "DELETE", headers: auth });
      if (!del.ok) return no();
    }
    const gone = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: auth });
    if (!gone.ok) return no();
    console.log(`[signup] released orphan login ${email} (${user.id})`);
    return sendJson(res, 200, { ok: true, released: true });
  } catch (error) {
    console.error("[signup] release-orphan failed:", error?.message);
    return no();
  }
}

async function handleResolveLogin(req, res) {
  const body = await readJsonBody(req);
  const invalid = () => sendJson(res, 401, { ok: false, error: "Invalid phone or password" });
  const digits = String(body.phone || "").replace(/\D/g, "");
  const password = String(body.password || "");
  if (digits.length < 9 || digits.length > 13 || !password || password.length > 200) return invalid();
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return sendJson(res, 503, { ok: false, error: "Phone sign-in is unavailable right now. Use your email." });
  }
  const ip = String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (throttled(`phone-login:${ip}:${digits}`, 5_000)) {
    return sendJson(res, 429, { ok: false, error: "Too many attempts. Wait a few seconds and try again." });
  }

  const local = digits.startsWith("254") ? `0${digits.slice(3)}` : digits.startsWith("0") ? digits : `0${digits}`;
  const intl = `254${local.slice(1)}`;
  const variants = [...new Set([digits, local, intl, `+${intl}`])];
  const list = variants.map((v) => `"${v}"`).join(",");
  const [profile] = await adminRows(`profiles?phone=in.(${encodeURIComponent(list)})&select=user_id&limit=1`);
  if (!profile?.user_id) return invalid();

  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(profile.user_id)}`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const user = userResponse.ok ? await userResponse.json().catch(() => null) : null;
  const email = user?.email;
  if (!email) return invalid();

  // Check the password the same way the sign-in form will.
  const check = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!check.ok) return invalid();
  const session = await check.json().catch(() => null);
  if (session?.access_token) {
    // Close the check session; the browser signs in with its own.
    fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
    }).catch(() => {});
  }
  return sendJson(res, 200, { ok: true, success: true, email });
}

// --- Welcome message for a brand new shop -------------------------------------

async function handleEmailWelcome(req, res) {
  const body = await readJsonBody(req);
  const email = String(body.email || body.recipientEmail || "").trim().toLowerCase();
  if (!emailRegex.test(email)) {
    return sendJson(res, 400, { ok: false, error: "A valid recipient email is required" });
  }
  if (throttled(`welcome:${email}`, 5 * 60_000)) return sendJson(res, 200, { ok: true, skipped: true });

  // Only a shop that registered in the last hour gets a welcome, and the
  // name and address come from its record, not from the request.
  const registered = await recentlyRegisteredShop(email);
  if (!registered) return sendJson(res, 200, { ok: true, skipped: true });
  const name = String(registered.tenant.contact_name || registered.tenant.business_name || "there").slice(0, 120);
  const loginUrl = `${STAFF_ORIGIN}/login`;
  const siteUrl = registered.tenant.slug ? shopOrigin(registered.tenant.slug) : "";
  const html = emailShell(
    "Your garage is ready",
    `<p style="margin:0 0 14px;font-size:15px;line-height:22px;">Hi ${esc(name)}, your JMSURF Garage workspace is set up and ready to use. Every module you chose is free for 14 days.</p>
<p style="margin:0 0 22px;"><a href="${esc(loginUrl)}" style="background-color:#a8121b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:15px;display:inline-block;">Open your garage</a></p>
<p style="margin:0;font-size:14px;line-height:21px;color:#4b5563;">Sign in at ${esc(loginUrl)}${siteUrl ? `<br>Your customers' page: ${esc(siteUrl)}` : ""}</p>`,
  );

  const result = await deliverSavedSmtp({
    to: email,
    subject: "Welcome to JMSURF Garage",
    html,
    text: `Hi ${name}, your JMSURF Garage workspace is ready.\n\nSign in: ${loginUrl}${siteUrl ? `\nYour customers' page: ${siteUrl}` : ""}`,
  });
  return sendJson(res, 200, result);
}

// --- New signup alert to the platform owner -----------------------------------

async function handleEmailSignupAlert(req, res) {
  const body = await readJsonBody(req);
  const email = String(body.email || "").trim().toLowerCase();
  if (!emailRegex.test(email)) {
    return sendJson(res, 400, { ok: false, error: "Signup details are required" });
  }
  if (throttled(`signup:${email}`, 60_000)) {
    return sendJson(res, 200, { ok: true, skipped: true });
  }

  // Details come from the registered shop, so this cannot be used to send
  // arbitrary text to the platform owner.
  const registered = await recentlyRegisteredShop(email);
  if (!registered) return sendJson(res, 200, { ok: true, skipped: true });
  const { tenant } = registered;
  const rows = [
    ["Business", tenant.business_name],
    ["Contact", tenant.contact_name],
    ["Email", email],
    ["Phone", tenant.contact_phone],
    ["Shop address", tenant.slug ? shopOrigin(tenant.slug).replace(/^https:\/\//, "") : ""],
    ["Registered", new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })],
  ].filter(([, value]) => String(value || "").trim());

  const list = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;font-size:14px;color:#6b7280;">${esc(label)}</td><td style="padding:6px 0;font-size:14px;color:#0f172a;">${esc(value)}</td></tr>`,
    )
    .join("");

  const result = await deliverSavedSmtp({
    to: "alert@jmsurf.co.ke",
    replyTo: email,
    subject: `New JMSURF Garage signup: ${String(tenant.business_name || email).slice(0, 80)}`,
    html: emailShell("A new shop just registered", `<table role="presentation">${list}</table>`),
    text: rows.map(([label, value]) => `${label}: ${value}`).join("\n"),
  });
  return sendJson(res, 200, result);
}

// --- Sale receipt to a customer -----------------------------------------------

/**
 * Shop staff email a business document (quotation, invoice, receipt …) with
 * its PDF attached. The PDF is drawn in the browser (lib/doc-pdf.ts), so the
 * server only checks the sender, limits the size and delivers it.
 */
async function handleEmailDocument(req, res) {
  const auth = await requireUser(req);
  if (auth.error) return sendJson(res, auth.status, { ok: false, error: auth.error });
  const [profile] = await adminRows(`profiles?user_id=eq.${encodeURIComponent(auth.user.id)}&select=tenant_id,display_name&limit=1`);
  const roles = (await adminRows(`user_roles?user_id=eq.${encodeURIComponent(auth.user.id)}&select=role`)).map((r) => String(r.role));
  if (!profile?.tenant_id || !roles.some((r) => ["admin", "manager", "cashier", "sales_person", "super_admin"].includes(r))) {
    return sendJson(res, 403, { ok: false, error: "Only shop staff can email documents" });
  }
  // PDFs travel in the body (a statement plus several invoices for a reminder).
  const body = await readJsonBody(req, 16_000_000);
  const to = (Array.isArray(body.to) ? body.to : [body.to]).map((v) => String(v || "").trim()).filter((v) => emailRegex.test(v)).slice(0, 10);
  if (!to.length) return sendJson(res, 400, { ok: false, error: "Enter a valid email address" });
  const subject = String(body.subject || "").trim().slice(0, 200);
  const message = String(body.message || "").trim().slice(0, 5000);
  if (!subject) return sendJson(res, 400, { ok: false, error: "A subject is required" });
  const pdf = String(body.pdf || "");
  const more = (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 20)
    .map((a) => ({ filename: String(a?.filename || "document.pdf").replace(/[^\w.\- ]/g, "_").slice(0, 80), content: String(a?.pdf || ""), contentType: "application/pdf" }))
    .filter((a) => a.content);
  if (pdf.length + more.reduce((n, a) => n + a.content.length, 0) > 14_000_000) return sendJson(res, 413, { ok: false, error: "The documents are too large to email together" });
  if (throttled(`doc:${auth.user.id}:${to.join(",")}:${subject}`, 20_000)) {
    return sendJson(res, 429, { ok: false, error: "This document was just sent. Please wait a moment." });
  }
  const [tenant] = await adminRows(`tenants?id=eq.${encodeURIComponent(profile.tenant_id)}&select=business_name&limit=1`);
  const shopName = String(tenant?.business_name || "Our shop").slice(0, 120);
  const html = emailShell(subject, `<p style="margin:0;font-size:15px;line-height:23px;">${esc(message).replace(/\n/g, "<br/>")}</p>`);
  const filename = String(body.filename || "document.pdf").replace(/[^\w.\- ]/g, "_").slice(0, 80);
  const result = await deliverForTenant(profile.tenant_id, {
    to, subject, html, text: `${message}\n\n${shopName}`, replyTo: body.replyTo || undefined, purpose: String(body.purpose || "other").slice(0, 20),
    attachments: [...(pdf ? [{ filename, content: pdf, contentType: "application/pdf" }] : []), ...more],
  });
  return sendJson(res, 200, result);
}

async function handleEmailReceipt(req, res) {
  const auth = await requireUser(req);
  if (auth.error) return sendJson(res, auth.status, { ok: false, error: auth.error });

  const body = await readJsonBody(req);
  const to = String(body.email || body.to || "").trim();
  if (!emailRegex.test(to)) {
    return sendJson(res, 400, { ok: false, error: "A valid customer email is required" });
  }
  // Only shop staff can send receipts, the shop name comes from their own
  // shop, and each person is limited so this cannot be used for bulk mail.
  const [profile] = await adminRows(
    `profiles?user_id=eq.${encodeURIComponent(auth.user.id)}&select=tenant_id&limit=1`,
  );
  const roles = (await adminRows(`user_roles?user_id=eq.${encodeURIComponent(auth.user.id)}&select=role`))
    .map((row) => String(row.role));
  const [tenant] = profile?.tenant_id
    ? await adminRows(`tenants?id=eq.${encodeURIComponent(profile.tenant_id)}&select=business_name,is_active&limit=1`)
    : [];
  const isStaff = roles.some((role) => ["admin", "manager", "cashier", "super_admin"].includes(role));
  if (!tenant || tenant.is_active === false || !isStaff) {
    return sendJson(res, 403, { ok: false, error: "Only shop staff can email receipts" });
  }
  if (throttled(`receipt:${auth.user.id}:${to.toLowerCase()}`, 30_000)) {
    return sendJson(res, 429, { ok: false, error: "A receipt was just sent to this address. Please wait a moment." });
  }

  const receipt = body.receipt || {};
  // Shops trade in their own currency (business_settings.currency).
  const [settings] = await adminRows(`business_settings?tenant_id=eq.${encodeURIComponent(profile.tenant_id)}&select=currency,receipt_terms&limit=1`);
  const currency = /^[A-Z]{3}$/.test(String(settings?.currency || "")) ? settings.currency : "KES";
  const terms = String(settings?.receipt_terms || "").trim().slice(0, 1500);
  const money = (n) =>
    `${currency} ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const items = Array.isArray(receipt.items) ? receipt.items : [];
  const lines = items
    .map(
      (item) =>
        `<tr><td style="padding:6px 0;font-size:14px;">${esc(item.name)} x${esc(item.quantity)}</td><td style="padding:6px 0;font-size:14px;text-align:right;">${money(Number(item.price) * Number(item.quantity))}</td></tr>`,
    )
    .join("");

  const shopName = String(tenant.business_name || "JMSURF Garage").slice(0, 120);
  const html = emailShell(
    `Receipt from ${shopName}`,
    `<table role="presentation" width="100%">${lines}
<tr><td style="padding:10px 0 0;border-top:1px solid #e5e7eb;font-size:15px;font-weight:bold;">Total</td><td style="padding:10px 0 0;border-top:1px solid #e5e7eb;font-size:15px;font-weight:bold;text-align:right;">${money(receipt.total)}</td></tr></table>
<p style="margin:18px 0 0;font-size:14px;color:#4b5563;">Paid by ${esc(receipt.payment_method || "cash")}${receipt.mpesa_ref ? ` (${esc(receipt.mpesa_ref)})` : ""}</p>
<p style="margin:6px 0 0;font-size:14px;color:#4b5563;">Thank you for your business.</p>${terms ? `
<div style="margin:16px 0 0;padding-top:10px;border-top:1px dashed #d1d5db;font-size:12px;color:#4b5563;"><strong>Terms &amp; conditions</strong><br/>${esc(terms).replace(/\n/g, "<br/>")}</div>` : ""}
`,
  );

  const result = await deliverForTenant(profile.tenant_id, {
    to, purpose: "invoices",
    subject: `Your receipt from ${shopName}`,
    html,
    text: `Receipt from ${shopName}\nTotal: ${money(receipt.total)}\n\nThank you for your business.${terms ? `\n\nTerms & conditions:\n${terms}` : ""}`,
  });
  return sendJson(res, 200, result);
}



// ---------------------------------------------------------------------------

// The payment routes reuse this server's JSON reply helper.
configurePayments({ sendJson });
startSendMoneyReconciler();
startPayheroReconciler();
startRecurringScheduler();
startMonitor((message) => deliverSavedSmtp(message));
startGatewayReconciler();
startHubReconciler();
startReminders((message) => deliverSavedSmtp(message));
startCustomerAlerts((message) => (message.tenantId ? deliverForTenant(message.tenantId, message) : deliverSavedSmtp(message)));
startErpJobs((tenantId, message) => deliverForTenant(tenantId, message));
startContractJobs((tenantId, message) => deliverForTenant(tenantId, message));
startNoteJobs((tenantId, message) => deliverForTenant(tenantId, message));
startEventAlerts((tenantId, message) => deliverForTenant(tenantId, message));
startWorkflows((tenantId, message) => deliverForTenant(tenantId, message));
startOwnerAlerts((message) => deliverSavedSmtp(message));
startDemoReset();
startCcBilling();
startWebhooks();
startMigrationJobs();
startEngageJobs((tenantId, message) => deliverForTenant(tenantId, message));
startInvoicePromptReconciler();
startPayLinkReconciler();
setShopMailer((tenantId, message) => deliverForTenant(tenantId, message));
startWaterAlerts((message) => deliverSavedSmtp(message));
startGarageJobs();

// Staff account routes reuse the reply helper and the saved email settings.
configureStaff({ sendJson, deliverEmail: deliverSavedSmtp, emailShell });

// An account with an authenticator app may only use the API after entering
// its code (session level aal2). The token's signature is checked later by
// each route; here it is only read, and only ever used to refuse.
const mfaCache = new Map();

/** Endpoints only the admin console (/admin) calls. */
// --- Marketing analytics ------------------------------------------------------
// The website and the super admin use the platform's Meta Pixel / GA4 IDs
// (platform_settings "tracking"); a company's own address uses the company's
// (business_settings.erp_settings.shop.site.tracking). Empty when not set.
const trackingCache = new Map();
async function trackingIds(req) {
  const host = shopHost(req);
  const slug = (await customDomainSlug(host)) || subdomainSlug(host);
  const key = slug || "_platform";
  const hit = trackingCache.get(key);
  if (hit && hit.until > Date.now()) return hit.ids;
  let ids = {};
  try {
    if (slug) {
      const t = (await adminRows(`tenants?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`))?.[0];
      const s = t ? (await adminRows(`business_settings?tenant_id=eq.${t.id}&select=erp_settings&limit=1`))?.[0] : null;
      ids = s?.erp_settings?.shop?.site?.tracking || {};
    } else {
      ids = (await adminRows("platform_settings?key=eq.tracking&select=value&limit=1"))?.[0]?.value || {};
    }
  } catch { ids = {}; }
  trackingCache.set(key, { ids, until: Date.now() + 5 * 60_000 });
  return ids;
}
async function serveTracking(req, res) {
  const ids = await trackingIds(req);
  const meta = /^\d{5,20}$/.test(String(ids.meta_pixel_id || "")) ? String(ids.meta_pixel_id) : "";
  const ga = /^G-[A-Z0-9]{4,16}$/.test(String(ids.ga4_id || "")) ? String(ids.ga4_id) : "";
  let js = "";
  if (meta) js += `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${meta}');fbq('track','PageView');
`;
  if (ga) js += `(function(){var t=document.createElement('script');t.async=true;t.src='https://www.googletagmanager.com/gtag/js?id=${ga}';document.head.appendChild(t);window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','${ga}');})();
`;
  res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" });
  return res.end(js || "/* no tracking configured */\n");
}

function isAdminApi(pathname) {
  return pathname.startsWith("/api/payments/platform/")
    || pathname === "/api/payments/diagnostics"
    || pathname.startsWith("/api/reminders/")
    || pathname === "/api/messages/admin";
}
async function mfaSatisfied(req) {
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) return true;
  let claims;
  try { claims = JSON.parse(Buffer.from(auth.slice(7).split(".")[1] || "", "base64url").toString("utf8")); } catch { return true; }
  if (!claims?.sub || claims.aal === "aal2" || claims.role !== "authenticated") return true;
  const hit = mfaCache.get(claims.sub);
  if (hit && hit.at > Date.now() - 60_000) return !hit.has;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/user_has_mfa`, {
      method: "POST",
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_user_id: claims.sub }),
      signal: AbortSignal.timeout(5000),
    });
    const has = r.ok ? (await r.json()) === true : false;
    if (mfaCache.size > 5000) mfaCache.clear();
    mfaCache.set(claims.sub, { has, at: Date.now() });
    return !has;
  } catch {
    return true; // The database's own check (has_role) still applies.
  }
}

createServer(async (req, res) => {
  // Every route can see which address this request came from (platform.js).
  requestStore.enterWith({ req });
  // Both garage.jmsurf.co.ke and garage.jmsurf.co.ke are served directly here.
  // Any www/non-www preference is handled by the proxy in front of this app.

  const url = req.url || "/";
  const [pathname, search] = url.split("?");

  // The super admin lives on admin.<root>; dash.<root> is an old alias that moves there.
  const hostOnly = String(req.headers.host || "").toLowerCase().split(":")[0];
  if (hostOnly === "dash.garage.jmsurf.co.ke") {
    // Browsers that cached the website here keep an old service worker; a redirected
    // worker script is refused, so hand them one that clears itself and reloads.
    if (pathname === "/sw.js") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
      return res.end("self.addEventListener(\"install\",()=>self.skipWaiting());self.addEventListener(\"activate\",e=>e.waitUntil((async()=>{for(const k of await caches.keys())await caches.delete(k);await self.registration.unregister();for(const c of await self.clients.matchAll({type:\"window\"}))c.navigate(c.url);})()));");
    }
    res.writeHead(302, { Location: `https://admin.garage.jmsurf.co.ke${pathname === "/" ? "/admin" : url}`, "Cache-Control": "no-store" });
    return res.end();
  }

  // Proof that a shop's domain (even behind Cloudflare's proxy) reaches this server.
  const domainProof = domainVerifyResponse(pathname);
  if (domainProof !== null) {
    res.writeHead(domainProof ? 200 : 404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(domainProof);
  }

  // Shops' own domains arrive on plain http from the proxy (its redirect is off
  // for them). Send visitors to https here, unless Cloudflare already serves
  // the visitor over https ("Flexible" mode), which would otherwise loop.
  if (String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "http"
      && !/"scheme"\s*:\s*"https"/.test(String(req.headers["cf-visitor"] || ""))
      && (await customDomainSlug(req.headers.host))) {
    const host = String(req.headers.host || "").split(":")[0];
    res.writeHead(308, { Location: `https://${host}${url}` });
    return res.end();
  }

  // A shop's own icon, install manifest and link-preview picture.
  if ((req.method === "GET" || req.method === "HEAD") && (pathname === "/favicon.ico" || pathname.startsWith("/shop-brand/"))) {
    const host = shopHost(req);
    const slug = (await customDomainSlug(host)) || subdomainSlug(host);
    const brand = slug ? await shopBrand(slug).catch(() => null) : null;
    try {
      if (brand && serveBrandAsset(pathname, brand, host, res)) return;
    } catch (error) {
      console.error("shop brand asset failed:", error?.message || error);
    }
    if (pathname.startsWith("/shop-brand/")) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
  }

  // Shop addresses call the payment routes cross-origin. The CORS headers must
  // be on every answer, the MFA refusal included, or the browser hides it and
  // the page sees a network failure instead of the real reason.
  if (isPaymentsRoute(pathname)) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Vary", "Origin");
  }

  // The authenticator code is asked for by the admin console only (/admin).
  // Shop pages and their API calls work for every signed-in user, so this
  // refusal is limited to the platform's own admin endpoints.
  if (isAdminApi(pathname) && req.method !== "OPTIONS" && !(await mfaSatisfied(req))) {
    return sendJson(res, 401, { error: "Enter the code from your authenticator app to continue.", mfa_required: true });
  }

  if (isPaymentsRoute(pathname)) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": req.headers.origin || "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      });
      res.end();
      return;
    }
    // A shop address may call the main address directly, so allow it through.
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Vary", "Origin");
    if (req.method !== "POST") {
      return sendJson(res, 405, { error: "Method not allowed" });
    }
    const body = await readJsonBody(req).catch(() => ({}));
    if (isGatewayRoute(pathname)) {
      return await handleGatewayRequest(req, res, pathname, new URLSearchParams(search || ""), body, sendJson);
    }
    if (pathname.startsWith("/api/payments/jmsurf/")) {
      return await handleSendMoneyRequest(req, res, pathname, body, sendJson);
    }
    return await handlePaymentsRequest(req, res, pathname, search, body);
  }

  if (isStaffRoute(pathname)) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": req.headers.origin || "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      });
      res.end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Vary", "Origin");
    if (req.method !== "POST") {
      return sendJson(res, 405, { error: "Method not allowed" });
    }
    const staffBody = await readJsonBody(req).catch(() => ({}));
    return await handleStaffRequest(req, res, pathname, staffBody);
  }


  if (isHubRoute(pathname)) {
    // Checkout return pages and provider callbacks arrive as GET or POST from
    // anywhere; the shop screens call from their own addresses.
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": req.headers.origin || "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        Vary: "Origin",
      });
      res.end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Vary", "Origin");
    const hubBody = req.method === "POST" ? await readJsonBody(req).catch(() => ({})) : {};
    return await handleHubRequest(req, res, pathname, new URLSearchParams(search || ""), hubBody, sendJson);
  }

  if (isMessagingRoute(pathname) || isReminderRoute(pathname)) {
    // Shop addresses call the www address directly, so allow it through.
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": req.headers.origin || "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        Vary: "Origin",
      });
      res.end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Vary", "Origin");
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
    try {
      const msgBody = await readJsonBody(req).catch(() => ({}));
      if (isReminderRoute(pathname)) return await handleReminderRequest(req, res, pathname, msgBody, sendJson);
      return await handleMessagingRequest(req, res, pathname, msgBody, sendJson);
    } catch (error) {
      console.error("messaging route failed:", error);
      return sendJson(res, 500, { ok: false, error: "Could not send the message" });
    }
  }

  if (pathname === "/api/demo/start" && req.method === "GET") return await handleDemoStart(req, res);
  if (isCcBillingRoute(pathname)) return await handleCcBilling(req, res, pathname, readJsonBody);
  // Public REST API for companies (/api/v1) and developer settings (/api/erp/dev).
  if (isDevRoute(pathname)) return await handleDev(req, res, pathname, readJsonBody, sendJson);
  if (isContractsPublicRoute(pathname)) return await handleContractsPublic(req, res, pathname, search, readJsonBody, sendJson);
  // Staff self-registration files (/join/<token>) and the company careers page.
  if (isHrPublicRoute(pathname)) return await handleHrPublic(req, res, pathname, search, readJsonBody, sendJson, async (r) => (await customDomainSlug(shopHost(r))) || subdomainSlug(shopHost(r)) || "");
  // Invoice payment links (/pay/<token>): the invoice summary and paying it, by token only.
  if (isPayLinkRoute(pathname)) return await handlePayLink(req, res, pathname, search, readJsonBody, sendJson);
  // Website lead forms (CRM → Web forms), posted from any website.
  if (isCrmPublicRoute(pathname)) return await handleCrmPublic(req, res, pathname);
  if (pathname === "/api/public/lead" && req.method === "POST") return await handleLeadIntake(req, res, await readJsonBody(req).catch(() => ({})), sendJson);
  if (isPlatformCrmRoute(pathname) && req.method === "POST") {
    const body = await readJsonBody(req).catch(() => ({}));
    return await handlePlatformCrm(req, res, pathname, body, { sendJson, requireSuperAdmin, deliverEmail: deliverSavedSmtp });
  }
  if (pathname === "/api/migrate/oauth/callback" && req.method === "GET") return await handleMigrateCallback(req, res, search);
  if (pathname === "/api/migrate/qbo/callback" && req.method === "GET") return await handleQboCallback(req, res, search);
  if ((pathname === "/api/migrate/sage/callback" || pathname === "/api/migrate/xero/callback") && req.method === "GET") return await handleSourceCallback(req, res, pathname.split("/")[3], search);

  if (isEngageRoute(pathname)) {
    // Website chat widget, online booking, event tickets, learner links, IoT devices, email tracking.
    const engageBody = req.method === "POST" ? await readJsonBody(req, 200_000).catch(() => ({})) : {};
    return await handleEngageRequest(req, res, pathname, search, engageBody, sendJson, async (r) => (await customDomainSlug(shopHost(r))) || subdomainSlug(shopHost(r)) || "");
  }

  if (isErpRoute(pathname)) {
    // Statements, backups and customer-portal admin for signed-in staff.
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    const erpBody = await readJsonBody(req, 80_000_000).catch(() => ({}));
    return await handleErpRequest(req, res, pathname, erpBody, sendJson);
  }

  if (isAiRoute(pathname)) {
    // Garage AI: answers from the company data with the person's own access.
    const aiBody = await readJsonBody(req, 30_000_000).catch(() => ({}));
    return await handleAiRequest(req, res, pathname, aiBody, sendJson);
  }

  if (isShopRoute(pathname)) {
    // Online shop + customer portal (public, same origin).
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    // Portal messages may carry a file (up to 5 MB, sent as base64).
    const shopBody = await readJsonBody(req, isPortalUpload(pathname) ? 8_000_000 : undefined).catch(() => ({}));
    // The company is the one whose address this is (its subdomain or own domain).
    const shopHostName = shopHost(req);
    const shopSlug = (await customDomainSlug(shopHostName)) || subdomainSlug(shopHostName)
      || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.headers.host || "")) ? String(req.headers["x-shop-slug"] || "") : "");
    return await handleShopRequest(req, res, pathname, shopBody, sendJson, shopSlug);
  }

  if (isGarageRoute(pathname)) {
    return await handleGarageRequest(req, res, pathname, { sendJson, readJsonBody });
  }

  if (isWaterRoute(pathname)) {
    // Water shop customers order from the shop's own address.
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400" });
      res.end();
      return;
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    const waterBody = await readJsonBody(req).catch(() => ({}));
    return await handleWaterRequest(req, res, pathname, waterBody, sendJson);
  }

  if (pathname === "/api/telemetry/error" && req.method === "POST") {
    let body = {};
    try { body = await readJsonBody(req); } catch { body = {}; }
    return handleErrorReport(req, res, body, sendJson);
  }

  if (pathname.startsWith("/api/email/")) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": req.headers.origin || "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      });
      res.end();
      return;
    }
    // Shop addresses call the www address directly, so allow it through.
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Vary", "Origin");
    if (req.method !== "POST") {
      return sendJson(res, 405, { ok: false, error: "Method not allowed" });
    }
    try {
      if (pathname === "/api/email/test") return await handleEmailTest(req, res);
      if (pathname === "/api/email/status") return await handleEmailStatus(req, res);
      if (pathname === "/api/email/send") return await handleEmailSend(req, res);
      if (pathname === "/api/email/verify") return await handleEmailVerify(req, res);
      if (pathname === "/api/email/welcome") return await handleEmailWelcome(req, res);
      if (pathname === "/api/email/signup-alert") return await handleEmailSignupAlert(req, res);
      if (pathname === "/api/email/receipt") return await handleEmailReceipt(req, res);
      if (pathname === "/api/email/document") return await handleEmailDocument(req, res);
      if (pathname === "/api/email/password-reset") return await handlePasswordReset(req, res);
      if (pathname === "/api/email/resolve-login") return await handleResolveLogin(req, res);
      if (pathname === "/api/email/release-orphan") return await handleReleaseOrphan(req, res);
      if (pathname === "/api/email/unsubscribe") return await handleUnsubscribe(req, res);
      if (pathname === "/api/email/tenant-test") return await handleTenantEmailTest(req, res);

      return sendJson(res, 404, { ok: false, error: "Unknown email route" });
    } catch (error) {
      console.error("email route failed:", error);
      return sendJson(res, 500, { ok: false, error: describeMailError(error) });
    }
  }

  // A company's address: its own robots.txt and sitemap.xml (public website pages only).
  if ((pathname === "/robots.txt" || pathname === "/sitemap.xml") && hostOnly !== SITE_HOST && hostOnly !== `www.${SITE_HOST}`) {
    const company = await companyAddress(req);
    if (company && pathname === "/robots.txt") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
      return res.end(companyRobotsTxt(company.origin, company.siteEnabled));
    }
    if (company) {
      if (!company.siteEnabled) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
      return res.end(companySitemap(company.origin, new Date().toISOString().slice(0, 10)));
    }
  }
  if (pathname === "/robots.txt" && isWorkspaceHost(hostOnly)) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
    return res.end("# A JMSURF Garage workspace: its pages are kept out of search results (noindex).\n# The website is https://garage.jmsurf.co.ke/\nUser-agent: *\nDisallow: /api/\n");
  }

  const filePath = resolveFilePath(url);

  if (!filePath) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  const exists = await fileExists(filePath);
  // A missing build file (old cached page after a deploy) must fail loudly
  // instead of receiving the HTML page, which the browser cannot run.
  if (!exists && pathname.startsWith("/assets/")) {
    // A tab opened before the latest deploy: serve the earlier build's file.
    const old = await archivedAsset(pathname.slice("/assets/".length)).catch(() => null);
    if (old) {
      const ext = path.extname(pathname).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME_TYPES.get(ext) || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
      return res.end(old);
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("Not found");
    return;
  }
  const targetPath = exists ? filePath : indexFile;

  try {
    if (pathname === "/tracking.js") return await serveTracking(req, res);
    let content = await fs.readFile(targetPath);
    const ext = path.extname(targetPath).toLowerCase();
    if (ext === ".html" && (req.method === "GET" || req.method === "HEAD")) {
      // A renamed company's old address forwards to the new one; an unknown address goes to the company finder.
      const moved = await slugMove(shopHost(req));
      if (moved) {
        const dest = moved.startsWith("https://app.") ? `${moved}/login` : `${moved}${url}`;
        res.writeHead(302, { Location: dest, "Cache-Control": "no-store" });
        return res.end();
      }
    }
    // One address for the website: www goes to garage.jmsurf.co.ke (same path).
    if (ext === ".html" && hostOnly === `www.${SITE_HOST}` && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(301, { Location: `https://${SITE_HOST}${url}`, "Cache-Control": "public, max-age=3600" });
      return res.end();
    }
    // The website's public pages come with their text and head tags in the HTML;
    // its other pages (sign-in internals, unknown paths) stay out of search results.
    let robotsTag = null;
    if (ext === ".html" && targetPath === indexFile && hostOnly === SITE_HOST) {
      const key = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : "/";
      const hit = seoRoutes[key];
      const snap = hit ? await fs.readFile(path.join(seoDir, hit.file)).catch(() => null) : null;
      if (snap) {
        content = snap;
        if (hit.noindex) robotsTag = "noindex, follow";
      } else if (key !== "/") {
        robotsTag = "noindex, follow";
        content = Buffer.from(noindexHtml(content.toString("utf8"), robotsTag));
      }
    }
    if (ext === ".html") {
      // A shop's own address shows the shop's name, icon and link preview
      // from the very first byte (WhatsApp and friends never run the app).
      const host = shopHost(req);
      const shopSlug = await customDomainSlug(host);
      const brandSlug = shopSlug || subdomainSlug(host);
      const brand = brandSlug ? await shopBrand(brandSlug).catch(() => null) : null;
      if (brand) {
        content = Buffer.from(brandHtml(content.toString("utf8"), brand, host, { stampSlug: !!shopSlug }));
      } else if (shopSlug) {
        content = Buffer.from(content.toString("utf8").replace("<head>", `<head><meta name="jmsurf-shop" content="${shopSlug.replace(/[^a-z0-9-]/g, "")}">`));
      }
    }
    // A company's public website and shop are its storefront: indexed, canonical to itself.
    // Its workspace, sign-in, account, cart and checkout are not; app. and dash. never are.
    const company = ext === ".html" && targetPath === indexFile && hostOnly !== SITE_HOST ? await companyAddress(req) : null;
    if (company) {
      robotsTag = companyRobots(pathname, company.siteEnabled);
      content = Buffer.from(robotsTag
        ? noindexHtml(content.toString("utf8"), robotsTag)
        : indexableHtml(content.toString("utf8"), company.origin, pathname));
    } else if (ext === ".html" && isWorkspaceHost(hostOnly)) {
      robotsTag = "noindex, nofollow";
      content = Buffer.from(noindexHtml(content.toString("utf8"), robotsTag));
    }
    const contentType = MIME_TYPES.get(ext) || "application/octet-stream";
    const hashedAsset = targetPath.includes(`${path.sep}assets${path.sep}`);
    // The page, the service worker files and every script or stylesheet outside
    // /assets/ (boot-guard.js, workbox, registerSW) keep the same name across
    // releases: never kept by Cloudflare or the browser. Cloudflare otherwise
    // turned "no-cache" on .js into max-age=14400 and visitors stayed on the
    // old release for hours.
    const alwaysFresh = ext === ".html" || (!hashedAsset && (ext === ".js" || ext === ".mjs" || ext === ".css"));

    res.writeHead(200, {
      ...(robotsTag ? { "X-Robots-Tag": robotsTag } : {}),
      "Content-Type": contentType,
      // Only fingerprinted build files are cached forever; the install
      // manifest and icons are re-checked so updates and "Install app" work.
      ...(alwaysFresh ? { "CDN-Cache-Control": "no-store", "Cloudflare-CDN-Cache-Control": "no-store" } : {}),
      "Cache-Control":
        alwaysFresh
          ? "no-cache, no-store, must-revalidate, max-age=0"
          : ext === ".webmanifest" || !hashedAsset
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      // Camera stays allowed on this site for barcode scanning.
      "Permissions-Policy": "geolocation=(self), microphone=(self \"https://app.jmsurfcallcentre.co.ke\"), camera=(self), autoplay=(self \"https://app.jmsurfcallcentre.co.ke\"), payment=()",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      ...(ext === ".html" ? { "Content-Security-Policy": CONTENT_SECURITY_POLICY } : {}),
    });
    res.end(content);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Failed to serve app. Run npm run build first.");
  }
}).listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  setTimeout(() => void archiveAssets(distDir), 5000).unref();
});
