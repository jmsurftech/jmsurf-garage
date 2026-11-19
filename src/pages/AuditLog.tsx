import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/kit";
import { useEffect, useMemo, useState } from "react";
import { PagedRows } from "@/components/Pager";
import { Activity, Search, RefreshCw, X, Download, Calendar, CloudUpload, CheckCircle2, AlertTriangle } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useOfflineSync, getLastAuditSync, type LastSyncInfo } from "@/hooks/useOfflineSync";
import { getSyncQueue, removeSyncQueueItem, type SyncQueueItem } from "@/lib/offlineDb";

interface ActivityRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_display_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  description: string;
  created_at: string;
  metadata: any;
}

const FILTERS_STORAGE_KEY = "audit-log:last-filters:v1";

interface SavedFilters {
  search: string;
  actionFilter: string;
  userFilter: string;
  entityFilter: string;
  dateFrom: string;
  dateTo: string;
}

const DEFAULT_FILTERS: SavedFilters = {
  search: "",
  actionFilter: "all",
  userFilter: "all",
  entityFilter: "all",
  dateFrom: "",
  dateTo: "",
};

function loadSavedFilters(): SavedFilters {
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function AuditLog() {
  const tenantId = useTenantId();
  const { role } = useAuth();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const initial = useMemo(loadSavedFilters, []);
  const [search, setSearch] = useState(initial.search);
  const [actionFilter, setActionFilter] = useState<string>(initial.actionFilter);
  const [userFilter, setUserFilter] = useState<string>(initial.userFilter);
  const [entityFilter, setEntityFilter] = useState<string>(initial.entityFilter);
  const [dateFrom, setDateFrom] = useState<string>(initial.dateFrom);
  const [dateTo, setDateTo] = useState<string>(initial.dateTo);

  // Tenant role-based UI behavior.
  // - admin / manager / super_admin → full tenant view & user filter
  // - everyone else (cashier, etc.) → can only see own actions (RLS also enforces this)
  const isPrivileged = role === "admin" || role === "manager" || role === "super_admin";

  // Offline-queued audit events for the *current* tenant.
  const { isOnline, syncing, failedItems, processQueue } = useOfflineSync(tenantId);
  const [auditPending, setAuditPending] = useState(0);
  const [justSynced, setJustSynced] = useState(0);
  const [lastSync, setLastSync] = useState<LastSyncInfo | null>(() => getLastAuditSync(tenantId));
  const [debugQueue, setDebugQueue] = useState<SyncQueueItem[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const prevPendingRef = useState({ v: 0 })[0];

  // Audit-only failed items (so the error banner is targeted to this page).
  const failedAuditItems = useMemo(
    () => failedItems.filter((q) => q.table === "user_activity_log"),
    [failedItems]
  );

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const queue = await getSyncQueue();
        const mine = queue.filter((q) =>
          q.table === "user_activity_log" &&
          (!tenantId || (q.tenant_id ?? (q.payload as any)?.tenant_id) === tenantId)
        );
        if (stop) return;
        setAuditPending(mine.length);
        // Sort newest first then keep only the next 10 we'd attempt to sync.
        setDebugQueue(
          [...mine]
            .sort((a, b) => a.createdAt - b.createdAt)
            .slice(0, 10)
        );
        if (prevPendingRef.v > 0 && mine.length === 0 && isOnline) {
          // We just finished syncing → flash a confirmation and refresh.
          setJustSynced(prevPendingRef.v);
          setTimeout(() => setJustSynced(0), 4000);
          setLastSync(getLastAuditSync(tenantId));
          load();
        }
        prevPendingRef.v = mine.length;
        setLastSync(getLastAuditSync(tenantId));
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(() => { if (!document.hidden) void tick(); }, 10_000);
    return () => { stop = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, isOnline]);

  // Auto-retry: as soon as the device reconnects, immediately flush queued
  // events for the active tenant. Avoids forcing the user to press
  // "Try syncing now" after a reconnect.
  useEffect(() => {
    if (!isOnline) return;
    processQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, tenantId]);

  const deleteFailedAuditForTenant = async () => {
    if (!tenantId) return;
    const queue = await getSyncQueue();
    const targets = queue.filter((q) =>
      q.table === "user_activity_log" &&
      q.retries >= 2 &&
      (q.tenant_id ?? (q.payload as any)?.tenant_id) === tenantId
    );
    for (const t of targets) {
      try { await removeSyncQueueItem(t.id); } catch { /* ignore */ }
    }
  };

  // Persist filters whenever they change
  useEffect(() => {
    const payload: SavedFilters = { search, actionFilter, userFilter, entityFilter, dateFrom, dateTo };
    try { localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(payload)); } catch { /* ignore quota */ }
  }, [search, actionFilter, userFilter, entityFilter, dateFrom, dateTo]);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("user_activity_log")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1000);
    setRows((data as ActivityRow[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId]);

  const actions = useMemo(() => Array.from(new Set(rows.map(r => r.action))).sort(), [rows]);
  const entities = useMemo(
    () => Array.from(new Set(rows.map(r => r.entity_type).filter(Boolean) as string[])).sort(),
    [rows]
  );
  const users = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      const key = r.user_id || r.user_email || "";
      if (!key) continue;
      if (!map.has(key)) map.set(key, r.user_display_name || r.user_email || key);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (actionFilter !== "all" && r.action !== actionFilter) return false;
    if (entityFilter !== "all" && (r.entity_type || "") !== entityFilter) return false;
    if (isPrivileged && userFilter !== "all") {
      const key = r.user_id || r.user_email || "";
      if (key !== userFilter) return false;
    }
    if (dateFrom) {
      if (new Date(r.created_at) < new Date(dateFrom + "T00:00:00")) return false;
    }
    if (dateTo) {
      if (new Date(r.created_at) > new Date(dateTo + "T23:59:59")) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      return (
        r.description.toLowerCase().includes(q) ||
        (r.user_email || "").toLowerCase().includes(q) ||
        (r.user_display_name || "").toLowerCase().includes(q) ||
        (r.entity_type || "").toLowerCase().includes(q) ||
        (r.entity_id || "").toLowerCase().includes(q)
      );
    }
    return true;
  }), [rows, actionFilter, entityFilter, userFilter, dateFrom, dateTo, search, isPrivileged]);

  const hasFilters = actionFilter !== "all" || userFilter !== "all" || entityFilter !== "all" || dateFrom || dateTo || search;
  const clearFilters = () => {
    setActionFilter("all"); setUserFilter("all"); setEntityFilter("all");
    setDateFrom(""); setDateTo(""); setSearch("");
  };

  // Quick date presets
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const applyPreset = (preset: "today" | "7d" | "month") => {
    const now = new Date();
    const to = format(now, "yyyy-MM-dd");
    let from = to;
    if (preset === "7d") {
      const d = new Date(now); d.setDate(d.getDate() - 6);
      from = format(d, "yyyy-MM-dd");
    } else if (preset === "month") {
      from = format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd");
    }
    setDateFrom(from); setDateTo(to);
  };

  const presetActive = (preset: "today" | "7d" | "month") => {
    if (!dateFrom || !dateTo) return false;
    const now = new Date();
    const to = format(now, "yyyy-MM-dd");
    if (dateTo !== to) return false;
    if (preset === "today") return dateFrom === to;
    if (preset === "7d") {
      const d = new Date(now); d.setDate(d.getDate() - 6);
      return dateFrom === format(d, "yyyy-MM-dd");
    }
    if (preset === "month") {
      return dateFrom === format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd");
    }
    return false;
  };

  const exportCsv = () => {
    const headers = ["When", "User", "Email", "Action", "Entity Type", "Entity ID", "Description"];
    const lines = [headers.join(",")];
    for (const r of filtered) {
      lines.push([
        format(new Date(r.created_at), "yyyy-MM-dd HH:mm:ss"),
        r.user_display_name || "",
        r.user_email || "",
        r.action,
        r.entity_type || "",
        r.entity_id || "",
        r.description,
      ].map(csvEscape).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${todayStr}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const presetBtnCls = (active: boolean) =>
    `inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
      active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-input text-muted-foreground hover:bg-muted"
    }`;

  return (
    <div className="space-y-6">
      <PageHeader icon={Activity} title="Activity log"
        description={isPrivileged ? "Everything every user has done in this workspace." : "Your own activity in this workspace."}
        actions={<>
          <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Refresh</Button>
          <Button onClick={exportCsv} disabled={loading || filtered.length === 0}><Download /> Export CSV</Button>
        </>} />

      {/* Failure banner: shown when offline audit events failed to sync after retries */}
      {failedAuditItems.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border bg-destructive/10 border-destructive/30 text-destructive text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span>
              {failedAuditItems.length} audit event{failedAuditItems.length === 1 ? "" : "s"} failed to sync.
              {failedAuditItems[0]?.lastError ? ` Last error: ${failedAuditItems[0].lastError}` : ""}
            </span>
          </div>
          <button
            onClick={() => processQueue()}
            disabled={syncing || !isOnline}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-destructive text-destructive-foreground text-xs font-medium hover:opacity-90 disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} /> Try syncing now
          </button>
        </div>
      )}

      {/* Audit sync indicator: pending offline events + last-sync confirmation */}
      {(auditPending > 0 || justSynced > 0 || !isOnline || lastSync) && (
        <div className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-xs ${
          auditPending > 0
            ? "bg-warning/10 border-warning/30 text-warning"
            : justSynced > 0
              ? "bg-success/10 border-success/30 text-success"
              : !isOnline
                ? "bg-muted border-border text-muted-foreground"
                : "bg-card border-border text-muted-foreground"
        }`}>
          <div className="flex items-center gap-2">
            {auditPending > 0 ? (
              <>
                <CloudUpload className={`w-4 h-4 ${syncing ? "animate-pulse" : ""}`} />
                <span>
                  {syncing ? "Syncing" : "Queued"} {auditPending} offline audit event{auditPending === 1 ? "" : "s"}
                  {isOnline ? "…" : " (waiting for connection)"}
                </span>
              </>
            ) : justSynced > 0 ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>{justSynced} offline audit event{justSynced === 1 ? "" : "s"} synced to this workspace</span>
              </>
            ) : !isOnline ? (
              <>
                <CloudUpload className="w-4 h-4" />
                <span>Offline — new audit events will sync when you reconnect</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 text-success" />
                <span>Audit log up to date for this workspace</span>
              </>
            )}
          </div>
          {lastSync && (
            <span className="whitespace-nowrap opacity-80">
              Last sync: {formatDistanceToNow(new Date(lastSync.at), { addSuffix: true })}
              {" · "}
              {lastSync.count} event{lastSync.count === 1 ? "" : "s"}
              {" in "}
              {lastSync.durationMs < 1000 ? `${lastSync.durationMs}ms` : `${(lastSync.durationMs / 1000).toFixed(1)}s`}
            </span>
          )}
        </div>
      )}

      {/* Debug: queued offline audit events for the active tenant */}
      <div className="rounded-lg border border-border bg-card">
        <button
          type="button"
          onClick={() => setShowDebug((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium hover:bg-muted/50"
        >
          <span className="inline-flex items-center gap-2">
            <CloudUpload className="w-3.5 h-3.5 text-muted-foreground" />
            Debug · queued offline audit events
            <span className="text-muted-foreground">({debugQueue.length})</span>
          </span>
          <span className="text-muted-foreground">{showDebug ? "Hide" : "Show"}</span>
        </button>
        {showDebug && (
          <div className="border-t border-border p-3 space-y-2">
            {debugQueue.length === 0 ? (
              <p className="text-xs text-muted-foreground">No queued audit events for this workspace.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1 pr-3 font-medium">Action</th>
                        <th className="py-1 pr-3 font-medium">Tenant</th>
                        <th className="py-1 pr-3 font-medium">Retries</th>
                        <th className="py-1 pr-3 font-medium">Last error</th>
                        <th className="py-1 pr-3 font-medium">Queued</th>
                      </tr>
                    </thead>
                    <tbody>
                      <PagedRows rows={debugQueue} colSpan={5}>{(pageRows) => pageRows.map((q) => {
                        const t = q.tenant_id ?? (q.payload as any)?.tenant_id ?? "—";
                        const action = (q.payload as any)?.action || "?";
                        return (
                          <tr key={q.id} className="border-t border-border">
                            <td className="py-1 pr-3 font-mono">{action}</td>
                            <td className="py-1 pr-3 font-mono truncate max-w-[8rem]" title={String(t)}>{String(t).slice(0, 8)}…</td>
                            <td className="py-1 pr-3">{q.retries}</td>
                            <td className="py-1 pr-3 text-destructive truncate max-w-[16rem]" title={q.lastError || ""}>{q.lastError || "—"}</td>
                            <td className="py-1 pr-3 text-muted-foreground">{formatDistanceToNow(new Date(q.createdAt), { addSuffix: true })}</td>
                          </tr>
                        );
                      })}</PagedRows>
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => processQueue()}
                    disabled={syncing || !isOnline}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} /> Retry sync now
                  </button>
                  <button
                    onClick={deleteFailedAuditForTenant}
                    disabled={!debugQueue.some((q) => q.retries >= 2)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-destructive/10 text-destructive border border-destructive/30 text-xs font-medium hover:bg-destructive/20 disabled:opacity-40"
                  >
                    <X className="w-3 h-3" /> Delete failed (this tenant)
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Calendar className="w-3.5 h-3.5" /> Quick range:</span>
        <button onClick={() => applyPreset("today")} className={presetBtnCls(presetActive("today"))}>Today</button>
        <button onClick={() => applyPreset("7d")} className={presetBtnCls(presetActive("7d"))}>Last 7 days</button>
        <button onClick={() => applyPreset("month")} className={presetBtnCls(presetActive("month"))}>This month</button>
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:bg-muted">
            <X className="w-3 h-3" /> Clear dates
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
        <div className="relative lg:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search description, user, entity..."
            className="fi pl-10 pr-4" />
        </div>
        {isPrivileged ? (
          <select value={userFilter} onChange={e => setUserFilter(e.target.value)}
            className="fi">
            <option value="all">All users</option>
            {users.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        ) : (
          <div className="fi">
            Showing only your activity
          </div>
        )}
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
          className="fi">
          <option value="all">All actions</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)}
          className="fi">
          <option value="all">All entities</option>
          {entities.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <div className="flex min-w-0 gap-2 lg:col-span-2">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="fi min-w-0" title="From date" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="fi min-w-0" title="To date" />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Showing {filtered.length} of {rows.length} events{!isPrivileged && " (your own)"}</span>
        {hasFilters && (
          <button onClick={clearFilters} className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-muted">
            <X className="w-3 h-3" /> Clear filters
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="dt">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="py-3 px-4 font-medium text-muted-foreground">When</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">User</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Action</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Entity</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">Description</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Loading...</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No activity matches the current filters.</td></tr>}
              {<PagedRows rows={filtered} colSpan={5}>{(pageRows) => pageRows.map(r => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="py-2.5 px-4 whitespace-nowrap text-muted-foreground">{format(new Date(r.created_at), "MMM dd, HH:mm")}</td>
                  <td className="py-2.5 px-4 whitespace-nowrap">{r.user_display_name || r.user_email || "—"}</td>
                  <td className="py-2.5 px-4">
                    <span className="text-xs font-semibold px-2 py-1 rounded-full bg-primary/10 text-primary">{r.action}</span>
                  </td>
                  <td className="py-2.5 px-4 text-muted-foreground">{r.entity_type || "—"}</td>
                  <td className="py-2.5 px-4">{r.description}</td>
                </tr>
              ))}</PagedRows>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
