import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useTenant } from "@/hooks/useTenant";
import { useJobs, useLiveWorkshop, useRefresh } from "../lib/data";
import Board, { type BoardMode } from "../components/Board";

/** Full-screen workshop board for a TV: every bay, car, mechanic, stage and time in stage. Switches view every 30 seconds. */
export default function BoardTV() {
  useLiveWorkshop();
  const refresh = useRefresh();
  const { tenant } = useTenant() as any;
  const { data: jobs = [] } = useJobs({ open: true });
  const [mode, setMode] = useState<BoardMode>("stage");
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    const r = setInterval(() => refresh(), 60_000);
    const m = setInterval(() => setMode((x) => (x === "stage" ? "bay" : "stage")), 30_000);
    return () => { clearInterval(t); clearInterval(r); clearInterval(m); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (s: string) => (jobs as any[]).filter((j) => j.status === s).length;
  return (
    <div className="min-h-screen bg-background p-4 text-foreground">
      <Helmet><title>Workshop board</title></Helmet>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">{tenant?.business_name || "Workshop"}</h1>
          <p className="text-sm text-muted-foreground">{mode === "stage" ? "By stage" : "By bay"} · {(jobs as any[]).length} cars · {count("ready")} ready · {count("waiting_parts")} waiting parts · {count("waiting_approval")} waiting approval</p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setMode(mode === "stage" ? "bay" : "stage")} className="rounded-xl border border-border px-3 py-1.5 text-sm">Switch view</button>
          <button type="button" onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)} className="rounded-xl border border-border px-3 py-1.5 text-sm">Full screen</button>
          <span className="font-display text-3xl font-bold tabular-nums">{clock.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>
      <Board jobs={jobs as any[]} mode={mode} tv />
    </div>
  );
}
