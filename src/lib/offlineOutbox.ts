/**
 * Offline mode for the whole system.
 *
 * Every database call of the app goes through `offlineFetch` (the Supabase client's fetch):
 *  - Reads work as before. When the network is down they come from the device (service worker cache), and
 *    changes made offline are laid over them, so a customer added offline shows in the customer list.
 *  - Writes (add / edit / delete) made offline, or when the connection drops mid-way, are kept in an outbox
 *    on the device (IndexedDB) and the screen gets an immediate "saved" answer. New rows get their id here so
 *    the screen can open them at once and later changes point at the same row.
 *  - Document numbers asked for offline (INV-, QT-, PO-…) get a provisional number (e.g. INV-OFF-7K2Q); when
 *    the outbox is sent, each one is swapped for the real next number, everywhere it was used.
 *  - Other server actions (payments, M-Pesa, stock receives…) need the server: offline they answer with a
 *    clear "needs the internet" message instead of failing silently.
 *  - Back online, the outbox is sent in order. Rejected changes stay listed (with the reason) to retry or discard.
 */

const DB = "dash_outbox";
const STORE = "outbox";
const META = "meta";

export type OutboxItem = {
  seq?: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  table: string;
  kind: "insert" | "update" | "delete" | "upsert";
  ids: string[];
  createdAt: number;
  tries: number;
  status: "pending" | "failed";
  error?: string | null;
  label: string;
};

const realFetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init);
let tokenGetter: (() => Promise<string | null>) | null = null;
/** The Supabase client registers how to get a fresh sign-in token for sending the outbox. */
export function setOutboxTokenGetter(fn: () => Promise<string | null>) { tokenGetter = fn; }
/**
 * Work that must never be replayed later (a move-in import): while it runs, writes go straight to the server.
 * A queued write whose first try did reach the server would otherwise be sent again and saved twice.
 */
let bypass = 0;
export async function withoutOutbox<T>(fn: () => Promise<T>): Promise<T> {
  bypass++;
  try { return await fn(); } finally { bypass--; }
}
let guard: (() => Promise<boolean>) | null = null;
/**
 * One login can belong to several companies, and saved rows land in the company that is active when they are
 * sent. The app registers a check that the active company is still the one this address belongs to; while it is
 * not (another tab switched company), waiting changes are held back instead of going into the wrong company.
 */
export function setOutboxGuard(fn: () => Promise<boolean>) { guard = fn; }

// ------------------------------------------------------------------ storage
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "seq", autoIncrement: true });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out: T;
      Promise.resolve(fn(t)).then((v) => { out = v; }, reject);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}
const req2p = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function outboxItems(): Promise<OutboxItem[]> {
  try { return await tx([STORE], "readonly", (t) => req2p(t.objectStore(STORE).getAll() as IDBRequest<OutboxItem[]>)); } catch { return []; }
}
async function addItem(item: OutboxItem) { await tx([STORE], "readwrite", (t) => { t.objectStore(STORE).add(item); }); }
async function putItem(item: OutboxItem) { await tx([STORE], "readwrite", (t) => { t.objectStore(STORE).put(item); }); }
async function delItem(seq: number) { await tx([STORE], "readwrite", (t) => { t.objectStore(STORE).delete(seq); }); }
async function getMeta<T>(key: string): Promise<T | undefined> { try { return await tx([META], "readonly", (t) => req2p(t.objectStore(META).get(key))); } catch { return undefined; } }
async function setMeta(key: string, v: unknown) { await tx([META], "readwrite", (t) => { t.objectStore(META).put(v, key); }); }

// ------------------------------------------------------------------ status for the screen
type Status = { pending: number; failed: number; syncing: boolean; online: boolean; held: boolean };
let status: Status = { pending: 0, failed: 0, syncing: false, held: false, online: typeof navigator === "undefined" ? true : navigator.onLine };
const listeners = new Set<(s: Status) => void>();
export function onOutboxStatus(fn: (s: Status) => void) { listeners.add(fn); fn(status); return () => { listeners.delete(fn); }; }
export function outboxStatus() { return status; }
async function refreshStatus(patch: Partial<Status> = {}) {
  const all = await outboxItems();
  status = { ...status, ...patch, pending: all.filter((i) => i.status === "pending").length, failed: all.filter((i) => i.status === "failed").length };
  for (const l of listeners) l(status);
}

