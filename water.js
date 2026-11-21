// ---------------------------------------------------------------------------
// Water refill shops: customer ordering portal + low-tank alerts.
//
// Customers of a water shop sign in on app.jmsurfgarage.co.ke/<shop>/order (or its own domain) with
// phone + password. They are NOT Supabase users: this module keeps their
// accounts and sessions (customer_accounts / customer_sessions) and reaches
// the database with the service key, scoped to the one shop and the one
// customer on every call. All routes are POST and are called on the www
// address (the shop-subdomain worker refuses POSTs to /api).
//
// POST /api/water/c/shop        { slug }                         shop + sizes
// POST /api/water/c/register    { slug, name, phone, password, lat, lng, address, landmark, email? }
// POST /api/water/c/login       { slug, phone, password }
// POST /api/water/c/logout
// POST /api/water/c/me                                            profile + totals
// POST /api/water/c/profile     { name?, email?, lat?, lng?, address?, landmark?, password?, new_password? }
// POST /api/water/c/orders                                        my orders
// POST /api/water/c/order       { items:[{product_id,quantity}], lat, lng, address, landmark, notes, save_location }
// POST /api/water/c/cancel      { order_id }
// POST /api/water/c/payments                                      my payments
// POST /api/water/c/forgot      { slug, phone }                   SMS reset code
// POST /api/water/c/reset       { slug, phone, code, password }
// POST /api/water/c/tickets                                       my support tickets + messages
// POST /api/water/c/ticket      { subject, body, category?, order_id? }   open a ticket
// POST /api/water/c/ticket-reply { ticket_id, body }
// POST /api/water/c/ticket-read  { ticket_id }
//
// Customer requests carry "Authorization: Customer <token>".
//
// Alerts: every minute, unsent low-tank notifications are emailed (and texted
// when the shop has SMS) to the shop's contact.
// ---------------------------------------------------------------------------
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash, randomInt } from "node:crypto";
import { promisify } from "node:util";
import { sendForShop } from "./messaging.js";

const scrypt = promisify(scryptCb);

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";

const SESSION_DAYS = 30;
const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const enc = encodeURIComponent;

export const isWaterRoute = (pathname) => pathname.startsWith("/api/water/");

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function db(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(15000),
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    // Messages raised by our own SQL functions are written for customers.
    const msg = str(data?.message);
    const e = new HttpError(res.status >= 500 ? 500 : 400, data?.code === "P0001" && msg ? msg : `Database error (${res.status})`);
    e.code = data?.code;
    if (res.status >= 500 || data?.code !== "P0001") console.error("[water] db", path.split("?")[0], res.status, msg);
    throw e;
  }
  return data;
}
const one = async (path) => ((await db(path)) || [])[0] || null;
const rpc = (fn, args) => db(`rpc/${fn}`, { method: "POST", body: args });

// --- phone numbers ------------------------------------------------------------

/** Digits in international form; local 0XXXXXXXXX numbers use the shop's country code. */
function phoneDigits(raw, cc = "254") {
  let d = str(raw).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = cc + d.slice(1);
  else if (d.length === 9 && cc === "254") d = cc + d;
  return /^\d{9,15}$/.test(d) ? d : "";
}
/** Ways the same number may already be saved on the shop's customer list. */
function phoneVariants(intl, cc) {
  const local = intl.startsWith(cc) ? `0${intl.slice(cc.length)}` : null;
  return [...new Set([intl, `+${intl}`, local].filter(Boolean))];
}

const COUNTRY_CODES = { KE: "254", UG: "256", TZ: "255", RW: "250", ET: "251", SO: "252", NG: "234", GH: "233", ZA: "27", ZM: "260", MW: "265", ZW: "263", MZ: "258", CD: "243", SS: "211", BI: "257", CM: "237", CI: "225", SN: "221", BW: "267", NA: "264" };

// --- passwords + sessions --------------------------------------------------------

async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
async function checkPassword(pw, stored) {
  const [kind, salt, hash] = str(stored).split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), want.length);
  return want.length === got.length && timingSafeEqual(want, got);
}
const sha = (s) => createHash("sha256").update(s).digest("hex");

