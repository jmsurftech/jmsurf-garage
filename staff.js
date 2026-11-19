import { withPlatformRole } from "./platform.js";
// ---------------------------------------------------------------------------
// Staff accounts handled directly by the app container.
//
// These routes replace the backend functions for creating staff logins,
// listing their sign-in emails and resetting their passwords, because the
// self-hosted function runtime is not refreshed by a normal deploy.
// ---------------------------------------------------------------------------

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ""
).replace(/\/+$/, "");
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
import { randomInt, createHmac, randomBytes } from "node:crypto";
import { Resolver } from "node:dns/promises";

// Accept every common spelling so a key saved under any of these names works.
const SERVICE_KEY =
  process.env.JMSURF_SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

// Roles a company admin may hand out (more than one Admin is allowed). Platform
// roles are not, matching the database rules on user_roles.
const SHOP_ASSIGNABLE_ROLES = new Set([
  "admin", "manager", "finance", "customer_service",
  "cashier", "stock_manager", "rider", "sales_person", "packaging",
]);

/** Login address for staff: the workspace on app.garage.jmsurf.co.ke (one login, the company comes from the membership). */
async function loginUrlFor(_tenantId) {
  return `${process.env.SHOP_ORIGIN || process.env.APP_ORIGIN || "https://app.garage.jmsurf.co.ke"}/login`;
}

/** Emails a temporary password; the person chooses their own at first sign-in. */
async function emailTempPassword({ to, name, password, loginUrl, invited, company }) {
  const intro = invited
    ? `You have been added to ${escHtml(company || "your company")} on JMSURF Garage.`
    : "Your JMSURF Garage password was reset.";
  const result = await deliverEmail({
    to,
    subject: invited ? `You're invited to ${company || "JMSURF Garage"}` : "Your JMSURF Garage temporary password",
    html: emailShell(
      invited ? "Welcome aboard" : "Your password was reset",
      `<p style="margin:0 0 14px;font-size:15px;">Hi ${escHtml(name || "there")}, ${intro}</p>
<p style="margin:0 0 6px;font-size:15px;">Sign in with:</p>
<p style="margin:0 0 4px;font-size:15px;">Email: <b>${escHtml(to)}</b></p>
<p style="margin:0 0 14px;font-size:15px;">Temporary password: <b style="font-family:monospace;font-size:16px;">${escHtml(password)}</b></p>
<p style="margin:0 0 14px;font-size:15px;"><a href="${escHtml(loginUrl)}" style="display:inline-block;background:#a8121b;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600;">Sign in</a></p>
<p style="margin:0 0 14px;font-size:15px;">You will be asked to choose your own password straight after signing in.</p>`,
    ),
    text: `${invited ? `You have been added to ${company || "your company"} on JMSURF Garage.` : "Your JMSURF Garage password was reset."}
Email: ${to}
Temporary password: ${password}
Sign in: ${loginUrl}
You will choose your own password after signing in.`,
  }).catch(() => ({ ok: false }));
  return Boolean(result?.ok);
}

const escHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

let sendJson = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};
let deliverEmail = async () => ({ ok: false, error: "Email is not configured" });
let emailShell = (title, inner) => `<h1>${title}</h1>${inner}`;

export function configureStaff(helpers = {}) {
  if (helpers.sendJson) sendJson = helpers.sendJson;
  if (helpers.deliverEmail) deliverEmail = helpers.deliverEmail;
  if (helpers.emailShell) emailShell = helpers.emailShell;
}

export function isStaffRoute(pathname) {
  return typeof pathname === "string" && pathname.startsWith("/api/staff/");
}

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());

function adminHeaders(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** Headers for reads/writes done on behalf of the signed-in user. */
function userHeaders(token, extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function db(pathAndQuery, { method = "GET", body, prefer, token } = {}) {
  const useUser = !SERVICE_KEY && token;
  const headers = useUser
    ? userHeaders(token, prefer ? { Prefer: prefer } : {})
    : adminHeaders(prefer ? { Prefer: prefer } : {});
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: response.ok, status: response.status, data, raw: text };
}

async function authenticate(req) {
  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) return { error: "Please sign in again", status: 401 };
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { error: "The server is missing its backend address", status: 500 };
  }
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
  });
  if (!response.ok) return { error: "Please sign in again", status: 401 };
  const user = await response.json();
  if (!user?.id) return { error: "Please sign in again", status: 401 };
  return { user, token: authHeader.slice(7) };
}

/** Signed-in caller plus their roles and shop. */
async function callerContext(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth;
  const token = auth.token;
  const [roleRes, profileRes] = await Promise.all([
    db(`user_roles?user_id=eq.${auth.user.id}&select=role`, { token }),
    db(`profiles?user_id=eq.${auth.user.id}&select=tenant_id&limit=1`, { token }),
  ]);
  const roles = await withPlatformRole((roleRes.data || []).map((r) => String(r.role)), auth.user.id, req);
  return {
    user: auth.user,
    token,
    hasServiceKey: Boolean(SERVICE_KEY),
    roles,
    isSuperAdmin: roles.includes("super_admin"),
    isShopAdmin: roles.some((r) => ["admin", "manager"].includes(r)),
    tenantId: profileRes.data?.[0]?.tenant_id || null,
  };
}

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i += 1) out += chars[randomInt(chars.length)];
  return `Jm${out}`;
}

