// Live state of a move-in run (fetch from the old system and/or import into the books),
// shown by the progress pop-up. It lives outside React so it survives re-renders, leaving
// the Move-in page and coming back (the import keeps running in the browser meanwhile), and
// is mirrored to sessionStorage so a reload during a server-side fetch picks up again.
import { useSyncExternalStore } from "react";
import { KINDS, ORDER, type Kind, type Log, type Row } from "./importEngine";

export type StepState = "waiting" | "running" | "done" | "failed";
export interface Step { key: string; label: string; state: StepState; /** Records handled (fetched or imported). */ count?: number; /** Records to handle, when known. */ total?: number; note?: string; warn?: boolean }
export type Phase = "fetching" | "importing" | "fetched" | "done" | "failed";

export interface Run {
  id: number;
  tenantId: string;
  /** "books_api", "odoo"… for a connection; "files:<source>" for an upload. */
  source: string;
  phase: Phase;
  /** Re-migrate: import as soon as the fetch ends. */
  autoImport: boolean;
  /** The job that was there before this run started (so its old status is not read as ours). */
  prevJobId?: string | null;
  /** The fetch was seen running on the server. */
  seenFetching?: boolean;
  steps: Step[];
  /** The live log line. */
  line: string;
  pct: number;
  /** Records handled so far / to handle (total 0 = not known yet). */
  done: number;
  total: number;
  startedAt: number;
  endedAt?: number;
  open: boolean;
}

const KEY = "dash-move-run";
const subs = new Set<() => void>();
const kindLabel = (k: string) => KINDS.find((x) => x.kind === k)?.label || k;
export const TAIL_LABELS: Record<string, string> = { kra: "KRA receipt details", finish: "Final checks" };

function load(): Run | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Run;
    // The import runs in this browser tab: a reload stopped it.
    if (r.phase === "importing") {
      return {
        ...r, phase: "failed", endedAt: Date.now(), open: true,
        steps: r.steps.map((s) => (s.state === "running" ? { ...s, state: "failed", note: "Stopped by a page reload" } : s)),
        line: "The page was reloaded during the import, which stops it. Press Import again: records already here are skipped.",
      };
    }
    return r;
  } catch { return null; }
}

let run: Run | null = load();

function emit() {
  try { if (run) sessionStorage.setItem(KEY, JSON.stringify(run)); else sessionStorage.removeItem(KEY); } catch { /* storage blocked */ }
  subs.forEach((f) => f());
}

export const isActive = (r: Run | null | undefined): boolean => !!r &&(r.phase === "fetching" || r.phase === "importing");

export const moveRun = {
  get: () => run,
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  start(init: Pick<Run, "tenantId" | "source" | "phase"> & Partial<Run>) {
    run = { autoImport: false, steps: [], line: "Starting…", pct: 2, done: 0, total: 0, open: true, ...init, id: Date.now(), startedAt: Date.now() };
    emit();
  },
  patch(fn: (r: Run) => Partial<Run>) { if (!run) return; run = { ...run, ...fn(run) }; emit(); },
  step(key: string, p: Partial<Step>) {
    if (!run) return;
    const has = run.steps.some((s) => s.key === key);
    const steps = has ? run.steps.map((s) => (s.key === key ? { ...s, ...p } : s)) : [...run.steps, { key, label: TAIL_LABELS[key] || kindLabel(key), state: "waiting" as StepState, ...p }];
    run = { ...run, steps }; emit();
  },
  finish(line: string) {
    moveRun.patch((r) => ({ phase: "done", pct: 100, line, endedAt: Date.now(), steps: r.steps.map((s) => (s.state === "running" || s.state === "waiting" ? { ...s, state: "done" } : s)) }));
  },
  fail(line: string) {
    moveRun.patch((r) => ({ phase: "failed", line, endedAt: Date.now(), steps: r.steps.map((s) => (s.state === "running" ? { ...s, state: "failed", note: line } : s)) }));
  },
  show: () => moveRun.patch(() => ({ open: true })),
  hide: () => moveRun.patch(() => ({ open: false })),
  clear: () => { run = null; emit(); },
};