// ------------------------------------------------------------------ helpers
const uuid = () => (crypto as any).randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c: any) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
const isNetworkError = (e: unknown) => e instanceof TypeError || (e as any)?.name === "AbortError" || /network|fetch|load failed/i.test(String((e as any)?.message || ""));
function headersOf(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(h || {}).forEach((v, k) => { out[k.toLowerCase()] = v; });
  return out;
}
function parseRest(urlStr: string) {
  const u = new URL(urlStr, location.origin);
  const m = u.pathname.match(/\/rest\/v1\/(rpc\/)?([^/?]+)/);
  return { u, rpc: !!m?.[1], name: m?.[2] || "" };
}
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(data === null ? null : JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...extra } });
const wantsObject = (h: Record<string, string>) => String(h.accept || "").includes("vnd.pgrst.object");

/** Simple PostgREST filters (col=eq.x, is.null, in.(a,b)) on a row; others are ignored (row kept). */
function matches(row: any, params: URLSearchParams) {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns", "or", "and"].includes(k)) continue;
    const val = row?.[k];
    if (v.startsWith("eq.")) { if (val === undefined) continue; if (String(val) !== v.slice(3)) return false; }
    else if (v === "is.null") { if (val !== undefined && val !== null) return false; }
    else if (v.startsWith("in.(")) { if (val === undefined) continue; const set = v.slice(4, -1).split(",").map((x) => x.replace(/^"|"$/g, "")); if (!set.includes(String(val))) return false; }
    else if (v.startsWith("neq.")) { if (val !== undefined && String(val) === v.slice(4)) return false; }
  }
  return true;
}
const idFilter = (params: URLSearchParams) => { const v = params.get("id"); return v?.startsWith("eq.") ? [v.slice(3)] : v?.startsWith("in.(") ? v.slice(4, -1).split(",") : []; };

const DOC_PREFIX: Record<string, string> = {
  quote: "QT-", invoice: "INV-", payment: "PR-", receipt: "SR-", credit_note: "CN-", po: "PO-", bill: "BILL-", requisition: "REQ-", delivery_note: "DN-", packing_list: "PL-",
  sales_order: "SO-", package: "PKG-", shipment: "SHP-", rfq: "RFQ-", payment_made: "PM-", journal: "JV-",
  lead: "LD-", web_order: "WEB-", employee: "EMP-", payroll: "PAY-", purchase_receive: "GRN-", expense: "EXP-", supplier_payment: "SP-", adjustment: "ADJ-", deal: "DEAL-", vendor_credit: "VC-", enquiry: "ENQ-",
};
const PLACEHOLDER = /\b[A-Z]{2,5}-OFF-[0-9A-Z]{5}\b/g;