/** Finds an account by email using the backend key. */
async function findAuthUserByEmail(email) {
  if (!SERVICE_KEY || !email) return null;
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=50`,
    { headers: adminHeaders() },
  );
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const list = payload?.users || [];
  return list.find((u) => String(u.email || "").toLowerCase() === email.toLowerCase()) || null;
}

/**
 * Marks a login as verified. Staff accounts are created by their own shop
 * owner, so they must never be held back by a verification email.
 *
 * Two routes are tried so this keeps working whichever way the server is set
 * up: the backend key first, then a guarded database call as the signed-in
 * admin.
 */
async function confirmEmail({ token, userId = "", email = "" }) {
  const problems = [];

  if (SERVICE_KEY) {
    let id = userId;
    let existing = null;
    if (!id && email) {
      existing = await findAuthUserByEmail(email);
      id = existing?.id || "";
    }
    if (id) {
      if (existing?.email_confirmed_at) {
        return { ok: true, result: { ok: true, alreadyVerified: true, email: existing.email, user_id: id } };
      }
      const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify({ email_confirm: true }),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok) {
        return {
          ok: true,
          result: {
            ok: true,
            alreadyVerified: false,
            email: payload?.email || email,
            user_id: payload?.id || id,
          },
        };
      }
      problems.push(String(payload?.msg || payload?.message || `backend replied ${response.status}`));
    } else {
      problems.push("that account was not found");
    }
  }

  // Database route: works even when the server has no backend key.
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_user_email`, {
    method: "POST",
    headers: userHeaders(token),
    body: JSON.stringify({ _user_id: userId || null, _email: email || null }),
  });
  const payload = await response.json().catch(() => null);
  if (response.ok) return { ok: true, result: payload };
  problems.push(String(payload?.message || payload?.hint || `database replied ${response.status}`));

  return { ok: false, error: `Could not verify that account: ${problems.join("; ")}` };
}


// ------------------------------------------------------------------ create

