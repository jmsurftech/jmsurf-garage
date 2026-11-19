import { withPlatformRole } from "./platform.js";
import { isDemoTenant } from "./demo.js";
import { credential } from "./integrations-core.js";
// JMSURF PAY (formerly SendMoney). JMSURFPAY_BASE_URL overrides it for staging.
// The company only enters its Till / Paybill / bank account; this server provisions the
// settlement channel with the JMSURF TECHNOLOGIES key (externalId = the company id,
// source jmsurf-garage). A company whose gateway is its own Daraja app is handed to
// gateways.js (pushInvoiceDaraja), so every invoice prompt caller works for both.
const BASE = (process.env.JMSURFPAY_BASE_URL || 'https://jmsurfpay.co.ke').replace(/\/+$/, '');
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const SERVICE_KEY = process.env.JMSURF_SUPABASE_SERVICE_KEY || '';
/** JMSURF TECHNOLOGIES key: server env, else the one saved in Super admin → Settings → Integrations. */
const apiKey = () => credential('JMSURFPAY_API_KEY');
/** How this platform names itself to JMSURF PAY (never another product's name). */
export const SOURCE = 'jmsurf-garage';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const str = (value) => String(value ?? '').trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requireConfiguration() {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY || !apiKey()) {
    throw new Error('JMSURF gateway is not configured on the server. Contact support.');
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  // Starting an STK prompt can take M-Pesa 15–20 s at busy times; giving up
  // earlier left sales stuck at "initiating" with an unknown outcome.
  const timeout = setTimeout(() => controller.abort(), method === 'POST' ? 25000 : 12000);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      signal: controller.signal,
      redirect: 'error',
      headers: {
        'X-API-Key': apiKey(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'JMSURF-GARAGE/1.0 (+https://garage.jmsurf.co.ke)',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(str(payload?.error || payload?.message) || `JMSURF PAY returned HTTP ${response.status}`);
    if (!payload || typeof payload !== 'object') throw new Error('JMSURF PAY returned an invalid response');
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

/** JMSURF PAY API for the platform's own collections (subscription fees). */
export async function sendMoneyApi(path, options = {}) {
  if (!apiKey()) throw new Error('JMSURF gateway is not configured on the server. Contact support.');
  return api(path, options);
}

async function db(path, { method = 'GET', body, prefer } = {}) {
  const options = {
    method,
    signal: AbortSignal.timeout(8000),
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, options);
  } catch (error) {
    if (method !== 'GET') throw error;
    await sleep(100);
    response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, signal: AbortSignal.timeout(8000) });
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Database request failed (${response.status}): ${str(payload?.message || payload?.code)}`);
  return payload;
}

async function one(table, condition, select = '*') {
  const rows = await db(`${table}?${condition}&select=${encodeURIComponent(select)}&limit=1`);
  return rows?.[0] || null;
}

async function caller(req) {
  const authorization = str(req.headers.authorization);
  if (!authorization.startsWith('Bearer ')) return null;
  const url = `${SUPABASE_URL}/auth/v1/user`;
  const headers = { Authorization: authorization, apikey: ANON_KEY };
  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  } catch {
    await sleep(100);
    response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  }
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  if (!uuid.test(user?.id || '')) return null;
  const [profile, roles] = await Promise.all([
    one('profiles', `user_id=eq.${user.id}`, 'tenant_id'),
    db(`user_roles?user_id=eq.${user.id}&select=role`),
  ]);
  return { user, profile, roles: new Set(await withPlatformRole((roles || []).map((row) => row.role), user.id, req)) };
}

async function forTenant(req, tenantId, { manage = false } = {}) {
  if (!uuid.test(str(tenantId))) throw new Error('Invalid shop identifier');
  const ctx = await caller(req);
  if (!ctx) return { error: 'Sign in first', status: 401 };
  if (ctx.profile?.tenant_id !== tenantId && !ctx.roles.has('super_admin')) {
    return { error: 'This shop does not belong to your account', status: 403 };
  }
  if (manage && !ctx.roles.has('admin') && !ctx.roles.has('super_admin')) {
    return { error: 'Only a shop administrator can change payment gateways', status: 403 };
  }
  return { ctx };
}

function destination(body) {
  const type = str(body.destination_type);
  const businessNumber = str(body.business_number);
  const accountNumber = str(body.account_number);
  const accountName = str(body.account_name);
  if (!['till', 'paybill', 'bank'].includes(type)) throw new Error('Choose Till, Paybill or Bank');
  if (type === 'till' && !/^\d{5,7}$/.test(accountNumber)) throw new Error('Enter a valid 5–7 digit Till');
  if (type !== 'till' && !/^\d{5,7}$/.test(businessNumber)) throw new Error('Enter a valid 5–7 digit Paybill');
  if (type !== 'till' && !/^[A-Za-z0-9_-]{1,32}$/.test(accountNumber)) throw new Error('Enter a valid Paybill or bank account number');
  if (accountName.length < 2 || accountName.length > 100) throw new Error('Enter the settlement account name');
  return { type, businessNumber: type === 'till' ? null : businessNumber, accountNumber, accountName };
}

async function register(req, body) {
  const tenantId = str(body.tenant_id);
  const auth = await forTenant(req, tenantId, { manage: true });
  if (auth.error) return auth;
  const target = destination(body);
  const tenant = await one('tenants', `id=eq.${tenantId}`, 'id,business_name,slug,is_active,deleted_at');
  if (!tenant) return { error: 'Shop not found', status: 404 };
  if (!tenant.is_active || tenant.deleted_at) return { error: 'Archived shops cannot activate a payment gateway', status: 409 };
  const existing = await one('sendmoney_tenants', `tenant_id=eq.${tenantId}`);
  if (existing) {
    const same = existing.destination_type === target.type &&
      existing.business_number === target.businessNumber &&
      existing.account_number === target.accountNumber &&
      existing.account_name === target.accountName;
    if (same) {
      const remote = await api(`/api/saas/tenant/${encodeURIComponent(existing.tenant_code)}`);
      if (remote.isActive === false) return { error: 'The JMSURF settlement account is inactive. Contact support.', status: 409 };
      return { success: true, configured: true, destination_type: existing.destination_type, account_number: existing.account_number, business_number: existing.business_number };
    }
  }
  const reserved = await one('sendmoney_provisioning', `tenant_id=eq.${tenantId}`);
  if (reserved) return { error: 'This account is being linked or needs support reconciliation. No second account was created.', status: 409 };
  try {
    await db('sendmoney_provisioning', {
      method: 'POST',
      body: {
        tenant_id: tenantId,
        destination_type: target.type,
        business_number: target.businessNumber,
        account_number: target.accountNumber,
        account_name: target.accountName,
      },
    });
  } catch (error) {
    return { error: 'This account is already being linked. Wait or contact support before retrying.', status: 409 };
  }
  const payload = {
    name: str(tenant.business_name || tenant.slug).slice(0, 100),
    description: `JMSURF Garage company ${tenantId}`,
    source: SOURCE,
    externalId: tenantId,
    accountType: target.type === 'till' ? 'till' : 'paybill',
    accountNumber: target.accountNumber,
    accountName: target.accountName,
    ...(target.businessNumber ? { businessNumber: target.businessNumber } : {}),
  };
  const provisioned = await api('/api/saas/provision-tenant', { method: 'POST', body: payload });
  if (!/^tnnt_[A-Za-z0-9_-]+$/.test(str(provisioned.tenantCode)) || !provisioned.settlementAccountId) {
    throw new Error('JMSURF PAY did not confirm the settlement account. Contact support before retrying.');
  }
  await db(existing ? `sendmoney_tenants?tenant_id=eq.${tenantId}` : 'sendmoney_tenants', {
    method: existing ? 'PATCH' : 'POST',
    body: {
      tenant_id: tenantId,
      tenant_code: provisioned.tenantCode,
      provider_tenant_id: String(provisioned.tenantId),
      settlement_account_id: String(provisioned.settlementAccountId),
      destination_type: target.type,
      business_number: target.businessNumber,
      account_number: target.accountNumber,
      account_name: target.accountName,
    },
  });
  await db(`sendmoney_provisioning?tenant_id=eq.${tenantId}`, { method: 'DELETE' });
  return { success: true, configured: true, changed: Boolean(existing), destination_type: target.type, account_number: target.accountNumber, business_number: target.businessNumber };
}

async function settings(req, body) {
  const tenantId = str(body.tenant_id);
  const auth = await forTenant(req, tenantId);
  if (auth.error) return auth;
  const saved = await one('sendmoney_tenants', `tenant_id=eq.${tenantId}`, 'destination_type,business_number,account_number,account_name');
  return { configured: Boolean(saved), ...(saved || {}) };
}

async function push(req, body) {
  const tenantId = str(body.tenant_id);
  const auth = await forTenant(req, tenantId);
  if (auth.error) return auth;
  return pushSale(tenantId, str(body.pos_transaction_id), body.phone);
}

/**
 * Online shop checkout: the server itself asks JMSURF PAY to prompt the
 * customer for a pending web sale (no staff session). Same checks as the till.
 */
export async function pushSaleForShop(tenantId, transactionId, phone) {
  requireConfiguration();
  return pushSale(str(tenantId), str(transactionId), phone);
}

async function pushSale(tenantId, transactionId, rawPhone) {
  const body = { phone: rawPhone };
  if (!uuid.test(transactionId)) throw new Error('Invalid sale identifier');
  const phone = str(body.phone).replace(/[^\d]/g, '');
  const normalized = phone.startsWith('0') ? `254${phone.slice(1)}` : phone;
  if (!/^254[17]\d{8}$/.test(normalized)) return { error: 'Enter a valid Kenyan M-Pesa number', status: 400 };
  const [tenant, active, sale, old] = await Promise.all([
    one('sendmoney_tenants', `tenant_id=eq.${tenantId}`),
    one('business_settings', `tenant_id=eq.${tenantId}`, 'payment_provider'),
    one('transactions', `id=eq.${transactionId}`, 'id,tenant_id,total,status,payment_method'),
    one('sendmoney_payments', `pos_transaction_id=eq.${transactionId}`),
  ]);
  if (!tenant) return { error: 'Save a JMSURF Till, Paybill or bank account first', status: 409 };
  if (active?.payment_provider !== 'jmsurf') return { error: 'JMSURF is not the active payment gateway', status: 409 };
  if (!sale || sale.tenant_id !== tenantId || sale.payment_method !== 'mpesa' || sale.status !== 'pending') {
    return { error: 'This pending sale is not eligible for an M-Pesa prompt', status: 409 };
  }
  const amount = Number(sale.total);
  if (!Number.isInteger(amount) || amount < 1 || amount > 150000) {
    await db(`transactions?id=eq.${transactionId}`, {
      method: 'PATCH',
      body: { status: 'failed', mpesa_error_message: 'JMSURF requires a whole-shilling amount between KSh 1 and 150,000' },
    });
    return { error: 'JMSURF requires a whole-shilling amount between KSh 1 and 150,000', status: 422 };
  }
  if (old) {
    if (old.checkout_request_id) return { success: true, checkout_request_id: old.checkout_request_id, resumed: true };
    return { error: 'This sale already has an M-Pesa request in progress. Check its status before retrying.', status: 409 };
  }
  await db('sendmoney_payments', { method: 'POST', body: { tenant_id: tenantId, pos_transaction_id: transactionId, phone: normalized, amount } });
  try {
    const result = await api('/api/payments/stkpush', {
      method: 'POST',
      body: {
        phoneNumber: normalized,
        amount,
        accountReference: transactionId.slice(0, 12),
        transactionDesc: `POS sale ${transactionId.slice(0, 8)}`,
        tenantCode: tenant.tenant_code,
      },
    });
    const checkout = str(result.checkoutRequestId);
    if (!checkout || checkout.length > 160) throw new Error('JMSURF PAY did not return a checkout reference');
    await Promise.all([
      db(`sendmoney_payments?pos_transaction_id=eq.${transactionId}`, {
        method: 'PATCH', body: { checkout_request_id: checkout, status: 'pending', checked_at: new Date().toISOString() },
      }),
      db(`transactions?id=eq.${transactionId}`, {
        method: 'PATCH', body: { mpesa_ref: `jmsurf:${checkout}` },
      }),
    ]);
    return { success: true, checkout_request_id: checkout };
  } catch (error) {
    // An interrupted provider request may have reached M-Pesa. Never issue a
    // second STK automatically; support can reconcile its unique sale reference.
    await db(`sendmoney_payments?pos_transaction_id=eq.${transactionId}`, {
      method: 'PATCH', body: { provider_status: { error: str(error.message).slice(0, 300) }, checked_at: new Date().toISOString() },
    });
    throw error;
  }
}

async function reconcile(payment) {
  if (!payment.checkout_request_id) return { resolved_status: 'pending' };
  if (payment.status === 'completed') return { resolved_status: 'completed', mpesa_receipt: payment.mpesa_receipt };
  const result = await api(`/api/payments/status/${encodeURIComponent(payment.checkout_request_id)}`);
  const rawStatus = str(result.status).toLowerCase();
  const cancelText = str(result.resultDesc || result.message || result.error).toLowerCase();
  const providerStatus = rawStatus === 'canceled' ||
    (rawStatus === 'failed' && (String(result.resultCode || result.ResultCode) === '1032' || cancelText.includes('cancel')))
    ? 'cancelled' : rawStatus;
  if (!['pending', 'completed', 'failed', 'cancelled'].includes(providerStatus)) throw new Error('JMSURF PAY returned an unknown payment status');
  let receipt = str(result.mpesaReceiptNumber || result.mpesaReceipt || result.receipt);
  if (providerStatus === 'completed' && !receipt) {
    // JMSURF PAY sometimes confirms a payment without passing on the M-Pesa
    // receipt. Give it a moment, then complete the sale on JMSURF PAY's own
    // reference so a paid customer is never shown as failed.
    const since = Date.parse(result.updatedAt || result.createdAt || '') || 0;
    if (Date.now() - since < 15000) return { resolved_status: 'pending' };
    receipt = `SM-${payment.checkout_request_id}`.slice(0, 60);
  }
  await db('rpc/settle_sendmoney_payment', {
    method: 'POST',
    body: {
      p_pos_transaction_id: payment.pos_transaction_id,
      p_status: providerStatus,
      p_receipt: receipt || null,
      p_provider_status: result,
    },
  });
  return { resolved_status: providerStatus, mpesa_receipt: receipt || null };
}

async function status(req, body) {
  const tenantId = str(body.tenant_id);
  const auth = await forTenant(req, tenantId);
  if (auth.error) return auth;
  const transactionId = str(body.pos_transaction_id);
  if (!uuid.test(transactionId)) throw new Error('Invalid sale identifier');
  const payment = await one('sendmoney_payments', `pos_transaction_id=eq.${transactionId}&tenant_id=eq.${tenantId}`);
  if (!payment) return { error: 'JMSURF payment not found', status: 404 };
  return await reconcile(payment);
}

/**
 * Starts a JMSURF prompt for a sale. Used when a till asks the generic
 * M-Pesa route but the shop's gateway is JMSURF (older or cached tills).
 */
export async function startSendMoneyPrompt(req, body) {
  requireConfiguration();
  return push(req, body);
}

export async function handleSendMoneyRequest(req, res, pathname, body, sendJson) {
  try {
    requireConfiguration();
    const action = pathname.split('/').pop();
    const result = action === 'register' ? await register(req, body)
      : action === 'settings' ? await settings(req, body)
      : action === 'push' ? await push(req, body)
      : action === 'status' ? await status(req, body)
      : { error: 'Unknown JMSURF route', status: 404 };
    const code = result.error ? result.status || 400 : 200;
    return sendJson(res, code, result);
  } catch (error) {
    console.error('[sendmoney] request failed', pathname, error);
    return sendJson(res, 503, { error: str(error.message) || 'JMSURF is temporarily unavailable' });
  }
}

export function startSendMoneyReconciler() {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  let busy = false;
  setInterval(async () => {
    // The key may be saved in the super admin after start-up.
    if (busy || !apiKey()) return;
    busy = true;
    try {
      const pending = await db('sendmoney_payments?status=eq.pending&select=*&order=started_at.asc&limit=30');
      for (const payment of pending || []) {
        try { await reconcile(payment); } catch (error) { console.error('[sendmoney] reconciliation failed', payment.id, error); }
        await sleep(100);
      }
    } catch (error) { console.error('[sendmoney] reconciliation batch failed', error); }
    finally { busy = false; }
  }, 5000).unref();
}

// ---------------------------------------------------------------------------
// Invoices: an M-Pesa prompt for what a customer still owes on an invoice
// (customer portal or staff). On confirmation the database records the
// payment and applies it to the invoice (settle_invoice_mpesa).
// ---------------------------------------------------------------------------
export async function pushInvoiceForShop(tenantId, invoiceId, rawPhone, amountWanted, requestedBy = 'portal') {
  // A company on its own Daraja app: same request table and settlement, its own keys.
  const provider = await one('business_settings', `tenant_id=eq.${tenantId}`, 'payment_provider').catch(() => null);
  if (provider?.payment_provider === 'daraja') {
    const { pushInvoiceDaraja } = await import('./gateways.js');
    return pushInvoiceDaraja(tenantId, invoiceId, rawPhone, amountWanted, requestedBy);
  }
  requireConfiguration();
  if (!uuid.test(str(invoiceId))) return { error: 'Invalid invoice', status: 400 };
  // The public demo never sends real payment prompts (portal, staff or payment link).
  if (await isDemoTenant(tenantId)) return { error: 'Payments are switched off in the demo company.', status: 403 };
  const phone = str(rawPhone).replace(/[^\d]/g, '');
  const normalized = phone.startsWith('0') ? `254${phone.slice(1)}` : phone.startsWith('7') || phone.startsWith('1') ? `254${phone}` : phone;
  if (!/^254[17]\d{8}$/.test(normalized)) return { error: 'Enter a valid Kenyan M-Pesa number', status: 400 };
  const [tenant, active, inv, open] = await Promise.all([
    one('sendmoney_tenants', `tenant_id=eq.${tenantId}`),
    one('business_settings', `tenant_id=eq.${tenantId}`, 'payment_provider'),
    one('invoices', `id=eq.${invoiceId}&tenant_id=eq.${tenantId}`, 'id,invoice_number,total,amount_paid,status,customer_id'),
    one('invoice_mpesa_requests', `invoice_id=eq.${invoiceId}&status=in.(initiating,pending)&created_at=gt.${new Date(Date.now() - 120000).toISOString()}`),
  ]);
  if (!tenant) return { error: 'The shop has not linked its M-Pesa Till or Paybill yet. Pay using the details shown.', status: 409 };
  if (active?.payment_provider !== 'jmsurf') return { error: 'M-Pesa prompts are not switched on. Pay using the details shown.', status: 409 };
  if (!inv || ['draft', 'void', 'paid'].includes(inv.status)) return { error: 'This invoice cannot be paid online', status: 409 };
  // A repeat tap while a prompt is still open answers with that prompt (no second STK).
  if (open) return { success: true, request_id: open.id, resumed: true };
  const due = Math.floor(Number(inv.total) - Number(inv.amount_paid));
  const amount = Math.floor(Number(amountWanted) || due);
  if (amount < 1 || amount > due || amount > 150000) return { error: `Pay between KES 1 and ${Math.min(due, 150000).toLocaleString()}`, status: 400 };
  const [req] = await db('invoice_mpesa_requests', { method: 'POST', prefer: 'return=representation', body: { tenant_id: tenantId, invoice_id: inv.id, customer_id: inv.customer_id, phone: normalized, amount, requested_by: requestedBy } });
  try {
    const result = await api('/api/payments/stkpush', {
      method: 'POST',
      body: { phoneNumber: normalized, amount, accountReference: str(inv.invoice_number).slice(0, 12), transactionDesc: `Invoice ${str(inv.invoice_number)}`.slice(0, 13), tenantCode: tenant.tenant_code },
    });
    const checkout = str(result.checkoutRequestId);
    if (!checkout) throw new Error('JMSURF PAY did not return a checkout reference');
    await db(`invoice_mpesa_requests?id=eq.${req.id}`, { method: 'PATCH', body: { checkout_request_id: checkout, status: 'pending', checked_at: new Date().toISOString() } });
    return { success: true, request_id: req.id };
  } catch (error) {
    await db(`invoice_mpesa_requests?id=eq.${req.id}`, { method: 'PATCH', body: { status: 'failed', provider_status: { error: str(error.message).slice(0, 300) } } }).catch(() => {});
    return { error: str(error.message) || 'M-Pesa did not answer. Try again.', status: 502 };
  }
}

async function reconcileInvoice(r) {
  const result = await api(`/api/payments/status/${encodeURIComponent(r.checkout_request_id)}`);
  const raw = str(result.status).toLowerCase();
  const text = str(result.resultDesc || result.message || result.error).toLowerCase();
  const status = raw === 'canceled' || (raw === 'failed' && (String(result.resultCode || result.ResultCode) === '1032' || text.includes('cancel'))) ? 'cancelled' : raw;
  if (!['pending', 'completed', 'failed', 'cancelled'].includes(status) || status === 'pending') {
    // Give up on prompts nobody answered after 10 minutes.
    if (Date.now() - Date.parse(r.created_at) > 600000) await db('rpc/settle_invoice_mpesa', { method: 'POST', body: { p_request: r.id, p_status: 'failed', p_receipt: null, p_provider: { timeout: true } } });
    return 'pending';
  }
  let receipt = str(result.mpesaReceiptNumber || result.mpesaReceipt || result.receipt);
  if (status === 'completed' && !receipt) receipt = `SM-${r.checkout_request_id}`.slice(0, 60);
  return db('rpc/settle_invoice_mpesa', { method: 'POST', body: { p_request: r.id, p_status: status, p_receipt: receipt || null, p_provider: result } });
}

/** Status for the portal / ERP while the customer is answering the prompt. */
export async function invoicePromptStatus(tenantId, requestId) {
  const r = await one('invoice_mpesa_requests', `id=eq.${requestId}&tenant_id=eq.${tenantId}`);
  if (!r) return { status: 'unknown' };
  if (r.status === 'pending' && r.checkout_request_id) {
    try {
      if (str(r.checkout_request_id).startsWith('daraja:')) await (await import('./gateways.js')).reconcileInvoiceDaraja(r);
      else await reconcileInvoice(r);
    } catch { /* next poll */ }
  }
  const fresh = await one('invoice_mpesa_requests', `id=eq.${requestId}`, 'status,mpesa_receipt,amount');
  return fresh || { status: 'unknown' };
}

/**
 * JMSURF PAY webhook (garage-integrations.js checks the signature first): the event only
 * says which payment changed; its outcome is read back from JMSURF PAY as usual.
 */
export async function settleFromWebhook(checkoutRequestId) {
  const id = str(checkoutRequestId);
  if (!id || id.length > 160 || !apiKey()) return { matched: false };
  const sale = await one('sendmoney_payments', `checkout_request_id=eq.${encodeURIComponent(id)}`).catch(() => null);
  if (sale) return { matched: 'sale', ...(await reconcile(sale)) };
  const inv = await one('invoice_mpesa_requests', `checkout_request_id=eq.${encodeURIComponent(id)}`).catch(() => null);
  if (inv) { await reconcileInvoice(inv); return { matched: 'invoice' }; }
  return { matched: false };
}

export function startInvoicePromptReconciler() {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  let busy = false;
  setInterval(async () => {
    if (busy || !apiKey()) return;
    busy = true;
    try {
      // Prompts sent with a company's own Daraja app are checked by gateways.js.
      const pending = await db('invoice_mpesa_requests?status=eq.pending&checkout_request_id=not.is.null&checkout_request_id=not.like.daraja:*&select=*&order=created_at.asc&limit=30');
      for (const r of pending || []) { try { await reconcileInvoice(r); } catch (e) { console.error('[invoice-mpesa]', r.id, e.message); } await sleep(100); }
    } catch (e) { console.error('[invoice-mpesa] batch', e.message); }
    finally { busy = false; }
  }, 6000).unref();
}
