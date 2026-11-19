import assert from 'node:assert/strict';
import { test } from 'node:test';

// The Docker build passes the real platform keys as build args: clear every one the payment code reads,
// so the test runs the same in the build as on a laptop.
for (const k of ['SENDMONEY_API_KEY', 'JMSURFPAY_API_KEY', 'JMSURFPAY_BASE_URL', 'SENDMONEY_WEBHOOK_SECRET', 'PAYMENT_CALLBACK_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'GARAGE_SECRETS_KEY', 'PUBLIC_ORIGIN', 'VITE_SUPABASE_URL',
  'MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_PASSKEY', 'MPESA_SHORTCODE', 'PAYSTACK_SECRET_KEY']) delete process.env[k];
process.env.SUPABASE_URL = 'https://db.example.test';
process.env.SUPABASE_ANON_KEY = 'anon-test';
process.env.JMSURF_SUPABASE_SERVICE_KEY = 'service-test';
const { configurePayments, handlePaymentsRequest } = await import('../payments.js');
const tenantId = '8324b60d-1f62-4b3d-9762-9c3c55a2f764';
const saleId = '4449b491-6527-4ac3-9d5e-969fb8acea3b';
const userId = '9fae386c-345b-442b-a166-3c62a95ac2da';
const reference = `POS-test-${saleId}`;
const reply = (body, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

async function route(pathname, body, search = '') {
  let answer;
  configurePayments({ sendJson: (_res, status, payload) => { answer = { status, payload }; } });
  await handlePaymentsRequest({ headers: { authorization: 'Bearer user-session' } }, {}, pathname, search, body);
  return answer;
}

function mockDatabase(calls, provider = 'mpesa') {
  let payment = null;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path: url.pathname, method: options.method || 'GET', body, headers: options.headers });
    if (url.pathname === '/auth/v1/user') return reply({ id: userId });
    if (url.pathname === '/rest/v1/tenants') return reply([{ id: tenantId, slug: 'test', business_name: 'Test Shop' }]);
    if (url.pathname === '/rest/v1/profiles') return reply([{ tenant_id: tenantId }]);
    if (url.pathname === '/rest/v1/transactions' && options.method === 'PATCH') return reply(null, 204);
    if (url.pathname === '/rest/v1/transactions') return reply([{ id: saleId, tenant_id: tenantId, total: 120, status: 'pending', payment_method: 'mpesa' }]);
    if (url.pathname === '/rest/v1/business_settings') return reply([{ payment_provider: provider }]);
    if (url.pathname === '/rest/v1/platform_settings') return reply([{ value: { payhero: { api_username: 'test-user', api_password: 'test-password', account_id: '123' } } }]);
    if (url.pathname === '/rest/v1/tenant_payout_channels') return reply([{ id: '0ae50622-6fc4-4771-992a-424405591993', payhero_channel_id: '123', channel_type: 'till', short_code: '123456' }]);
    if (url.pathname === '/rest/v1/payhero_transactions' && options.method === 'POST') {
      payment = { ...body, id: '716e01aa-0230-4b6d-96a1-42bd7e2a6984' };
      return reply([payment], 201);
    }
    if (url.pathname === '/rest/v1/payhero_transactions' && options.method === 'PATCH') {
      Object.assign(payment, body);
      return reply(null, 204);
    }
    if (url.pathname === '/rest/v1/payhero_transactions') return reply(payment ? [payment] : []);
    if (url.pathname === '/api/v2/payments') return reply({ reference: 'payhero-test-ref' }, 201);
    if (url.pathname === '/api/v2/transaction-status') {
      return reply({ status: 'COMPLETED', external_reference: reference, amount: 120, provider_reference: 'MPESA123' });
    }
    if (url.pathname === '/rest/v1/rpc/settle_payhero_payment') return reply('completed');
    throw new Error(`Unexpected request: ${url.href}`);
  };
}

test('PayHero reserves a tenant sale before sending one prompt and settles only from provider status', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    mockDatabase(calls);
    const started = await route('/api/payments/payhero/stk-push', {
      tenant_id: tenantId, pos_transaction_id: saleId, amount: 120, phone: '0712345678',
    });
    assert.equal(started.payload.success, true);
    assert.ok(calls.findIndex(x => x.path === '/rest/v1/payhero_transactions' && x.method === 'POST') <
      calls.findIndex(x => x.path === '/api/v2/payments'));
    assert.ok(calls.some(x => x.path === '/rest/v1/payhero_transactions' && x.method === 'POST' && x.headers.apikey === 'service-test'));
    assert.ok(calls.some(x => x.path === '/rest/v1/transactions' && x.method === 'PATCH' && x.body.mpesa_ref === 'payhero:payhero-test-ref'));
    const status = await route('/api/payments/payhero/status', { pos_transaction_id: saleId });
    assert.equal(status.payload.resolved_status, 'completed');
    const settlement = calls.find(x => x.path === '/rest/v1/rpc/settle_payhero_payment');
    assert.equal(settlement.body.p_receipt, 'MPESA123');
    assert.equal(settlement.body.p_pos_transaction_id, saleId);
  } finally { globalThis.fetch = originalFetch; }
});

// JMSURF shops are paid through SendMoney whatever the till sends, so a
// PayHero request for one never reaches PayHero.
test('A JMSURF shop never sends a PayHero prompt', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    mockDatabase(calls, 'jmsurf');
    const started = await route('/api/payments/payhero/stk-push', {
      tenant_id: tenantId, pos_transaction_id: saleId, amount: 120, phone: '0712345678',
    });
    assert.notEqual(started.payload.prompt_sent, true);
    assert.ok(calls.every(x => x.path !== '/api/v2/payments'));
  } finally { globalThis.fetch = originalFetch; }
});