async function createStaff(req, res, body) {
  const ctx = await callerContext(req);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });
  if (!ctx.isSuperAdmin && !ctx.roles.includes("admin")) {
    return sendJson(res, 403, { error: "Only the shop owner can add staff" });
  }

  const email = str(body.email).toLowerCase();
  // The system makes the temporary password and emails it.
  const password = str(body.password) || randomPassword();
  const displayName = str(body.display_name);
  const phone = str(body.phone);
  let role = str(body.role) || "cashier";
  const locationId = str(body.location_id);
  const companyRoleId = str(body.company_role_id);

  if (!email || !password || !displayName) {
    return sendJson(res, 400, { error: "Name and email are required" });
  }
  if (password.length < 6) {
    return sendJson(res, 400, { error: "The password must be at least 6 characters" });
  }
  if (!ctx.isSuperAdmin && !SHOP_ASSIGNABLE_ROLES.has(role)) {
    return sendJson(res, 403, { error: "That role cannot be given from a shop account" });
  }
  if (phone && SERVICE_KEY) {
    const taken = await db("rpc/phone_taken", { method: "POST", body: { p_phone: phone } });
    if (taken.data === true) {
      return sendJson(res, 400, { error: "That phone number already belongs to another account. Every account needs its own number." });
    }
  }
  if (!SERVICE_KEY) {
    return sendJson(res, 503, { error: "Staff accounts cannot be created right now. Contact support." });
  }

  const tenantId = ctx.isSuperAdmin ? str(body.tenant_id) || ctx.tenantId : ctx.tenantId;
  if (!tenantId) return sendJson(res, 400, { error: "This account is not linked to a shop yet" });

  const token = ctx.token;
  let companyRole = null;
  if (companyRoleId) {
    companyRole = (await db(`company_roles?id=eq.${encodeURIComponent(companyRoleId)}&tenant_id=eq.${tenantId}&select=id,base_role&limit=1`)).data?.[0] || null;
    if (!companyRole) return sendJson(res, 400, { error: "That role was not found" });
    role = String(companyRole.base_role);
    if (!ctx.isSuperAdmin && !SHOP_ASSIGNABLE_ROLES.has(role) && role !== "admin") return sendJson(res, 403, { error: "That role cannot be given from a shop account" });
  }

  // Plan limit check
  const [subRes, countRes] = await Promise.all([
    db(`subscriptions?tenant_id=eq.${tenantId}&select=max_users,plan_name&order=created_at.desc&limit=1`, { token }),
    fetch(`${SUPABASE_URL}/rest/v1/profiles?tenant_id=eq.${tenantId}&select=id`, {
      headers: SERVICE_KEY
        ? adminHeaders({ Prefer: "count=exact", Range: "0-0" })
        : userHeaders(token, { Prefer: "count=exact", Range: "0-0" }),
    }),
  ]);
  const cap = Number(subRes.data?.[0]?.max_users ?? 0);
  const used = Number(String(countRes.headers.get("content-range") || "").split("/")[1] || 0);
  if (cap > 0 && used >= cap) {
    return sendJson(res, 403, {
      error: `Your ${subRes.data?.[0]?.plan_name || "current"} package allows ${cap} user${cap === 1 ? "" : "s"} (you have ${used}). Upgrade to add more.`,
    });
  }

  // Staff are always created through the admin API. Public sign-up must never
  // be able to attach an account to a shop.
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName },
    }),
  });
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !created?.id) {
    const message = String(created?.msg || created?.message || created?.error_description || "");
    if (/already/i.test(message)) {
      const existing = await findAuthUserByEmail(email);
      if (!existing?.id) return sendJson(res, 400, { error: "That email already has an account" });
      const had = (await db(`tenant_members?tenant_id=eq.${tenantId}&user_id=eq.${existing.id}&select=id,status&limit=1`)).data?.[0];
      if (had?.status === "active") return sendJson(res, 400, { error: "That person is already in this company" });
      const row = { tenant_id: tenantId, user_id: existing.id, role, status: "active", invited_by: ctx.user.id, company_role_id: companyRole?.id || null,
        location_ids: Array.isArray(body.location_ids) && body.location_ids.length ? body.location_ids.map(str).filter(Boolean) : null };
      const ins = had ? await db(`tenant_members?id=eq.${had.id}`, { method: "PATCH", body: row }) : await db("tenant_members", { method: "POST", body: row });
      if (!ins.ok) return sendJson(res, 400, { error: "Could not add that person to the company" });
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existing.id}`, { method: "PUT", headers: adminHeaders(), body: JSON.stringify({ ban_duration: "none" }) }).catch(() => null);
      const company = (await db(`tenants?id=eq.${tenantId}&select=business_name,name&limit=1`)).data?.[0];
      const cname = company?.business_name || company?.name || "a company";
      const url = await loginUrlFor(tenantId);
      if (typeof deliverEmail === "function") await deliverEmail({ to: email, subject: `You were added to ${cname} on JMSURF Garage`, text: `Hello ${displayName},\n\nYou now have access to ${cname} on JMSURF Garage. Sign in with your usual email and password, then pick ${cname} from your companies.\n\n${url}`, html: `<p>Hello ${displayName},</p><p>You now have access to <b>${cname}</b> on JMSURF Garage. Sign in with your usual email and password, then pick <b>${cname}</b> from your companies.</p><p><a href="${url}">${url}</a></p>` }).catch(() => null);
      return sendJson(res, 200, { success: true, user_id: existing.id, existing: true, message: `${email} already uses JMSURF Garage: they were added to ${cname} with this role and told by email.` });
    }
    return sendJson(res, 400, { error: message || "Could not create that staff login" });
  }
  const userId = created.id;

  // The account trigger creates the profile and a default role; adjust both.
  const profileUpdate = { tenant_id: tenantId, display_name: displayName, must_change_password: true, invited_at: new Date().toISOString(), invited_by: ctx.user.id };
  if (phone) profileUpdate.phone = phone;
  if (companyRole) profileUpdate.company_role_id = companyRole.id;
  const locIds = Array.isArray(body.location_ids) ? body.location_ids.map(str).filter(Boolean).slice(0, 50) : [];
  if (locIds.length) profileUpdate.location_ids = locIds;
  if (body.cost_per_hour !== undefined && body.cost_per_hour !== "") profileUpdate.cost_per_hour = Number(body.cost_per_hour) || null;
  if (str(body.address)) profileUpdate.address = str(body.address).slice(0, 200);
  if (str(body.remarks)) profileUpdate.remarks = str(body.remarks).slice(0, 255);
  const patched = await db(`profiles?user_id=eq.${userId}`, { method: "PATCH", body: profileUpdate, prefer: "return=representation" });
  if (!patched.ok || !(patched.data || []).length) {
    await db("profiles", { method: "POST", body: { user_id: userId, ...profileUpdate } });
  }

  await db(`user_roles?user_id=eq.${userId}`, { method: "DELETE", token });
  const roleInsert = await db("user_roles", { method: "POST", body: { user_id: userId, role }, token });
  if (!roleInsert.ok) {
    await db("user_roles", { method: "POST", body: { user_id: userId, role: "cashier" }, token });
  }

  // Every staff login needs a branch, otherwise the till has no shop to load
  // products from. Fall back to the shop's main (or first) branch.
  let assignedLocation = locationId;
  if (assignedLocation) {
    // The branch must belong to this shop.
    const owned = await db(`locations?id=eq.${encodeURIComponent(assignedLocation)}&tenant_id=eq.${tenantId}&select=id&limit=1`, { token });
    if (!(owned.data || []).length) assignedLocation = "";
  }
  if (!assignedLocation) {
    const main = await db(`locations?tenant_id=eq.${tenantId}&is_active=eq.true&order=is_main.desc,created_at.asc&limit=1&select=id`, { token });
    assignedLocation = (main.data || [])[0]?.id || "";
  }
  if (assignedLocation) {
    await db("user_locations", {
      method: "POST",
      body: { user_id: userId, location_id: assignedLocation, is_primary: true },
      token,
    });
  }

  // Staff never wait for a verification email — confirm the login right away.
  const confirmed = await confirmEmail({ token, userId });

  const company = (await db(`tenants?id=eq.${tenantId}&select=name&limit=1`)).data?.[0]?.name || "";
  const emailed = await emailTempPassword({ to: email, name: displayName, password, loginUrl: await loginUrlFor(tenantId), invited: true, company });

  return sendJson(res, 200, {
    success: true,
    user_id: userId,
    verified: confirmed.ok,
    emailed,
    message: emailed
      ? `Invitation sent to ${email} with a temporary password. They choose their own when they first sign in.`
      : `Staff member added, but the email did not go out. Use "Send a temporary password" on their card to try again.`,
  });
}

// ------------------------------------------------------------------ update

/**
 * Changes a person in the company: their role (company role → database role), active / inactive
 * (inactive people cannot sign in), the branches they work in and their details.
 */
async function updateStaff(req, res, body) {
  const ctx = await callerContext(req);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });
  if (!ctx.isSuperAdmin && !ctx.roles.includes("admin")) return sendJson(res, 403, { error: "Only the company admin can change users" });
  if (!SERVICE_KEY) return sendJson(res, 503, { error: "Users cannot be changed right now. Contact support." });
  const userId = str(body.user_id);
  const tenantId = ctx.tenantId;
  if (!userId || !tenantId) return sendJson(res, 400, { error: "Which user should be changed?" });
  // The person's membership of this company (they may be working in another of their companies right now).
  const member = (await db(`tenant_members?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&select=id,role,is_owner,status&limit=1`)).data?.[0];
  if (!member) return sendJson(res, 403, { error: "You can only change users in your own company" });
  const profile = (await db(`profiles?user_id=eq.${encodeURIComponent(userId)}&select=tenant_id&limit=1`)).data?.[0];
  const here = profile?.tenant_id === tenantId;
  const self = userId === ctx.user.id;
  const tenant = (await db(`tenants?id=eq.${tenantId}&select=owner_user_id&limit=1`)).data?.[0];
  const isOwner = member.is_owner || (!!tenant?.owner_user_id && tenant.owner_user_id === userId);
  const prof = {}; const mem = {};
  if (body.display_name !== undefined && str(body.display_name)) prof.display_name = str(body.display_name).slice(0, 120);
  if (body.phone !== undefined) prof.phone = str(body.phone) || null;
  if (body.cost_per_hour !== undefined) prof.cost_per_hour = body.cost_per_hour === "" || body.cost_per_hour === null ? null : Number(body.cost_per_hour) || 0;
  if (body.address !== undefined) prof.address = str(body.address).slice(0, 200) || null;
  if (body.remarks !== undefined) prof.remarks = str(body.remarks).slice(0, 255) || null;
  if (body.location_ids !== undefined) {
    const ids = Array.isArray(body.location_ids) ? body.location_ids.map(str).filter(Boolean).slice(0, 50) : [];
    if (ids.length) {
      const owned = (await db(`locations?tenant_id=eq.${tenantId}&id=in.(${ids.map(encodeURIComponent).join(",")})&select=id`)).data || [];
      if (owned.length !== ids.length) return sendJson(res, 400, { error: "A branch does not belong to this company" });
    }
    mem.location_ids = ids.length ? ids : null;
    if (here) {
      prof.location_ids = mem.location_ids;
      // The till and stock screens read user_locations: keep it in step (first branch is the main one).
      await db(`user_locations?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE" });
      if (ids.length) await db("user_locations", { method: "POST", body: ids.map((id, i) => ({ user_id: userId, location_id: id, is_primary: i === 0 })) });
    }
  }
  if (body.company_role_id !== undefined) {
    if (self || isOwner) return sendJson(res, 403, { error: self ? "You cannot change your own role" : "The owner's role cannot be changed" });
    const rid = str(body.company_role_id);
    const r = rid ? (await db(`company_roles?id=eq.${encodeURIComponent(rid)}&tenant_id=eq.${tenantId}&select=id,base_role&limit=1`)).data?.[0] : null;
    if (rid && !r) return sendJson(res, 400, { error: "That role was not found" });
    if (r && String(r.base_role) === "super_admin") return sendJson(res, 403, { error: "That role cannot be given" });
    mem.company_role_id = r ? r.id : null;
    if (r) mem.role = r.base_role;
    if (here) {
      prof.company_role_id = mem.company_role_id;
      if (r) { await db(`user_roles?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE" }); await db("user_roles", { method: "POST", body: { user_id: userId, role: r.base_role } }); }
    }
  }
  if (body.status !== undefined) {
    const inactive = str(body.status) === "inactive";
    if (inactive && (self || isOwner)) return sendJson(res, 403, { error: self ? "You cannot make yourself inactive" : "The owner cannot be made inactive" });
    mem.status = inactive ? "disabled" : "active";
    if (here) prof.status = inactive ? "inactive" : "active";
    // Inactive in this company only. Sign-in is blocked only when no other company of theirs is active.
    const others = (await db(`tenant_members?user_id=eq.${encodeURIComponent(userId)}&tenant_id=neq.${tenantId}&status=eq.active&select=tenant_id`)).data || [];
    if (inactive && here && others.length) {
      // Move them to one of their other companies so they keep working there.
      const next = others[0].tenant_id;
      const nm = (await db(`tenant_members?user_id=eq.${encodeURIComponent(userId)}&tenant_id=eq.${next}&select=role,company_role_id,location_ids&limit=1`)).data?.[0] || {};
      Object.assign(prof, { tenant_id: next, company_role_id: nm.company_role_id || null, location_ids: nm.location_ids || null, status: "active" });
      await db(`user_roles?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE" });
      await db("user_roles", { method: "POST", body: { user_id: userId, role: nm.role || "cashier" } });
    }
    const ban = inactive && !others.length ? "876000h" : "none";
    if (inactive ? !others.length : true) {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: "PUT", headers: adminHeaders(), body: JSON.stringify({ ban_duration: ban }) });
      if (!r.ok) return sendJson(res, 400, { error: "Could not change that user's sign-in" });
    }
  }
  if (Object.keys(mem).length) {
    const r = await db(`tenant_members?id=eq.${member.id}`, { method: "PATCH", body: mem });
    if (!r.ok) return sendJson(res, 400, { error: "Could not save the changes" });
  }
  if (Object.keys(prof).length) {
    prof.updated_at = new Date().toISOString();
    const r = await db(`profiles?user_id=eq.${encodeURIComponent(userId)}`, { method: "PATCH", body: prof });
    if (!r.ok) return sendJson(res, 400, { error: "Could not save the changes" });
  }
  return sendJson(res, 200, { success: true });
}