async function newSession(accountId) {
  const token = randomBytes(32).toString("base64url");
  await db("customer_sessions", {
    method: "POST",
    body: { token_hash: sha(token), account_id: accountId, expires_at: new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString() },
  });
  return token;
}

/** The signed-in customer: account, customer row and shop. */
async function customer(req) {
  const h = str(req.headers["authorization"]);
  if (!h.startsWith("Customer ")) throw new HttpError(401, "Sign in first");
  const token = h.slice(9).trim();
  if (token.length < 20) throw new HttpError(401, "Sign in first");
  const s = await one(`customer_sessions?token_hash=eq.${sha(token)}&select=account_id,expires_at`);
  if (!s || new Date(s.expires_at) < new Date()) throw new HttpError(401, "Your session ended. Sign in again.");
  const acc = await one(`customer_accounts?id=eq.${s.account_id}&is_active=eq.true&select=id,tenant_id,customer_id,phone`);
  if (!acc) throw new HttpError(401, "Sign in first");
  const shop = await shopById(acc.tenant_id);
  if (!shop) throw new HttpError(403, "This shop is not taking orders");
  return { token, account: acc, shop };
}

// --- shops -------------------------------------------------------------------

async function shopRow(filter) {
  const t = await one(`tenants?${filter}&is_active=eq.true&deleted_at=is.null&select=id,slug,business_name,business_phone,contact_phone,contact_email,business_email,logo_url,business_type`);
  if (!t || t.business_type !== "water") return null;
  const s = await one(`business_settings?tenant_id=eq.${t.id}&select=currency,country,payment_provider`);
  return { ...t, currency: s?.currency || "KES", country: s?.country || "KE", cc: COUNTRY_CODES[s?.country] || "254" };
}
const shopById = (id) => shopRow(`id=eq.${enc(id)}`);
async function shopBySlug(slug) {
  const s = str(slug).toLowerCase();
  if (!/^[a-z0-9-]{2,63}$/.test(s)) throw new HttpError(404, "Shop not found");
  const shop = await shopRow(`slug=eq.${enc(s)}`);
  if (!shop) throw new HttpError(404, "This shop does not take water orders online");
  return shop;
}
const publicShop = (s) => ({
  name: s.business_name, slug: s.slug, logo_url: s.logo_url, currency: s.currency, country: s.country,
  phone: s.business_phone || s.contact_phone || null,
});

/** Refill sizes and empty containers (bottles, jerricans) customers can order. */
async function catalogue(tenantId) {
  const rows = await db(`products?tenant_id=eq.${tenantId}&is_active=eq.true&or=(litres.not.is.null,container_litres.not.is.null)` +
    `&select=id,name,price,litres,container_litres,image_url&order=name.asc`);
  return (rows || []).map((p) => ({
    id: p.id, name: p.name, price: Number(p.price), image_url: p.image_url,
    litres: p.litres == null ? null : Number(p.litres),
    container_litres: p.container_litres == null ? null : Number(p.container_litres),
  })).sort((a, b) => (a.litres ?? a.container_litres ?? 0) - (b.litres ?? b.container_litres ?? 0));
}

// --- rate limits (per process) -----------------------------------------------------

const hits = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 20000) hits.clear();
}
const ipOf = (req) => str(req.headers["cf-connecting-ip"]) || str(req.headers["x-forwarded-for"]).split(",").pop()?.trim() || req.socket?.remoteAddress || "?";

// --- location -------------------------------------------------------------------

function location(body, required) {
  const lat = Number(body.lat), lng = Number(body.lng);
  const ok = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  if (!ok && required) throw new HttpError(400, "Pin your delivery location on the map");
  return ok ? { lat, lng } : null;
}
const clip = (v, n) => str(v).slice(0, n) || null;

// --- handlers -------------------------------------------------------------------

