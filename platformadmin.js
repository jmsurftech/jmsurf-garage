// ---------------------------------------------------------------------------
// Admin → Companies and Admin → Users: what the platform owner does for one company
// and its people. Platform owner only (platform_admins, on the admin address); the
// admin API also asks for the authenticator code (server.js isAdminApi / mfaSatisfied).
//
// POST /api/admin/companies/<action>   {tenant_id, ...}
// POST /api/admin/users/<action>       {user_id, tenant_id?, ...}
//
// The service key stays on this server. Database checks that belong to the platform
// owner (admin_record_payment, admin_add_sms_units, admin_sign_out_user,
// admin_user_security) run as the signed-in owner, so their own checks still apply.
// Every change is written to platform_admin_actions (with the company), never a
// password or a link.
// ---------------------------------------------------------------------------
import { randomInt } from "node:crypto";

const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const APP = (process.env.SHOP_ORIGIN || process.env.APP_ORIGIN || "https://app.jmsurfgarage.co.ke").replace(/\/+$/, "");

/** Roles a company person can have (the platform role is never handed out here). */
export const COMPANY_ROLES = ["admin", "manager", "finance", "cashier", "sales_person", "stock_manager", "customer_service", "rider", "packaging"];

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const isId = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str(v));
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str(v));
const esc = (s) => str(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** "YYYY-MM-DD" → the end of that day in Nairobi, or null. */
const endOfDay = (v) => {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T23:59:59+03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const cleanPhone = (v) => str(v).replace(/[^\d+]/g, "").slice(0, 20);

class Refusal extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const refuse = (m, s) => { throw new Refusal(m, s); };

/* ----------------------------------------------------------- backend calls */

const svcHeaders = (extra = {}) => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...extra });

async function db(path, { method = "GET", body, prefer = "return=representation" } = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method, headers: svcHeaders({ Prefer: prefer }), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; }
  if (!r.ok) throw new Error(str(j?.message) || `The database replied ${r.status}`);
  return j;
}
const rows = async (p) => { const d = await db(p); return Array.isArray(d) ? d : []; };
const one = async (p) => (await rows(p))[0] || null;

async function auth(path, { method = "GET", body } = {}) {
  const r = await fetch(`${URL_}/auth/v1/${path}`, { method, headers: svcHeaders(), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: j };
}

/** A database function run as the signed-in platform owner (its own owner check applies). */
async function asOwner(who, fn, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST", signal: AbortSignal.timeout(20000),
    headers: { apikey: ANON || KEY, Authorization: who.authHeader, "Content-Type": "application/json", "x-dash-context": "platform" },
    body: JSON.stringify(args || {}),
  });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; }
  if (!r.ok) refuse(str(j?.message) || "That did not go through");
  return j;
}

async function audit(who, tenantId, action, targetType, targetId, detail = {}) {
  await db("platform_admin_actions", {
    method: "POST", prefer: "return=minimal",
    body: { admin_id: who.user.id, tenant_id: tenantId || null, action, target_type: targetType, target_id: targetId || null, detail },
  }).catch((e) => console.error("[admin] audit write failed:", e.message));
}

async function mapLimit(list, n, fn) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]); } }));
  return out;
}

async function findLogin(email) {
  const e = str(email).toLowerCase();
  const r = await auth(`admin/users?filter=${encodeURIComponent(e)}&per_page=50`);
  return (r.data?.users || []).find((u) => str(u.email).toLowerCase() === e) || null;
}
async function getLogin(userId) {
  const r = await auth(`admin/users/${userId}`);
  return r.ok && r.data?.id ? r.data : null;
}
const strongPassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = ""; for (let i = 0; i < 12; i += 1) out += chars[randomInt(chars.length)];
  return `Jm${out}!`;
};

/* ----------------------------------------------------------------- company */

async function companyOf(id, { live = false } = {}) {
  if (!isId(id)) refuse("Choose a company");
  const t = await one(`tenants?id=eq.${id}&select=id,business_name,owner_user_id,deleted_at,is_active,contact_name,contact_email,contact_phone`);
  if (!t) refuse("That company was not found", 404);
  if (live && t.deleted_at) refuse("Restore the company first");
  return t;
}
const latestSub = (tenantId) => one(`subscriptions?tenant_id=eq.${tenantId}&select=*&order=created_at.desc&limit=1`);
const platformOwners = async () => new Set((await rows("platform_admins?select=user_id")).map((r) => r.user_id));

async function memberOf(tenantId, userId) {
  if (!isId(userId)) refuse("Choose a person");
  const m = await one(`tenant_members?tenant_id=eq.${tenantId}&user_id=eq.${userId}&select=id,role,is_owner,status,company_role_id,location_ids`);
  if (!m) refuse("That person is not in this company");
  return m;
}

/**
 * Someone loses this company (removed, or the company stopped): if this was the company
 * they were working in, move them to another active company of theirs. Returns false when
 * they have none left (the caller then blocks the sign-in).
 */
