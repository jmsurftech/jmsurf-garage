import { useEffect, useState } from "react";
import { WifiOff, RefreshCw, CloudOff, AlertTriangle, X, RotateCcw, Trash2, CheckCircle2 } from "lucide-react";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { onOutboxStatus, outboxItems, drainOutbox, retryOutbox, discardOutbox, type OutboxItem } from "@/lib/offlineOutbox";
import { cn } from "@/lib/utils";

/**
 * Connection status for the whole system: offline, changes waiting to be sent (till sales and everything
 * else), syncing, and changes the server rejected (open the list to retry or discard them).
 */
export default function OfflineIndicator() {
  const pos = useOfflineSync();
  const [box, setBox] = useState({ pending: 0, failed: 0, syncing: false, online: true, held: false });
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [justSynced, setJustSynced] = useState(0);
  useEffect(() => onOutboxStatus(setBox), []);
  useEffect(() => {
    const done = (e: Event) => { setJustSynced((e as CustomEvent).detail?.sent || 0); setTimeout(() => setJustSynced(0), 4000); };
    window.addEventListener("dash-outbox-synced", done);
    return () => window.removeEventListener("dash-outbox-synced", done);
  }, []);
  useEffect(() => { if (open) void outboxItems().then(setItems); }, [open, box]);

  const online = pos.isOnline && box.online;
  const waiting = pos.pendingCount + box.pending;
  const syncing = pos.syncing || box.syncing;
  if (online && !waiting && !box.failed && !justSynced) return null;

  const tone = !online ? "bg-foreground/90 text-background" : box.failed ? "bg-destructive text-white" : justSynced && !waiting ? "bg-success text-white" : "bg-amber-500 text-white";
  return (
    <>
      <div className={cn("fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-3 z-50 flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium shadow-lg md:bottom-4 md:right-4", tone)} role="status">
        {!online ? <><WifiOff className="h-4 w-4" /><span>Offline · work carries on{waiting ? ` · ${waiting} change${waiting === 1 ? "" : "s"} saved on this device` : ""}</span></>
          : box.held && box.pending ? <><AlertTriangle className="h-4 w-4" /><span>{box.pending} change{box.pending === 1 ? "" : "s"} waiting · another tab switched company; press Continue here to send them</span></>
          : syncing ? <><RefreshCw className="h-4 w-4 animate-spin" /><span>Sending {waiting} change{waiting === 1 ? "" : "s"}…</span></>
          : box.failed ? <><AlertTriangle className="h-4 w-4" /><span>{box.failed} change{box.failed === 1 ? "" : "s"} could not be saved</span></>
          : waiting ? <><CloudOff className="h-4 w-4" /><span>{waiting} waiting</span><button type="button" onClick={() => { void drainOutbox(); void pos.processQueue(); }} className="rounded-full bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30">Send now</button></>
          : <><CheckCircle2 className="h-4 w-4" /><span>Back online · {justSynced} change{justSynced === 1 ? "" : "s"} saved</span></>}
        {(box.failed > 0 || box.pending > 0) && <button type="button" onClick={() => setOpen(true)} className="rounded-full bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30">Details</button>}
      </div>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/30 p-3 sm:items-center" onClick={() => setOpen(false)}>
          <div className="dash-card max-h-[80vh] w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3"><CloudOff className="h-4 w-4 text-primary" /><h2 className="flex-1 font-display font-semibold">Changes saved on this device</h2><button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><X className="h-4 w-4" /></button></div>
            <ul className="max-h-[55vh] divide-y divide-border/60 overflow-y-auto">
              {items.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nothing waiting.</li>}
              {items.map((it) => (
                <li key={it.seq} className="flex items-start gap-3 px-4 py-3 text-sm">
                  <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", it.status === "failed" ? "bg-destructive" : "bg-amber-500")} />
                  <span className="min-w-0 flex-1"><span className="block font-medium capitalize">{it.label}</span><span className="block text-xs text-muted-foreground">{new Date(it.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{it.status === "failed" ? ` · ${it.error}` : " · waiting to send"}</span></span>
                  {it.status === "failed" && <>
                    <button type="button" className="icon-btn" onClick={() => void retryOutbox(it.seq)} aria-label="Try again"><RotateCcw className="h-4 w-4" /></button>
                    <button type="button" className="icon-btn-danger" onClick={() => void discardOutbox(it.seq!)} aria-label="Discard"><Trash2 className="h-4 w-4" /></button>
                  </>}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2 border-t border-border/60 px-4 py-3">
              {box.failed > 0 && <button type="button" onClick={() => void retryOutbox()} className="rounded-xl border border-border px-3 py-2 text-sm font-medium hover:border-primary/50">Try all again</button>}
              <button type="button" onClick={() => { void drainOutbox(); setOpen(false); }} disabled={!online} className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Send now</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