async function register(req, b) {
  limit(`reg:${ipOf(req)}`, 8, 3600_000);
  const shop = await shopBySlug(b.slug);
  const name = clip(b.name, 120);
  const phone = phoneDigits(b.phone, shop.cc);
  const pw = String(b.password || "");
  const email = str(b.email).toLowerCase();
  if (!name) throw new HttpError(400, "Enter your name");
  if (!phone) throw new HttpError(400, "Enter a valid phone number");
  if (pw.length < 6 || pw.length > 200) throw new HttpError(400, "Use a password of at least 6 characters");
  if (email && !EMAIL.test(email)) throw new HttpError(400, "That email address is not valid");
  const loc = location(b, true);

  if (await one(`customer_accounts?tenant_id=eq.${shop.id}&phone=eq.${phone}&select=id`)) {
    throw new HttpError(409, "This phone number already has an account. Sign in instead.");
  }
  // One phone number, one account: not a staff login, not a customer of another shop.
  if ((await db("rpc/phone_taken", { method: "POST", body: { p_phone: phone } })) === true) {
    throw new HttpError(409, "This phone number already belongs to another account. Use a different number.");
  }
  // Reuse the shop's existing customer with this number, else add one.
  const variants = phoneVariants(phone, shop.cc).map((v) => `"${v}"`).join(",");
  let cust = await one(`customers?tenant_id=eq.${shop.id}&phone=in.(${enc(variants)})&select=id&order=created_at.asc`);
  const altPhone = b.alt_phone ? phoneDigits(b.alt_phone, shop.cc) : "";
  if (b.alt_phone && !altPhone) throw new HttpError(400, "The other phone number is not valid");
  if (!str(b.area)) throw new HttpError(400, "Enter your estate or area");
  if (!str(b.building)) throw new HttpError(400, "Enter your house, apartment or building");
  const details = {
    name, lat: loc.lat, lng: loc.lng,
    area: clip(b.area, 120), building: clip(b.building, 160), landmark: clip(b.landmark, 300),
    address: clip([b.area, b.building, b.address].map(str).filter(Boolean).join(", "), 300),
    delivery_notes: clip(b.delivery_notes, 500), alt_phone: altPhone ? `+${altPhone}` : null,
    ...(email ? { email } : {}),
  };
  if (cust) {
    if (await one(`customer_accounts?customer_id=eq.${cust.id}&select=id`)) {
      throw new HttpError(409, "This phone number already has an account. Sign in instead.");
    }
    await db(`customers?id=eq.${cust.id}`, { method: "PATCH", body: details });
  } else {
    [cust] = await db("customers", { method: "POST", prefer: "return=representation", body: { ...details, phone: phone.startsWith(shop.cc) ? `0${phone.slice(shop.cc.length)}` : `+${phone}`, tenant_id: shop.id } });
  }
  const [acc] = await db("customer_accounts", {
    method: "POST", prefer: "return=representation",
    body: { tenant_id: shop.id, customer_id: cust.id, phone, password_hash: await hashPassword(pw) },
  });
  return { token: await newSession(acc.id), shop: publicShop(shop) };
}

async function login(req, b) {
  const shop = await shopBySlug(b.slug);
  const phone = phoneDigits(b.phone, shop.cc);
  limit(`login:${ipOf(req)}`, 20, 900_000);
  limit(`login:${shop.id}:${phone}`, 8, 900_000);
  const acc = phone && await one(`customer_accounts?tenant_id=eq.${shop.id}&phone=eq.${phone}&select=id,password_hash,is_active,locked_until,failed_logins`);
  if (acc?.locked_until && new Date(acc.locked_until) > new Date()) throw new HttpError(429, "Too many wrong passwords. Try again in 15 minutes.");
  const ok = acc && acc.is_active && await checkPassword(String(b.password || ""), acc.password_hash);
  if (!ok) {
    if (acc) {
      const n = (acc.failed_logins || 0) + 1;
      await db(`customer_accounts?id=eq.${acc.id}`, { method: "PATCH", body: { failed_logins: n >= 8 ? 0 : n, ...(n >= 8 ? { locked_until: new Date(Date.now() + 900_000).toISOString() } : {}) } });
    }
    throw new HttpError(401, "Wrong phone number or password");
  }
  await db(`customer_accounts?id=eq.${acc.id}`, { method: "PATCH", body: { failed_logins: 0, locked_until: null, last_login_at: new Date().toISOString() } });
  return { token: await newSession(acc.id), shop: publicShop(shop) };
}

