// ---------------------------------------------------------------------------
// JMSURF CALL CENTRE billing (its own plans, not the JMSURF Garage bill), paid by
// M-Pesa through JMSURF Pay (the platform's settlement account). Called by the
// call centre app (app. and admin.jmsurfcallcentre.co.ke) with the person's session.
//
// POST /api/cc-billing/summary            plans, subscription, payments, agents
// POST /api/cc-billing/pay   {plan_id, months, agents, phone}   M-Pesa prompt
// POST /api/cc-billing/topup {amount, phone}   M-Pesa prompt that adds credit to the call/SMS wallet
// POST /api/cc-billing/status {id}        checks a payment (and applies it)
// POST /api/cc-billing/admin              platform owner: every subscription and payment, JMSURF Pay account
// A paid subscription switches the Call Centre on in the company's DASH (cc_apply_payment).
//
// JMSURF Garage: the Call Centre keeps its companies, logins and billing in DASH's database
// and calls DASH's server for billing, never this one. Garage links to it through
// garage-integrations.js (callcentre/*), so these routes and the job stay OFF here unless
// CC_BILLING_ENABLED=1 (kept only so a future Garage-hosted Call Centre can switch them on).
// ---------------------------------------------------------------------------
const ENABLED = process.env.CC_BILLING_ENABLED === "1";
import { sendMoneyApi } from "./sendmoney.js";
import { isDemoTenant } from "./demo.js";

const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
/** Only the call centre's own addresses may call these from a browser. */
const CC_ORIGINS = new Set(["https://app.jmsurfcallcentre.co.ke", "https://admin.jmsurfcallcentre.co.ke"]);
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

async function db(path, { method = "GET", body, prefer = "return=representation" } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: prefer }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const t = await res.text();
  const j = t ? JSON.parse(t) : null;
  if (!res.ok) throw new Error(str(j?.message) || `Database replied ${res.status}`);
  return j;
}
const one = async (p) => (await db(p))?.[0] || null;
const rpc = (fn, body) => db(`rpc/${fn}`, { method: "POST", body });

async function caller(req) {
  const auth = str(req.headers.authorization);
  if (!auth.startsWith("Bearer ")) throw new HttpError(401, "Sign in first");
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) throw new HttpError(401, "Sign in first");
  const user = await r.json();
  const prof = await one(`profiles?user_id=eq.${user.id}&select=tenant_id,display_name`);
  if (!prof?.tenant_id) throw new HttpError(403, "No company");
  const roles = (await db(`user_roles?user_id=eq.${user.id}&select=role`)).map((x) => String(x.role));
  const owner = !!(await one(`platform_admins?user_id=eq.${user.id}&select=user_id`));
  return { user, tenantId: prof.tenant_id, manager: roles.some((x) => ["admin", "manager"].includes(x)) || owner, owner };
}

async function jmsurfPay() {
  const row = await one("platform_settings?key=eq.subscription_billing&select=value");
  return row?.value?.jmsurf || null;
}
const phone254 = (p) => { const d = str(p).replace(/\D/g, ""); return d.startsWith("0") ? `254${d.slice(1)}` : d.startsWith("254") ? d : /^[17]\d{8}$/.test(d) ? `254${d}` : d; };
const priceOf = (plan, agents, months) => (Number(plan.price_monthly) + Math.max(0, agents - plan.agents_included) * Number(plan.extra_agent_price)) * months;

async function checkPayment(p) {
  if (p.status !== "pending" || !p.reference) return p.status;
  const r = await sendMoneyApi(`/api/payments/status/${encodeURIComponent(p.reference)}`).catch(() => null);
  const s = str(r?.status).toLowerCase();
  const receipt = str(r?.mpesaReceiptNumber || r?.mpesaReceipt || r?.receipt);
  if (s === "completed" && receipt) { await rpc("cc_apply_payment", { p_payment: p.id, p_receipt: receipt }); return "completed"; }
  if (["failed", "cancelled", "canceled"].includes(s)) {
    const status = String(r?.resultCode) === "1032" || /cancel/i.test(str(r?.resultDesc)) ? "cancelled" : "failed";
    await db(`cc_payments?id=eq.${p.id}&status=eq.pending`, { method: "PATCH", prefer: "return=minimal", body: { status, detail: str(r?.resultDesc).slice(0, 200) } });
    return status;
  }
  return "pending";
}

