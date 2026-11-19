/**
 * Offline-first IndexedDB layer for POS operations.
 * Caches products, customers, and queues mutations for sync.
 */

const DB_NAME = "jmsurf_pos_offline";
const DB_VERSION = 1;

export interface SyncQueueItem {
  id: string;
  table: string;
  action: "insert" | "update" | "upsert" | "delete";
  payload: Record<string, any>;
  createdAt: number;
  retries: number;
  /** Tenant that owned this mutation when it was queued. Used to keep
   *  audit-log events from leaking across tenants after a tenant switch. */
  tenant_id?: string | null;
  /** Last error message if a sync attempt failed. */
  lastError?: string | null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION + 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("products")) {
        db.createObjectStore("products", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("customers")) {
        db.createObjectStore("customers", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("transactions")) {
        db.createObjectStore("transactions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("product_stocks")) {
        db.createObjectStore("product_stocks", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("business_settings")) {
        db.createObjectStore("business_settings", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sync_queue")) {
        db.createObjectStore("sync_queue", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("tenants")) {
        db.createObjectStore("tenants", { keyPath: "slug" });
      }
      if (!db.objectStoreNames.contains("auth_cache")) {
        db.createObjectStore("auth_cache", { keyPath: "key" });
      }
      // Generic per-table caches added for broader offline coverage
      ["locations", "staff", "services", "suppliers", "shifts"].forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "id" });
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Generic helpers
async function putAll(storeName: string, items: any[]) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  for (const item of items) {
    store.put(item);
  }
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAll<T = any>(storeName: string): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const req = store.getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function clearStore(storeName: string) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).clear();
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Cache API data locally
export async function cacheProducts(products: any[]) {
  await clearStore("products");
  await putAll("products", products);
}

export async function cacheCustomers(customers: any[]) {
  await clearStore("customers");
  await putAll("customers", customers);
}

export async function cacheProductStocks(stocks: any[]) {
  await clearStore("product_stocks");
  await putAll("product_stocks", stocks);
}

export async function cacheBusinessSettings(settings: any) {
  if (!settings) return;
  const db = await openDb();
  const tx = db.transaction("business_settings", "readwrite");
  // Replace any existing rows for the same tenant so cache stays scoped to
  // a single active workspace and never leaks names from another tenant.
  const store = tx.objectStore("business_settings");
  if (settings.tenant_id) {
    const all = await new Promise<any[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    for (const row of all) {
      if (row.tenant_id !== settings.tenant_id) {
        store.delete(row.id);
      }
    }
  }
  store.put(settings);
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Read cached data
export async function getCachedProducts() {
  return getAll("products");
}

export async function getCachedCustomers() {
  return getAll("customers");
}

export async function getCachedProductStocks() {
  return getAll("product_stocks");
}

export async function getCachedBusinessSettings(tenantId?: string) {
  const all = await getAll("business_settings");
  if (tenantId) {
    return all.find((r: any) => r?.tenant_id === tenantId) || null;
  }
  return all[0] || null;
}

export async function clearCachedBusinessSettings(tenantId?: string) {
  const db = await openDb();
  const tx = db.transaction("business_settings", "readwrite");
  const store = tx.objectStore("business_settings");
  if (!tenantId) {
    store.clear();
  } else {
    const all = await new Promise<any[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    for (const row of all) {
      if (row?.tenant_id === tenantId) store.delete(row.id);
    }
  }
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedTransactions() {
  return getAll("transactions");
}

// Sync queue operations
export async function addToSyncQueue(item: Omit<SyncQueueItem, "id" | "createdAt" | "retries">) {
  const db = await openDb();
  const tx = db.transaction("sync_queue", "readwrite");
  // Auto-stamp tenant_id from the payload if the caller didn't pass one.
  const inferredTenant = (item as any).tenant_id ?? (item.payload as any)?.tenant_id ?? null;
  const entry: SyncQueueItem = {
    ...item,
    tenant_id: inferredTenant,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    retries: 0,
    lastError: null,
  };
  tx.objectStore("sync_queue").put(entry);
  return new Promise<string>((resolve, reject) => {
    tx.oncomplete = () => resolve(entry.id);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  return getAll<SyncQueueItem>("sync_queue");
}

export async function removeSyncQueueItem(id: string) {
  const db = await openDb();
  const tx = db.transaction("sync_queue", "readwrite");
  tx.objectStore("sync_queue").delete(id);
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateSyncQueueItem(item: SyncQueueItem) {
  const db = await openDb();
  const tx = db.transaction("sync_queue", "readwrite");
  tx.objectStore("sync_queue").put(item);
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Save offline transaction locally
export async function saveOfflineTransaction(tx: any) {
  const db = await openDb();
  const dbTx = db.transaction("transactions", "readwrite");
  dbTx.objectStore("transactions").put(tx);
  return new Promise<void>((resolve, reject) => {
    dbTx.oncomplete = () => resolve();
    dbTx.onerror = () => reject(dbTx.error);
  });
}

// Update local stock after an offline sale.
// We deliberately ALLOW negative stock so the sale is never blocked when the
// cashier is offline. The server will reconcile inventory on sync; admins can
// see the negative figure as a "needs review" signal in inventory.
export async function deductLocalStock(productId: string, locationId: string, qty: number) {
  const stocks = await getCachedProductStocks();
  const match = stocks.find(
    (s: any) => s.product_id === productId && s.location_id === locationId
  );
  if (match) {
    match.stock = (match.stock || 0) - qty;
    await putAll("product_stocks", [match]);
  }
}

// Meta helpers for tracking last sync time
export async function setMeta(key: string, value: any) {
  const db = await openDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put({ key, value, updatedAt: Date.now() });
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMeta(key: string): Promise<any> {
  const db = await openDb();
  const tx = db.transaction("meta", "readonly");
  const req = tx.objectStore("meta").get(key);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function getSyncQueueCount(): Promise<number> {
  const queue = await getSyncQueue();
  return queue.length;
}

// Tenant caching for offline login
export async function cacheTenant(tenant: any) {
  if (!tenant?.slug) return;
  const db = await openDb();
  const tx = db.transaction("tenants", "readwrite");
  tx.objectStore("tenants").put(tenant);
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedTenant(slug: string): Promise<any | null> {
  const db = await openDb();
  const tx = db.transaction("tenants", "readonly");
  const req = tx.objectStore("tenants").get(slug);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Auth cache for offline profile/role
export async function cacheAuthData(key: string, data: any) {
  const db = await openDb();
  const tx = db.transaction("auth_cache", "readwrite");
  tx.objectStore("auth_cache").put({ key, data, updatedAt: Date.now() });
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedAuthData(key: string): Promise<any | null> {
  const db = await openDb();
  const tx = db.transaction("auth_cache", "readonly");
  const req = tx.objectStore("auth_cache").get(key);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result?.data || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Wipe ALL offline caches — call on signOut and on tenant mismatch.
 * Prevents data leakage between accounts.
 */
export async function wipeAllOfflineCaches() {
  const stores = [
    "products", "customers", "transactions", "product_stocks",
    "business_settings", "sync_queue", "meta", "tenants", "auth_cache",
    "locations", "staff", "services", "suppliers", "shifts",
  ];
  try {
    const db = await openDb();
    for (const s of stores) {
      try {
        const tx = db.transaction(s, "readwrite");
        tx.objectStore(s).clear();
        await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
      } catch { /* ignore missing stores */ }
    }
  } catch (e) {
    console.warn("wipeAllOfflineCaches failed:", e);
  }
  // Also clear any tenant/session-related localStorage keys
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("held_sales") || k.startsWith("mpesa_stale_") || k.startsWith("tenant_"))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

/* ===== Generic per-table cache helpers + offline write ===== */
export async function cacheTable(name: string, rows: any[]) {
  if (!Array.isArray(rows)) return;
  try {
    await clearStore(name);
    await putAll(name, rows);
  } catch (e) {
    console.warn(`cacheTable(${name}) failed:`, e);
  }
}

export async function getCachedTable<T = any>(name: string): Promise<T[]> {
  try { return await getAll<T>(name); } catch { return []; }
}

export async function offlineWrite(opts: {
  table: string;
  action: "insert" | "update" | "delete" | "upsert";
  payload: Record<string, any>;
  cacheStore?: string;
}) {
  const { table, action, payload, cacheStore } = opts;
  const row: any = { ...payload };
  if (action === "insert" || action === "upsert") {
    if (!row.id) row.id = crypto.randomUUID();
    if (!row.created_at) row.created_at = new Date().toISOString();
    if (!row.updated_at) row.updated_at = new Date().toISOString();
    row.__pending_sync = true;
  }
  if (cacheStore) {
    try {
      const db = await openDb();
      const tx = db.transaction(cacheStore, "readwrite");
      const store = tx.objectStore(cacheStore);
      if (action === "delete") store.delete(payload.id);
      else store.put(row);
      await new Promise<void>((res) => { tx.oncomplete = () => res(); tx.onerror = () => res(); });
    } catch (e) {
      console.warn(`offlineWrite cache (${cacheStore}) failed:`, e);
    }
  }
  await addToSyncQueue({ table, action, payload: row });
  return row;
}
