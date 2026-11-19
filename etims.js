// ---------------------------------------------------------------------------
// KRA eTIMS (OSCU) for JMSURF Garage companies, through the JMSURF eTIMS Hub.
//
// The hub (etims.jmsurf.co.ke) is the KRA integrator. This server talks to it
// with the platform's partner key (ETIMS_PARTNER_KEY): each company becomes a
// hub tenant (reference = tenant id), its OSCU device is initialised through
// the hub, and the hub issues the company its own API key, kept write-only in
// integration_secrets (etims_hub_key_sandbox / etims_hub_key_live).
// Company settings stay in business_settings.erp_settings.etims:
//   env sbx|prod, tin, bhf_id, device_serial, goods_cls_cd, service_cls_cd, auto_sign.
// Signing writes the KRA details onto the invoice / credit note (etims_* columns)
// exactly as before, so documents, PDFs and the "Push to eTIMS" button are unchanged.
// Documents KRA has not answered yet stay "pending" and are checked every 2 minutes.
// ---------------------------------------------------------------------------

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const HUB = (process.env.ETIMS_HUB_URL || "https://etims.jmsurf.co.ke").replace(/\/+$/, "");
const PARTNER_KEY = process.env.ETIMS_PARTNER_KEY || "";

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const enc = encodeURIComponent;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function db(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(15000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  const j = t ? JSON.parse(t) : null;
  if (!res.ok) throw new Error(str(j?.message) || `Database error ${res.status}`);
  return j;
}
const one = async (path) => (await db(path))?.[0] || null;

/** Calls the hub with the partner key, or a company's own key for /v1. */
async function hub(path, { method = "GET", body, key = PARTNER_KEY } = {}) {
  if (!key) throw new HttpError(503, "KRA eTIMS is not set up on this server yet.");
  let res;
  try {
    res = await fetch(`${HUB}${path}`, { method, signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) { throw new HttpError(502, `Could not reach the eTIMS hub: ${e.message}`); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) {
    const err = new HttpError(res.status >= 500 || res.status === 401 ? 502 : 400, str(j?.error?.message) || `eTIMS hub replied ${res.status}`);
    err.code = j?.error?.code;
    throw err;
  }
  return j;
}

async function config(tenantId) {
  const s = await one(`business_settings?tenant_id=eq.${tenantId}&select=id,erp_settings,business_name,business_email,business_phone`);
  const e = s?.erp_settings?.etims || {};
  const secrets = Object.fromEntries((await db(`integration_secrets?tenant_id=eq.${tenantId}&name=like.etims_hub_*&select=name,value`)).map((x) => [x.name, x.value]));
  const env = e.env === "prod" ? "prod" : "sbx";
  return {
    settingsId: s?.id, erp: s?.erp_settings || {}, company: s?.business_name || "", email: s?.business_email || "", phone: s?.business_phone || "",
    env, hubEnv: env === "prod" ? "production" : "sandbox", tin: str(e.tin).toUpperCase(), bhfId: (str(e.bhf_id) || "00").replace(/\D/g, "").padStart(2, "0").slice(0, 2),
    serial: str(e.device_serial), goodsCls: str(e.goods_cls_cd) || "5059690800", serviceCls: str(e.service_cls_cd) || "8111150100",
    vatRegistered: e.vat_registered !== false, key: env === "prod" ? secrets.etims_hub_key_live : secrets.etims_hub_key_sandbox,
  };
}

/** KRA tax bands: A exempt, B 16% standard, C zero-rated, D non-VAT, E 8%. */
export function taxBand(rate, explicit, vatRegistered = true) {
  if (explicit && /^[A-E]$/.test(explicit)) return explicit;
  if (!vatRegistered) return "D";
  const r = Number(rate) || 0;
  return r >= 15 ? "B" : r >= 7 ? "E" : "A";
}

/** The hub document for a DASH invoice / credit note. Document prices are tax-exclusive. */
/** The item's unit (pcs, kg, litre …) as a KRA quantity unit code. */
function qtyUnit(unit) {
  const u = str(unit).toLowerCase();
  if (!u) return "U";
  if (/^(kg|kgs|kilo)/.test(u)) return "KG";
  if (/^(g|gm|gms|gram)/.test(u)) return "GRM";
  if (/^(l|lt|ltr|litre|liter)/.test(u)) return "LTR";
  if (/^ml/.test(u)) return "MLT";
  if (/^(m|mtr|metre|meter)$/.test(u)) return "MTR";
  if (/^box/.test(u)) return "BX";
  if (/^(dozen|dz)/.test(u)) return "DZ";
  if (/^pair/.test(u)) return "PR";
  if (/^set/.test(u)) return "SET";
  if (/^(pack|pkt)/.test(u)) return "PA";
  if (/^bag/.test(u)) return "BG";
  if (/^roll/.test(u)) return "RO";
  if (/^ton/.test(u)) return "TNE";
  return "U";
}

export function hubLines(lines, products, c) {
  return lines.filter((l) => str(l.name) && Number(l.quantity ?? l.qty ?? 1)).map((l, i) => {
    const p = l.item_id ? products.get(l.item_id) : null;
    const service = p ? p.product_type === "service" : false;
    const qty = Number(l.quantity ?? l.qty ?? 1) || 1;
    const rate = r2(l.rate ?? l.price ?? 0);
    const supply = r2(qty * rate);
    const discount = r2(Number(l.discount_amount ?? 0) || (Number(l.discount || 0) > 0 && Number(l.discount) <= 100 ? supply * Number(l.discount) / 100 : 0));
    return {
      item_id: str(l.item_id || `line-${str(l.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80) || i}`).slice(0, 120),
      name: str(l.name).slice(0, 200), quantity: qty, unit_price: rate, ...(discount > 0 ? { discount } : {}),
      tax_type: taxBand(p?.vat_rate ?? l.tax_rate, p?.etims_tax_type, c.vatRegistered),
      item_class_code: str(p?.etims_item_cls_cd) || (service ? c.serviceCls : c.goodsCls),
      product_type: /^[123]$/.test(str(p?.etims_item_type)) ? str(p.etims_item_type) : service ? "3" : "2",
      packaging_unit: str(p?.etims_pkg_unit).toUpperCase().slice(0, 5) || "NT",
      quantity_unit: str(p?.etims_qty_unit).toUpperCase().slice(0, 5) || qtyUnit(p?.unit ?? l.unit),
    };
  });
}

const signedPatch = (kind, d) => ({
  etims_status: "signed", etims_invc_no: d.etims_invoice_number ?? null, etims_rcpt_no: str(d.kra.receipt_number ?? d.kra.cu_invoice_number),
  etims_signature: str(d.kra.receipt_signature), etims_qr_url: str(d.kra.qr_url), etims_error: null,
  // invoices and credit notes both keep the full SCU details (credit_notes has the same columns since 20261018)
  etims_internal_data: str(d.kra.internal_data), etims_sdc_id: str(d.kra.cu_id), etims_signed_at: str(d.kra.signed_at_kra),
});

/**
 * Stock movement for a signed sale (type 11, stock out) or customer return (type 03, stock in),
 * with each item's balance after it. Services and items without stock are left out.
 */
async function reportSaleStock(who, c, kind, doc, items, products) {
  const table = kind === "credit_note" ? "credit_notes" : "invoices";
  const goods = items.filter((l) => l.item_id && products.get(l.item_id) && products.get(l.item_id).product_type !== "service" && str(products.get(l.item_id).etims_item_type) !== "3");
  if (!goods.length) return;
  const lines = [];
  for (const l of goods) {
    const p = products.get(l.item_id);
    let code = str(p.etims_item_cd);
    if (!code) {
      // Registered by the hub when the invoice was signed: learn its KRA item code.
      const it = await hub(`/v1/items/${enc(p.id)}`, { key: c.key }).catch(() => null);
      code = str(it?.item_code || it?.data?.item_code);
      if (code) await db(`products?id=eq.${p.id}`, { method: "PATCH", prefer: "return=minimal", body: { etims_item_cd: code } }).catch(() => {});
    }
    if (!code) continue;
    const stock = await db(`product_stocks?product_id=eq.${p.id}&select=stock`).catch(() => []);
    const balance = (stock || []).reduce((a, r) => a + Number(r.stock || 0), 0);
    lines.push({ item_code: code, quantity: Math.abs(Number(l.quantity ?? l.qty ?? 1)) || 1, unit_price: Math.max(0, Number(p.cost_price ?? l.rate ?? 0) || 0), balance_after: balance });
  }
  if (!lines.length) return;
  try {
    await hub("/v1/stock/movements", { method: "POST", key: c.key, body: {
      reference: str(doc.invoice_number || doc.credit_note_number || doc.id).slice(0, 50), idempotency_key: `dash-stock-${kind}-${doc.id}`,
      type: kind === "credit_note" ? "03" : "11", date: str(doc.issue_date || doc.created_at).slice(0, 10) || null, lines,
    } });
    await db(`${table}?id=eq.${doc.id}`, { method: "PATCH", prefer: "return=minimal", body: { etims_stock_status: "reported" } });
  } catch (e) {
    await db(`${table}?id=eq.${doc.id}`, { method: "PATCH", prefer: "return=minimal", body: { etims_stock_status: `failed: ${str(e.message).slice(0, 200)}` } }).catch(() => {});
  }
}

/** Sends a sale (invoice) or refund (credit note) to KRA through the hub. */
async function sign(who, kind, id) {
  const c = await config(who.tenantId);
  if (!c.key) throw new HttpError(400, "Connect the company to KRA eTIMS first (System → KRA eTIMS).");
  const table = kind === "credit_note" ? "credit_notes" : "invoices";
  const doc = await one(`${table}?id=eq.${enc(id)}&tenant_id=eq.${who.tenantId}&select=*`);
  if (!doc) throw new HttpError(404, "Document not found");
  if (doc.etims_status === "signed") return { ok: true, already: true, rcpt_no: doc.etims_rcpt_no, qr_url: doc.etims_qr_url };
  if (["draft", "void"].includes(doc.status)) throw new HttpError(400, "Send or approve the document before signing it with KRA.");
  const items = Array.isArray(doc.items) ? doc.items : [];
  if (!items.length) throw new HttpError(400, "The document has no items.");
  const ids = [...new Set(items.map((l) => l.item_id).filter(Boolean))];
  const prods = ids.length ? await db(`products?tenant_id=eq.${who.tenantId}&id=in.(${ids.map(enc).join(",")})&select=id,name,unit,product_type,vat_rate,etims_item_cls_cd,etims_tax_type,etims_item_type,etims_pkg_unit,etims_qty_unit,etims_origin,etims_item_cd,cost_price`) : [];
  const products = new Map((prods || []).map((p) => [p.id, p]));
  // Services live in their own table: send them as services (item type 3) with their KRA class and tax type.
  const missing = ids.filter((x) => !products.has(x));
  if (missing.length) {
    const svcs = await db(`services?tenant_id=eq.${who.tenantId}&id=in.(${missing.map(enc).join(",")})&select=id,name,vat_rate,etims_item_cls_cd,etims_tax_type`).catch(() => []);
    for (const sv of svcs || []) products.set(sv.id, { ...sv, product_type: "service", etims_item_type: "3", unit: "U" });
  }
  const cust = doc.customer_id ? await one(`customers?id=eq.${doc.customer_id}&select=name,kra_pin,phone`) : null;
  const pin = str(cust?.kra_pin).toUpperCase();
  const body = {
    reference: str(doc.invoice_number || doc.credit_note_number || doc.id).slice(0, 50),
    idempotency_key: `dash-${kind}-${doc.id}`,
    date: str(doc.issue_date || doc.credit_date || doc.created_at).slice(0, 10) || null,
    customer: { pin: /^[AP]\d{9}[A-Z]$/.test(pin) ? pin : null, name: str(cust?.name || doc.customer_name).slice(0, 60) || null, phone: str(cust?.phone).slice(0, 20) || null },
    payment_method: Number(doc.amount_paid || 0) >= Number(doc.total || 0) ? "01" : "02",
    prices_include_tax: !!doc.prices_include_tax,
    lines: hubLines(items, products, c),
  };
  if (kind === "credit_note") {
    const inv = doc.invoice_id ? await one(`invoices?id=eq.${doc.invoice_id}&select=invoice_number,etims_status`) : null;
    if (!inv) throw new HttpError(400, "Link this credit note to the invoice it corrects; KRA needs the original invoice.");
    if (inv.etims_status !== "signed") throw new HttpError(400, `Invoice ${inv.invoice_number} has not been signed with KRA, so this credit note cannot be sent.`);
    Object.assign(body, { original_reference: str(inv.invoice_number).slice(0, 50), reason_code: "06" });
  }
  try {
    const d = await hub(kind === "credit_note" ? "/v1/credit-notes" : "/v1/invoices", { method: "POST", body, key: c.key });
    if (d.status === "signed" && d.kra) {
      const patch = { ...signedPatch(kind, d), customer_pin: body.customer.pin };
      await db(`${table}?id=eq.${doc.id}`, { method: "PATCH", prefer: "return=minimal", body: patch });
      // Zoho does the same: after the receipt, the stock movement of the items is pushed to KRA.
      void reportSaleStock(who, c, kind, doc, items, products).catch((e) => console.error("[etims] stock after sale", e.message));
      return { ok: true, rcpt_no: patch.etims_rcpt_no, qr_url: patch.etims_qr_url };
    }
    // KRA slow or down: the hub keeps retrying; we check back every 2 minutes
    await db(`${table}?id=eq.${doc.id}`, { method: "PATCH", prefer: "return=minimal", body: { etims_status: "pending", etims_error: str(d.error?.message) || "Waiting for KRA" } });
    return { ok: true, pending: true };
  } catch (e) {
    await db(`${table}?id=eq.${doc.id}`, { method: "PATCH", prefer: "return=minimal", body: { etims_status: "failed", etims_error: str(e.message).slice(0, 400) } }).catch(() => {});
    throw e;
  }
}

async function initialize(who, b) {
  if (!who.owner) throw new HttpError(403, "Only the administrator can set up eTIMS");
  const c = await config(who.tenantId);
  if (!/^[AP]\d{9}[A-Z]$/.test(c.tin)) throw new HttpError(400, "Enter the company's KRA PIN (e.g. P051234567X).");
  if (!c.serial) throw new HttpError(400, "Enter your KRA PIN first so the device serial number is created.");
  const t = await hub(`/partner/v1/tenants/${who.tenantId}`, { method: "PUT", body: {
    name: str(c.company || "JMSURF Garage company").slice(0, 120), kra_pin: c.tin, contact_email: str(c.email) || null, contact_phone: str(c.phone).slice(0, 20) || null,
    default_item_class_code: /^\d{2,10}$/.test(c.goodsCls) ? c.goodsCls : null,
  } });
  if (c.hubEnv === "production" && !t.live_approved) throw new HttpError(400, "Live KRA signing is not switched on for this company yet. Contact JMSURF support.");
  const dev = t.devices?.[c.hubEnv];
  const after = (!dev?.connected || dev.kra_pin !== c.tin || dev.branch_id !== c.bhfId || dev.serial !== c.serial || b?.force)
    ? await hub(`/partner/v1/tenants/${who.tenantId}/connect`, { method: "POST", body: { environment: c.hubEnv, kra_pin: c.tin, branch_id: c.bhfId, serial: c.serial, vat_registered: c.vatRegistered } })
    : t;
  if (!c.key) {
    const k = await hub(`/partner/v1/tenants/${who.tenantId}/keys`, { method: "POST", body: { environment: c.hubEnv } });
    await db("integration_secrets?on_conflict=tenant_id,name", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: {
      tenant_id: who.tenantId, name: c.hubEnv === "production" ? "etims_hub_key_live" : "etims_hub_key_sandbox", value: k.key, updated_by: who.user.id, updated_at: new Date().toISOString(),
    } });
  }
  const d = after.devices?.[c.hubEnv] || {};
  const erp = { ...c.erp, etims: { ...(c.erp.etims || {}), initialised_at: new Date().toISOString(), sdc_id: str(d.cu_id), branch_name: str(d.branch_name), taxpayer_name: str(d.taxpayer_name), via: "hub" } };
  await db(`business_settings?id=eq.${c.settingsId}`, { method: "PATCH", prefer: "return=minimal", body: { erp_settings: erp } });
  return { ok: true, sdc_id: d.cu_id, branch: d.branch_name, taxpayer: d.taxpayer_name };
}

async function classes(_who, b) {
  const q = str(b.q).slice(0, 60);
  if (q.length < 2) return { data: [] };
  return hub(`/partner/v1/item-classes?env=${b.env === "prod" ? "production" : "sandbox"}&q=${enc(q)}`);
}

// ---------------------------------------------------------------- pending documents
async function checkPending() {
  for (const [table, kind, numberCol] of [["invoices", "invoice", "invoice_number"], ["credit_notes", "credit_note", "credit_note_number"]]) {
    const rows = await db(`${table}?etims_status=eq.pending&select=id,tenant_id,${numberCol}&limit=50`).catch(() => []);
    for (const r of rows || []) {
      try {
        const c = await config(r.tenant_id);
        if (!c.key) continue;
        const list = await hub(`/v1/documents?reference=${enc(str(r[numberCol]))}&limit=5`, { key: c.key });
        const d = (list.data || []).find((x) => x.object === kind);
        if (d?.status === "signed" && d.kra) await db(`${table}?id=eq.${r.id}`, { method: "PATCH", prefer: "return=minimal", body: signedPatch(kind, d) });
        else if (d?.status === "failed" && d.error && !d.error.retrying) await db(`${table}?id=eq.${r.id}`, { method: "PATCH", prefer: "return=minimal", body: { etims_status: "failed", etims_error: str(d.error.message).slice(0, 400) } });
      } catch (e) { console.error("[etims] pending", table, r.id, e.message); }
    }
  }
}
// ---------------------------------------------------------------- automatic signing
/**
 * "Sign invoices automatically" (erp_settings.etims.auto_sign): sent invoices and open/closed credit
 * notes that were never pushed go to KRA here, whichever screen sent them. Only documents saved
 * since the switch was turned on (auto_sign_since, else the connection date) and at least a minute
 * ago (the invoice form signs straight away itself). Drafts, void and unapproved documents are left
 * out; a document that failed once waits for "Push to eTIMS". The hub's idempotency key per document
 * means a second push never makes a second KRA receipt.
 */
const AUTO_LOOKBACK_MS = 30 * 24 * 3600_000;
async function autoSign() {
  const companies = await db("business_settings?erp_settings->etims->>auto_sign=eq.true&erp_settings->etims->>initialised_at=not.is.null&select=tenant_id,erp_settings").catch(() => []);
  for (const s of companies || []) {
    const e = s.erp_settings?.etims || {};
    const tenantId = s.tenant_id;
    if (!tenantId || e.via !== "hub") continue;
    const c = await config(tenantId).catch(() => null);
    if (!c?.key) continue;
    const since = new Date(Math.max(Date.parse(e.auto_sign_since || e.initialised_at) || 0, Date.now() - AUTO_LOOKBACK_MS)).toISOString();
    const settled = new Date(Date.now() - 60_000).toISOString();
    const base = `tenant_id=eq.${tenantId}&etims_status=is.null&approval_status=not.in.(pending,rejected,info_requested)&updated_at=gte.${enc(since)}&updated_at=lt.${enc(settled)}&order=created_at.asc&limit=20`;
    const who = { tenantId };
    const invoices = await db(`invoices?${base}&status=not.in.(draft,void)&select=id`).catch(() => []);
    for (const r of invoices || []) {
      try { await sign(who, "invoice", r.id); } catch (err) { console.error("[etims] auto-sign invoice", r.id, err.message); }
    }
    const notes = await db(`credit_notes?${base}&status=in.(open,closed)&invoice_id=not.is.null&select=id,invoice_id`).catch(() => []);
    for (const r of notes || []) {
      // KRA needs the original invoice signed first; wait for it rather than failing the credit note.
      const inv = await one(`invoices?id=eq.${r.invoice_id}&select=etims_status`).catch(() => null);
      if (inv?.etims_status !== "signed") continue;
      try { await sign(who, "credit_note", r.id); } catch (err) { console.error("[etims] auto-sign credit note", r.id, err.message); }
    }
  }
}

let jobRunning = false;
async function etimsTick() {
  if (jobRunning) return;
  jobRunning = true;
  try {
    await autoSign().catch((e) => console.error("[etims] auto-sign", e.message));
    await checkPending().catch((e) => console.error("[etims] pending", e.message));
  } finally { jobRunning = false; }
}
export function startEtimsJobs() {
  if (!PARTNER_KEY || !SUPABASE_URL || !SERVICE_KEY) return;
  setInterval(() => void etimsTick(), 2 * 60_000).unref?.();
}

// ---------------------------------------------------------------- status, log, items, reports
async function keyFor(who) {
  const c = await config(who.tenantId);
  if (!c.key) throw new HttpError(400, "Connect the company to KRA eTIMS first (System → KRA eTIMS).");
  return c;
}

/** Connection per branch: KRA PIN, branch code, device serial, CU number, connected or not. */
async function status(who) {
  const c = await config(who.tenantId);
  if (!c.key) return { connected: false, environment: c.env, tin: c.tin, branch_id: c.bhfId, serial: c.serial };
  const s = await hub("/v1/status", { key: c.key });
  return { connected: !!s.device?.connected, environment: c.env, tin: c.tin, branch_id: s.device?.branch_id || c.bhfId, serial: c.serial,
    cu_id: s.device?.cu_id || null, taxpayer: s.device?.taxpayer_name || null, vat_registered: s.device?.vat_registered ?? null, live_approved: !!s.business?.live_approved,
    test_device: !!s.device?.shared_test_device };
}

/** e-Invoice activity log: every document sent to KRA, newest first. */
async function documents(who, b) {
  const c = await keyFor(who);
  const st = ["signed", "pending", "failed", "processing"].includes(str(b.status)) ? `&status=${str(b.status)}` : "";
  return hub(`/v1/documents?limit=200${st}`, { key: c.key });
}

async function retry(who, b) {
  const c = await keyFor(who);
  if (!/^[0-9a-f-]{36}$/.test(str(b.id))) throw new HttpError(400, "Unknown document");
  return hub(`/v1/documents/${str(b.id)}/retry`, { method: "POST", key: c.key });
}

/** Registers items with KRA (their KRA item code is kept on the item). */
async function registerItems(who, b) {
  const c = await keyFor(who);
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(str).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 200);
  if (!ids.length) throw new HttpError(400, "Choose the items to register");
  const prods = (await db(`products?tenant_id=eq.${who.tenantId}&id=in.(${ids.join(",")})&select=id,name,price,unit,vat_rate,product_type,etims_item_cls_cd,etims_tax_type,etims_item_type,etims_pkg_unit,etims_qty_unit,etims_origin`)) || [];
  // services live in their own table
  const rest = ids.filter((x) => !prods.some((p) => p.id === x));
  const svcs = rest.length ? ((await db(`services?tenant_id=eq.${who.tenantId}&id=in.(${rest.join(",")})&select=id,name,price,vat_rate,etims_item_cls_cd,etims_tax_type`).catch(() => [])) || []) : [];
  const all = [...prods.map((p) => ({ ...p, table: "products" })), ...svcs.map((s) => ({ ...s, product_type: "service", etims_item_type: "3", table: "services" }))];
  const done = [], failed = [], codes = {};
  for (const p of all) {
    const service = p.product_type === "service";
    try {
      const r = await hub("/v1/items", { method: "POST", key: c.key, body: {
        external_id: p.id, name: str(p.name).slice(0, 200), item_class_code: str(p.etims_item_cls_cd) || (service ? c.serviceCls : c.goodsCls),
        tax_type: taxBand(p.vat_rate, p.etims_tax_type, c.vatRegistered), product_type: /^[123]$/.test(str(p.etims_item_type)) ? str(p.etims_item_type) : service ? "3" : "2",
        packaging_unit: str(p.etims_pkg_unit).toUpperCase().slice(0, 5) || "NT", quantity_unit: str(p.etims_qty_unit).toUpperCase().slice(0, 5) || qtyUnit(p.unit),
        origin_country: str(p.etims_origin).toUpperCase().slice(0, 2) || "KE", default_price: Math.max(0, Number(p.price) || 0),
      } });
      await db(`${p.table}?id=eq.${p.id}`, { method: "PATCH", prefer: "return=minimal", body: { etims_item_cd: r.item_code || null, etims_registered_at: new Date().toISOString(), etims_error: null } });
      codes[p.id] = r.item_code;
      done.push(p.name);
    } catch (e) {
      await db(`${p.table}?id=eq.${p.id}`, { method: "PATCH", prefer: "return=minimal", body: { etims_error: str(e.message).slice(0, 400) } }).catch(() => {});
      failed.push(`${p.name}: ${e.message}`);
    }
  }
  return { registered: done.length, failed, codes };
}

/** Sends a customer with a KRA PIN to KRA (branch customer list); keeps the KRA customer number. */
async function registerCustomer(who, b) {
  const c = await keyFor(who);
  const id = str(b.id);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, "Unknown customer");
  const cu = await one(`customers?id=eq.${id}&tenant_id=eq.${who.tenantId}&select=id,name,company_name,kra_pin,phone,email,address`);
  if (!cu) throw new HttpError(404, "Customer not found");
  const pin = str(cu.kra_pin).toUpperCase();
  if (!/^[AP]\d{9}[A-Z]$/.test(pin)) return { ok: true, skipped: "no_pin" };
  const addr = typeof cu.address === "object" && cu.address ? Object.values(cu.address).filter(Boolean).join(", ") : str(cu.address);
  try {
    const r = await hub("/v1/customers", { method: "POST", key: c.key, body: {
      external_id: cu.id, pin, name: str(cu.company_name || cu.name).slice(0, 60), phone: str(cu.phone).slice(0, 20) || null,
      email: str(cu.email).slice(0, 50) || null, address: str(addr).slice(0, 300) || null,
    } });
    await db(`customers?id=eq.${cu.id}`, { method: "PATCH", prefer: "return=minimal", body: { etims_cust_no: r.customer_number || null, etims_registered_at: new Date().toISOString(), etims_error: null } });
    return { ok: true, customer_number: r.customer_number };
  } catch (e) {
    await db(`customers?id=eq.${cu.id}`, { method: "PATCH", prefer: "return=minimal", body: { etims_error: str(e.message).slice(0, 400) } }).catch(() => {});
    throw e;
  }
}