async function moveElsewhere(userId, tenantId) {
  const prof = await one(`profiles?user_id=eq.${userId}&select=tenant_id`);
  if (prof?.tenant_id !== tenantId) return true;
  const others = await rows(`tenant_members?user_id=eq.${userId}&tenant_id=neq.${tenantId}&status=eq.active&select=tenant_id,role,company_role_id,location_ids,tenants!inner(deleted_at,is_active)&tenants.deleted_at=is.null&tenants.is_active=eq.true&limit=1`).catch(() => []);
  const next = others[0];
  if (!next) return false;
  await db(`profiles?user_id=eq.${userId}`, { method: "PATCH", prefer: "return=minimal", body: { tenant_id: next.tenant_id, company_role_id: next.company_role_id || null, location_ids: next.location_ids || null, status: "active", updated_at: new Date().toISOString() } });
  await db(`user_roles?user_id=eq.${userId}`, { method: "DELETE", prefer: "return=minimal" });
  await db("user_roles", { method: "POST", prefer: "return=minimal", body: { user_id: userId, role: next.role || "cashier" } });
  return true;
}

/** Ends every session of a login now (their open tabs are signed out within the hour at most). */
const endSessions = (who, userId) => asOwner(who, "admin_sign_out_user", { p_user: userId }).catch(() => 0);
const setBan = async (userId, banned) => {
  const r = await auth(`admin/users/${userId}`, { method: "PUT", body: { ban_duration: banned ? "876000h" : "none" } });
  if (!r.ok) refuse("Could not change that sign-in");
};

/** The people working in this company right now (their current company), for suspend / archive. */
async function peopleWorkingIn(tenantId, owners) {
  return (await rows(`profiles?tenant_id=eq.${tenantId}&select=user_id&limit=1000`)).map((p) => p.user_id).filter((id) => !owners.has(id));
}

/* ----------------------------------------------------------------- emails */

async function recoveryLink(email) {
  const r = await auth("admin/generate_link", { method: "POST", body: { type: "recovery", email } });
  const th = r.data?.hashed_token || r.data?.properties?.hashed_token;
  if (!r.ok || !th) refuse("Could not make the link. Try again.");
  return `${APP}/reset-password?token_hash=${encodeURIComponent(th)}&type=recovery`;
}
async function mailLink(ctx, { to, name, company, link, invited }) {
  const title = invited ? `You were added to ${company}` : "Reset your JMSURF Garage password";
  const intro = invited
    ? `You now have a JMSURF Garage login for <b>${esc(company)}</b>. Choose your password to sign in.`
    : "Use the button below to choose a new password. The link works once.";
  const r = await ctx.deliverEmail({
    to, subject: invited ? `Set your password for ${company} on JMSURF Garage` : "Reset your JMSURF Garage password",
    html: ctx.emailShell(title, `<p style="margin:0 0 14px;font-size:15px;">Hi ${esc(name || "there")}, ${intro}</p>
<p style="margin:0 0 14px;"><a href="${esc(link)}" style="display:inline-block;background:#a8121b;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600;">${invited ? "Set my password" : "Choose a new password"}</a></p>
<p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Then sign in at ${esc(APP)}/login with ${esc(to)}.</p>`),
    text: `${invited ? `You were added to ${company} on JMSURF Garage.` : "Reset your JMSURF Garage password."}\n${link}\nThen sign in at ${APP}/login with ${to}.`,
  }).catch(() => ({ ok: false }));
  return Boolean(r?.ok);
}
async function mailAttached(ctx, { to, name, company }) {
  const r = await ctx.deliverEmail({
    to, subject: `You were added to ${company} on JMSURF Garage`,
    html: ctx.emailShell(`You were added to ${company}`, `<p style="margin:0 0 14px;font-size:15px;">Hi ${esc(name || "there")}, you now have access to <b>${esc(company)}</b>. Sign in with your usual email and password at <a href="${esc(APP)}/login">${esc(APP)}/login</a> and pick it from your companies.</p>`),
    text: `You now have access to ${company} on JMSURF Garage. Sign in at ${APP}/login and pick it from your companies.`,
  }).catch(() => ({ ok: false }));
  return Boolean(r?.ok);
}

/* --------------------------------------------------------------- company actions */

const DETAIL_FIELDS = ["business_name", "contact_name", "contact_email", "contact_phone", "business_email", "business_phone", "business_address", "industry"];