// ----------------------------------------------------------------- verify

async function verifyStaff(req, res, body) {
  const ctx = await callerContext(req);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });
  if (!ctx.isSuperAdmin && !ctx.isShopAdmin) {
    return sendJson(res, 403, { error: "You do not have permission to verify accounts" });
  }
  let userId = str(body.user_id);
  const email = str(body.email).toLowerCase();
  if (!userId && !email) return sendJson(res, 400, { error: "Which account should be verified?" });

  // Shop staff can only verify accounts that belong to their own shop.
  if (!ctx.isSuperAdmin) {
    if (!userId) userId = (await findAuthUserByEmail(email))?.id || "";
    const target = userId
      ? (await db(`profiles?user_id=eq.${encodeURIComponent(userId)}&select=tenant_id&limit=1`, { token: ctx.token })).data?.[0]
      : null;
    if (!ctx.tenantId || target?.tenant_id !== ctx.tenantId) {
      return sendJson(res, 403, { error: "You can only verify staff in your own shop" });
    }
  }

  const confirmed = await confirmEmail({ token: ctx.token, userId, email });
  if (!confirmed.ok) return sendJson(res, 400, { error: confirmed.error });
  const result = confirmed.result || {};
  return sendJson(res, 200, {
    ok: true,
    alreadyVerified: Boolean(result.alreadyVerified),
    email: result.email || email,
    user_id: result.user_id || userId,
  });
}