/** Daily sales report from KRA-signed documents (X report for today, Z for a past day). */
async function dailyReport(who, b) {
  const c = await keyFor(who);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(str(b.date)) ? str(b.date) : "";
  return hub(`/v1/reports/daily${day ? `?date=${day}` : ""}`, { key: c.key });
}

// ---------------------------------------------------------------- KRA inbound (notices, purchases, imports)
const notices = async (who) => hub("/v1/notices", { key: (await keyFor(who)).key });
const kraPurchases = async (who, b) => hub(`/v1/purchases${b?.refresh === false ? "?refresh=0" : ""}`, { key: (await keyFor(who)).key });
const kraImports = async (who) => hub("/v1/imports", { key: (await keyFor(who)).key });
async function decideImport(who, b) {
  const c = await keyFor(who);
  if (!/^[0-9a-f-]{36}$/.test(str(b.id))) throw new HttpError(400, "Unknown import");
  let itemCode = null;
  if (b.approve) {
    const p = await one(`products?id=eq.${enc(str(b.product_id))}&tenant_id=eq.${who.tenantId}&select=etims_item_cd,name`);
    if (!p?.etims_item_cd) throw new HttpError(400, "Register that item with KRA first (Items → More → Register with KRA eTIMS).");
    itemCode = p.etims_item_cd;
  }
  return hub(`/v1/imports/${str(b.id)}`, { method: "POST", key: c.key, body: { approve: !!b.approve, item_code: itemCode } });
}