/** The current run for this company (null when none). */
export function useMoveRun(tenantId: string | null | undefined): Run | null {
  const r = useSyncExternalStore(moveRun.subscribe, moveRun.get, moveRun.get);
  return r && tenantId && r.tenantId === tenantId ? r : null;
}

/**
 * Wires runImport to the run: one step per kind (waiting → running → done/failed) and a
 * percent that moves with the records imported, from `from`% to 95% (the rest is `tail`).
 */
export function trackImport(byKind: Map<Kind, Row[]>, from: number, tail: string[] = ["kra", "finish"]) {
  const kinds = ORDER.filter((k) => byKind.get(k)?.length);
  const size = (k: Kind) => byKind.get(k)?.length || 0;
  const total = kinds.reduce((a, k) => a + size(k), 0);
  let done = 0;
  let seen = 0;
  moveRun.patch((r) => {
    // Kinds the fetch looked for but brought nothing new for.
    const empty = r.steps.filter((s) => !kinds.includes(s.key as Kind) && !TAIL_LABELS[s.key])
      .map((s) => ({ ...s, state: "done" as StepState, note: s.note || "Nothing new" }));
    return {
      phase: "importing", total, done: 0, pct: Math.max(r.pct, from),
      line: `Importing ${total.toLocaleString()} records into your books…`,
      steps: [
        ...kinds.map((k) => ({ key: k, label: kindLabel(k), state: "waiting" as StepState, total: size(k), note: `${size(k).toLocaleString()} to import` })),
        ...empty,
        ...tail.map((t) => ({ key: t, label: TAIL_LABELS[t] || t, state: "waiting" as StepState })),
      ],
    };
  });
  const pctAt = (n: number) => Math.round(from + (95 - from) * (total ? n / total : 1));
  return {
    total,
    onKind: (kind: Kind, rows: number) => {
      moveRun.step(kind, { state: "running", note: `Importing ${rows.toLocaleString()} records…` });
      moveRun.patch(() => ({ line: `Importing ${kindLabel(kind).toLowerCase()}: ${rows.toLocaleString()} records…`, pct: pctAt(done + rows / 2) }));
    },
    onLog: (logs: Log[]) => {
      for (const l of logs.slice(seen)) {
        done += size(l.kind);
        const failed = l.errors.length > 0 && l.ok === 0 && l.skipped === 0;
        const note = failed ? l.errors[0]
          : `${l.ok.toLocaleString()} imported${l.skipped ? ` · ${l.skipped.toLocaleString()} already here` : ""}${l.errors.length ? ` · ${l.errors.length} problem${l.errors.length > 1 ? "s" : ""}: ${l.errors[0]}` : ""}`;
        moveRun.step(l.kind, { state: failed ? "failed" : "done", count: l.ok, note, warn: l.errors.length > 0 });
        moveRun.patch(() => ({ done, pct: pctAt(done), line: failed ? `${kindLabel(l.kind)} could not be imported: ${l.errors[0]}` : `${kindLabel(l.kind)}: ${note}` }));
      }
      seen = logs.length;
    },
  };
}

/** Steps and percent of a server-side fetch, from the job the status call returns. */
export function fetchState(job: any, autoImport: boolean) {
  const kinds: string[] = job.kinds || [];
  const finished = job.status === "fetched" || job.status === "imported";
  let last = -1;
  kinds.forEach((k, i) => { if (job.progress?.[k]) last = i; });
  const steps: Step[] = kinds.map((k, i) => {
    const p = job.progress?.[k];
    const n = Number(p?.fetched || 0);
    const state: StepState = finished || i < last ? "done" : i === last ? (job.status === "failed" ? "failed" : "running") : "waiting";
    return { key: k, label: kindLabel(k), state, count: n, note: p?.note || (n ? `${n.toLocaleString()} found` : state === "done" ? "None found" : state === "running" ? "Looking…" : "") };
  });
  const found = kinds.reduce((a, k) => a + Number(job.progress?.[k]?.fetched || 0), 0);
  const share = autoImport ? 40 : 100;
  const pct = finished ? share : Math.round(Math.max(2, kinds.length ? ((Math.max(last, 0) + 0.5) / kinds.length) * share : 2));
  return { steps, found, pct, current: last >= 0 && !finished ? kindLabel(kinds[last]) : "" };
}
