import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { Play, Square, Check, ChevronLeft, PackagePlus, Wrench, LogOut, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProducts } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import { cn } from "@/lib/utils";
import { sb, must } from "../lib/api";
import { JOB_SELECT, useLiveWorkshop, logEvent } from "../lib/data";
import { STATUS_LABEL, humanMinutes, type JobStatus } from "../lib/status";
import { useWorkshopLinks } from "../lib/nav";
import { JobStatusPill, MediaStrip, PlateTag, vehicleLabel } from "../components/bits";

function useMyJobs(userId?: string) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["gw-my-jobs", tenantId, userId], enabled: !!tenantId && !!userId, refetchInterval: 60_000,
    queryFn: async () => {
      const [byJob, byLine] = await Promise.all([
        sb.from("garage_jobs").select(JOB_SELECT).eq("tenant_id", tenantId).contains("mechanic_ids", [userId]).not("status", "in", "(collected,cancelled,ready)"),
        sb.from("garage_job_lines").select("job_id").eq("tenant_id", tenantId).contains("mechanic_ids", [userId]).neq("status", "done"),
      ]);
      const ids = [...new Set((must(byLine) as any[]).map((l) => l.job_id))];
      const extra = ids.length ? must(await sb.from("garage_jobs").select(JOB_SELECT).in("id", ids).not("status", "in", "(collected,cancelled,ready)")) as any[] : [];
      const map = new Map<string, any>();
      for (const j of [...(must(byJob) as any[]), ...extra]) map.set(j.id, j);
      return [...map.values()].sort((a, b) => (a.promised_at || "9").localeCompare(b.promised_at || "9"));
    },
  });
}