/** A purchase a supplier declared to KRA becomes a draft bill (supplier found by KRA PIN, or created). */
async function purchaseToBill(who, b) {
  const c = await keyFor(who);
  const list = await hub("/v1/purchases?refresh=0", { key: c.key });
  const p = (list.data || []).find((x) => x.id === str(b.id));
  if (!p) throw new HttpError(404, "That purchase is no longer in the KRA list");
  let sup = await one(`suppliers?tenant_id=eq.${who.tenantId}&kra_pin=eq.${enc(p.supplier_pin)}&select=id,name&limit=1`);
  if (!sup) {
    const [s] = await db("suppliers", { method: "POST", prefer: "return=representation", body: { tenant_id: who.tenantId, name: str(p.supplier_name) || p.supplier_pin, kra_pin: p.supplier_pin, is_active: true, onboarding_status: "active" } });
    sup = s;
  }
  const codes = [...new Set((p.items || []).map((i) => str(i.itemCd)).filter(Boolean))];
  const prods = codes.length ? await db(`products?tenant_id=eq.${who.tenantId}&etims_item_cd=in.(${codes.map(enc).join(",")})&select=id,name,etims_item_cd`) : [];
  const byCode = new Map((prods || []).map((x) => [x.etims_item_cd, x]));
  const rate = (t) => ({ B: 16, E: 8 }[t] ?? 0);
  // KRA amounts are VAT-inclusive; bills store prices before VAT.
  const items = (p.items || []).map((i) => {
    const r = rate(i.taxTyCd);
    const unit = Math.round((Number(i.prc || 0) / (1 + r / 100)) * 100) / 100;
    const qty = Number(i.qty || 1);
    const prod = byCode.get(str(i.itemCd));
    return { item_id: prod?.id || null, type: "product", name: str(prod?.name || i.itemNm) || "Item", description: "", unit: null, quantity: qty, rate: unit, price: unit, discount: 0, tax_rate: r, amount: Math.round(qty * unit * 100) / 100 };
  });
  const subtotal = items.reduce((a, x) => a + x.amount, 0);
  const total = Number(p.total_amount) || subtotal;
  const num = await db("rpc/next_doc_number", { method: "POST", body: { p_kind: "bill", p_tenant: who.tenantId } });
  const date = /^\d{8}$/.test(str(p.sale_date)) ? `${p.sale_date.slice(0, 4)}-${p.sale_date.slice(4, 6)}-${p.sale_date.slice(6, 8)}` : new Date().toISOString().slice(0, 10);
  const [bill] = await db("bills", { method: "POST", prefer: "return=representation", body: {
    tenant_id: who.tenantId, name: `${sup.name} · ${num}`, bill_number: num, category: "Purchases", supplier_id: sup.id, bill_date: date, due_date: date,
    reference: str(p.supplier_invoice_no) || null, items, subtotal: Math.round(subtotal * 100) / 100, tax: Math.round((total - subtotal) * 100) / 100, amount: total,
    status: "draft", notes: `From KRA eTIMS: ${p.supplier_name || p.supplier_pin} invoice ${p.supplier_invoice_no}`, etims_purchase_id: p.id, created_by: who.user.id,
  } });
  await hub(`/v1/purchases/${p.id}/status`, { method: "POST", key: c.key, body: { status: "accepted", external_ref: num } }).catch(() => undefined);
  return { bill_id: bill.id, bill_number: num };
}
const rejectPurchase = async (who, b) => hub(`/v1/purchases/${str(b.id)}/status`, { method: "POST", key: (await keyFor(who)).key, body: { status: "rejected" } });