async function me(req) {
  const { account, shop } = await customer(req);
  const [c, orders] = await Promise.all([
    one(`customers?id=eq.${account.customer_id}&select=id,name,phone,alt_phone,email,lat,lng,address,area,building,landmark,delivery_notes,balance,created_at`),
    db(`water_orders?customer_id=eq.${account.customer_id}&tenant_id=eq.${shop.id}&select=status,total,litres_total`),
  ]);
  const live = (orders || []).filter((o) => o.status !== "cancelled");
  return {
    shop: publicShop(shop),
    customer: c,
    totals: {
      orders: live.length,
      litres: live.reduce((a, o) => a + Number(o.litres_total || 0), 0),
      ordered: live.reduce((a, o) => a + Number(o.total || 0), 0),
      paid: live.filter((o) => o.status === "paid").reduce((a, o) => a + Number(o.total || 0), 0),
      open: live.filter((o) => o.status !== "paid").length,
    },
    sizes: await catalogue(shop.id),
  };
}

async function profile(req, b) {
  const { account } = await customer(req);
  const patch = {};
  if (b.name !== undefined) { if (!str(b.name)) throw new HttpError(400, "Enter your name"); patch.name = clip(b.name, 120); }
  if (b.email !== undefined) {
    const e = str(b.email).toLowerCase();
    if (e && !EMAIL.test(e)) throw new HttpError(400, "That email address is not valid");
    patch.email = e || null;
  }
  if (b.lat !== undefined || b.lng !== undefined) Object.assign(patch, location(b, true));
  if (b.address !== undefined) patch.address = clip(b.address, 300);
  if (b.landmark !== undefined) patch.landmark = clip(b.landmark, 300);
  if (b.area !== undefined) patch.area = clip(b.area, 120);
  if (b.building !== undefined) patch.building = clip(b.building, 160);
  if (b.delivery_notes !== undefined) patch.delivery_notes = clip(b.delivery_notes, 500);
  if (b.alt_phone !== undefined) {
    if (!str(b.alt_phone)) patch.alt_phone = null;
    else { const d = phoneDigits(b.alt_phone, (await shopById(account.tenant_id))?.cc); if (!d) throw new HttpError(400, "The other phone number is not valid"); patch.alt_phone = `+${d}`; }
  }
  if (b.area !== undefined || b.building !== undefined) patch.address = clip([b.area, b.building].map(str).filter(Boolean).join(", "), 300);
  if (Object.keys(patch).length) await db(`customers?id=eq.${account.customer_id}`, { method: "PATCH", body: patch });
  if (b.new_password) {
    const acc = await one(`customer_accounts?id=eq.${account.id}&select=password_hash`);
    if (!(await checkPassword(String(b.password || ""), acc.password_hash))) throw new HttpError(400, "Your current password is wrong");
    if (String(b.new_password).length < 6) throw new HttpError(400, "Use a password of at least 6 characters");
    await db(`customer_accounts?id=eq.${account.id}`, { method: "PATCH", body: { password_hash: await hashPassword(String(b.new_password)) } });
    await db(`customer_sessions?account_id=eq.${account.id}&token_hash=neq.${sha(customerToken(req))}`, { method: "DELETE" });
  }
  return { ok: true };
}
const customerToken = (req) => str(req.headers["authorization"]).slice(9).trim();

async function orders(req) {
  const { account, shop } = await customer(req);
  const rows = await db(`water_orders?customer_id=eq.${account.customer_id}&tenant_id=eq.${shop.id}` +
    `&select=id,order_no,items,total,litres_total,status,lat,lng,address,landmark,notes,rider_name,rider_lat,rider_lng,rider_seen_at,payment_method,created_at,accepted_at,assigned_at,picked_at,delivered_at,paid_at,cancelled_at,cancel_reason` +
    `&order=created_at.desc&limit=100`);
  const live = ["assigned", "on_the_way", "delivered"];
  return {
    orders: (rows || []).map((o) => {
      const fresh = o.rider_seen_at && Date.now() - Date.parse(o.rider_seen_at) < 30 * 60_000;
      if (live.includes(o.status) && fresh) return o;
      return { ...o, rider_lat: null, rider_lng: null, rider_seen_at: null };
    }),
  };
}

