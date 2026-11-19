import { useEffect, useMemo, useState } from "react";
import { Clock, User, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { sb } from "../lib/api";
import { useBays, useMechanics } from "../lib/data";
import { BOARD_STAGES, STATUS_LABEL, moveProblem, stageMinutes, humanMinutes, type JobStatus } from "../lib/status";
import { PlateTag, vehicleLabel } from "./bits";

export type BoardMode = "stage" | "bay";

function JobTile({ j, tv, nameOf, onOpen, now }: { j: any; tv?: boolean; nameOf: (id: string) => string; onOpen?: (id: string) => void; now: number }) {
  const mins = Number(stageMinutes(j, now)[j.status]) || 0;
  const late = j.promised_at && Date.parse(j.promised_at) < now && !["ready", "collected"].includes(j.status);
  const slow = mins > (j.status === "waiting_approval" ? 120 : j.status === "waiting_parts" ? 24 * 60 : 8 * 60);
  return (
    <div draggable={!tv} onDragStart={(e) => e.dataTransfer.setData("text/job", j.id)} onClick={() => onOpen?.(j.id)}
      className={cn("cursor-pointer select-none rounded-xl border bg-card p-2 shadow-sm transition hover:shadow-md", late ? "border-destructive/60" : "border-border", tv && "p-3")}>
      <div className="flex items-center justify-between gap-2">
        <PlateTag plate={j.vehicle?.plate} big={tv} />
        <span className={cn("inline-flex items-center gap-0.5 tabular-nums", tv ? "text-base" : "text-[11px]", slow ? "font-semibold text-destructive" : "text-muted-foreground")}><Clock className="h-3 w-3" />{humanMinutes(mins)}</span>
      </div>
      <p className={cn("mt-1 truncate font-medium", tv ? "text-base" : "text-xs")}>{vehicleLabel(j.vehicle) || j.job_no}</p>
      <p className={cn("truncate text-muted-foreground", tv ? "text-sm" : "text-[11px]")}>{j.complaint || ""}</p>
      <div className={cn("mt-1 flex flex-wrap items-center gap-x-2 text-muted-foreground", tv ? "text-sm" : "text-[11px]")}>
        {(j.mechanic_ids || []).length > 0 && <span className="inline-flex items-center gap-0.5"><User className="h-3 w-3" />{(j.mechanic_ids || []).map(nameOf).filter(Boolean).map((n: string) => n.split(" ")[0]).join(", ")}</span>}
        {j.bay && <span>{j.bay}</span>}
        {late && <span className="inline-flex items-center gap-0.5 font-semibold text-destructive"><AlertTriangle className="h-3 w-3" />Late</span>}
        {!late && j.promised_at && <span>Due {new Date(j.promised_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</span>}
      </div>
    </div>
  );
}

/** Live workshop board: by stage (drag to move) or by bay (drag to change bay). */
export default function Board({ jobs, mode, tv, onOpen, onChanged }: { jobs: any[]; mode: BoardMode; tv?: boolean; onOpen?: (id: string) => void; onChanged?: () => void }) {
  const { toast } = useToast();
  const { data: bays = [] } = useBays();
  const mech = useMechanics();
  const [now, setNow] = useState(Date.now());
  const [over, setOver] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const columns = useMemo(() => {
    if (mode === "stage") return BOARD_STAGES.map((s) => ({ key: s, label: STATUS_LABEL[s], jobs: jobs.filter((j) => j.status === s) }));
    const active = (bays as any[]).filter((b) => b.active);
    return [
      ...active.map((b) => ({ key: b.id, label: b.name, jobs: jobs.filter((j) => j.bay_id === b.id) })),
      { key: "none", label: "Waiting for a bay", jobs: jobs.filter((j) => !j.bay_id || !active.some((b) => b.id === j.bay_id)) },
    ];
  }, [jobs, mode, bays]);

  const drop = async (col: string, id: string) => {
    setOver(null);
    const j = jobs.find((x) => x.id === id);
    if (!j) return;
    let patch: Record<string, unknown>;
    if (mode === "stage") {
      if (j.status === col) return;
      const problem = moveProblem(j.status as JobStatus, col as JobStatus, j);
      if (problem) return toast({ title: "Not moved", description: col === "ready" ? "Open the job and do the quality check first." : problem, variant: "destructive" });
      if (col === "ready") return toast({ title: "Not moved", description: "Open the job and do the quality check first.", variant: "destructive" });
      patch = { status: col };
    } else {
      const bay = (bays as any[]).find((b) => b.id === col);
      patch = { bay_id: bay?.id || null, bay: bay?.name || null };
    }
    const { error } = await sb.from("garage_jobs").update(patch).eq("id", id);
    if (error) toast({ title: "Not moved", description: error.message, variant: "destructive" });
    onChanged?.();
  };

  return (
    <div className={cn("flex gap-2 overflow-x-auto pb-2", tv && "gap-3")}>
      {columns.map((c) => (
        <div key={c.key} onDragOver={(e) => { e.preventDefault(); setOver(c.key); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/job"); if (id) void drop(c.key, id); }}
          className={cn("flex w-[78vw] max-w-[260px] shrink-0 flex-col rounded-2xl border bg-muted/30 sm:w-56", over === c.key ? "border-primary bg-primary/5" : "border-border", tv && "w-72 max-w-none sm:w-72")}>
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <span className={cn("font-semibold", tv ? "text-lg" : "text-xs")}>{c.label}</span>
            <span className={cn("rounded-full bg-background px-1.5 tabular-nums", tv ? "text-base" : "text-[11px]")}>{c.jobs.length}</span>
          </div>
          <div className="flex-1 space-y-1.5 px-1.5 pb-1.5">
            {c.jobs.map((j) => <JobTile key={j.id} j={j} tv={tv} nameOf={mech.nameOf} onOpen={onOpen} now={now} />)}
            {!c.jobs.length && <p className={cn("px-1 py-3 text-center text-muted-foreground", tv ? "text-sm" : "text-[11px]")}>—</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
