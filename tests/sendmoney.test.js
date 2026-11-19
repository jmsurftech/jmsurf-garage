import assert from 'node:assert/strict';
import { test } from 'node:test';

// The Docker build passes the real platform keys as build args: clear every one the payment code reads,
// so the test runs the same in the build as on a laptop.
for (const k of ['JMSURFPAY_API_KEY', 'JMSURFPAY_BASE_URL', 'SENDMONEY_WEBHOOK_SECRET', 'PAYMENT_CALLBACK_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'GARAGE_SECRETS_KEY', 'PUBLIC_ORIGIN', 'VITE_SUPABASE_URL',
  'MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_PASSKEY', 'MPESA_SHORTCODE', 'PAYSTACK_SECRET_KEY']) delete process.env[k];
process.env.SUPABASE_URL = 'https://db.example.test';
process.env.SUPABASE_ANON_KEY = 'anon-test';
process.env.JMSURF_SUPABASE_SERVICE_KEY = 'service-test';
process.env.SENDMONEY_API_KEY = 'sendmoney-test';

const { handleSendMoneyRequest } = await import('../sendmoney.js');
const tenantId = '8324b60d-1f62-4b3d-9762-9c3c55a2f764';
const transactionId = '4449b491-6527-4ac3-9d5e-969fb8acea3b';
const userId = '9fae386c-345b-442b-a166-3c62a95ac2da';
const reply = (body, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

async function route(pathname, body) {
  let answer;
  await handleSendMoneyRequest(
    { headers: { authorization: 'Bearer user-session' } }, {}, pathname, body,
    (_res, status, payload) => { answer = { status, payload }; },
  );
  return answer;
}

test('JMSURF uses the saved sale amount and tenant destination, then settles only after provider confirmation', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let payment = null;
  try {
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: url.href, body, options });
      if (url.pathname === '/auth/v1/user') return reply({ id: userId });
      if (url.pathname === '/rest/v1/profiles') return reply([{ tenant_id: tenantId }]);
      if (url.pathname === '/rest/v1/user_roles') return reply([{ role: 'cashier' }]);
      if (url.pathname === '/rest/v1/sendmoney_tenants') return reply([{ tenant_code: 'tnnt_test', tenant_id: tenantId }]);
      if (url.pathname === '/rest/v1/business_settings') return reply([{ payment_provider: 'jmsurf' }]);
      if (url.pathname === '/rest/v1/transactions' && options.method !== 'PATCH') {
        return reply([{ id: transactionId, tenant_id: tenantId, total: 250, status: 'pending', payment_method: 'mpesa' }]);
      }
      if (url.pathname === '/rest/v1/transactions' && options.method === 'PATCH') return reply(null, 204);
      if (url.pathname === '/rest/v1/sendmoney_payments') {
        if (options.method === 'POST') { payment = { ...body, status: 'initiating' }; return reply(null, 201); }
        if (options.method === 'PATCH') { Object.assign(payment, body); return reply(null, 204); }
        return reply(payment ? [payment] : []);
      }
      if (url.pathname === '/api/payments/stkpush') return reply({ checkoutRequestId: 'ws_CO_test' });
      if (url.pathname === '/api/payments/status/ws_CO_test') {
        return reply({ status: 'completed', mpesaReceiptNumber: 'TEST123' });
      }
      if (url.pathname === '/rest/v1/rpc/settle_sendmoney_payment') return reply('completed');
      throw new Error(`Unexpected request: ${url.href}`);
    };

    const started = await route('/api/payments/jmsurf/push', {
      tenant_id: tenantId, pos_transaction_id: transactionId, phone: '0712345678', amount: 1,
    });
    assert.equal(started.status, 200);
    assert.equal(started.payload.checkout_request_id, 'ws_CO_test');
    const push = calls.find((call) => call.url.endsWith('/api/payments/stkpush'));
    assert.equal(push.body.amount, 250);
    assert.equal(push.body.tenantCode, 'tnnt_test');
    assert.equal(push.body.phoneNumber, '254712345678');
    assert.equal(push.options.headers['User-Agent'], 'JMSURF-GARAGE/1.0 (+https://garage.jmsurf.co.ke)');

    const completed = await route('/api/payments/jmsurf/status', {
      tenant_id: tenantId, pos_transaction_id: transactionId,
    });
    assert.equal(completed.payload.resolved_status, 'completed');
    const settled = calls.find((call) => call.url.endsWith('/rpc/settle_sendmoney_payment'));
    assert.equal(settled.body.p_receipt, 'TEST123');
    assert.equal(settled.body.p_pos_transaction_id, transactionId);
  } finally { globalThis.fetch = originalFetch; }
});

test('JMSURF refuses another tenant before touching SendMoney', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      calls.push(url.href);
      if (url.pathname === '/auth/v1/user') return reply({ id: userId });
      if (url.pathname === '/rest/v1/profiles') return reply([{ tenant_id: tenantId }]);
      if (url.pathname === '/rest/v1/user_roles') return reply([{ role: 'cashier' }]);
      throw new Error('A denied request reached another service');
    };
    const denied = await route('/api/payments/jmsurf/push', {
      tenant_id: '4c9166e1-1846-4386-9f0d-f661751828e2',
      pos_transaction_id: transactionId, phone: '0712345678',
    });
    assert.equal(denied.status, 403);
    assert.ok(calls.every((url) => !url.includes('jmsurfpay.co.ke')));
  } finally { globalThis.fetch = originalFetch; }
});