// ------------------------------------------------------------------- list

async function listStaffAccounts(req, res) {
  const ctx = await callerContext(req);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });
  if (!ctx.isSuperAdmin && !ctx.isShopAdmin) return sendJson(res, 200, { users: [] });
  if (!SERVICE_KEY) return sendJson(res, 200, { users: [] });

  // A shop only ever sees its own people; the platform owner sees everyone.
  let allowed = null;
  if (!ctx.isSuperAdmin) {
    if (!ctx.tenantId) return sendJson(res, 200, { users: [] });
    const members = await db(`tenant_members?tenant_id=eq.${encodeURIComponent(ctx.tenantId)}&select=user_id`);
    allowed = new Set((members.data || []).map((row) => String(row.user_id)));
  }

  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: adminHeaders(),
    });
    if (!response.ok) break;
    const payload = await response.json().catch(() => ({}));
    const batch = payload?.users || [];
    users.push(...batch.filter((u) => !allowed || allowed.has(String(u.id))).map((u) => ({ id: u.id, email: u.email, phone: u.phone, email_confirmed_at: u.email_confirmed_at, last_sign_in_at: u.last_sign_in_at, created_at: u.created_at, banned_until: u.banned_until || null })));
    if (batch.length < 200) break;
  }
  return sendJson(res, 200, { users });
}

// --------------------------------------------------------- reset password

