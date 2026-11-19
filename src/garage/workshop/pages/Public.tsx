import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Check, X, Loader2, Phone, Star, CheckCircle2, Clock, Wrench, CalendarDays, Receipt, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { pubApi } from "../lib/api";
import { STATUS_CUSTOMER, type JobStatus } from "../lib/status";
import { lineGross } from "../lib/totals";
import { formatPlate } from "../lib/plate";

const money = (n: any) => `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const when = (iso?: string | null, time = true) => (iso ? new Date(iso).toLocaleString("en-KE", { weekday: "short", day: "numeric", month: "short", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}) }) : "");

function Shell({ garage, title, children }: { garage?: any; title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Helmet><title>{title}</title><meta name="robots" content="noindex" /></Helmet>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          {garage?.logo_url ? <img src={garage.logo_url} alt="" className="h-9 w-9 rounded-lg object-contain" /> : <span className="g-tile xs"><Wrench className="h-4 w-4" /></span>}
          <div className="min-w-0 flex-1"><p className="truncate font-display font-bold">{garage?.name || "Garage"}</p>{garage?.phone && <a href={`tel:${garage.phone}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" />{garage.phone}</a>}</div>
        </div>
      </header>
      <main className="mx-auto max-w-xl space-y-3 px-4 py-4 pb-16">{children}</main>
      <footer className="pb-6 text-center text-[11px] text-muted-foreground">Powered by JMSURF Garage</footer>
    </div>
  );
}
const Card = ({ children, className }: { children: ReactNode; className?: string }) => <section className={cn("rounded-2xl border border-border bg-card p-4", className)}>{children}</section>;
const Plate = ({ p }: { p?: string }) => p ? <span className="inline-flex rounded-md border-2 border-foreground/80 bg-white px-1.5 font-mono text-sm font-bold tracking-wider text-black">{p}</span> : null;

function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => { let live = true; fn().then((d) => live && setData(d)).catch((e) => live && setError(e.message)); return () => { live = false; }; }, [...deps, n]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload: () => setN((x) => x + 1) };
}

function Failed({ error }: { error: string }) {
  return <Shell title="Garage"><Card className="text-center"><p className="font-semibold">{error}</p><p className="mt-1 text-sm text-muted-foreground">Contact the garage if you need help.</p></Card></Shell>;
}
const Loading = () => <Shell title="Garage"><div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></Shell>;

/* ------------------------------------------------------------------ /e/:token */