function RequestPart({ job, onDone }: { job: any; onDone: () => void }) {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const { data: products = [] } = useProducts();
  const [q, setQ] = useState("");
  const [qty, setQty] = useState("1");
  const [pick, setPick] = useState<any>(null);
  const list = useMemo(() => { const s = q.trim().toLowerCase(); return s.length < 2 || pick ? [] : (products as any[]).filter((p) => `${p.name} ${p.sku || ""}`.toLowerCase().includes(s)).slice(0, 8); }, [q, products, pick]);
  const send = async () => {
    const name = pick?.name || q.trim();
    if (!name) return;
    try {
      const line = must(await sb.from("garage_job_lines").insert({ tenant_id: tenantId, job_id: job.id, kind: "part", item_id: pick?.id || null, description: name, qty: Number(qty) || 1, rate: Number(pick?.price) || 0, tax_rate: Number(pick?.vat_rate) || 0, approved: null, is_extra: true }).select("id").single()) as any;
      must(await sb.from("garage_part_requests").insert({ tenant_id: tenantId, job_id: job.id, line_id: line.id, item_id: pick?.id || null, description: name, qty: Number(qty) || 1, status: pick ? "requested" : "to_order" }));
      await logEvent(tenantId!, job.id, "parts_requested", `Mechanic asked for ${qty} × ${name}`);
      toast({ title: "Asked from the store", description: "The service advisor gets the customer's approval for it." });
      setQ(""); setPick(null); setQty("1"); onDone();
    } catch (e: any) { toast({ title: "Not sent", description: e.message, variant: "destructive" }); }
  };
  return (
    <div className="space-y-2 rounded-2xl border border-border p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold"><PackagePlus className="h-4 w-4" /> Ask for a part</p>
      <input className="fi" value={pick ? pick.name : q} onChange={(e) => { setPick(null); setQ(e.target.value); }} placeholder="Enter the part name" />
      {list.map((p) => <button key={p.id} type="button" onClick={() => setPick(p)} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">{p.name} <span className="text-xs text-muted-foreground">{Number(p.stock || 0)} in stock</span></button>)}
      <div className="flex gap-2"><input className="fi w-20" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /><button type="button" onClick={send} className="h-10 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground">Send to store</button></div>
    </div>
  );
}

function MyJob({ job, back }: { job: any; back: () => void }) {
  const { user } = useAuth() as any;
  const tenantId = useTenantId();
  const { toast } = useToast();
  const { data, refetch } = useQuery({
    queryKey: ["gw-my-job", job.id],
    queryFn: async () => {
      const [lines, logs, media] = await Promise.all([
        sb.from("garage_job_lines").select("*").eq("job_id", job.id).neq("status", "cancelled").order("sort"),
        sb.from("garage_time_logs").select("*").eq("job_id", job.id),
        sb.from("garage_job_media").select("*").eq("job_id", job.id).order("created_at"),
      ]);
      return { lines: must(lines) as any[], logs: must(logs) as any[], media: must(media) as any[] };
    },
  });
  const [findings, setFindings] = useState(job.findings || "");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const lines = (data?.lines || []).filter((l) => l.kind === "labour" && l.approved !== false);
  const logs = data?.logs || [];
  const open = (lineId: string) => logs.find((x) => x.line_id === lineId && x.mechanic_id === user?.id && !x.ended_at);
  const spent = (lineId: string) => logs.filter((x) => x.line_id === lineId && x.mechanic_id === user?.id).reduce((s, x) => s + (x.ended_at ? Number(x.minutes || 0) : (now - Date.parse(x.started_at)) / 60000), 0);

  const clock = async (l: any) => {
    const o = open(l.id);
    if (o) await sb.from("garage_time_logs").update({ ended_at: new Date().toISOString() }).eq("id", o.id);
    else {
      // One line at a time: clock off anything else first.
      for (const x of logs.filter((x) => x.mechanic_id === user?.id && !x.ended_at)) await sb.from("garage_time_logs").update({ ended_at: new Date().toISOString() }).eq("id", x.id);
      const r = await sb.from("garage_time_logs").insert({ tenant_id: tenantId, job_id: job.id, line_id: l.id, mechanic_id: user?.id });
      if (r.error) return toast({ title: "Not clocked on", description: r.error.message, variant: "destructive" });
      await sb.from("garage_job_lines").update({ status: "in_progress", ...(l.mechanic_ids?.includes(user?.id) ? {} : { mechanic_ids: [...(l.mechanic_ids || []), user?.id] }) }).eq("id", l.id);
      if (["checked_in", "diagnosing", "waiting_parts"].includes(job.status) && l.approved === true) await sb.from("garage_jobs").update({ status: "in_progress" }).eq("id", job.id);
    }
    void refetch();
  };
  const done = async (l: any) => {
    const o = open(l.id);
    if (o) await sb.from("garage_time_logs").update({ ended_at: new Date().toISOString() }).eq("id", o.id);
    await sb.from("garage_job_lines").update({ status: "done" }).eq("id", l.id);
    const left = lines.filter((x) => x.id !== l.id && x.status !== "done" && x.approved === true);
    if (!left.length && job.status === "in_progress") {
      const { error } = await sb.from("garage_jobs").update({ status: "quality_check" }).eq("id", job.id);
      if (!error) toast({ title: "All work done: sent to quality check" });
    }
    void refetch();
  };

  return (
    <div className="space-y-3">
      <button type="button" onClick={back} className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ChevronLeft className="h-4 w-4" />My jobs</button>
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2"><PlateTag plate={job.vehicle?.plate} big /><JobStatusPill status={job.status} /></div>
        <p className="mt-1 font-medium">{vehicleLabel(job.vehicle)} · {job.job_no}</p>
        <p className="mt-1 rounded-lg bg-muted/50 p-2 text-sm">{job.complaint}</p>
        {job.internal_notes && <p className="mt-1 text-xs text-muted-foreground">Note: {job.internal_notes}</p>}
      </div>
      {lines.map((l) => {
        const o = open(l.id);
        return (
          <div key={l.id} className={cn("rounded-2xl border p-3", l.status === "done" ? "border-success/40 bg-success/5" : o ? "border-primary bg-primary/5" : "border-border bg-card")}>
            <p className={cn("font-medium", l.status === "done" && "line-through")}>{l.description}</p>
            <p className="text-xs text-muted-foreground">{l.approved === true ? "Approved" : "Waiting for the customer's approval"}{l.hours ? ` · ${l.hours} h sold` : ""} · you: {humanMinutes(spent(l.id))}</p>
            {l.status !== "done" && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" disabled={l.approved !== true && !o} onClick={() => clock(l)} className={cn("flex h-12 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold disabled:opacity-40", o ? "bg-destructive text-white" : "bg-primary text-primary-foreground")}>{o ? <><Square className="h-4 w-4" />Clock off</> : <><Play className="h-4 w-4" />Clock on</>}</button>
                <button type="button" disabled={l.approved !== true} onClick={() => done(l)} className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-success text-sm font-semibold text-success disabled:opacity-40"><Check className="h-4 w-4" />Done</button>
              </div>
            )}
          </div>
        );
      })}
      {!lines.length && <p className="text-center text-sm text-muted-foreground">No labour lines yet. Write your findings; the service advisor adds the work.</p>}
      <div className="rounded-2xl border border-border p-3">
        <p className="mb-1 text-sm font-semibold">Findings</p>
        <textarea className="fi" rows={3} value={findings} onChange={(e) => setFindings(e.target.value)} placeholder="Enter what you found" />
        <button type="button" onClick={async () => { await sb.from("garage_jobs").update({ findings }).eq("id", job.id); toast({ title: "Findings saved" }); }} className="mt-2 h-10 w-full rounded-xl border border-border text-sm font-semibold">Save findings</button>
      </div>
      <div className="rounded-2xl border border-border p-3">
        <p className="mb-2 text-sm font-semibold">Photos, videos and voice notes</p>
        <MediaStrip media={data?.media || []} meta={{ job_id: job.id, vehicle_id: job.vehicle_id, stage: "job" }} onChange={() => refetch()} />
      </div>
      <RequestPart job={job} onDone={() => refetch()} />
    </div>
  );
}

/** The mechanic's phone: my jobs today, clock on / off per line, photos, parts, done. */
export default function MechanicApp() {
  useLiveWorkshop();
  const { user, profile, signOut } = useAuth() as any;
  const { href } = useWorkshopLinks();
  const { data: jobs = [], refetch, isFetching } = useMyJobs(user?.id);
  const [openId, setOpenId] = useState<string | null>(null);
  const job = (jobs as any[]).find((j) => j.id === openId);
  return (
    <div className="mx-auto min-h-screen max-w-md bg-background px-3 pb-10 pt-[max(0.75rem,env(safe-area-inset-top))] text-foreground">
      <Helmet><title>My jobs</title></Helmet>
      <div className="mb-3 flex items-center justify-between">
        <div><p className="text-xs text-muted-foreground">Mechanic</p><h1 className="font-display text-lg font-bold">{String(profile?.display_name || "My jobs").split(" ")[0]}</h1></div>
        <div className="flex gap-2">
          <button type="button" onClick={() => refetch()} className="rounded-xl border border-border p-2" aria-label="Refresh"><RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /></button>
          <a href={href("/garage")} className="rounded-xl border border-border p-2" aria-label="Workshop"><Wrench className="h-4 w-4" /></a>
          {signOut && <button type="button" onClick={() => signOut()} className="rounded-xl border border-border p-2" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>}
        </div>
      </div>
      {job ? <MyJob key={job.id} job={job} back={() => setOpenId(null)} /> : (
        <div className="space-y-2">
          {!(jobs as any[]).length && <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No jobs for you right now. The foreman assigns cars on the workshop board.</p>}
          {(jobs as any[]).map((j) => (
            <button key={j.id} type="button" onClick={() => setOpenId(j.id)} className="block w-full rounded-2xl border border-border bg-card p-3 text-left active:scale-[.99]">
              <div className="flex items-center justify-between"><PlateTag plate={j.vehicle?.plate} big /><span className="text-xs text-muted-foreground">{STATUS_LABEL[j.status as JobStatus]}</span></div>
              <p className="mt-1 font-medium">{vehicleLabel(j.vehicle)}</p>
              <p className="line-clamp-2 text-sm text-muted-foreground">{j.complaint}</p>
              {j.bay && <p className="mt-1 text-xs">{j.bay}{j.promised_at ? ` · due ${new Date(j.promised_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}` : ""}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
