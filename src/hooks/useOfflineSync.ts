import { useEffect, useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getSyncQueue,
  removeSyncQueueItem,
  updateSyncQueueItem,
  getSyncQueueCount,
  type SyncQueueItem,
} from "@/lib/offlineDb";

const MAX_RETRIES = 5;
const LAST_SYNC_KEY_PREFIX = "audit:last-sync:";

export interface LastSyncInfo {
  /** ms epoch of the most recent successful flush of audit events */
  at: number;
  /** how long that flush took, in ms */
  durationMs: number;
  /** how many audit events were synced in that flush */
  count: number;
}

export function getLastAuditSync(tenantId: string | null | undefined): LastSyncInfo | null {
  if (!tenantId) return null;
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY_PREFIX + tenantId);
    if (!raw) return null;
    return JSON.parse(raw) as LastSyncInfo;
  } catch {
    return null;
  }
}

function setLastAuditSync(tenantId: string, info: LastSyncInfo) {
  try {
    localStorage.setItem(LAST_SYNC_KEY_PREFIX + tenantId, JSON.stringify(info));
  } catch { /* quota */ }
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const up = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return isOnline;
}

export function useOfflineSync(activeTenantId?: string | null) {
  const isOnline = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  /** Items that have failed at least once (for the active tenant). */
  const [failedItems, setFailedItems] = useState<SyncQueueItem[]>([]);
  const syncInProgress = useRef(false);

  const refreshCount = useCallback(async () => {
    const count = await getSyncQueueCount();
    setPendingCount(count);
    try {
      const all = await getSyncQueue();
      const failed = all.filter((q) => {
        if (q.retries < 2) return false;
        if (!activeTenantId) return true;
        const t = q.tenant_id ?? (q.payload as any)?.tenant_id;
        return !t || t === activeTenantId;
      });
      setFailedItems(failed);
    } catch { /* ignore */ }
  }, [activeTenantId]);

  const processQueue = useCallback(async () => {
    if (syncInProgress.current || !navigator.onLine) return;
    syncInProgress.current = true;
    setSyncing(true);

    const startedAt = Date.now();
    let auditFlushed = 0;

    try {
      const queue = await getSyncQueue();
      if (queue.length === 0) {
        setSyncing(false);
        syncInProgress.current = false;
        return;
      }

      // Sort by createdAt to process in order
      queue.sort((a, b) => a.createdAt - b.createdAt);

      for (const item of queue) {
        try {
          // Tenant-scoped audit isolation: never sync an audit event whose
          // queued tenant_id no longer matches the active workspace. This
          // prevents queued Azil events from being inserted under Eunisha.
          if (item.table === "user_activity_log" && activeTenantId) {
            const queuedTenant = item.tenant_id ?? (item.payload as any)?.tenant_id;
            if (queuedTenant && queuedTenant !== activeTenantId) {
              // Leave it in the queue — it will sync when its tenant becomes active.
              continue;
            }
          }

          await processSyncItem(item);
          await removeSyncQueueItem(item.id);
          if (item.table === "user_activity_log") auditFlushed++;
        } catch (err: any) {
          console.error("Sync item failed:", item.id, err);
          if (item.retries >= MAX_RETRIES) {
            console.warn("Max retries reached, removing:", item.id);
            await removeSyncQueueItem(item.id);
          } else {
            await updateSyncQueueItem({
              ...item,
              retries: item.retries + 1,
              lastError: String(err?.message || err),
            });
          }
        }
      }

      if (auditFlushed > 0 && activeTenantId) {
        setLastAuditSync(activeTenantId, {
          at: Date.now(),
          durationMs: Date.now() - startedAt,
          count: auditFlushed,
        });
      }
    } finally {
      syncInProgress.current = false;
      setSyncing(false);
      await refreshCount();
    }
  }, [refreshCount, activeTenantId]);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline) {
      processQueue();
    }
  }, [isOnline, processQueue]);

  // Periodic sync every 30s when online
  useEffect(() => {
    refreshCount();
    const interval = setInterval(() => {
      if (document.hidden) return;
      if (navigator.onLine) {
        processQueue();
      }
      refreshCount();
    }, 30_000);
    return () => clearInterval(interval);
  }, [processQueue, refreshCount]);

  return { isOnline, pendingCount, syncing, failedItems, processQueue, refreshCount };
}

async function processSyncItem(item: SyncQueueItem) {
  const sb: any = supabase;
  // Treat unique-violation (e.g. audit log dedup on event_id) as already-synced.
  const isDuplicate = (err: any) => err && (err.code === "23505" || /duplicate key/i.test(err.message || ""));

  switch (item.action) {
    case "insert": {
      const { error } = await sb.from(item.table).insert(item.payload);
      if (error && !isDuplicate(error)) throw error;
      break;
    }
    case "update": {
      const { id, ...rest } = item.payload;
      const { error } = await sb.from(item.table).update(rest).eq("id", id);
      if (error) throw error;
      break;
    }
    case "upsert": {
      const { error } = await sb.from(item.table).upsert(item.payload);
      if (error && !isDuplicate(error)) throw error;
      break;
    }
    case "delete": {
      const { error } = await sb.from(item.table).delete().eq("id", item.payload.id);
      if (error) throw error;
      break;
    }
  }
}
