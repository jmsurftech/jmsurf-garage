import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, Loader2, XCircle, AlertTriangle, DatabaseZap, ChevronRight } from "lucide-react";
import { Modal } from "@/components/kit";
import { cn } from "@/lib/utils";
import { isActive, moveRun, type Run, type Step } from "./progress";

const since = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

/** Seconds since the run started, ticking while it runs. */
function useElapsed(r: Run) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isActive(r)) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [r.phase, r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return since((r.endedAt || now) - r.startedAt);
}

function StepRow({ s }: { s: Step }) {
  return (
    <li className={cn("flex items-start gap-3 rounded-xl px-3 py-2.5", s.state === "running" ? "bg-primary/5 ring-1 ring-primary/20" : s.state === "failed" ? "bg-destructive/5" : "")}>
      <span className="mt-0.5 shrink-0">
        {s.state === "running" ? <Loader2 className="h-4 w-4 animate-spin text-primary" />
          : s.state === "done" ? (s.warn ? <AlertTriangle className="h-4 w-4 text-warning" /> : <CheckCircle2 className="h-4 w-4 text-success" />)
          : s.state === "failed" ? <XCircle className="h-4 w-4 text-destructive" />
          : <Circle className="h-4 w-4 text-muted-foreground/40" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm font-medium", s.state === "waiting" && "text-muted-foreground")} title={s.label}>{s.label}</span>
        {s.note && <span className={cn("block break-words text-xs", s.state === "failed" ? "text-destructive" : "text-muted-foreground")}>{s.note}</span>}
      </span>
      <span className={cn("shrink-0 pt-0.5 text-[11px] font-semibold uppercase tracking-wide",
        s.state === "running" ? "text-primary" : s.state === "done" ? (s.warn ? "text-warning" : "text-success") : s.state === "failed" ? "text-destructive" : "text-muted-foreground/70")}>
        {s.state === "running" ? "Working" : s.state === "done" ? "Done" : s.state === "failed" ? "Failed" : "Waiting"}
      </span>
    </li>
  );
}

/**
 * The move-in progress pop-up: a checklist of every kind of record with its live status,
 * an overall bar and the current activity. Closing it leaves the run going in the background.
 */
export function MoveProgress({ run }: { run: Run | null }) {
  if (!run) return null;
  return <MoveProgressModal r={run} />;
}

function MoveProgressModal({ r }: { r: Run }) {
  const elapsed = useElapsed(r);
  const active = isActive(r);
  const finished = r.steps.filter((s) => s.state === "done" || s.state === "failed").length;
  const failed = r.steps.filter((s) => s.state === "failed").length;
  const title = r.phase === "fetching" ? "Fetching from your previous system"
    : r.phase === "importing" ? "Moving your records in"
    : r.phase === "fetched" ? "Fetch complete"
    : r.phase === "done" ? (failed ? "Move-in finished with problems" : "Move-in complete")
    : "Move-in stopped";
  const counts = r.total ? `${r.done.toLocaleString()} of ${r.total.toLocaleString()} records` : r.done ? `${r.done.toLocaleString()} records found` : "";
  return (
    <Modal open={r.open} onClose={moveRun.hide} center size="lg" icon={DatabaseZap} title={title} bodyClassName="flex min-h-0 flex-col overflow-hidden"
      description={active ? `Running for ${elapsed}. You can close this window: it carries on.` : `Took ${elapsed}.`}
      footer={active ? (
        <button type="button" onClick={moveRun.hide} className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold">Run in background</button>
      ) : (
        <>
          {r.phase === "done" && <Link to="/accounting/statements" onClick={moveRun.clear} className="rounded-xl border border-border bg-card px-4 py-2.5 text-center text-sm font-semibold">Check the trial balance</Link>}
          <button type="button" onClick={moveRun.clear} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">Done</button>
        </>
      )}>
      {/* The percentage and the status line stay put; only the list of steps scrolls. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="shrink-0">
          <div className="mb-1.5 flex items-end justify-between gap-3">
            <span className="font-display text-2xl font-bold tabular-nums">{r.pct}%</span>
            <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">{counts}{counts && r.steps.length ? " · " : ""}{r.steps.length ? `${finished} of ${r.steps.length} steps` : ""}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.pct}>
            <div className={cn("h-full rounded-full transition-[width] duration-500", r.phase === "failed" ? "bg-destructive" : r.phase === "done" || r.phase === "fetched" ? "bg-success" : "bg-primary")} style={{ width: `${Math.max(2, Math.min(100, r.pct))}%` }} />
          </div>
        </div>
        <p aria-live="polite" className={cn("flex shrink-0 items-start gap-2 rounded-xl px-3 py-2 text-sm",
          r.phase === "failed" ? "bg-destructive/10 text-destructive" : r.phase === "done" || r.phase === "fetched" ? "bg-success/10" : "bg-muted/60")}>
          {active ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : r.phase === "failed" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />}
          <span className="min-w-0 break-words">{r.line}</span>
        </p>
        {r.steps.length > 0 && <ul className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-1">{r.steps.map((s) => <StepRow key={s.key} s={s} />)}</ul>}
      </div>
    </Modal>
  );
}

/** A slim bar on the Move-in page while the pop-up is closed. */
export function MoveProgressBar({ run }: { run: Run | null }) {
  if (!run || run.open) return null;
  const active = isActive(run);
  return (
    <button type="button" onClick={moveRun.show}
      className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left shadow-sm hover:border-primary/40">
      {active ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" /> : run.phase === "failed" ? <XCircle className="h-5 w-5 shrink-0 text-destructive" /> : <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{active ? `Move-in running · ${run.pct}%` : run.phase === "failed" ? "Move-in stopped" : "Move-in finished"}</span>
        <span className="block truncate text-xs text-muted-foreground" title={run.line}>{run.line}</span>
      </span>
      <span className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted sm:block"><span className="block h-full rounded-full bg-primary" style={{ width: `${run.pct}%` }} /></span>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">Show <ChevronRight className="h-3.5 w-3.5" /></span>
    </button>
  );
}