// ------------------------------------------------------------------ the fetch
/** Supabase client fetch with offline reads, queued writes and the outbox laid over reads. */
export async function offlineFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/rest/v1/") || bypass > 0) return realFetch(input, init);
  const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const { u, rpc, name } = parseRest(url);
  const headers = headersOf(init.headers);

  if (method === "GET" || method === "HEAD") return readWithOutbox(input, init, u, name, headers);

  // A write while changes are still waiting: send those first so the order stays right.
  if (navigator.onLine && status.pending > 0 && !draining) await drainOutbox().catch(() => undefined);
  if (navigator.onLine && !(status.pending > 0)) {
    try { return await realFetch(input, init); }
    catch (e) { if (!isNetworkError(e)) throw e; /* dropped connection: keep it below */ }
  }

  if (rpc) {
    if (name === "next_doc_number" || name === "peek_doc_number") {
      let kind = "";
      try { kind = String(JSON.parse(String(init.body || "{}")).p_kind || ""); } catch { /* no body */ }
      const ph = `${(DOC_PREFIX[kind] || `${kind.slice(0, 3).toUpperCase()}-`).replace(/-$/, "")}-OFF-${Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, "X")}`;
      if (name === "next_doc_number") { const map = (await getMeta<Record<string, string>>("docnums")) || {}; map[ph] = kind; await setMeta("docnums", map); }
      return json(ph);
    }
    return json({ message: "You are offline. This needs the internet; it is not saved. Try again when you are back online.", code: "OFFLINE", hint: "offline" }, 503);
  }

  // Queue the change.
  const body = typeof init.body === "string" ? init.body : null;
  const prefer = String(headers.prefer || "");
  let rows: any[] = [];
  let kind: OutboxItem["kind"] = method === "DELETE" ? "delete" : method === "PATCH" ? "update" : prefer.includes("resolution=merge-duplicates") ? "upsert" : "insert";
  let outBody = body;
  if (method === "POST" && body) {
    try {
      const parsed = JSON.parse(body);
      rows = (Array.isArray(parsed) ? parsed : [parsed]).map((r) => (r && typeof r === "object" && !r.id ? { ...r, id: uuid() } : r));
      outBody = JSON.stringify(Array.isArray(parsed) ? rows : rows[0]);
      // supabase-js names the columns in ?columns= — the new id must be among them.
      if (u.searchParams.has("columns") && !u.searchParams.get("columns")!.split(",").map((c) => c.replace(/"/g, "")).includes("id")) u.searchParams.set("columns", `${u.searchParams.get("columns")},"id"`);
    } catch { /* not JSON: send as is */ }
  }
  let patch: any = null;
  if (method === "PATCH" && body) { try { patch = JSON.parse(body); } catch { /* ignore */ } }
  const ids = method === "POST" ? rows.map((r) => r?.id).filter(Boolean) : idFilter(u.searchParams);
  const item: OutboxItem = {
    url: u.href, method, headers: Object.fromEntries(Object.entries(headers).filter(([k]) => k !== "authorization")), body: outBody,
    table: name, kind, ids, createdAt: Date.now(), tries: 0, status: "pending",
    label: `${kind === "insert" ? "New" : kind === "delete" ? "Delete" : "Change"} ${name.replace(/_/g, " ")}`,
  };
  await addItem(item);
  void refreshStatus();
  scheduleDrain();

  // The answer supabase-js expects.
  if (!prefer.includes("return=representation")) return new Response(null, { status: method === "POST" ? 201 : 204 });
  let out: any[] = [];
  if (method === "POST") out = rows;
  else if (method === "PATCH") out = (ids.length ? ids : [undefined]).map((id) => ({ ...(patch || {}), ...(id ? { id } : {}) }));
  else out = ids.map((id) => ({ id }));
  return wantsObject(headers) ? json(out[0] ?? null, out[0] ? 200 : 406) : json(out, 200);
}

async function pendingFor(table: string) {
  if (!status.pending && !status.failed) return [];
  return (await outboxItems()).filter((i) => i.table === table && i.status === "pending");
}

/** Overlays the waiting changes of a table on a read (new rows, edits, deletions). */
function overlay(rows: any[], items: OutboxItem[], params: URLSearchParams) {
  let list = [...rows];
  for (const it of items) {
    let body: any = null;
    try { body = it.body ? JSON.parse(it.body) : null; } catch { /* ignore */ }
    if (it.kind === "insert" || it.kind === "upsert") {
      for (const r of Array.isArray(body) ? body : [body]) {
        if (!r) continue;
        const i = list.findIndex((x) => x?.id === r.id);
        if (i >= 0) list[i] = { ...list[i], ...r };
        else if (matches(r, params)) list = [r, ...list];
      }
    } else if (it.kind === "update" && body) {
      list = list.map((x) => (it.ids.includes(x?.id) ? { ...x, ...body } : x));
    } else if (it.kind === "delete") {
      list = list.filter((x) => !it.ids.includes(x?.id));
    }
  }
  return list.filter((r) => matches(r, params) || rows.includes(r));
}

async function readWithOutbox(input: RequestInfo | URL, init: RequestInit, u: URL, table: string, headers: Record<string, string>): Promise<Response> {
  let res: Response | null = null;
  try { res = await realFetch(input, init); } catch (e) {
    const items = await pendingFor(table);
    if (!items.length) throw e;
    const rows = overlay([], items, u.searchParams);
    return wantsObject(headers) ? json(rows[0] ?? null, rows[0] ? 200 : 406) : json(rows, 200, { "Content-Range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` });
  }
  const items = await pendingFor(table);
  if (!items.length || !res.ok || init.method === "HEAD") return res;
  try {
    const data = await res.clone().json();
    if (Array.isArray(data)) return json(overlay(data, items, u.searchParams), res.status);
    if (data && typeof data === "object") return json(overlay([data], items, u.searchParams)[0] ?? data, res.status);
  } catch { /* not JSON */ }
  return res;
}

// ------------------------------------------------------------------ sending the outbox
let draining = false;
let timer: ReturnType<typeof setTimeout> | null = null;
function scheduleDrain(ms = 1500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void drainOutbox(); }, ms);
}

/** Sends waiting changes in order. Stops at the first network problem; rejected ones are kept as failed. */
export async function drainOutbox(): Promise<{ sent: number; failed: number }> {
  if (draining || !navigator.onLine) return { sent: 0, failed: 0 };
  if (!(await outboxItems()).some((i) => i.status === "pending")) { if (status.held) await refreshStatus({ held: false }); return { sent: 0, failed: 0 }; }
  if (draining) return { sent: 0, failed: 0 };
  draining = true;
  let sent = 0, failed = 0;
  await refreshStatus({ syncing: true });
  try {
    if (guard && !(await guard().catch(() => false))) { await refreshStatus({ held: true }); return { sent, failed }; }
    if (status.held) await refreshStatus({ held: false });
    const token = tokenGetter ? await tokenGetter() : null;
    const docnums = (await getMeta<Record<string, string>>("docnums")) || {};
    const real = (await getMeta<Record<string, string>>("docnums-real")) || {};
    const items = (await outboxItems()).filter((i) => i.status === "pending").sort((a, b) => (a.seq || 0) - (b.seq || 0));
    for (const it of items) {
      // Provisional document numbers → the real next numbers.
      const text = `${it.url} ${it.body || ""}`;
      for (const ph of new Set(text.match(PLACEHOLDER) || [])) {
        if (real[ph] || !docnums[ph]) continue;
        const r = await realFetch(new URL("/rest/v1/rpc/next_doc_number", it.url).href, { method: "POST", headers: { ...it.headers, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ p_kind: docnums[ph] }) }).catch(() => null);
        if (!r?.ok) throw new Error("network");
        real[ph] = await r.json();
        await setMeta("docnums-real", real);
      }
      const swap = (s: string | null) => (s ? s.replace(PLACEHOLDER, (m) => real[m] || m) : s);
      let res: Response | null = null;
      try {
        res = await realFetch(swap(it.url)!, { method: it.method, headers: { ...it.headers, ...(token ? { authorization: `Bearer ${token}` } : {}), prefer: [...String(it.headers.prefer || "").split(",").map((x) => x.trim()).filter((x) => x && !x.startsWith("return=")), "return=minimal"].join(",") }, body: swap(it.body) });
      } catch { break; /* still offline: try later */ }
      if (res.ok || (res.status === 409 && it.kind === "insert")) { await delItem(it.seq!); sent++; continue; }
      if (res.status >= 500 || res.status === 401 || res.status === 429) { it.tries++; await putItem(it); break; }
      const err = await res.json().catch(() => ({}));
      it.status = "failed"; it.tries++; it.error = String(err?.message || err?.hint || `Rejected (${res.status})`).slice(0, 300);
      await putItem(it); failed++;
    }
  } catch { /* network: next time */ }
  finally {
    draining = false;
    await refreshStatus({ syncing: false, online: navigator.onLine });
    if (sent) window.dispatchEvent(new CustomEvent("dash-outbox-synced", { detail: { sent } }));
    if (status.pending > 0 && navigator.onLine) scheduleDrain(15_000);
  }
  return { sent, failed };
}

/** Retry a failed change, or retry all of them. */
export async function retryOutbox(seq?: number) {
  for (const it of await outboxItems()) if (it.status === "failed" && (seq === undefined || it.seq === seq)) { it.status = "pending"; it.error = null; await putItem(it); }
  await refreshStatus();
  return drainOutbox();
}
/** Throw a change away (it is not sent). */
export async function discardOutbox(seq: number) { await delItem(seq); await refreshStatus(); }

/** Starts listening for the connection and sends waiting changes when it is back. */
export function startOutbox() {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;
  void refreshStatus();
  window.addEventListener("online", () => { void refreshStatus({ online: true }); scheduleDrain(800); });
  window.addEventListener("offline", () => void refreshStatus({ online: false }));
  setInterval(() => { if (navigator.onLine && status.pending > 0) void drainOutbox(); }, 30_000);
  scheduleDrain(3000);
}