/** Reports a bill to KRA as a purchase. */
async function reportBill(who, b) {
  const c = await keyFor(who);
  const bill = await one(`bills?id=eq.${enc(str(b.id))}&tenant_id=eq.${who.tenantId}&select=*`);
  if (!bill) throw new HttpError(404, "Bill not found");
  if (bill.etims_status === "signed") return { ok: true, already: true };
  if (["draft", "void"].includes(bill.status)) throw new HttpError(400, "Open the bill before reporting it to KRA.");
  const sup = bill.supplier_id ? await one(`suppliers?id=eq.${bill.supplier_id}&select=name,kra_pin`) : null;
  const ids = [...new Set((bill.items || []).map((l) => l.item_id).filter(Boolean))];
  const prods = ids.length ? await db(`products?tenant_id=eq.${who.tenantId}&id=in.(${ids.map(enc).join(",")})&select=id,etims_item_cd,etims_item_cls_cd,etims_tax_type,vat_rate,product_type`) : [];
  const pm = new Map((prods || []).map((p) => [p.id, p]));
  const lines = (bill.items || []).filter((l) => str(l.name) && Number(l.quantity ?? 1)).map((l) => {
    const p = l.item_id ? pm.get(l.item_id) : null;
    return { item_code: p?.etims_item_cd || null, name: str(l.name).slice(0, 200), quantity: Number(l.quantity ?? 1), unit_price: Number(l.rate ?? l.price ?? 0),
      tax_type: taxBand(p?.vat_rate ?? l.tax_rate, p?.etims_tax_type, c.vatRegistered), item_class_code: str(p?.etims_item_cls_cd) || (p?.product_type === "service" ? c.serviceCls : c.goodsCls) };
  });
  if (!lines.length) throw new HttpError(400, "The bill has no lines.");
  try {
    await hub("/v1/purchases", { method: "POST", key: c.key, body: {
      reference: str(bill.bill_number || bill.id).slice(0, 50), idempotency_key: `dash-bill-${bill.id}`, date: str(bill.bill_date).slice(0, 10) || null,
      supplier: { pin: str(sup?.kra_pin).toUpperCase() || null, name: str(sup?.name).slice(0, 60) || null, invoice_no: str(bill.reference) || null },
      payment_method: Number(bill.amount_paid || 0) >= Number(bill.amount || 0) ? "01" : "02", prices_include_tax: false, lines, kra_purchase_id: bill.etims_purchase_id || null,
    } });
    await db(`bills?id=eq.${bill.id}`, { method: "PATCH", prefer: "return=minimal", body: { etims_status: "signed", etims_error: null, etims_reported_at: new Date().toISOString() } });
    return { ok: true };
  } catch (e) {
    await db(`bills?id=eq.${bill.id}`, { method: "PATCH", prefer: "return=minimal", body: { etims_status: "failed", etims_error: str(e.message).slice(0, 400) } }).catch(() => {});
    throw e;
  }
}