async function placeOrder(req, b) {
  const { account, shop } = await customer(req);
  limit(`order:${account.id}`, 20, 3600_000);
  const c = await one(`customers?id=eq.${account.customer_id}&select=lat,lng,address,landmark,delivery_notes`);
  const loc = location(b, false) || (c?.lat != null ? { lat: c.lat, lng: c.lng } : null);
  if (!loc) throw new HttpError(400, "Pin your delivery location on the map");
  const items = (Array.isArray(b.items) ? b.items : [])
    .filter((i) => UUID.test(str(i?.product_id)) && Number.isInteger(Number(i?.quantity)) && Number(i.quantity) > 0)
    .map((i) => ({ product_id: str(i.product_id), quantity: Number(i.quantity) }));
  if (!items.length) throw new HttpError(400, "Choose what you want delivered");
  const address = b.address !== undefined ? b.address : c?.address;
  const landmark = b.landmark !== undefined ? b.landmark : c?.landmark;
  const order = await rpc("water_place_order", {
    p_tenant: shop.id, p_customer: account.customer_id, p_items: items,
    p_lat: loc.lat, p_lng: loc.lng, p_address: str(address), p_landmark: str(landmark), p_notes: [str(b.notes), str(c?.delivery_notes)].filter(Boolean).join(" · "),
  });
  if (b.save_location && location(b, false)) {
    await db(`customers?id=eq.${account.customer_id}`, { method: "PATCH", body: { lat: loc.lat, lng: loc.lng, address: clip(address, 300), landmark: clip(landmark, 300) } });
  }
  return { order };
}

async function cancel(req, b) {
  const { account } = await customer(req);
  if (!UUID.test(str(b.order_id))) throw new HttpError(400, "Order not found");
  return { order: await rpc("water_customer_cancel", { p_order: str(b.order_id), p_customer: account.customer_id }) };
}

