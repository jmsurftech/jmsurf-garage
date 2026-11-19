/**
 * Online-first mutation wrapper:
 * - When online → run the network operation directly.
 * - When offline → optimistically write to IndexedDB cache and queue the mutation
 *   via offlineWrite() so useOfflineSync drains it when connectivity returns.
 *
 * Use for simple CRUD against tenant-scoped tables (products, customers, bills,
 * expenses, invoices, profiles, business_settings, etc.).
 */
import { supabase } from "@/integrations/supabase/client";
import { offlineWrite } from "@/lib/offlineDb";

export type OfflineAction = "insert" | "update" | "upsert" | "delete";

export interface OfflineMutateOpts {
  table: string;
  action: OfflineAction;
  payload: Record<string, any>;
  /** IndexedDB store name to optimistically update (e.g. "products", "customers"). */
  cacheStore?: string;
  /** Match column for update/delete. Defaults to "id". */
  matchColumn?: string;
}

export async function offlineMutate(opts: OfflineMutateOpts) {
  const { table, action, payload, cacheStore, matchColumn = "id" } = opts;

  if (navigator.onLine) {
    const sb: any = supabase;
    let error: any = null;
    if (action === "insert") {
      ({ error } = await sb.from(table).insert(payload));
    } else if (action === "update") {
      const { [matchColumn]: matchVal, ...rest } = payload as any;
      ({ error } = await sb.from(table).update(rest).eq(matchColumn, matchVal));
    } else if (action === "upsert") {
      ({ error } = await sb.from(table).upsert(payload));
    } else if (action === "delete") {
      ({ error } = await sb.from(table).delete().eq(matchColumn, (payload as any)[matchColumn]));
    }
    if (error) throw error;
    return { offline: false };
  }

  // Offline path
  await offlineWrite({ table, action, payload, cacheStore });
  return { offline: true };
}