async function resetStaffPassword(req, res, body) {
  const ctx = await callerContext(req);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });
  if (!ctx.isSuperAdmin && !ctx.isShopAdmin) {
    return sendJson(res, 403, { error: "Only the shop owner can reset staff passwords" });
  }

  const token = ctx.token;
  const userId = str(body.user_id);
  if (!userId) return sendJson(res, 400, { error: "Which staff member should be reset?" });

  const target = (await db(`profiles?user_id=eq.${userId}&select=tenant_id,display_name&limit=1`, { token })).data?.[0];
  const memberHere = ctx.tenantId ? (await db(`tenant_members?tenant_id=eq.${ctx.tenantId}&user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`)).data?.[0] : null;
  if (!ctx.isSuperAdmin) {
    if (!ctx.tenantId || (target?.tenant_id !== ctx.tenantId && !memberHere)) {
      return sendJson(res, 403, { error: "You can only reset passwords for staff in your own shop" });
    }
  }

  const targetRoles = ((await db(`user_roles?user_id=eq.${userId}&select=role`, { token })).data || [])
    .map((r) => String(r.role));
  if (!ctx.isSuperAdmin) {
    // Owners can reset their staff; managers only staff below them. Nobody in
    // a shop can take over an owner or platform account this way.
    const protectedRoles = ctx.roles.includes("admin") ? ["admin", "super_admin"] : ["admin", "super_admin", "manager"];
    if (userId === ctx.user.id || targetRoles.some((role) => protectedRoles.includes(role))) {
      return sendJson(res, 403, { error: "That account cannot be changed here" });
    }
  }

  if (!SERVICE_KEY) {
    // Without the backend key we can still email a reset link to the staff member.
    const emailRow = (await db(`profiles?user_id=eq.${userId}&select=email&limit=1`, { token })).data?.[0];
    const targetEmail = str(body.email) || str(emailRow?.email);
    if (!targetEmail) {
      return sendJson(res, 400, { error: "We need this staff member's email to send them a reset link." });
    }
    const recover = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: targetEmail }),
    });
    if (!recover.ok) {
      return sendJson(res, 400, { error: "Could not send the reset link. Please try again." });
    }
    return sendJson(res, 200, {
      success: true,
      emailed: true,
      message: `A password reset link was emailed to ${targetEmail}.`,
    });
  }


  const newPassword = str(body.password) || randomPassword();
  if (newPassword.length < 6) {
    return sendJson(res, 400, { error: "The password must be at least 6 characters" });
  }

  const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ password: newPassword }),
  });
  const updated = await updateRes.json().catch(() => ({}));
  if (!updateRes.ok) {
    return sendJson(res, 400, {
      error: String(updated?.msg || updated?.message || "Could not change that password"),
    });
  }

  const email = updated?.email || "";
  const loginUrl = await loginUrlFor(target?.tenant_id);
  await db(`profiles?user_id=eq.${userId}`, { method: "PATCH", body: { must_change_password: true }, token });

  const emailed = email ? await emailTempPassword({ to: email, name: target?.display_name, password: newPassword, loginUrl, invited: false }) : false;

  return sendJson(res, 200, {
    success: true,
    emailed,
    message: emailed
      ? `A temporary password was emailed to ${email}. They choose their own when they sign in.`
      : `The email did not go out. New temporary password: ${newPassword} — share it with them in person.`,
    password: emailed ? undefined : newPassword,
  });
}

// ------------------------------------------------------------------ delete