async function companyAction(action, who, body, ctx) {
  const t = await companyOf(str(body.tenant_id));
  const tid = t.id;
  const now = new Date().toISOString();

  if (action === "details") {
    const patch = {};
    for (const k of DETAIL_FIELDS) {
      if (body[k] === undefined) continue;
      const v = str(body[k]).slice(0, k === "business_address" ? 300 : 160);
      if ((k === "contact_email" || k === "business_email") && v && !isEmail(v)) refuse("Enter a valid email");
      if (k === "business_name" && !v) refuse("Enter the business name");
      if (k === "contact_email" && !v) refuse("Enter the owner's email");
      patch[k] = k.endsWith("_phone") ? cleanPhone(v) || null : v || (k === "contact_name" ? "" : null);
    }
    if (!Object.keys(patch).length) refuse("Nothing to save");
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, t[k] ?? null]));
    await db(`tenants?id=eq.${tid}`, { method: "PATCH", prefer: "return=minimal", body: patch });
    await audit(who, tid, "company_details", "tenant", tid, { before, after: patch });
    return { ok: true };
  }

  if (action === "subscription") {
    const sub = await latestSub(tid);
    if (sub?.status === "suspended" || sub?.status === "paused") refuse("This company is suspended. Reactivate it first.");
    const plan = await one(`plans?id=eq.${encodeURIComponent(str(body.plan_id))}&select=id,name,price_monthly,max_users,max_locations`);
    if (!plan) refuse("Choose a plan");
    const cycle = ["monthly", "quarterly", "annually"].includes(str(body.billing_cycle)) ? str(body.billing_cycle) : "monthly";
    const status = ["active", "trial", "expired"].includes(str(body.status)) ? str(body.status) : "active";
    const ends = endOfDay(body.ends_at);
    if (status !== "expired" && !ends) refuse("Choose the date it runs to");
    const keep = sub && sub.plan_id === plan.id;
    const patch = {
      plan_id: plan.id, plan_name: plan.name, billing_cycle: cycle, status,
      price: keep ? Number(sub.price ?? plan.price_monthly) : Number(plan.price_monthly || 0),
      max_users: keep ? sub.max_users ?? plan.max_users : plan.max_users,
      max_locations: keep ? sub.max_locations ?? plan.max_locations : plan.max_locations,
      paused_at: null, updated_at: now,
    };
    if (ends) { patch.current_period_end = ends; patch.trial_ends_at = status === "trial" ? ends : null; }
    if (status === "expired") { patch.current_period_end = now; patch.trial_ends_at = null; patch.comped_until = null; }
    if (sub) await db(`subscriptions?id=eq.${sub.id}`, { method: "PATCH", prefer: "return=minimal", body: patch });
    else await db("subscriptions", { method: "POST", prefer: "return=minimal", body: { ...patch, tenant_id: tid, current_period_start: now } });
    await audit(who, tid, "subscription_changed", "subscription", sub?.id, {
      before: sub ? { plan: sub.plan_name, cycle: sub.billing_cycle, status: sub.status, ends: sub.current_period_end } : null,
      after: { plan: plan.name, cycle, status, ends: patch.current_period_end || null },
    });
    return { ok: true };
  }

  if (action === "trial") {
    const sub = await latestSub(tid);
    if (!sub) refuse("Give the company a plan first");
    if (sub.status === "suspended" || sub.status === "paused") refuse("This company is suspended. Reactivate it first.");
    if (body.end === true) {
      await db(`subscriptions?id=eq.${sub.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "expired", trial_ends_at: now, current_period_end: now, updated_at: now } });
      await audit(who, tid, "trial_ended", "subscription", sub.id, { was: sub.trial_ends_at });
      return { ok: true };
    }
    const until = endOfDay(body.until);
    if (!until || Date.parse(until) < Date.now()) refuse("Choose a date from today on");
    await db(`subscriptions?id=eq.${sub.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "trial", trial_ends_at: until, current_period_end: until, paused_at: null, updated_at: now } });
    await audit(who, tid, "trial_set", "subscription", sub.id, { from: sub.trial_ends_at, to: until });
    return { ok: true };
  }

  if (action === "comp") {
    const sub = await latestSub(tid);
    if (!sub) refuse("Give the company a plan first");
    if (sub.status === "suspended" || sub.status === "paused") refuse("This company is suspended. Reactivate it first.");
    const note = str(body.note).slice(0, 300);
    if (body.until === null) {
      await db(`subscriptions?id=eq.${sub.id}`, { method: "PATCH", prefer: "return=minimal", body: { comped_until: null, comp_note: null, status: "expired", current_period_end: now, updated_at: now } });
      await audit(who, tid, "plan_free_ended", "subscription", sub.id, { was: sub.comped_until });
      return { ok: true };
    }
    const until = endOfDay(body.until);
    if (!until || Date.parse(until) < Date.now()) refuse("Choose a date from today on");
    const end = sub.current_period_end && Date.parse(sub.current_period_end) > Date.parse(until) && sub.status === "active" ? sub.current_period_end : until;
    await db(`subscriptions?id=eq.${sub.id}`, { method: "PATCH", prefer: "return=minimal", body: { comped_until: until, comp_note: note || null, status: "active", trial_ends_at: null, current_period_end: end, paused_at: null, updated_at: now } });
    await audit(who, tid, "plan_free", "subscription", sub.id, { until, note });
    return { ok: true };
  }

  if (action === "module") {
    const key = str(body.key);
    const mod = await one(`platform_modules?key=eq.${encodeURIComponent(key)}&select=key,name,price_monthly,included`);
    if (!mod) refuse("Unknown module");
    if (mod.included) refuse("This module is in every plan already");
    const row = await one(`tenant_modules?tenant_id=eq.${tid}&module_key=eq.${encodeURIComponent(key)}&select=*`);
    if (body.status === undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0 || price > 10_000_000) refuse("Enter a price");
      if (!row) refuse("Switch the module on first");
      await db(`tenant_modules?id=eq.${row.id}`, { method: "PATCH", prefer: "return=minimal", body: { price_monthly: price, updated_at: now } });
      await audit(who, tid, "module_price", "module", row.id, { module: key, from: row.price_monthly, to: price });
      return { ok: true };
    }
    const status = str(body.status);
    if (!["comped", "trial", "active", "cancelled"].includes(status)) refuse("Choose what to do with the module");
    const until = body.until ? endOfDay(body.until) : null;
    if (body.until && (!until || Date.parse(until) < Date.now())) refuse("Choose a date from today on");
    const days = (n) => new Date(Date.now() + n * 86400_000).toISOString();
    const patch = {
      tenant_id: tid, module_key: key, status, updated_at: now,
      price_monthly: status === "comped" ? 0 : Number(row?.status === "comped" || !row ? mod.price_monthly : row.price_monthly) || 0,
      trial_ends_at: status === "trial" ? until || days(14) : null,
      current_period_end: status === "comped" ? until : status === "active" ? until || days(30) : null,
      cancelled_at: status === "cancelled" ? now : null,
      activated_by: who.user.id,
    };
    if (row) await db(`tenant_modules?id=eq.${row.id}`, { method: "PATCH", prefer: "return=minimal", body: patch });
    else await db("tenant_modules", { method: "POST", prefer: "return=minimal", body: patch });
    await audit(who, tid, `module_${status}`, "module", row?.id, { module: key, name: mod.name, until: patch.current_period_end || patch.trial_ends_at || null });
    return { ok: true };
  }

  if (action === "suspend") {
    const reason = str(body.reason).slice(0, 300);
    if (reason.length < 3) refuse("Say why the company is suspended (the company sees this)");
    const sub = await latestSub(tid);
    if (!sub) refuse("Give the company a plan first");
    await db(`subscriptions?id=eq.${sub.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "suspended", suspended_at: now, suspended_reason: reason, updated_at: now } });
    await db(`tenants?id=eq.${tid}`, { method: "PATCH", prefer: "return=minimal", body: { is_active: false } });
    const owners = await platformOwners();
    const people = await peopleWorkingIn(tid, owners);
    await mapLimit(people.slice(0, 500), 6, async (uid) => { await moveElsewhere(uid, tid).catch(() => false); await endSessions(who, uid); });
    await audit(who, tid, "company_suspended", "tenant", tid, { reason, was: sub.status, signed_out: people.length });
    return { ok: true, signed_out: people.length };
  }

  if (action === "reactivate") {
    const sub = await latestSub(tid);
    // "paused" is the older word for the same thing.
    if (!sub || (sub.status !== "suspended" && sub.status !== "paused")) refuse("This company is not suspended");
    const nowMs = Date.now();
    const status = sub.trial_ends_at && Date.parse(sub.trial_ends_at) > nowMs ? "trial"
      : sub.current_period_end && Date.parse(sub.current_period_end) > nowMs ? "active" : "expired";
    await db(`subscriptions?id=eq.${sub.id}`, { method: "PATCH", prefer: "return=minimal", body: { status, suspended_at: null, suspended_reason: null, paused_at: null, updated_at: now } });
    if (!t.deleted_at) await db(`tenants?id=eq.${tid}`, { method: "PATCH", prefer: "return=minimal", body: { is_active: true } });
    await audit(who, tid, "company_reactivated", "tenant", tid, { status });
    return { ok: true, status };
  }

  if (action === "archive") {
    if (t.deleted_at) refuse("Already archived");
    await db(`tenants?id=eq.${tid}`, { method: "PATCH", prefer: "return=minimal", body: { deleted_at: now, is_active: false } });
    const owners = await platformOwners();
    const people = await peopleWorkingIn(tid, owners);
    await mapLimit(people.slice(0, 500), 6, async (uid) => { await moveElsewhere(uid, tid).catch(() => false); await endSessions(who, uid); });
    await audit(who, tid, "company_archived", "tenant", tid, { reason: str(body.reason).slice(0, 300) || null });
    return { ok: true };
  }

  if (action === "restore") {
    if (!t.deleted_at) refuse("This company is not archived");
    const sub = await latestSub(tid);
    await db(`tenants?id=eq.${tid}`, { method: "PATCH", prefer: "return=minimal", body: { deleted_at: null, is_active: sub?.status !== "suspended" } });
    await audit(who, tid, "company_restored", "tenant", tid, {});
    return { ok: true };
  }

  if (action === "payment") {
    if (t.deleted_at) refuse("Restore the company first");
    const reference = str(body.reference).toUpperCase().slice(0, 60);
    if (reference.length < 3) refuse("Enter the M-Pesa code or reference");
    const amount = body.amount === undefined || body.amount === null || body.amount === "" ? null : Number(body.amount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) refuse("Enter the amount received");
    const res = await asOwner(who, "admin_record_payment", { p_tenants: [tid], p_reference: reference, p_total: amount, p_gateway: "manual" });
    const row = Array.isArray(res) ? res[0] : null;
    await audit(who, tid, "payment_recorded", "tenant", tid, { reference, amount: row?.amount ?? amount, paid_until: row?.paid_until || null });
    return { ok: true, paid_until: row?.paid_until || null };
  }

  if (action === "sms") {
    const units = Math.trunc(Number(body.units));
    if (!Number.isFinite(units) || units === 0) refuse("Enter how many SMS to add or take off");
    const amount = Math.max(0, Number(body.amount) || 0);
    const reference = str(body.reference).slice(0, 60);
    const note = str(body.note).slice(0, 500);
    const balance = await asOwner(who, "admin_add_sms_units", { p_tenant: tid, p_units: units, p_amount: amount, p_reference: reference || null, p_note: note || null });
    await audit(who, tid, units > 0 ? "sms_added" : "sms_removed", "tenant", tid, { units, amount, reference, note, balance });
    return { ok: true, balance };
  }

  if (action === "notes") {
    const [notes, actions] = await Promise.all([
      rows(`platform_tenant_notes?tenant_id=eq.${tid}&select=id,body,author_id,created_at&order=created_at.desc&limit=200`),
      rows(`platform_admin_actions?tenant_id=eq.${tid}&select=id,admin_id,action,target_type,target_id,detail,created_at&order=created_at.desc&limit=300`),
    ]);
    const ids = [...new Set([...notes.map((n) => n.author_id), ...actions.flatMap((a) => [a.admin_id, a.target_type === "user" ? a.target_id : null])].filter(isId))];
    const names = {};
    if (ids.length) for (const p of await rows(`profiles?user_id=in.(${ids.join(",")})&select=user_id,display_name`)) names[p.user_id] = p.display_name;
    return { ok: true, notes, actions, names };
  }

  if (action === "note-add") {
    const text = str(body.body).slice(0, 4000);
    if (!text) refuse("Write the note first");
    const [n] = await db("platform_tenant_notes", { method: "POST", body: { tenant_id: tid, body: text, author_id: who.user.id } });
    await audit(who, tid, "note_added", "note", n?.id, {});
    return { ok: true };
  }

  if (action === "note-delete") {
    if (!isId(body.id)) refuse("Choose a note");
    await db(`platform_tenant_notes?id=eq.${body.id}&tenant_id=eq.${tid}`, { method: "DELETE", prefer: "return=minimal" });
    await audit(who, tid, "note_deleted", "note", body.id, {});
    return { ok: true };
  }

  /* ---------------------------------------------------------------- people */

  if (action === "users") {
    const [members, owners, sub, security] = await Promise.all([
      rows(`tenant_members?tenant_id=eq.${tid}&select=user_id,role,is_owner,status,last_used_at,created_at&order=created_at.asc&limit=1000`),
      platformOwners(), latestSub(tid), asOwner(who, "admin_user_security", {}).catch(() => []),
    ]);
    const mfaOn = new Set((Array.isArray(security) ? security : []).filter((s) => s.mfa).map((s) => s.user_id));
    const list = members.filter((m) => !owners.has(m.user_id));
    const ids = list.map((m) => m.user_id);
    const profs = {};
    if (ids.length) for (const p of await rows(`profiles?user_id=in.(${ids.join(",")})&select=user_id,display_name,phone,tenant_id,must_change_password`)) profs[p.user_id] = p;
    const logins = await mapLimit(ids, 8, getLogin);
    const users = list.map((m, i) => {
      const u = logins[i] || {}; const p = profs[m.user_id] || {};
      return {
        user_id: m.user_id, name: p.display_name || u.user_metadata?.full_name || "", email: u.email || "", phone: p.phone || u.phone || "",
        role: m.role, is_owner: !!m.is_owner || m.user_id === t.owner_user_id, status: m.status,
        banned: !!u.banned_until && Date.parse(u.banned_until) > Date.now(),
        verified: !!u.email_confirmed_at, mfa: mfaOn.has(m.user_id),
        last_sign_in_at: u.last_sign_in_at || null, last_used_at: m.last_used_at, working_here: p.tenant_id === tid,
        must_change_password: !!p.must_change_password, created_at: m.created_at, missing: !u.id,
      };
    });
    const active = users.filter((u) => u.status === "active").length;
    return { ok: true, users, max_users: Number(sub?.max_users || 0), active };
  }

  if (action === "user-add") {
    if (t.deleted_at) refuse("Restore the company first");
    const email = str(body.email).toLowerCase();
    const name = str(body.name).slice(0, 120);
    const phone = cleanPhone(body.phone);
    const role = str(body.role) || "cashier";
    const method = str(body.method) === "password" ? "password" : "link";
    if (!isEmail(email)) refuse("Enter a valid email");
    if (!name) refuse("Enter their name");
    if (!COMPANY_ROLES.includes(role)) refuse("Choose a role");
    const given = str(body.password);
    if (method === "password" && given && given.length < 8) refuse("The one-time password needs at least 8 characters");

    const [sub, owners, members] = await Promise.all([
      latestSub(tid), platformOwners(),
      rows(`tenant_members?tenant_id=eq.${tid}&status=eq.active&select=user_id`),
    ]);
    const used = members.filter((m) => !owners.has(m.user_id)).length;
    const cap = Number(sub?.max_users || 0);
    const existing = await findLogin(email);
    const already = existing ? members.some((m) => m.user_id === existing.id) : false;
    if (already) refuse("That person is already in this company");
    if (cap > 0 && used >= cap) refuse(`The ${sub?.plan_name || "current"} plan allows ${cap} user${cap === 1 ? "" : "s"} and the company has ${used}. Raise the limit under Subscription → Custom deal first.`);

    if (existing) {
      if (owners.has(existing.id)) refuse("That email belongs to a platform owner");
      const had = await one(`tenant_members?tenant_id=eq.${tid}&user_id=eq.${existing.id}&select=id`);
      const row = { tenant_id: tid, user_id: existing.id, role, status: "active", invited_by: who.user.id, company_role_id: null };
      if (had) await db(`tenant_members?id=eq.${had.id}`, { method: "PATCH", prefer: "return=minimal", body: row });
      else await db("tenant_members", { method: "POST", prefer: "return=minimal", body: row });
      const prof = await one(`profiles?user_id=eq.${existing.id}&select=tenant_id`);
      if (prof && !prof.tenant_id) {
        await db(`profiles?user_id=eq.${existing.id}`, { method: "PATCH", prefer: "return=minimal", body: { tenant_id: tid, status: "active" } });
        await db(`user_roles?user_id=eq.${existing.id}`, { method: "DELETE", prefer: "return=minimal" });
        await db("user_roles", { method: "POST", prefer: "return=minimal", body: { user_id: existing.id, role } });
      }
      const emailed = await mailAttached(ctx, { to: email, name, company: t.business_name });
      await audit(who, tid, "user_attached", "user", existing.id, { email, role });
      return { ok: true, existing: true, emailed, user_id: existing.id };
    }

    if (phone) {
      const taken = await db("rpc/phone_taken", { method: "POST", body: { p_phone: phone } }).catch(() => false);
      if (taken === true) refuse("That phone number already belongs to another login. Every login needs its own number.");
    }
    const password = method === "password" ? given || strongPassword() : strongPassword();
    const created = await auth("admin/users", { method: "POST", body: { email, password, email_confirm: true, user_metadata: { full_name: name } } });
    if (!created.ok || !created.data?.id) refuse(str(created.data?.msg || created.data?.message) || "Could not create that login");
    const uid = created.data.id;

    const profile = { tenant_id: tid, display_name: name, phone: phone || null, must_change_password: method === "password", invited_at: now, invited_by: who.user.id, status: "active" };
    const patched = await db(`profiles?user_id=eq.${uid}`, { method: "PATCH", body: profile }).catch(() => []);
    if (!Array.isArray(patched) || !patched.length) await db("profiles", { method: "POST", prefer: "return=minimal", body: { user_id: uid, ...profile } });
    await db(`user_roles?user_id=eq.${uid}`, { method: "DELETE", prefer: "return=minimal" });
    await db("user_roles", { method: "POST", prefer: "return=minimal", body: { user_id: uid, role } });
    await db("tenant_members?on_conflict=tenant_id,user_id", { method: "POST", prefer: "return=minimal,resolution=merge-duplicates", body: { tenant_id: tid, user_id: uid, role, status: "active", invited_by: who.user.id } });
    // The till and stock screens need a branch: the company's main one.
    const main = await one(`locations?tenant_id=eq.${tid}&is_active=eq.true&order=is_main.desc,created_at.asc&limit=1&select=id`).catch(() => null);
    if (main) await db("user_locations", { method: "POST", prefer: "return=minimal", body: { user_id: uid, location_id: main.id, is_primary: true } }).catch(() => null);

    let emailed = false;
    if (method === "link") emailed = await mailLink(ctx, { to: email, name, company: t.business_name, link: await recoveryLink(email), invited: true });
    await audit(who, tid, "user_added", "user", uid, { email, role, method });
    // The one-time password goes back to the platform owner once, to hand over; it is never stored or logged.
    return { ok: true, user_id: uid, emailed, password: method === "password" ? password : undefined };
  }

  if (action === "user-role") {
    const m = await memberOf(tid, body.user_id);
    const role = str(body.role);
    if (!COMPANY_ROLES.includes(role)) refuse("Choose a role");
    if ((m.is_owner || t.owner_user_id === body.user_id) && role !== "admin") refuse("The owner stays an administrator. Transfer ownership first.");
    await db(`tenant_members?id=eq.${m.id}`, { method: "PATCH", prefer: "return=minimal", body: { role, company_role_id: null } });
    const prof = await one(`profiles?user_id=eq.${body.user_id}&select=tenant_id`);
    if (prof?.tenant_id === tid) {
      await db(`profiles?user_id=eq.${body.user_id}`, { method: "PATCH", prefer: "return=minimal", body: { company_role_id: null } });
      await db(`user_roles?user_id=eq.${body.user_id}`, { method: "DELETE", prefer: "return=minimal" });
      await db("user_roles", { method: "POST", prefer: "return=minimal", body: { user_id: body.user_id, role } });
    }
    await audit(who, tid, "user_role", "user", body.user_id, { from: m.role, to: role });
    return { ok: true };
  }

  if (action === "user-remove") {
    const m = await memberOf(tid, body.user_id);
    if (m.is_owner || t.owner_user_id === body.user_id) refuse("The owner cannot be removed. Transfer ownership first.");
    await db(`tenant_members?id=eq.${m.id}`, { method: "DELETE", prefer: "return=minimal" });
    const kept = await moveElsewhere(body.user_id, tid);
    if (!kept) {
      // No other company: the login stays (records keep their name) but cannot sign in.
      await db(`profiles?user_id=eq.${body.user_id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "inactive" } });
      await setBan(body.user_id, true);
    }
    await endSessions(who, body.user_id);
    await audit(who, tid, "user_removed", "user", body.user_id, { role: m.role, login_blocked: !kept });
    return { ok: true, login_blocked: !kept };
  }

  if (action === "owner") {
    const m = await memberOf(tid, body.user_id);
    if (m.status !== "active") refuse("Give them access again first");
    if (t.owner_user_id === body.user_id) refuse("They already own this company");
    const login = await getLogin(body.user_id);
    if (!login?.email) refuse("That login has no email address");
    const prof = await one(`profiles?user_id=eq.${body.user_id}&select=display_name,phone,tenant_id`);
    await db(`tenant_members?tenant_id=eq.${tid}&is_owner=eq.true`, { method: "PATCH", prefer: "return=minimal", body: { is_owner: false } });
    await db(`tenant_members?id=eq.${m.id}`, { method: "PATCH", prefer: "return=minimal", body: { is_owner: true, role: "admin", company_role_id: null } });
    await db(`tenants?id=eq.${tid}`, { method: "PATCH", prefer: "return=minimal", body: { owner_user_id: body.user_id, contact_email: login.email, contact_name: prof?.display_name || t.contact_name, contact_phone: prof?.phone || t.contact_phone } });
    if (prof?.tenant_id === tid) {
      await db(`user_roles?user_id=eq.${body.user_id}`, { method: "DELETE", prefer: "return=minimal" });
      await db("user_roles", { method: "POST", prefer: "return=minimal", body: { user_id: body.user_id, role: "admin" } });
    }
    await audit(who, tid, "owner_transferred", "user", body.user_id, { from: t.owner_user_id, to: body.user_id });
    return { ok: true };
  }

  refuse("Unknown action", 404);
}