export function EstimateApproval() {
  const { token } = useParams<{ token: string }>();
  const { data, error, reload } = useLoad<any>(() => pubApi("estimate", { token }), [token]);
  const [dec, setDec] = useState<Record<string, "approved" | "declined">>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);
  useEffect(() => {
    if (!data) return;
    const d: Record<string, any> = {};
    for (const l of data.estimate.lines || []) d[l.id] = l.decision || ((l.priority || "must") === "must" ? "approved" : "declined");
    setDec(d);
  }, [data]);
  const total = useMemo(() => (data?.estimate.lines || []).filter((l: any) => dec[l.id] === "approved").reduce((s: number, l: any) => s + lineGross(l), 0), [data, dec]);
  if (error) return <Failed error={error} />;
  if (!data) return <Loading />;
  const e = data.estimate;
  const answered = !["sent", "viewed"].includes(e.status);
  const send = async () => {
    setBusy(true); setFail(null);
    try { setDone(await pubApi("estimate/respond", { token, decisions: dec, note })); reload(); }
    catch (x: any) { setFail(x.message); }
    finally { setBusy(false); }
  };
  const groups: [string, string][] = [["must", "Needed now"], ["advised", "Advised soon"], ["optional", "Optional"]];

  return (
    <Shell garage={data.garage} title={`Estimate ${data.job.job_no}`}>
      <Card>
        <div className="flex flex-wrap items-center gap-2"><Plate p={data.vehicle?.plate} /><span className="font-medium">{[data.vehicle?.make, data.vehicle?.model].filter(Boolean).join(" ")}</span></div>
        <h1 className="mt-2 font-display text-xl font-bold">{e.kind === "extra" ? "Extra work found" : "Your estimate"}</h1>
        <p className="text-sm text-muted-foreground">Job {data.job.job_no} · version {e.version}{e.expires_at ? ` · valid until ${when(e.expires_at, false)}` : ""}</p>
        {e.message && <p className="mt-2 rounded-lg bg-muted/50 p-2 text-sm">{e.message}</p>}
        {data.job.findings && <p className="mt-2 text-sm"><b>What we found:</b> {data.job.findings}</p>}
      </Card>

      {done || answered ? (
        <Card className="text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
          <p className="mt-2 font-semibold">{e.status === "expired" ? "This estimate has expired" : "Thank you, the garage has your answer"}</p>
          {(done?.approved_total ?? e.approved_total) > 0 && <p className="text-sm text-muted-foreground">Approved: {money(done?.approved_total ?? e.approved_total)}</p>}
          {data.job.tracking_token && <a href={`/t/${data.job.tracking_token}`} className="mt-3 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Follow your car</a>}
        </Card>
      ) : (
        <>
          {groups.map(([key, label]) => {
            const ls = (e.lines || []).filter((l: any) => (l.priority || "must") === key);
            if (!ls.length) return null;
            return (
              <Card key={key}>
                <p className={cn("mb-2 text-xs font-semibold uppercase", key === "must" ? "text-destructive" : key === "advised" ? "text-warning" : "text-muted-foreground")}>{label}</p>
                <div className="space-y-2">
                  {ls.map((l: any) => (
                    <div key={l.id} className="rounded-xl border border-border p-2.5">
                      <div className="flex items-start gap-2"><p className="flex-1 text-sm font-medium">{l.description}</p><span className="text-sm font-semibold tabular-nums">{money(lineGross(l))}</span></div>
                      {(data.photos || []).filter((p: any) => p.line_id === l.id).map((p: any) => <img key={p.url} src={p.url} alt="" className="mt-2 max-h-48 rounded-lg" />)}
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setDec((d) => ({ ...d, [l.id]: "approved" }))} className={cn("flex h-10 items-center justify-center gap-1 rounded-xl border text-sm font-semibold", dec[l.id] === "approved" ? "border-success bg-success text-white" : "border-border")}><Check className="h-4 w-4" />Yes, do it</button>
                        <button type="button" onClick={() => setDec((d) => ({ ...d, [l.id]: "declined" }))} className={cn("flex h-10 items-center justify-center gap-1 rounded-xl border text-sm font-semibold", dec[l.id] === "declined" ? "border-destructive bg-destructive text-white" : "border-border")}><X className="h-4 w-4" />No</button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
          {(data.photos || []).filter((p: any) => !p.line_id).length > 0 && (
            <Card><p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Photos</p><div className="grid grid-cols-3 gap-2">{data.photos.filter((p: any) => !p.line_id).map((p: any) => <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer"><img src={p.url} alt={p.caption || ""} className="aspect-square w-full rounded-lg object-cover" /></a>)}</div></Card>
          )}
          <Card>
            <textarea className="fi" rows={2} value={note} onChange={(x) => setNote(x.target.value)} placeholder="Add a note for the garage (optional)" />
            <div className="mt-3 flex items-center justify-between"><span className="text-sm text-muted-foreground">You approve</span><span className="font-display text-xl font-bold tabular-nums">{money(total)}</span></div>
            {e.deposit_amount ? <p className="text-xs text-muted-foreground">The garage asks for a deposit of {money(e.deposit_amount)} before starting.</p> : null}
            {fail && <p className="mt-2 text-sm text-destructive">{fail}</p>}
            <button type="button" disabled={busy} onClick={send} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Send my answer</button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">Your answer, the time and this link are saved with the job.</p>
          </Card>
        </>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ /t/:token */

const STEPS: JobStatus[] = ["checked_in", "diagnosing", "waiting_approval", "in_progress", "quality_check", "ready", "collected"];

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} stars`}><Star className={cn("h-7 w-7", n <= value ? "fill-warning text-warning" : "text-muted-foreground")} /></button>)}</div>;
}

export function JobTracking() {
  const { token } = useParams<{ token: string }>();
  const { data, error, reload } = useLoad<any>(() => pubApi("track", { token }), [token]);
  const [rate, setRate] = useState({ rating: 0, mechanic: 0, comment: "" });
  const [rated, setRated] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(reload, 60_000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <Failed error={error} />;
  if (!data) return <Loading />;
  const j = data.job;
  const status = j.status as JobStatus;
  const at = (s: string) => data.timeline.filter((x: any) => x.to_status === s).pop()?.at;
  const idx = STEPS.indexOf(status === "waiting_parts" ? "in_progress" : status);
  const sendRating = async () => {
    if (!rate.rating) return setFail("Choose 1 to 5 stars");
    try { await pubApi("track/rate", { token, rating: rate.rating, mechanic_rating: rate.mechanic || undefined, comment: rate.comment }); setRated(true); setFail(null); }
    catch (e: any) { setFail(e.message); }
  };
  return (
    <Shell garage={data.garage} title={`Job ${j.job_no}`}>
      <Card>
        <div className="flex flex-wrap items-center gap-2"><Plate p={data.vehicle?.plate ? formatPlate(data.vehicle.plate) : undefined} /><span className="font-medium">{[data.vehicle?.make, data.vehicle?.model].filter(Boolean).join(" ")}</span></div>
        <h1 className={cn("mt-2 font-display text-2xl font-bold", status === "ready" && "text-success")}>{STATUS_CUSTOMER[status] || status}</h1>
        <p className="text-sm text-muted-foreground">Job {j.job_no}{j.promised_at && !["ready", "collected"].includes(status) ? ` · expected ${when(j.promised_at)}` : ""}{j.ready_at && status === "ready" ? ` · ready since ${when(j.ready_at)}` : ""}</p>
        {j.estimate_token && <a href={`/e/${j.estimate_token}`} className="mt-3 flex h-11 items-center justify-center rounded-xl bg-warning text-sm font-semibold text-white">Approve or decline the work</a>}
      </Card>
      {status !== "cancelled" && (
        <Card>
          <ol className="space-y-2">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", i < idx ? "bg-success text-white" : i === idx ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{i < idx ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
                <span className={cn("flex-1 text-sm", i === idx ? "font-semibold" : i > idx && "text-muted-foreground")}>{STATUS_CUSTOMER[s]}</span>
                {at(s) && <span className="text-[11px] text-muted-foreground">{when(at(s))}</span>}
              </li>
            ))}
          </ol>
          {status === "waiting_parts" && <p className="mt-2 flex items-center gap-1 text-xs text-warning"><Clock className="h-3.5 w-3.5" />Waiting for parts</p>}
        </Card>
      )}
      {j.customer_notes && <Card><p className="text-xs font-semibold uppercase text-muted-foreground">From the garage</p><p className="mt-1 whitespace-pre-line text-sm">{j.customer_notes}</p></Card>}
      {data.work?.length > 0 && <Card><p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Work approved</p><ul className="space-y-1 text-sm">{data.work.map((w: any, i: number) => <li key={i} className="flex items-center gap-2">{w.status === "done" ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Wrench className="h-4 w-4 text-muted-foreground" />}{w.description}</li>)}</ul></Card>}
      {data.photos?.length > 0 && (
        <Card><p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Photos</p>
          <div className="grid grid-cols-3 gap-2">{data.photos.map((p: any) => p.kind === "video" ? <video key={p.url} src={p.url} controls className="aspect-square w-full rounded-lg object-cover" /> : <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer"><img src={p.url} alt={p.caption || ""} className="aspect-square w-full rounded-lg object-cover" /></a>)}</div>
        </Card>
      )}
      {data.invoices?.length > 0 && (
        <Card>
          <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground"><Receipt className="h-3.5 w-3.5" />Bill</p>
          <div className="space-y-2">
            {data.invoices.map((inv: any) => (
              <div key={inv.number} className="rounded-xl border border-border p-2.5">
                <div className="flex items-center justify-between text-sm"><span>Invoice {inv.number}</span><b className="tabular-nums">{money(inv.total)}</b></div>
                {inv.balance > 0.5 ? <p className="text-xs text-destructive">Balance {money(inv.balance)}</p> : <p className="text-xs text-success">Paid in full</p>}
                {inv.pay && inv.balance > 0.5 && <a href={inv.pay} className="mt-2 flex h-11 items-center justify-center rounded-xl bg-success text-sm font-semibold text-white">Pay with M-Pesa</a>}
                {inv.etims_qr_url && <a href={inv.etims_qr_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary"><ShieldCheck className="h-3.5 w-3.5" />KRA eTIMS receipt {inv.etims_rcpt_no || ""}</a>}
              </div>
            ))}
          </div>
        </Card>
      )}
      {["ready", "collected"].includes(status) && (
        <Card>
          {j.rated || rated ? <p className="text-center text-sm">Thank you for rating us{j.rating ? ` ${j.rating}/5` : ""}.</p> : (
            <div className="space-y-2">
              <p className="font-semibold">How did we do?</p>
              <Stars value={rate.rating} onChange={(n) => setRate({ ...rate, rating: n })} />
              <p className="text-sm text-muted-foreground">And the mechanic who worked on your car?</p>
              <Stars value={rate.mechanic} onChange={(n) => setRate({ ...rate, mechanic: n })} />
              <textarea className="fi" rows={2} value={rate.comment} onChange={(e) => setRate({ ...rate, comment: e.target.value })} placeholder="Tell us more (optional)" />
              {fail && <p className="text-sm text-destructive">{fail}</p>}
              <button type="button" onClick={sendRating} className="h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground">Send rating</button>
            </div>
          )}
        </Card>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ /book/:slug */

export function OnlineBooking() {
  const { slug } = useParams<{ slug: string }>();
  const { data, error } = useLoad<any>(() => pubApi("book/info", { slug }), [slug]);
  const [f, setF] = useState({ name: "", phone: "", plate: "", vehicle_desc: "", service: "", notes: "" });
  const [day, setDay] = useState("");
  const [slot, setSlot] = useState("");
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);
  const days = useMemo(() => {
    if (!data) return [];
    const out: Date[] = [];
    for (let i = 0; out.length < 14 && i < 30; i++) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
      const dow = d.getDay() === 0 ? 7 : d.getDay();
      if ((data.open_days || []).includes(dow)) out.push(d);
    }
    return out;
  }, [data]);
  const slots = useMemo(() => {
    if (!data || !day) return [];
    const out: { iso: string; label: string; full: boolean }[] = [];
    const base = new Date(`${day}T00:00`);
    for (let m = data.open_hour * 60; m + data.slot_minutes <= data.close_hour * 60; m += data.slot_minutes) {
      const t = new Date(base.getTime() + m * 60000);
      if (t.getTime() < Date.now() + 30 * 60000) continue;
      const iso = t.toISOString();
      out.push({ iso, label: t.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }), full: (data.full || []).includes(iso.slice(0, 16)) });
    }
    return out;
  }, [data, day]);
  if (error) return <Failed error={error} />;
  if (!data) return <Loading />;
  const book = async () => {
    setBusy(true); setFail(null);
    try { setDone(await pubApi("book", { slug, ...f, starts_at: slot })); }
    catch (e: any) { setFail(e.message); }
    finally { setBusy(false); }
  };
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (done) return (
    <Shell garage={data.garage} title="Booked">
      <Card className="text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-success" /><p className="mt-2 font-display text-xl font-bold">You are booked</p>
        <p className="text-sm text-muted-foreground">{when(done.starts_at)} · reference {done.booking_no}</p><p className="mt-2 text-sm">We have sent you an SMS. The garage will confirm shortly.</p></Card>
    </Shell>
  );
  return (
    <Shell garage={data.garage} title={`Book a service · ${data.garage.name}`}>
      <Card>
        <h1 className="flex items-center gap-2 font-display text-xl font-bold"><CalendarDays className="h-5 w-5" />Book your car in</h1>
        {data.intro && <p className="mt-1 text-sm text-muted-foreground">{data.intro}</p>}
      </Card>
      <Card>
        <p className="mb-2 text-sm font-semibold">1. Choose a day</p>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {days.map((d) => { const k = ymd(d); return <button key={k} type="button" onClick={() => { setDay(k); setSlot(""); }} className={cn("flex w-14 shrink-0 flex-col items-center rounded-xl border py-1.5 text-xs", day === k ? "border-primary bg-primary text-primary-foreground" : "border-border")}><span>{d.toLocaleDateString("en-KE", { weekday: "short" })}</span><b className="text-base">{d.getDate()}</b><span>{d.toLocaleDateString("en-KE", { month: "short" })}</span></button>; })}
        </div>
        {day && <><p className="mb-2 mt-3 text-sm font-semibold">2. Choose a time</p>
          <div className="grid grid-cols-4 gap-1.5">{slots.map((s) => <button key={s.iso} type="button" disabled={s.full} onClick={() => setSlot(s.iso)} className={cn("h-9 rounded-xl border text-sm disabled:opacity-30", slot === s.iso ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{s.label}</button>)}</div>
          {!slots.length && <p className="text-sm text-muted-foreground">No times left that day.</p>}</>}
      </Card>
      {slot && (
        <Card>
          <p className="mb-2 text-sm font-semibold">3. Your details</p>
          <div className="space-y-2">
            <input className="fi" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Enter your name" autoComplete="name" />
            <input className="fi" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="07XXXXXXXX" autoComplete="tel" />
            <input className="fi font-mono uppercase" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} placeholder="Enter number plate" />
            <input className="fi" value={f.vehicle_desc} onChange={(e) => setF({ ...f, vehicle_desc: e.target.value })} placeholder="Enter make and model (optional)" />
            {data.services?.length > 0 ? (
              <select className="fi" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}><option value="">What do you need?</option>{data.services.map((s: string) => <option key={s} value={s}>{s}</option>)}<option value="Other">Other</option></select>
            ) : <input className="fi" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} placeholder="Enter what you need" />}
            <textarea className="fi" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Describe the problem (optional)" />
          </div>
          {fail && <p className="mt-2 text-sm text-destructive">{fail}</p>}
          <button type="button" disabled={busy} onClick={book} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Book {when(slot)}</button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">Your name and number are used only for this booking and reminders about it.</p>
        </Card>
      )}
    </Shell>
  );
}