test('shop admin can replace a settlement destination without changing another tenant', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url: url.href, method: options.method || 'GET', body });
      if (url.pathname === '/auth/v1/user') return reply({ id: userId });
      if (url.pathname === '/rest/v1/profiles') return reply([{ tenant_id: tenantId }]);
      if (url.pathname === '/rest/v1/user_roles') return reply([{ role: 'admin' }]);
      if (url.pathname === '/rest/v1/tenants') return reply([{ id: tenantId, business_name: 'Test Shop', slug: 'test', is_active: true, deleted_at: null }]);
      if (url.pathname === '/rest/v1/sendmoney_tenants' && options.method === 'PATCH') return reply(null, 204);
      if (url.pathname === '/rest/v1/sendmoney_tenants') return reply([{
        tenant_id: tenantId, tenant_code: 'tnnt_old', destination_type: 'till',
        business_number: null, account_number: '123456', account_name: 'Test Shop',
      }]);
      if (url.pathname === '/rest/v1/sendmoney_provisioning' && options.method === 'POST') return reply(null, 201);
      if (url.pathname === '/rest/v1/sendmoney_provisioning' && options.method === 'DELETE') return reply(null, 204);
      if (url.pathname === '/rest/v1/sendmoney_provisioning') return reply([]);
      if (url.pathname === '/api/saas/provision-tenant') return reply({ tenantCode: 'tnnt_new', tenantId: 10, settlementAccountId: 11 });
      throw new Error(`Unexpected request: ${url.href}`);
    };
    const changed = await route('/api/payments/jmsurf/register', {
      tenant_id: tenantId, destination_type: 'paybill', business_number: '247247',
      account_number: '00123456', account_name: 'Test Shop',
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.payload.changed, true);
    const provision = calls.find((call) => call.url.endsWith('/api/saas/provision-tenant'));
    assert.equal(provision.body.name, 'Test Shop');
    const update = calls.find((call) => call.method === 'PATCH' && call.url.includes('/sendmoney_tenants'));
    assert.ok(update.url.includes(`tenant_id=eq.${tenantId}`));
    assert.equal(update.body.tenant_code, 'tnnt_new');
    assert.ok(calls.some((call) => call.method === 'DELETE' && call.url.includes('/sendmoney_provisioning')));
  } finally { globalThis.fetch = originalFetch; }
});

test('a customer-cancelled STK prompt is settled as cancelled', async () => {
  const originalFetch = globalThis.fetch;
  let settled = null;
  try {
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname === '/auth/v1/user') return reply({ id: userId });
      if (url.pathname === '/rest/v1/profiles') return reply([{ tenant_id: tenantId }]);
      if (url.pathname === '/rest/v1/user_roles') return reply([{ role: 'cashier' }]);
      if (url.pathname === '/rest/v1/sendmoney_payments') return reply([{
        tenant_id: tenantId, pos_transaction_id: transactionId,
        checkout_request_id: 'ws_CO_cancelled', status: 'pending',
      }]);
      if (url.pathname === '/api/payments/status/ws_CO_cancelled') {
        return reply({ status: 'failed', resultCode: 1032, message: 'Request cancelled by user' });
      }
      if (url.pathname === '/rest/v1/rpc/settle_sendmoney_payment') {
        settled = JSON.parse(options.body);
        return reply('cancelled');
      }
      throw new Error(`Unexpected request: ${url.href}`);
    };
    const result = await route('/api/payments/jmsurf/status', {
      tenant_id: tenantId, pos_transaction_id: transactionId,
    });
    assert.equal(result.status, 200);
    assert.equal(result.payload.resolved_status, 'cancelled');
    assert.equal(settled.p_status, 'cancelled');
  } finally { globalThis.fetch = originalFetch; }
});

test('an invalid JMSURF sale amount fails before any provider prompt', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      calls.push({ url: url.href, method: options.method || 'GET' });
      if (url.pathname === '/auth/v1/user') return reply({ id: userId });
      if (url.pathname === '/rest/v1/profiles') return reply([{ tenant_id: tenantId }]);
      if (url.pathname === '/rest/v1/user_roles') return reply([{ role: 'cashier' }]);
      if (url.pathname === '/rest/v1/sendmoney_tenants') return reply([{ tenant_code: 'tnnt_test' }]);
      if (url.pathname === '/rest/v1/business_settings') return reply([{ payment_provider: 'jmsurf' }]);
      if (url.pathname === '/rest/v1/sendmoney_payments') return reply([]);
      if (url.pathname === '/rest/v1/transactions' && options.method === 'PATCH') return reply(null, 204);
      if (url.pathname === '/rest/v1/transactions') return reply([{
        id: transactionId, tenant_id: tenantId, total: 0.83, status: 'pending', payment_method: 'mpesa',
      }]);
      throw new Error(`Unexpected request: ${url.href}`);
    };
    const result = await route('/api/payments/jmsurf/push', {
      tenant_id: tenantId, pos_transaction_id: transactionId, phone: '0712345678',
    });
    assert.equal(result.status, 422);
    assert.ok(calls.some((call) => call.method === 'PATCH' && call.url.includes('/transactions')));
    assert.ok(calls.every((call) => !call.url.includes('jmsurfpay.co.ke')));
  } finally { globalThis.fetch = originalFetch; }
});