/* ---------------------------------------------------------------- login actions */

async function userAction(action, who, body, ctx) {
  const uid = str(body.user_id);
  if (!isId(uid)) refuse("Choose a person");
  const tid = isId(body.tenant_id) ? str(body.tenant_id) : null;
  if (tid) await memberOf(tid, uid);
  if (uid === who.user.id) refuse("Use My account for your own login");
  const owners = await platformOwners();
  if (owners.has(uid)) refuse("Platform owner logins are changed from their own account");

  if (action === "login") {
    const enabled = body.enabled === true;
    await setBan(uid, !enabled);
    if (enabled) await db(`profiles?user_id=eq.${uid}&status=eq.inactive`, { method: "PATCH", prefer: "return=minimal", body: { status: "active" } }).catch(() => null);
    else await endSessions(who, uid);
    await audit(who, tid, enabled ? "login_enabled" : "login_disabled", "user", uid, {});
    return { ok: true };
  }
  if (action === "reset") {
    const login = await getLogin(uid);
    if (!login?.email) refuse("That login has no email address");
    const prof = await one(`profiles?user_id=eq.${uid}&select=display_name`);
    const sent = await mailLink(ctx, { to: login.email, name: prof?.display_name, company: "", link: await recoveryLink(login.email), invited: false });
    if (!sent) refuse("The email did not go out. Check Settings → Email and try again.");
    await audit(who, tid, "password_reset_sent", "user", uid, { email: login.email });
    return { ok: true, email: login.email };
  }
  if (action === "mfa") {
    // Removes the authenticator(s); the person sets one up again after signing in.
    // (The database function records it too; the company copy is written here.)
    const removed = Number(await asOwner(who, "admin_reset_user_mfa", { p_user: uid })) || 0;
    if (!removed) refuse("Two-step sign-in is not switched on for this login");
    await endSessions(who, uid);
    if (tid) await audit(who, tid, "mfa_reset", "user", uid, { factors_removed: removed });
    return { ok: true };
  }
  if (action === "verify") {
    const r = await auth(`admin/users/${uid}`, { method: "PUT", body: { email_confirm: true } });
    if (!r.ok) refuse("Could not confirm that email");
    await audit(who, tid, "email_confirmed", "user", uid, { email: r.data?.email || "" });
    return { ok: true };
  }
  if (action === "password") {
    // A one-time password the platform owner hands over; they choose their own at the next sign-in.
    const given = str(body.password);
    if (given && given.length < 8) refuse("The one-time password needs at least 8 characters");
    const password = given || strongPassword();
    const r = await auth(`admin/users/${uid}`, { method: "PUT", body: { password } });
    if (!r.ok) refuse(str(r.data?.msg || r.data?.message) || "Could not set that password");
    await db(`profiles?user_id=eq.${uid}`, { method: "PATCH", prefer: "return=minimal", body: { must_change_password: true } });
    await endSessions(who, uid);
    await audit(who, tid, "one_time_password_set", "user", uid, {});
    return { ok: true, password };
  }
  if (action === "delete") {
    // For good: only a login that owns no company (transfer ownership or archive the company first).
    const owns = await rows(`tenants?owner_user_id=eq.${uid}&deleted_at=is.null&select=business_name&limit=3`);
    if (owns.length) refuse(`They own ${owns.map((x) => x.business_name).join(", ")}. Transfer ownership first.`);
    const login = await getLogin(uid);
    const r = await auth(`admin/users/${uid}`, { method: "DELETE" });
    if (!r.ok) refuse("Could not delete that login. Block its sign-in instead.");
    await audit(who, tid, "login_deleted", "user", null, { email: login?.email || "", name: login?.user_metadata?.full_name || "" });
    return { ok: true };
  }
  if (action === "signout") {
    const n = await endSessions(who, uid);
    if (tid) await audit(who, tid, "signed_out_everywhere", "user", uid, { sessions_ended: n });
    return { ok: true, sessions: n };
  }
  refuse("Unknown action", 404);
}

