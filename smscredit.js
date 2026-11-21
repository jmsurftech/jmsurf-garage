// ---------------------------------------------------------------------------
// Built-in SMS credit (works like JMSURF ISP): a company with no SMS account of
// its own sends through JMSURF's SMS account and spends prepaid SMS
// (tenant_sms_settings.balance_units, one per SMS part). It tops up by M-Pesa:
// JMSURF PAY sends the prompt to the platform settlement account and a paid
// top-up adds floor(amount / price) SMS (garage_sms_credit). Price per SMS:
// platform_settings 'sms_pricing'.price_kes (default 0.80).
// ---------------------------------------------------------------------------
import { credential } from "./integrations-core.js";

const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const enc = encodeURIComponent;

async function db(path, { method = "GET", body, prefer = "return=representation" } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(15000),
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!res.ok) throw new Error(str(j?.message) || `Database replied ${res.status}`);
  return j;
}
const one = async (p) => (await db(p).catch(() => null))?.[0] || null;
const rpc = (fn, body) => db(`rpc/${fn}`, { method: "POST", body });

/** JMSURF's own SMS account (the built-in route), or "" when it is not saved. */
export const builtinSmsKey = () => credential("JMSURF_SMS_API_KEY") || "";
export const builtinSmsSender = () => credential("JMSURF_SMS_SENDER") || undefined;

let priceCache = { at: 0, value: null };
/** { price_kes, min_topup_kes } from Admin settings, cached for a minute. */
export async function smsPricing() {
  if (priceCache.value && Date.now() - priceCache.at < 60_000) return priceCache.value;
  const row = await one("platform_settings?key=eq.sms_pricing&select=value&limit=1");
  const price = Number(row?.value?.price_kes);
  const min = Number(row?.value?.min_topup_kes);
  const value = { price_kes: price > 0 ? price : 0.8, min_topup_kes: min >= 10 ? min : 50 };
  priceCache = { at: Date.now(), value };
  return value;
}

/** Balance in the same shape as the JMSURF SMS API, so the wallet card shows either. */
export async function creditBalance(tenantId) {
  const [s, p] = await Promise.all([one(`tenant_sms_settings?tenant_id=eq.${enc(tenantId)}&select=balance_units&limit=1`), smsPricing()]);
  const units = Math.max(0, Number(s?.balance_units) || 0);
  return { ok: true, builtin: true, billing: "prepaid", sms_remaining: units, balance_kes: Math.round(units * p.price_kes * 100) / 100, rate_kes_per_sms: p.price_kes, min_topup_kes: p.min_topup_kes };
}

/** Takes SMS from the balance; false when there are not enough. */
export async function spendCredit(tenantId, units) {
  return (await rpc("consume_sms_units", { p_tenant: tenantId, p_units: units }).catch(() => false)) === true;
}
export async function refundCredit(tenantId, units) {
  await rpc("refund_sms_units", { p_tenant: tenantId, p_units: units }).catch(() => undefined);
}

const phone254 = (p) => { const d = str(p).replace(/\D/g, ""); return d.startsWith("0") ? `254${d.slice(1)}` : d.startsWith("254") ? d : /^[17]\d{8}$/.test(d) ? `254${d}` : d; };