/** Removes the account through the database, using the caller's own sign-in. */
async function deleteViaDatabase(userId, token) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_user_account`, {
    method: "POST",
    headers: userHeaders(token),
    body: JSON.stringify({ _user_id: userId }),
  });
  const payload = await response.json().catch(() => null);
  if (response.ok) return { ok: true };
  return {
    ok: false,
    error: String(payload?.message || payload?.error || "Could not remove that staff member"),
  };
}

async function deleteStaff(req, res, body) {
  const ctx = await callerContext(req);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });
  if (!ctx.isSuperAdmin && !ctx.roles.includes("admin")) {
    return sendJson(res, 403, { error: "Only the shop owner can remove staff" });
  }
  const userId = str(body.user_id);
  if (!userId) return sendJson(res, 400, { error: "Which staff member should be removed?" });
  if (userId === ctx.user.id) return sendJson(res, 400, { error: "You cannot remove your own account" });

  const target = (await db(`profiles?user_id=eq.${userId}&select=tenant_id&limit=1`, { token: ctx.token }))
    .data?.[0];
  const memberships = (await db(`tenant_members?user_id=eq.${encodeURIComponent(userId)}&select=id,tenant_id,role,company_role_id,location_ids,status`)).data || [];
  const mine = memberships.find((m) => m.tenant_id === ctx.tenantId);
  if (!ctx.isSuperAdmin && (!ctx.tenantId || (target?.tenant_id !== ctx.tenantId && !mine))) {
    return sendJson(res, 403, { error: "You can only remove staff in your own shop" });
  }
  // A person who also works in other companies keeps their sign-in: they only leave this company.
  const elsewhere = memberships.filter((m) => m.tenant_id !== ctx.tenantId && m.status === "active");
  if (mine && elsewhere.length && !ctx.isSuperAdmin) {
    if (mine.role === "admin" || mine.role === "super_admin") return sendJson(res, 403, { error: "The shop owner account cannot be removed here" });
    await db(`tenant_members?id=eq.${mine.id}`, { method: "DELETE" });
    if (target?.tenant_id === ctx.tenantId) {
      const next = elsewhere[0];
      await db(`profiles?user_id=eq.${encodeURIComponent(userId)}`, { method: "PATCH", body: { tenant_id: next.tenant_id, company_role_id: next.company_role_id || null, location_ids: next.location_ids || null, status: "active" } });
      await db(`user_roles?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE" });
      await db("user_roles", { method: "POST", body: { user_id: userId, role: next.role || "cashier" } });
    }
    return sendJson(res, 200, { success: true, message: "Removed from this company. They keep access to their other companies." });
  }
  if (!ctx.isSuperAdmin) {
    const targetRoles = ((await db(`user_roles?user_id=eq.${userId}&select=role`, { token: ctx.token })).data || [])
      .map((r) => String(r.role));
    if (targetRoles.some((role) => ["admin", "super_admin"].includes(role))) {
      return sendJson(res, 403, { error: "The shop owner account cannot be removed here" });
    }
  }

  // Without the backend key the admin endpoint answers "No API key found in
  // request", so go straight to the database instead of failing.
  if (!SERVICE_KEY) {
    const viaDb = await deleteViaDatabase(userId, ctx.token);
    if (viaDb.ok) return sendJson(res, 200, { success: true });
    return sendJson(res, 400, { error: viaDb.error });
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: adminHeaders(),
  });
  if (!response.ok) {
    const viaDb = await deleteViaDatabase(userId, ctx.token);
    if (viaDb.ok) return sendJson(res, 200, { success: true });
    const payload = await response.json().catch(() => ({}));
    return sendJson(res, 400, {
      error: String(payload?.msg || payload?.message || viaDb.error || "Could not remove that staff member"),
    });
  }
  return sendJson(res, 200, { success: true });
}

// --- Shops' own domains ------------------------------------------------------
// The owner adds a domain, points its A record at this server and presses
// Check. Once public DNS shows the domain on our IP (which proves they control
// it) it is approved; pos-custom-domains-sync on the VPS then routes it to the
// app with its own certificate within a minute.

const SERVER_IP = process.env.POS_PUBLIC_IP || "37.60.255.35";
const MAX_DOMAINS = 4;
const HOST_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const cleanHost = (v) => str(v).toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
const publicDns = new Resolver({ timeout: 4000, tries: 2 });
publicDns.setServers(["1.1.1.1", "8.8.8.8"]);
const lookup = (fn, host) => fn.call(publicDns, host).catch(() => []);

async function domainOwner(req, body) {
  const ctx = await callerContext(req);
  if (ctx.error) return ctx;
  if (!SERVICE_KEY) return { error: "Domains cannot be connected right now. Contact support.", status: 503 };
  const tenantId = ctx.isSuperAdmin ? str(body?.tenant_id) || ctx.tenantId : ctx.tenantId;
  if (!ctx.isSuperAdmin && !ctx.roles.includes("admin")) return { error: "Only the shop owner can connect a domain", status: 403 };
  if (!tenantId) return { error: "This account is not linked to a shop", status: 400 };
  return { ...ctx, tenantId };
}

async function dnsState(host) {
  const [a, aaaa] = await Promise.all([lookup(publicDns.resolve4, host), lookup(publicDns.resolve6, host)]);
  const pointed = a.length > 0 && a.every((ip) => ip === SERVER_IP);
  // A leftover IPv6 record sends certificate checks elsewhere, so it must go.
  return { a, aaaa, pointed, ok: pointed && aaaa.length === 0 };
}

// Domains behind Cloudflare's proxy show Cloudflare's IPs, so DNS can't prove
// they reach us. Instead we fetch a one-off path through the domain; only this
// server can answer it (HMAC with a server secret).
const VERIFY_PREFIX = "/.well-known/jmsurfgarage-verify/";
const verifyAnswer = (nonce) => createHmac("sha256", SERVICE_KEY || "jmsurf").update(`domain-verify:${nonce}`).digest("hex");

/** server.js answers GET /.well-known/jmsurfgarage-verify/<nonce> with this. */
export function domainVerifyResponse(pathname) {
  if (!pathname.startsWith(VERIFY_PREFIX)) return null;
  const nonce = pathname.slice(VERIFY_PREFIX.length);
  return /^[a-f0-9]{32}$/.test(nonce) ? verifyAnswer(nonce) : "";
}

async function reachesUs(host) {
  const nonce = randomBytes(16).toString("hex");
  for (const scheme of ["https", "http"]) {
    try {
      const r = await fetch(`${scheme}://${host}${VERIFY_PREFIX}${nonce}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok && (await r.text()).trim() === verifyAnswer(nonce)) return true;
    } catch { /* try the next scheme */ }
  }
  return false;
}

async function isLive(host) {
  try {
    const r = await fetch(`https://${host}/`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(6000) });
    return r.status > 0 && r.status < 500;
  } catch { return false; }
}

const domainRows = async (tenantId) =>
  (await db(`tenant_domains?tenant_id=eq.${tenantId}&kind=eq.custom&select=id,host,status,created_at,activated_at&order=created_at`)).data || [];

async function listDomains(req, res) {
  const ctx = await domainOwner(req, {});
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });
  return sendJson(res, 200, { server_ip: SERVER_IP, domains: await domainRows(ctx.tenantId) });
}