/** Every login with its companies, for Admin → Users. */
async function allUsers(who) {
  const users = [];
  for (let page = 1; page <= 25; page += 1) {
    const r = await auth(`admin/users?page=${page}&per_page=200`);
    if (!r.ok) break;
    const batch = r.data?.users || [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  const [members, tenants, profiles, owners, security] = await Promise.all([
    rows("tenant_members?select=user_id,tenant_id,role,is_owner,status&limit=20000"),
    rows("tenants?select=id,business_name,deleted_at,owner_user_id&limit=10000"),
    rows("profiles?select=user_id,display_name,phone,tenant_id&limit=20000"),
    platformOwners(),
    asOwner(who, "admin_user_security", {}).catch(() => []),
  ]);
  const tname = new Map(tenants.map((t) => [t.id, t]));
  const prof = new Map(profiles.map((p) => [p.user_id, p]));
  const sec = new Map((Array.isArray(security) ? security : []).map((s) => [s.user_id, s]));
  const byUser = new Map();
  for (const m of members) { if (!byUser.has(m.user_id)) byUser.set(m.user_id, []); byUser.get(m.user_id).push(m); }
  return users.map((u) => {
    const p = prof.get(u.id) || {};
    const s = sec.get(u.id) || {};
    return {
      user_id: u.id, email: u.email || "", phone: p.phone || u.phone || "", name: p.display_name || u.user_metadata?.full_name || "",
      platform_owner: owners.has(u.id), verified: !!u.email_confirmed_at,
      banned: !!u.banned_until && Date.parse(u.banned_until) > Date.now(),
      last_sign_in_at: u.last_sign_in_at || null, created_at: u.created_at, mfa: !!s.mfa, sessions: Number(s.sessions || 0),
      current_tenant_id: p.tenant_id || null,
      companies: (byUser.get(u.id) || []).map((m) => ({
        tenant_id: m.tenant_id, name: tname.get(m.tenant_id)?.business_name || "", role: m.role, status: m.status,
        is_owner: !!m.is_owner || tname.get(m.tenant_id)?.owner_user_id === u.id, archived: !!tname.get(m.tenant_id)?.deleted_at,
      })),
    };
  });
}

/* ------------------------------------------------------------------- routes */

export const isPlatformAdminRoute = (p) => typeof p === "string" && (p.startsWith("/api/admin/companies/") || p.startsWith("/api/admin/users/"));

export async function handlePlatformAdmin(req, res, pathname, body, ctx) {
  const { sendJson, requireSuperAdmin } = ctx;
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  if (!URL_ || !KEY) return sendJson(res, 503, { ok: false, error: "The server is missing its backend key" });
  const who = await requireSuperAdmin(req);
  if (who.error) return sendJson(res, who.status || 403, { ok: false, error: who.error });
  const [, , , area, action] = pathname.split("/");
  try {
    if (area === "companies") return sendJson(res, 200, await companyAction(action, who, body || {}, ctx));
    if (area === "users" && action === "all") return sendJson(res, 200, { ok: true, users: await allUsers(who) });
    if (area === "users") return sendJson(res, 200, await userAction(action, who, body || {}, ctx));
    return sendJson(res, 404, { ok: false, error: "Unknown route" });
  } catch (e) {
    if (e instanceof Refusal) return sendJson(res, e.status, { ok: false, error: e.message });
    console.error(`[admin] ${pathname} failed:`, e?.message || e);
    return sendJson(res, 500, { ok: false, error: "Something went wrong. Try again." });
  }
}