/** Sends the M-Pesa prompt for an SMS top-up. */
export async function startTopup({ tenantId, userId, amount, phone }) {
  const p = await smsPricing();
  amount = Math.round(Number(amount) || 0);
  if (amount < p.min_topup_kes || amount > 100000) return { ok: false, error: `Top up between KES ${p.min_topup_kes} and KES 100,000` };
  const msisdn = phone254(phone);
  if (!/^254[17]\d{8}$/.test(msisdn)) return { ok: false, error: "Enter the M-Pesa number to pay from (07… or 01…)" };
  const units = Math.floor(amount / p.price_kes);
  const billing = await one("platform_settings?key=eq.subscription_billing&select=value&limit=1");
  const code = str(billing?.value?.jmsurf?.tenant_code);
  if (!code) return { ok: false, error: "SMS top-up is not set up yet. Contact JMSURF support." };
  const tenant = await one(`tenants?id=eq.${enc(tenantId)}&select=slug`);
  const [row] = await db("garage_sms_payments", { method: "POST", body: { tenant_id: tenantId, amount, price_kes: p.price_kes, units, phone: msisdn, status: "pending", created_by: userId || null } });
  const { sendMoneyApi } = await import("./sendmoney.js");
  const r = await sendMoneyApi("/api/payments/stkpush", { method: "POST", body: { phoneNumber: msisdn, amount, accountReference: `SMS-${str(tenant?.slug).slice(0, 8)}`, transactionDesc: "Garage SMS top-up", tenantCode: code } }).catch((e) => ({ error: e.message }));
  const ref = str(r?.checkoutRequestId);
  if (!ref) {
    const why = str(r?.error || r?.message) || "M-Pesa did not accept the request. Try again.";
    await db(`garage_sms_payments?id=eq.${row.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed", detail: why.slice(0, 200) } }).catch(() => undefined);
    return { ok: false, error: why };
  }
  await db(`garage_sms_payments?id=eq.${row.id}`, { method: "PATCH", prefer: "return=minimal", body: { reference: ref } });
  // Same history list the SMS page already shows.
  await db("sms_topups", { method: "POST", prefer: "return=minimal", body: { tenant_id: tenantId, topup_id: row.id, amount_kes: amount, phone: `+${msisdn}`, status: "pending", sms_estimate: units, created_by: userId || null } }).catch(() => undefined);
  return { ok: true, id: row.id, status: "pending", sms_estimate: units };
}

async function checkPayment(p) {
  if (p.status !== "pending" || !p.reference) return p.status;
  const { sendMoneyApi } = await import("./sendmoney.js");
  const r = await sendMoneyApi(`/api/payments/status/${enc(p.reference)}`).catch(() => null);
  const s = str(r?.status).toLowerCase();
  const receipt = str(r?.mpesaReceiptNumber || r?.mpesaReceipt || r?.receipt);
  if (s === "completed" && receipt) { await rpc("garage_sms_credit", { p_payment: p.id, p_receipt: receipt }); return "completed"; }
  if (["failed", "cancelled", "canceled"].includes(s)) {
    const status = String(r?.resultCode) === "1032" || /cancel/i.test(str(r?.resultDesc)) ? "cancelled" : "failed";
    await db(`garage_sms_payments?id=eq.${p.id}&status=eq.pending`, { method: "PATCH", prefer: "return=minimal", body: { status, detail: str(r?.resultDesc).slice(0, 200) } });
    await db(`sms_topups?topup_id=eq.${p.id}`, { method: "PATCH", prefer: "return=minimal", body: { status, updated_at: new Date().toISOString() } }).catch(() => undefined);
    return status;
  }
  return "pending";
}

/** A top-up's state for the wallet dialog (checks M-Pesa and credits it when paid). */
export async function topupStatus(tenantId, id) {
  const p = await one(`garage_sms_payments?id=eq.${enc(str(id))}&tenant_id=eq.${enc(tenantId)}&select=*`);
  if (!p) return { ok: false, error: "Top-up not found" };
  const status = await checkPayment(p);
  const b = await creditBalance(tenantId);
  return { ok: true, status, sms_remaining: b.sms_remaining };
}

/** Checks open top-ups every minute, so a payment is credited even if the dialog was closed. */
export function startSmsCredit() {
  if (!URL_ || !KEY) return;
  let busy = false;
  setInterval(async () => {
    if (busy) return; busy = true;
    try {
      const since = new Date(Date.now() - 30 * 60_000).toISOString();
      const open = await db(`garage_sms_payments?status=eq.pending&reference=not.is.null&created_at=gte.${enc(since)}&select=*`).catch(() => []);
      for (const p of open || []) await checkPayment(p).catch(() => undefined);
      await db(`garage_sms_payments?status=eq.pending&created_at=lt.${enc(since)}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed", detail: "No answer from M-Pesa" } }).catch(() => undefined);
    } finally { busy = false; }
  }, 60_000).unref();
}
