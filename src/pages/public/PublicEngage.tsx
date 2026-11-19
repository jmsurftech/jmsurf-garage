import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { CalendarClock, Clock, CheckCircle2, Ticket, MapPin, GraduationCap, PlayCircle, Circle, ChevronLeft, ChevronRight, Smartphone, Loader2 } from "lucide-react";
import { Orbs } from "@/components/brand/Orbs";
import { DashMark } from "@/components/brand/DashLogo";
import PoweredBy from "@/components/PoweredBy";
import { cn } from "@/lib/utils";

async function pub<T = any>(path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/pub/${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `Request failed (${res.status})`);
  return j as T;
}
const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const EAT = 3 * 60; // company time zone (minutes east of UTC)
const localTime = (iso: string) => new Date(Date.parse(iso) + EAT * 60_000).toISOString().slice(11, 16);
const localDate = (d: Date) => new Date(d.getTime() + EAT * 60_000).toISOString().slice(0, 10);

function Shell({ title, company, logo, children }: { title: string; company?: string; logo?: string | null; children: ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-4 py-10">
      <Helmet><title>{`${title}${company ? ` · ${company}` : ""}`}</title><meta name="robots" content="noindex" /></Helmet>
      <Orbs intensity="subtle" />
      <div className="relative mx-auto w-full max-w-3xl">
        <header className="mb-8 flex items-center gap-3">
          {logo ? <img src={logo} alt="" className="h-12 w-12 rounded-2xl object-contain shadow" /> : <DashMark className="h-12 w-12" />}
          <div><p className="font-display text-xl font-extrabold text-foreground">{company || " "}</p><p className="text-sm text-muted-foreground">{title}</p></div>
        </header>
        {children}
        <p className="mt-10 text-center"><PoweredBy /></p>
      </div>
    </main>
  );
}
const Card = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn("rounded-3xl border border-border bg-card/95 p-6 shadow-xl backdrop-blur", className)}>{children}</div>;
const Err = ({ text }: { text: string }) => <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{text}</p>;

/* ------------------------------------------------------------------ booking */

