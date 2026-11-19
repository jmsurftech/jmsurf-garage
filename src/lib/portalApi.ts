/**
 * Client for the water customer portal (water.js on the app server).
 * Customers are not staff accounts: their session token lives in this
 * browser only and is sent as "Authorization: Customer <token>".
 */

const apiUrl = (path: string) => {
  // Every JMSURF Garage address is served by the same server: same-origin calls.
  return path;
};

const tokenKey = (slug: string) => `water-portal:${slug}`;
export const getToken = (slug: string) => { try { return localStorage.getItem(tokenKey(slug)); } catch { return null; } };
export const setToken = (slug: string, t: string | null) => {
  try { if (t) localStorage.setItem(tokenKey(slug), t); else localStorage.removeItem(tokenKey(slug)); } catch { /* private mode */ }
};

export class PortalError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function portal<T = any>(slug: string, action: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = getToken(slug);
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/water/c/${action}`), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Customer ${token}` } : {}) },
      body: JSON.stringify({ slug, ...body }),
    });
  } catch {
    throw new PortalError("No connection. Check your internet and try again.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token && !["login", "register", "reset"].includes(action)) setToken(slug, null);
    throw new PortalError(data?.error || "Something went wrong. Try again.", res.status);
  }
  return data as T;
}

export interface PortalShop { name: string; slug: string; logo_url: string | null; currency: string; country: string; phone: string | null }
/** A refill size (litres set) or an empty container for sale (container_litres set). */
export interface PortalSize { id: string; name: string; price: number; litres: number | null; container_litres?: number | null; image_url: string | null }
export const refillSizes = (all: PortalSize[]) => all.filter((s) => s.litres != null && s.litres > 0) as (PortalSize & { litres: number })[];
export const containerItems = (all: PortalSize[]) => all.filter((s) => s.litres == null && s.container_litres != null);
export interface PortalCustomer {
  id: string; name: string; phone: string; alt_phone?: string | null; email: string | null;
  lat: number | null; lng: number | null; address: string | null; area?: string | null; building?: string | null;
  landmark: string | null; delivery_notes?: string | null;
}