/** Reports an applied inventory adjustment to KRA: stock added (06) and removed (16), with each item's new balance. */
async function reportAdjustment(who, b) {
  const c = await keyFor(who);
  const adj = await one(`inventory_adjustments?id=eq.${enc(str(b.id))}&tenant_id=eq.${who.tenantId}&select=*`);
  if (!adj) throw new HttpError(404, "Adjustment not found");
  if (adj.status !== "adjusted") throw new HttpError(400, "Convert the adjustment to adjusted first.");
  if (adj.mode !== "quantity") throw new HttpError(400, "Only quantity adjustments are reported to KRA.");
  if (adj.etims_status === "signed") return { ok: true, already: true };
  const lines = (adj.lines || []).filter((l) => l.product_id && Number(l.qty_adjusted));
  const ids = [...new Set(lines.map((l) => l.product_id))];
  const prods = ids.length ? await db(`products?tenant_id=eq.${who.tenantId}&id=in.(${ids.map(enc).join(",")})&select=id,etims_item_cd,cost_price,name`) : [];
  const pm = new Map((prods || []).map((p) => [p.id, p]));
  const missing = lines.filter((l) => !pm.get(l.product_id)?.etims_item_cd).map((l) => l.name);
  if (missing.length) throw new HttpError(400, `Register these items with KRA first: ${missing.slice(0, 5).join(", ")}`);
  const row = (l) => ({ item_code: pm.get(l.product_id).etims_item_cd, quantity: Math.abs(Number(l.qty_adjusted)), unit_price: Math.max(0, Number(l.cost ?? pm.get(l.product_id).cost_price) || 0), balance_after: Number(l.new_qty ?? 0) });
  const groups = [["06", lines.filter((l) => Number(l.qty_adjusted) > 0)], ["16", lines.filter((l) => Number(l.qty_adjusted) < 0)]];
  try {
    for (const [type, list] of groups) {
      if (!list.length) continue;
      await hub("/v1/stock/movements", { method: "POST", key: c.key, body: {
        reference: str(adj.adjustment_number || adj.id).slice(0, 50), idempotency_key: `dash-adj-${adj.id}-${type}`, type,
        date: str(adj.adjustment_date).slice(0, 10) || null, remark: str(adj.reason).slice(0, 400) || null, lines: list.map(row),
      } });
    }
    await db(`inventory_adjustments?id=eq.${adj.id}`, { method: "PATCH", prefer: "return=minimal", body: { etims_status: "signed", etims_error: null } });
    return { ok: true };
  } catch (e) {
    await db(`inventory_adjustments?id=eq.${adj.id}`, { method: "PATCH", prefer: "return=minimal", body: { etims_status: "failed", etims_error: str(e.message).slice(0, 400) } }).catch(() => {});
    throw e;
  }
}