async function approveIfReady(row) {
  const dns = await dnsState(row.host);
  let status = row.status;
  if (!dns.ok && dns.a.length > 0 && (await reachesUs(row.host))) {
    dns.ok = true; dns.proxied = true;
  }
  if (dns.ok && status === "pending") {
    const now = new Date().toISOString();
    await db(`tenant_domains?id=eq.${row.id}`, { method: "PATCH", body: { status: "approved", approved_at: now, activated_at: now } });
    status = "approved";
  }
  const live = status === "approved" || status === "active" ? await isLive(row.host) : false;
  return { ...row, status, dns, live };
}

async function connectDomain(req, res, body) {
  const ctx = await domainOwner(req, body);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });
  const host = cleanHost(body.host);
  if (!HOST_RE.test(host) || host.length > 253) return sendJson(res, 400, { error: "Enter a domain like myshop.co.ke or order.myshop.co.ke" });
  // Only the platform's own addresses are refused. Any other domain (jmsurf.co.ke
  // included) is approved once its DNS points here, which only its owner can do.
  if (/(^|\.)garage\.jmsurf\.co\.ke$|\.sslip\.io$|\.nip\.io$/.test(host)) {
    return sendJson(res, 400, { error: "That is a JMSURF Garage address. Use your own domain, e.g. erp.yourcompany.co.ke" });
  }
  const existing = (await db(`tenant_domains?host=ilike.${encodeURIComponent(host)}&select=id,tenant_id,host,status&limit=1`)).data?.[0];
  if (existing && existing.tenant_id !== ctx.tenantId) {
    return sendJson(res, 409, { error: "That domain is already connected to another shop" });
  }
  let row = existing;
  if (!row) {
    const mine = await domainRows(ctx.tenantId);
    if (mine.length >= MAX_DOMAINS) return sendJson(res, 400, { error: `A shop can have up to ${MAX_DOMAINS} domains. Remove one first.` });
    const ins = await db("tenant_domains", {
      method: "POST", prefer: "return=representation",
      body: { tenant_id: ctx.tenantId, host, kind: "custom", status: "pending", requested_by: ctx.user.id, payment_status: "waived", dns_target: SERVER_IP },
    });
    if (!ins.ok) return sendJson(res, 400, { error: /duplicate|unique/i.test(ins.raw) ? "That domain is already connected" : "Could not save the domain" });
    row = ins.data[0];
  }
  return sendJson(res, 200, { server_ip: SERVER_IP, domain: await approveIfReady(row) });
}

async function checkDomain(req, res, body) {
  const ctx = await domainOwner(req, body);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });
  const row = (await db(`tenant_domains?id=eq.${encodeURIComponent(str(body.id))}&tenant_id=eq.${ctx.tenantId}&kind=eq.custom&select=id,host,status,created_at,activated_at&limit=1`)).data?.[0];
  if (!row) return sendJson(res, 404, { error: "Domain not found" });
  return sendJson(res, 200, { server_ip: SERVER_IP, domain: await approveIfReady(row) });
}

async function removeDomain(req, res, body) {
  const ctx = await domainOwner(req, body);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });
  const del = await db(`tenant_domains?id=eq.${encodeURIComponent(str(body.id))}&tenant_id=eq.${ctx.tenantId}&kind=eq.custom`, { method: "DELETE", prefer: "return=representation" });
  if (!del.ok || !(del.data || []).length) return sendJson(res, 404, { error: "Domain not found" });
  return sendJson(res, 200, { success: true });
}

export async function handleStaffRequest(req, res, pathname, body) {
  try {
    if (pathname === "/api/staff/create") return await createStaff(req, res, body);
    if (pathname === "/api/staff/list") return await listStaffAccounts(req, res);
    if (pathname === "/api/staff/update") return await updateStaff(req, res, body);
    if (pathname === "/api/staff/reset-password") return await resetStaffPassword(req, res, body);
    if (pathname === "/api/staff/delete") return await deleteStaff(req, res, body);
    if (pathname === "/api/staff/verify") return await verifyStaff(req, res, body);
    if (pathname === "/api/staff/domains") return await listDomains(req, res);
    if (pathname === "/api/staff/domain-connect") return await connectDomain(req, res, body);
    if (pathname === "/api/staff/domain-check") return await checkDomain(req, res, body);
    if (pathname === "/api/staff/domain-remove") return await removeDomain(req, res, body);
    return sendJson(res, 404, { error: "Unknown staff route" });
  } catch (error) {
    console.error("staff route failed:", error);
    return sendJson(res, 500, { error: error?.message || "Something went wrong" });
  }
}