async function payments(req) {
  const { account, shop } = await customer(req);
  const [sales, ledger] = await Promise.all([
    db(`transactions?customer_id=eq.${account.customer_id}&tenant_id=eq.${shop.id}&status=in.(completed,refunded)` +
      `&select=id,created_at,total,payment_method,items,status&order=created_at.desc&limit=200`),
    db(`customer_payments?customer_id=eq.${account.customer_id}&kind=eq.payment&tenant_id=eq.${shop.id}&select=id,created_at,amount,method,note&order=created_at.desc&limit=200`).catch(() => []),
  ]);
  const list = [
    ...(sales || []).map((s) => ({
      id: s.id, at: s.created_at, amount: Number(s.total), method: s.payment_method, status: s.status,
      what: (Array.isArray(s.items) ? s.items : []).map((i) => `${i.quantity} × ${i.name}`).join(", "),
    })),
    ...(ledger || []).map((p) => ({ id: p.id, at: p.created_at, amount: Number(p.amount), method: p.method || "payment", status: "completed", what: p.note ? `Account payment · ${p.note}` : "Account payment" })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { payments: list, total: list.filter((p) => p.status === "completed").reduce((a, p) => a + p.amount, 0) };
}

// --- support tickets ---------------------------------------------------------------

const TICKET_COLS = "id,ticket_no,subject,category,status,priority,order_id,created_at,last_message_at,last_message_by,unread_by_requester,resolved_at";

async function tickets(req) {
  const { account, shop } = await customer(req);
  const rows = await db(`support_tickets?customer_id=eq.${account.customer_id}&tenant_id=eq.${shop.id}&source=eq.customer` +
    `&select=${TICKET_COLS}&order=last_message_at.desc&limit=50`);
  const ids = (rows || []).map((t) => t.id);
  const msgs = ids.length
    ? await db(`support_ticket_messages?ticket_id=in.(${ids.join(",")})&internal=eq.false&select=id,ticket_id,author_kind,author_name,body,created_at&order=created_at.asc&limit=2000`)
    : [];
  return {
    tickets: (rows || []).map((t) => ({
      ...t,
      messages: (msgs || []).filter((m) => m.ticket_id === t.id).map((m) => ({
        id: m.id, from: m.author_kind, at: m.created_at, body: m.body,
        name: m.author_kind === "customer" ? m.author_name : (m.author_name || shop.business_name),
      })),
    })),
  };
}

async function openTicket(req, b) {
  const { account, shop } = await customer(req);
  limit(`ticket:${account.id}`, 10, 3600_000);
  const order = UUID.test(str(b.order_id)) ? str(b.order_id) : null;
  return {
    ticket: await rpc("ticket_customer_open", {
      p_tenant: shop.id, p_customer: account.customer_id, p_subject: clip(b.subject, 150), p_body: clip(b.body, 4000),
      p_category: clip(b.category, 40) || "general", p_order: order,
    }),
  };
}

async function replyTicket(req, b) {
  const { account } = await customer(req);
  limit(`ticket-reply:${account.id}`, 60, 3600_000);
  if (!UUID.test(str(b.ticket_id))) throw new HttpError(400, "Ticket not found");
  return { ticket: await rpc("ticket_customer_reply", { p_ticket: str(b.ticket_id), p_customer: account.customer_id, p_body: clip(b.body, 4000) }) };
}

async function readTicket(req, b) {
  const { account } = await customer(req);
  if (UUID.test(str(b.ticket_id))) {
    await db(`support_tickets?id=eq.${str(b.ticket_id)}&customer_id=eq.${account.customer_id}&unread_by_requester=eq.true`,
      { method: "PATCH", body: { unread_by_requester: false } });
  }
  return { ok: true };
}

async function forgot(req, b) {
  limit(`forgot:${ipOf(req)}`, 5, 3600_000);
  const shop = await shopBySlug(b.slug);
  const phone = phoneDigits(b.phone, shop.cc);
  const acc = phone && await one(`customer_accounts?tenant_id=eq.${shop.id}&phone=eq.${phone}&is_active=eq.true&select=id`);
  // Same answer whether or not the number exists.
  if (acc) {
    limit(`forgot:${acc.id}`, 3, 3600_000);
    const code = String(randomInt(100000, 1000000));
    await db(`customer_accounts?id=eq.${acc.id}`, { method: "PATCH", body: { reset_code_hash: sha(`${acc.id}:${code}`), reset_expires_at: new Date(Date.now() + 15 * 60_000).toISOString() } });
    const sent = await sendForShop({ tenantId: shop.id, channel: "sms", to: phone, text: `${shop.business_name}: your password reset code is ${code}. It expires in 15 minutes.` }).catch((e) => ({ ok: false, error: e.message }));
    if (!sent?.ok) {
      console.warn("[water] reset SMS not sent", shop.id, sent?.error);
      return { ok: false, error: `We could not send a code by SMS. Call ${shop.business_phone || shop.contact_phone || "the shop"} to reset your password.` };
    }
  }
  return { ok: true };
}

async function reset(req, b) {
  const shop = await shopBySlug(b.slug);
  const phone = phoneDigits(b.phone, shop.cc);
  limit(`reset:${ipOf(req)}`, 10, 3600_000);
  const acc = phone && await one(`customer_accounts?tenant_id=eq.${shop.id}&phone=eq.${phone}&select=id,reset_code_hash,reset_expires_at`);
  const code = str(b.code);
  if (!acc || !acc.reset_code_hash || new Date(acc.reset_expires_at) < new Date() || sha(`${acc.id}:${code}`) !== acc.reset_code_hash) {
    throw new HttpError(400, "That code is wrong or has expired");
  }
  if (String(b.password || "").length < 6) throw new HttpError(400, "Use a password of at least 6 characters");
  await db(`customer_accounts?id=eq.${acc.id}`, { method: "PATCH", body: { password_hash: await hashPassword(String(b.password)), reset_code_hash: null, reset_expires_at: null, failed_logins: 0, locked_until: null } });
  await db(`customer_sessions?account_id=eq.${acc.id}`, { method: "DELETE" });
  return { token: await newSession(acc.id), shop: publicShop(shop) };
}

const ROUTES = {
  "/api/water/c/shop": async (req, b) => {
    const s = await shopBySlug(b.slug);
    const [sizes, site] = await Promise.all([
      catalogue(s.id),
      one(`shop_sites?tenant_id=eq.${s.id}&select=content,published`).catch(() => null),
    ]);
    return { shop: publicShop(s), sizes, site: site?.published ? site.content : null, site_off: site ? !site.published : false };
  },
  "/api/water/c/register": register,
  "/api/water/c/login": login,
  "/api/water/c/logout": async (req) => { const t = customerToken(req); if (t) await db(`customer_sessions?token_hash=eq.${sha(t)}`, { method: "DELETE" }); return { ok: true }; },
  "/api/water/c/me": me,
  "/api/water/c/profile": profile,
  "/api/water/c/orders": orders,
  "/api/water/c/order": placeOrder,
  "/api/water/c/cancel": cancel,
  "/api/water/c/payments": payments,
  "/api/water/c/forgot": forgot,
  "/api/water/c/reset": reset,
  "/api/water/c/tickets": tickets,
  "/api/water/c/ticket": openTicket,
  "/api/water/c/ticket-reply": replyTicket,
  "/api/water/c/ticket-read": readTicket,
};

export async function handleWaterRequest(req, res, pathname, body, sendJson) {
  const fn = ROUTES[pathname];
  if (!fn) return sendJson(res, 404, { error: "Unknown route" });
  if (!SUPABASE_URL || !SERVICE_KEY) return sendJson(res, 503, { error: "Ordering is not available right now" });
  try {
    return sendJson(res, 200, await fn(req, body || {}));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("[water]", pathname, e);
    return sendJson(res, status, { error: status === 500 ? "Something went wrong. Try again." : e.message });
  }
}

// --- low-tank alerts --------------------------------------------------------------

let sendEmail = null;

async function sendAlerts() {
  const rows = await db(`shop_notifications?sent_at=is.null&kind=eq.tank_low&select=id,tenant_id,title,body&order=created_at.asc&limit=25`).catch(() => null);
  for (const n of rows || []) {
    // Claim it first so two servers never send the same alert.
    const claimed = await db(`shop_notifications?id=eq.${n.id}&sent_at=is.null`, { method: "PATCH", prefer: "return=representation", body: { sent_at: new Date().toISOString() } }).catch(() => []);
    if (!claimed?.length) continue;
    const t = await one(`tenants?id=eq.${n.tenant_id}&select=business_name,contact_name,contact_email,business_email,contact_phone,business_phone`).catch(() => null);
    if (!t) continue;
    const to = str(t.contact_email) || str(t.business_email);
    if (to && sendEmail) {
      const text = `${n.title}\n\n${n.body}\n\nOpen Water → Tanks in JMSURF Garage to record the refill.`;
      await sendEmail({ to, subject: `${t.business_name}: ${n.title}`, text, html: `<p><b>${esc(n.title)}</b></p><p>${esc(n.body)}</p><p>Open <b>Water → Tanks</b> in JMSURF Garage to record the refill.</p>` })
        .catch((e) => console.warn("[water] alert email failed", n.tenant_id, e?.message));
    }
    const phone = str(t.contact_phone) || str(t.business_phone);
    if (phone) {
      await sendForShop({ tenantId: n.tenant_id, channel: "sms", to: phone, text: `${t.business_name}: ${n.title}. ${n.body}` })
        .catch(() => undefined);
    }
  }
}
const esc = (s) => str(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function startWaterAlerts(deliverEmail) {
  sendEmail = deliverEmail;
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  const tick = () => sendAlerts().catch((e) => console.warn("[water] alerts", e?.message));
  setTimeout(tick, 20_000);
  setInterval(tick, 60_000).unref?.();
  // Expired customer sessions.
  setInterval(() => db(`customer_sessions?expires_at=lt.${new Date().toISOString()}`, { method: "DELETE" }).catch(() => undefined), 6 * 3600_000).unref?.();
}