export function BookPage() {
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState("");
  const [type, setType] = useState<any>(null);
  const [day, setDay] = useState(() => localDate(new Date()));
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slot, setSlot] = useState("");
  const [f, setF] = useState({ name: "", phone: "", email: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  useEffect(() => { pub("book/info").then(setInfo).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    if (!type) return;
    setSlots(null); setSlot("");
    pub(`book/slots?type=${type.id}&date=${day}`).then((r) => setSlots(r.slots)).catch((e) => setError(e.message));
  }, [type, day]);
  const days = useMemo(() => Array.from({ length: 21 }, (_, i) => new Date(Date.now() + i * 86400_000)).filter((d) => !info || info.days.includes(new Date(localDate(d)).getUTCDay())), [info]);
  const book = async () => {
    setBusy(true); setError("");
    try { setDone(await pub("book", { type: type.id, start: slot, ...f })); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  if (error && !info) return <Shell title="Book an appointment"><Card><Err text={error} /></Card></Shell>;
  if (!info) return <Shell title="Book an appointment"><Card><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></Card></Shell>;
  if (done) return (
    <Shell title="Book an appointment" company={info.company} logo={info.logo}>
      <Card className="text-center"><CheckCircle2 className="mx-auto h-14 w-14 text-success" /><h1 className="mt-4 font-display text-2xl font-bold">You're booked</h1><p className="mt-2 text-muted-foreground">{type.name} on {done.when} · reference {done.number}. We've sent you an SMS.</p></Card>
    </Shell>
  );
  return (
    <Shell title="Book an appointment" company={info.company} logo={info.logo}>
      <div className="space-y-5">
        <Card>
          <p className="mb-3 font-display text-lg font-bold">1. Choose a service</p>
          {!info.types.length && <p className="text-sm text-muted-foreground">No services are open for online booking yet.</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {info.types.map((t: any) => (
              <button key={t.id} onClick={() => setType(t)} className={cn("rounded-2xl border p-4 text-left transition-all", type?.id === t.id ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-primary/40")}>
                <p className="font-semibold">{t.name}</p>
                <p className="mt-1 flex items-center gap-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{t.minutes} min</span>{t.price > 0 && <span>{kes(t.price)}</span>}</p>
                {t.description && <p className="mt-2 text-xs text-muted-foreground">{t.description}</p>}
              </button>
            ))}
          </div>
        </Card>
        {type && (
          <Card>
            <p className="mb-3 font-display text-lg font-bold">2. Pick a day and time</p>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {days.map((d) => { const k = localDate(d); return (
                <button key={k} onClick={() => setDay(k)} className={cn("flex min-w-[64px] flex-col items-center rounded-2xl border px-3 py-2 text-xs", day === k ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                  <span>{new Date(k).toLocaleDateString("en-KE", { weekday: "short" })}</span><b className="text-lg">{k.slice(8)}</b><span>{new Date(k).toLocaleDateString("en-KE", { month: "short" })}</span>
                </button>
              ); })}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {slots === null ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : !slots.length ? <p className="col-span-full text-sm text-muted-foreground">No free times on this day.</p>
                : slots.map((s) => <button key={s} onClick={() => setSlot(s)} className={cn("rounded-xl border py-2 text-sm font-semibold", slot === s ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/40")}>{localTime(s)}</button>)}
            </div>
          </Card>
        )}
        {slot && (
          <Card>
            <p className="mb-3 font-display text-lg font-bold">3. Your details</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="fi h-11" placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              <input className="fi h-11" placeholder="Phone (M-Pesa number)" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
              <input className="fi h-11 sm:col-span-2" placeholder="Email (optional)" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
              <textarea className="fi sm:col-span-2" rows={2} placeholder="Anything we should know? (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
            </div>
            {error && <div className="mt-3"><Err text={error} /></div>}
            <button disabled={busy || !f.name || !f.phone} onClick={() => void book()} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary font-semibold text-primary-foreground disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} Book {type.name} at {localTime(slot)}
            </button>
          </Card>
        )}
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ events */

export function EventsPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<any>(null);
  const [f, setF] = useState({ name: "", phone: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  useEffect(() => { pub("events").then(setData).catch((e) => setError(e.message)); }, []);
  const reg = async () => {
    setBusy(true); setError("");
    try { setDone(await pub("events/register", { event: open.id, ...f })); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  if (!data) return <Shell title="Events"><Card>{error ? <Err text={error} /> : <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}</Card></Shell>;
  return (
    <Shell title="Events" company={data.company} logo={data.logo}>
      {done ? (
        <Card className="text-center">
          <CheckCircle2 className="mx-auto h-14 w-14 text-success" />
          <h1 className="mt-4 font-display text-2xl font-bold">{done.price > 0 ? "Almost done: pay on your phone" : "You're registered"}</h1>
          <p className="mt-2 text-muted-foreground">Ticket {done.ticket} for {open.title}.</p>
          {done.price > 0 && (done.prompt?.sent
            ? <p className="mt-3 inline-flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2 text-sm text-success"><Smartphone className="h-4 w-4" /> An M-Pesa prompt for {kes(done.price)} was sent. Enter your PIN to confirm.</p>
            : <p className="mt-3 text-sm text-muted-foreground">Invoice {done.invoice} for {kes(done.price)} is waiting. {done.prompt?.error || "We'll contact you with payment details."}</p>)}
        </Card>
      ) : open ? (
        <Card>
          <button onClick={() => setOpen(null)} className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-primary"><ChevronLeft className="h-4 w-4" /> All events</button>
          <h1 className="font-display text-2xl font-bold">{open.title}</h1>
          <p className="mt-1 flex flex-wrap gap-3 text-sm text-muted-foreground">{open.starts_at && <span className="inline-flex items-center gap-1"><CalendarClock className="h-4 w-4" />{new Date(open.starts_at).toLocaleString("en-KE", { dateStyle: "full", timeStyle: "short" })}</span>}{open.venue && <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{open.venue}</span>}</p>
          {open.description && <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{open.description}</p>}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <input className="fi h-11" placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <input className="fi h-11" placeholder="Phone (M-Pesa number)" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            <input className="fi h-11 sm:col-span-2" placeholder="Email (optional)" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
          {error && <div className="mt-3"><Err text={error} /></div>}
          <button disabled={busy || !f.name || !f.phone || open.seats_left === 0} onClick={() => void reg()} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary font-semibold text-primary-foreground disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />} {open.seats_left === 0 ? "Sold out" : open.price > 0 ? `Get a ticket · ${kes(open.price)}` : "Register free"}
          </button>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {!data.events.length && <Card className="sm:col-span-2"><p className="text-sm text-muted-foreground">No upcoming events right now.</p></Card>}
          {data.events.map((e: any) => (
            <button key={e.id} onClick={() => setOpen(e)} className="group rounded-3xl border border-border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">{e.starts_at ? new Date(e.starts_at).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" }) : "Date to be announced"}</p>
              <p className="mt-1 font-display text-lg font-bold">{e.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{e.venue}</p>
              <p className="mt-3 flex items-center justify-between text-sm"><b>{e.price > 0 ? kes(e.price) : "Free"}</b>{e.seats_left !== null && <span className="text-xs text-muted-foreground">{e.seats_left} seats left</span>}<ChevronRight className="h-4 w-4 text-primary" /></p>
            </button>
          ))}
        </div>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ eLearning */

function embed(link: string) {
  const yt = link.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = link.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

export function LearnPage() {
  const [params] = useSearchParams();
  const k = params.get("k") || "";
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState("");
  const [msg, setMsg] = useState("");
  const load = () => pub(`learn?k=${encodeURIComponent(k)}`).then((d) => { setData(d); }).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <Shell title="Course"><Card>{error ? <Err text={error} /> : <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}</Card></Shell>;
  const l = data.lessons[i];
  const complete = async () => {
    setMsg("");
    try {
      const r = await pub("learn/progress", { k, lesson: i, answer });
      if (!r.ok) { setMsg(r.error); return; }
      setAnswer(""); await load();
      if (i < data.lessons.length - 1) setI(i + 1);
    } catch (e: any) { setMsg(e.message); }
  };
  const video = l?.link ? embed(l.link) : null;
  return (
    <Shell title={data.course.title} company={data.company}>
      <Card className="mb-4">
        <div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 font-semibold"><GraduationCap className="h-5 w-5 text-primary" /> {data.learner}</p><span className="text-sm font-semibold text-primary">{data.progress}% complete</span></div>
        <div className="mt-3 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${data.progress}%` }} /></div>
      </Card>
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <Card className="p-3">
          <ol className="space-y-1">
            {data.lessons.map((x: any) => (
              <li key={x.i}><button onClick={() => { setI(x.i); setMsg(""); }} className={cn("flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm", x.i === i ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted")}>
                {x.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}<span className="truncate">{x.title}</span>
              </button></li>
            ))}
          </ol>
        </Card>
        {l ? (
          <Card>
            <h1 className="font-display text-xl font-bold">{l.title}</h1>
            {l.minutes > 0 && <p className="text-xs text-muted-foreground">{l.minutes} minutes</p>}
            {video ? <div className="mt-4 aspect-video overflow-hidden rounded-2xl bg-black"><iframe src={video} title={l.title} className="h-full w-full" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>
              : l.link ? <a href={l.link} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-muted px-4 py-3 text-sm font-semibold"><PlayCircle className="h-5 w-5 text-primary" /> Open the lesson material</a> : null}
            {l.body && <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{l.body}</p>}
            {l.question && (
              <div className="mt-5 rounded-2xl bg-muted/50 p-4">
                <p className="text-sm font-semibold">Quiz: {l.question}</p>
                <input className="fi mt-2" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" />
              </div>
            )}
            {msg && <div className="mt-3"><Err text={msg} /></div>}
            <button onClick={() => void complete()} className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
              <CheckCircle2 className="h-4 w-4" /> {l.done ? "Done · next lesson" : l.question ? "Check answer" : "Mark as done"}
            </button>
          </Card>
        ) : <Card><p className="text-sm text-muted-foreground">This course has no lessons yet.</p></Card>}
      </div>
    </Shell>
  );
}