const ROUTES = {
  "/api/cc-billing/summary": async (who) => {
    const sub = await rpc("cc_subscription_for", { p_tenant: who.tenantId });
    const [plans, payments, agents, pay] = await Promise.all([
      db("cc_plans?is_active=eq.true&select=*&order=sort"),
      db(`cc_payments?tenant_id=eq.${who.tenantId}&select=*&order=created_at.desc&limit=24`),
      db(`cc_agents?tenant_id=eq.${who.tenantId}&select=id`),
      jmsurfPay(),
    ]);
    return { subscription: sub, plans, payments, agents: agents.length, can_pay: !!pay?.tenant_code };
  },
  "/api/cc-billing/pay": async (who, b) => {
    if (!who.manager) throw new HttpError(403, "Only owners and managers can pay");
    const plan = await one(`cc_plans?id=eq.${encodeURIComponent(str(b.plan_id))}&is_active=eq.true&select=*`);
    if (!plan) throw new HttpError(400, "Choose a plan");
    const months = [1, 3, 6, 12].includes(Number(b.months)) ? Number(b.months) : 1;
    const agentRows = await db(`cc_agents?tenant_id=eq.${who.tenantId}&select=id`);
    const agents = Math.max(plan.agents_included, Number(b.agents) || 0, agentRows.length);
    const phone = phone254(b.phone);
    if (!/^254[17]\d{8}$/.test(phone)) throw new HttpError(400, "Enter the M-Pesa number (07… or 01…)");
    let amount = priceOf(plan, agents, months);
    if (months === 12) amount = Math.round(amount * 0.9); // two months off a year (≈10%)
    if (await isDemoTenant(who.tenantId)) throw new HttpError(403, "Payments are switched off in the demo. Create your own free company to take real payments.");
    const pay = await jmsurfPay();
    if (!pay?.tenant_code) throw new HttpError(400, "Payments are not set up yet. Contact JMSURF support.");
    const tenant = await one(`tenants?id=eq.${who.tenantId}&select=slug`);
    const [row] = await db("cc_payments", { method: "POST", body: { tenant_id: who.tenantId, plan_id: plan.id, months, agents, amount, phone, gateway: "jmsurf", status: "pending", created_by: who.user.id } });
    const r = await sendMoneyApi("/api/payments/stkpush", { method: "POST", body: { phoneNumber: phone, amount: Math.round(amount), accountReference: `CC-${str(tenant?.slug).slice(0, 9)}`, transactionDesc: `Call centre ${plan.name}`, tenantCode: pay.tenant_code } }).catch((e) => ({ error: e.message }));
    const ref = str(r?.checkoutRequestId);
    if (!ref) {
      await db(`cc_payments?id=eq.${row.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed", detail: str(r?.error || r?.message || "M-Pesa did not accept the request").slice(0, 200) } });
      throw new HttpError(502, str(r?.error || r?.message) || "M-Pesa did not accept the payment request. Try again.");
    }
    await db(`cc_payments?id=eq.${row.id}`, { method: "PATCH", prefer: "return=minimal", body: { reference: ref } });
    return { ok: true, id: row.id, amount, months, agents };
  },
  "/api/cc-billing/topup": async (who, b) => {
    if (!who.manager) throw new HttpError(403, "Only owners and managers can top up");
    const amount = Math.round(Number(b.amount) || 0);
    if (amount < 100 || amount > 150000) throw new HttpError(400, "Top up between KES 100 and KES 150,000");
    const phone = phone254(b.phone);
    if (!/^254[17]\d{8}$/.test(phone)) throw new HttpError(400, "Enter the M-Pesa number (07… or 01…)");
    if (await isDemoTenant(who.tenantId)) throw new HttpError(403, "Payments are switched off in the demo. Create your own free company to take real payments.");
    const pay = await jmsurfPay();
    if (!pay?.tenant_code) throw new HttpError(400, "Payments are not set up yet. Contact JMSURF support.");
    const tenant = await one(`tenants?id=eq.${who.tenantId}&select=slug`);
    const [row] = await db("cc_payments", { method: "POST", body: { tenant_id: who.tenantId, purpose: "topup", months: 1, agents: 1, amount, phone, gateway: "jmsurf", status: "pending", created_by: who.user.id } });
    const r = await sendMoneyApi("/api/payments/stkpush", { method: "POST", body: { phoneNumber: phone, amount, accountReference: `CCT-${str(tenant?.slug).slice(0, 8)}`, transactionDesc: "Call centre top-up", tenantCode: pay.tenant_code } }).catch((e) => ({ error: e.message }));
    const ref = str(r?.checkoutRequestId);
    if (!ref) {
      await db(`cc_payments?id=eq.${row.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed", detail: str(r?.error || r?.message || "M-Pesa did not accept the request").slice(0, 200) } });
      throw new HttpError(502, str(r?.error || r?.message) || "M-Pesa did not accept the payment request. Try again.");
    }
    await db(`cc_payments?id=eq.${row.id}`, { method: "PATCH", prefer: "return=minimal", body: { reference: ref } });
    return { ok: true, id: row.id, amount };
  },
  "/api/cc-billing/status": async (who, b) => {
    const p = await one(`cc_payments?id=eq.${encodeURIComponent(str(b.id))}&tenant_id=eq.${who.tenantId}&select=*`);
    if (!p) throw new HttpError(404, "Payment not found");
    return { status: await checkPayment(p) };
  },
  "/api/cc-billing/admin": async (who) => {
    if (!who.owner) throw new HttpError(403, "Only JMSURF platform owners can open this");
    const [subs, payments, plans, pay, tenants] = await Promise.all([
      db("cc_subscriptions?select=*&order=updated_at.desc&limit=2000"),
      db("cc_payments?select=*&order=created_at.desc&limit=300"),
      db("cc_plans?select=*&order=sort"),
      jmsurfPay(),
      db("tenants?select=id,business_name,slug&limit=5000"),
    ]);
    const name = new Map(tenants.map((t) => [t.id, t.business_name]));
    const paid = payments.filter((p) => p.status === "completed");
    const month = new Date().toISOString().slice(0, 7);
    return {
      subscriptions: subs.map((s) => ({ ...s, company: name.get(s.tenant_id) || "Company" })),
      payments: payments.map((p) => ({ ...p, company: name.get(p.tenant_id) || "Company" })),
      plans,
      jmsurf_pay: pay ? { linked: !!pay.tenant_code, destination_type: pay.destination_type, business_number: pay.business_number, account_number: pay.account_number, account_name: pay.account_name } : { linked: false },
      totals: {
        mrr: subs.filter((s) => s.status === "active").reduce((a, s) => a + Number(plans.find((p) => p.id === s.plan_id)?.price_monthly || 0), 0),
        collected_month: paid.filter((p) => String(p.paid_at || "").startsWith(month)).reduce((a, p) => a + Number(p.amount), 0),
        collected_all: paid.reduce((a, p) => a + Number(p.amount), 0),
        active: subs.filter((s) => s.status === "active").length, trial: subs.filter((s) => s.status === "trial").length, past_due: subs.filter((s) => s.status === "past_due").length,
      },
    };
  },
};

export const isCcBillingRoute = (p) => p.startsWith("/api/cc-billing/");

/** Cross-site: the call centre app calls these with the person's session. */
export async function handleCcBilling(req, res, pathname, readJsonBody) {
  const origin = String(req.headers.origin || "");
  const cors = { "Access-Control-Allow-Origin": CC_ORIGINS.has(origin) ? origin : "https://app.jmsurfcallcentre.co.ke", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors }); res.end(JSON.stringify(body)); };
  if (!ENABLED) return send(404, { error: "Call Centre billing is handled by JMSURF DASH" });
  try {
    const fn = ROUTES[pathname];
    if (!fn || req.method !== "POST") throw new HttpError(404, "Unknown route");
    const body = await readJsonBody(req).catch(() => ({}));
    const who = await caller(req);
    return send(200, await fn(who, body || {}));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("[cc-billing]", pathname, e);
    return send(status, { error: status === 500 ? "Something went wrong" : e.message });
  }
}

/** Checks pending payments every minute and lapses ended subscriptions daily. */
export function startCcBilling() {
  if (!ENABLED || !URL_ || !KEY) return;
  let busy = false; let lastExpire = 0;
  setInterval(async () => {
    if (busy) return; busy = true;
    try {
      const since = new Date(Date.now() - 30 * 60_000).toISOString();
      for (const p of await db(`cc_payments?status=eq.pending&gateway=eq.jmsurf&reference=not.is.null&created_at=gte.${encodeURIComponent(since)}&select=*`).catch(() => [])) await checkPayment(p).catch(() => {});
      await db(`cc_payments?status=eq.pending&gateway=eq.jmsurf&created_at=lt.${encodeURIComponent(since)}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed", detail: "No answer from M-Pesa" } }).catch(() => {});
      if (Date.now() - lastExpire > 6 * 3600e3) { lastExpire = Date.now(); await rpc("cc_expire_subscriptions", {}).catch(() => {}); }
    } finally { busy = false; }
  }, 60_000).unref();
}