const taxpayer = async (who, b) => hub(`/v1/taxpayers/${enc(str(b.pin).toUpperCase())}`, { key: (await keyFor(who)).key });

/**
 * Reads KRA's public receipt page (the link in the receipt QR code): SCU date, control unit
 * number, CU invoice number, internal data, receipt signature and receipt number.
 */
export async function kraReceiptDetails(url) {
  if (!/^https:\/\/etims\.kra\.go\.ke\//.test(str(url))) return null;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (JMSURF Garage)" }, signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!res?.ok) return null;
  const text = (await res.text()).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const after = (label) => new RegExp(`${label}\\s*:\\s*([^\\s][^:]*?)\\s+(?=[A-Z][A-Za-z ]{2,30}:|End of|$)`).exec(text)?.[1]?.trim() || "";
  const scu = text.slice(text.indexOf("SCU INFORMATION") >= 0 ? text.indexOf("SCU INFORMATION") : 0);
  const pick = (label) => new RegExp(`${label}\\s*:\\s*([A-Za-z0-9/:\\- ]+?)\\s{1,}(?=Control Unit|Invoice Number|Internal Data|Receipt Signature|Receipt Number|End of|$)`).exec(scu)?.[1]?.trim() || "";
  const date = /Date\s*:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/.exec(scu)?.[1] || "";
  const cu = pick("Control Unit Number") || after("Control Unit Number");
  const inv = pick("Invoice Number");
  const out = {
    signed_at: date, cu_id: cu, cu_invoice: inv, internal_data: pick("Internal Data"),
    signature: pick("Receipt Signature"), receipt_number: /Receipt Number\s*:\s*(\d+)/.exec(scu)?.[1] || "",
  };
  return out.cu_id || out.signature ? out : null;
}

/** Fills the SCU details of documents that have a KRA receipt link but no details yet (e.g. brought from Zoho). */
export async function fillFromKra(tenantId, limit = 200) {
  let filled = 0;
  for (const [table, extra] of [["invoices", ""], ["credit_notes", ""]]) {
    const docs = await db(`${table}?tenant_id=eq.${tenantId}&etims_qr_url=like.https://etims.kra.go.ke*&etims_internal_data=is.null&select=id,etims_qr_url,etims_signature&limit=${limit}${extra}`);
    for (const d of docs || []) {
      const k = await kraReceiptDetails(d.etims_qr_url);
      if (!k) continue;
      const cuNo = str(k.cu_invoice).split("/").pop()?.trim();
      await db(`${table}?id=eq.${d.id}`, { method: "PATCH", prefer: "return=minimal", body: {
        etims_status: "signed", etims_sdc_id: k.cu_id || null, etims_invc_no: cuNo || null, etims_rcpt_no: k.receipt_number || cuNo || null,
        etims_internal_data: k.internal_data || null, etims_signature: k.signature || d.etims_signature || null, etims_signed_at: k.signed_at || null,
      } });
      filled++;
    }
  }
  return filled;
}

export const etimsRoutes = {
  /** Brings the KRA SCU details for documents reported to KRA elsewhere (moved in from another system). */
  "/api/erp/etims/fill-from-kra": async (who) => ({ ok: true, filled: await fillFromKra(who.tenantId) }),
  "/api/erp/etims/notices": (who) => notices(who),
  "/api/erp/etims/kra-purchases": (who, b) => kraPurchases(who, b),
  "/api/erp/etims/kra-purchase-to-bill": (who, b) => purchaseToBill(who, b),
  "/api/erp/etims/kra-purchase-reject": (who, b) => rejectPurchase(who, b),
  "/api/erp/etims/imports": (who) => kraImports(who),
  "/api/erp/etims/import-decide": (who, b) => decideImport(who, b),
  "/api/erp/etims/report-bill": (who, b) => reportBill(who, b),
  "/api/erp/etims/taxpayer": (who, b) => taxpayer(who, b),
  "/api/erp/etims/report-adjustment": (who, b) => reportAdjustment(who, b),
  "/api/erp/etims/status": (who) => status(who),
  "/api/erp/etims/documents": (who, b) => documents(who, b),
  "/api/erp/etims/retry": (who, b) => retry(who, b),
  "/api/erp/etims/register-items": (who, b) => registerItems(who, b),
  "/api/erp/etims/register-customer": (who, b) => registerCustomer(who, b),
  "/api/erp/etims/daily-report": (who, b) => dailyReport(who, b),
  "/api/erp/etims/initialize": (who, b) => initialize(who, b),
  "/api/erp/etims/classes": (who, b) => classes(who, b),
  "/api/erp/etims/sign-invoice": (who, b) => sign(who, "invoice", str(b.id)),
  "/api/erp/etims/sign-credit-note": (who, b) => sign(who, "credit_note", str(b.id)),
};
export { HttpError as EtimsError };
