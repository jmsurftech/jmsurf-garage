import { useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { sb, must, wsApi } from "../lib/api";
import { useGarageSettings, useMechanics } from "../lib/data";
import { DEFAULT_QC } from "../lib/checklists";
import { MediaStrip, when } from "./bits";

/** Quality check before "ready": short checklist, road test notes, then the car is marked ready (and the customer told). */
export default function JobQC({ data, onChange }: { data: any; onChange: () => void }) {
  const { user } = useAuth() as any;
  const { toast } = useToast();
  const mech = useMechanics();
  const { data: settings } = useGarageSettings();
  const { job, lines, media } = data;
  const list: string[] = settings?.qc_checklist?.length ? settings.qc_checklist : DEFAULT_QC;
  const saved = job.qc || {};
  const [ticks, setTicks] = useState<Record<string, boolean>>(saved.items || {});
  const [road, setRoad] = useState<string>(saved.road_test || "");
  const [mileageOut, setMileageOut] = useState<string>(job.mileage_out ? String(job.mileage_out) : "");
  const [tell, setTell] = useState(true);
  const [busy, setBusy] = useState(false);
  const notDone = lines.filter((l: any) => l.approved === true && l.status !== "done" && l.status !== "cancelled");
  const allTicked = list.every((i) => ticks[i]);

  const save = async (pass: boolean) => {
    if (pass && !allTicked) return toast({ title: "Tick every check first", variant: "destructive" });
    if (pass && notDone.length) return toast({ title: `${notDone.length} approved line(s) are not marked done`, variant: "destructive" });
    setBusy(true);
    try {
      const qc = { items: ticks, road_test: road, passed: pass, by: user?.id, by_name: mech.nameOf(user?.id), at: new Date().toISOString() };
      must(await sb.from("garage_jobs").update({ qc, mileage_out: Number(mileageOut) || null }).eq("id", job.id));
      if (pass) {
        if (job.status === "in_progress") must(await sb.from("garage_jobs").update({ status: "quality_check" }).eq("id", job.id));
        must(await sb.from("garage_jobs").update({ status: "ready" }).eq("id", job.id));
        if (tell && job.customer?.phone) await wsApi("send-job", { job_id: job.id, kind: "ready" }).catch((e) => toast({ title: "Ready message not sent", description: e.message, variant: "destructive" }));
        toast({ title: "Passed: the car is ready" });
      } else {
        if (job.status === "quality_check") await sb.from("garage_jobs").update({ status: "in_progress" }).eq("id", job.id);
        toast({ title: "Sent back to the workshop" });
      }
      onChange();
    } catch (e: any) { toast({ title: "Not saved", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      {saved.at && <p className={cn("rounded-lg px-2 py-1.5 text-xs", saved.passed ? "bg-success/10 text-success" : "bg-warning/10")}>Last check {when(saved.at)} by {saved.by_name || "staff"}: {saved.passed ? "passed" : "failed"}</p>}
      {notDone.length > 0 && <p className="rounded-lg bg-warning/10 px-2 py-1.5 text-xs">Not done yet: {notDone.map((l: any) => l.description).join(", ")}</p>}
      <div className="grid gap-1.5 sm:grid-cols-2">
        {list.map((i) => (
          <label key={i} className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm", ticks[i] ? "border-success/40 bg-success/5" : "border-border")}>
            <input type="checkbox" checked={!!ticks[i]} onChange={(e) => setTicks((t) => ({ ...t, [i]: e.target.checked }))} /> {i}
          </label>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
        <textarea className="fi" rows={2} value={road} onChange={(e) => setRoad(e.target.value)} placeholder="Enter road test notes (noises, pulling, brakes, gear changes)" />
        <input className="fi" inputMode="numeric" value={mileageOut} onChange={(e) => setMileageOut(e.target.value.replace(/\D/g, ""))} placeholder="Mileage out (km)" />
      </div>
      <MediaStrip compact media={media.filter((m: any) => m.stage === "quality_check")} meta={{ job_id: job.id, vehicle_id: job.vehicle_id, stage: "quality_check" }} onChange={onChange} />
      <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} /> Tell the customer by SMS that the car is ready</label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !["in_progress", "quality_check"].includes(job.status)} onClick={() => save(true)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-success px-3 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Passed: car ready
        </button>
        <button type="button" disabled={busy || job.status !== "quality_check"} onClick={() => save(false)} className="h-9 rounded-xl border border-border px-3 text-sm disabled:opacity-50">Failed: back to work</button>
      </div>
      {!["in_progress", "quality_check"].includes(job.status) && <p className="text-[11px] text-muted-foreground">The quality check is done when the job is in progress or in quality check.</p>}
    </div>
  );
}
