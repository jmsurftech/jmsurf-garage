import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { CheckCircle2, Loader2, Upload, FileText, X, Briefcase, MapPin, ChevronLeft, Send, ShieldCheck, CalendarClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Orbs } from "@/components/brand/Orbs";
import { DashMark } from "@/components/brand/DashLogo";
import PoweredBy from "@/components/PoweredBy";
import { friendlyError } from "@/lib/friendlyError";
import { cn } from "@/lib/utils";

const rpc = (fn: string, args: Record<string, unknown>) => (supabase as any).rpc(fn, args);
const asDataUrl = (file: File) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = bad; r.readAsDataURL(file); });

function Frame({ title, company, logo, children }: { title: string; company?: string | null; logo?: string | null; children: ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-4 py-8 sm:py-10">
      <Helmet><title>{`${title}${company ? ` · ${company}` : ""}`}</title><meta name="robots" content="noindex" /></Helmet>
      <Orbs intensity="subtle" />
      <div className="relative mx-auto w-full max-w-2xl">
        <header className="mb-6 flex items-center gap-3">
          {logo ? <img src={logo} alt="" className="h-12 w-12 rounded-2xl object-contain shadow" /> : <DashMark className="h-12 w-12" />}
          <div className="min-w-0"><p className="truncate font-display text-xl font-extrabold">{company || " "}</p><p className="text-sm text-muted-foreground">{title}</p></div>
        </header>
        {children}
        <p className="mt-10 text-center"><PoweredBy /></p>
      </div>
    </main>
  );
}
const Card = ({ children, className }: { children: ReactNode; className?: string }) => <section className={cn("rounded-3xl border border-border bg-card/95 p-5 shadow-xl backdrop-blur sm:p-6", className)}>{children}</section>;
const Alert = ({ text }: { text: string }) => <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{text}</p>;
const In = ({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: ReactNode }) => (
  <label className={cn("block space-y-1", className)}><span className="text-sm font-medium">{label}{required && <span className="text-destructive"> *</span>}</span>{children}</label>
);

/* ------------------------------------------------------------ staff registration */

const DOC_KINDS = ["ID copy", "KRA PIN certificate", "NSSF card", "SHA card", "Academic certificates", "Certificate of good conduct", "Bank details", "Passport photo", "Other"];
const FILE_TYPES = ["application/pdf", "image/jpeg", "image/png"];
type FilePick = { file: File; category: string; state: "waiting" | "sending" | "sent" | "failed"; error?: string };
const BLANK = {
  first_name: "", other_names: "", last_name: "", gender: "", date_of_birth: "", marital_status: "", national_id: "", phone: "", email: "", address: "",
  kra_pin: "", nssf_no: "", shif_no: "", kin_name: "", kin_relationship: "", kin_phone: "",
  payment_method: "bank", bank_name: "", bank_branch: "", bank_account: "", mpesa_phone: "", note: "",
};

/** /join/<token>: a new hire sends their details and documents to HR. No login. */
export function StaffJoin() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<{ company: string; logo: string | null; department: string | null; open: boolean } | null | false>(null);
  const [f, setF] = useState(BLANK);
  const [files, setFiles] = useState<FilePick[]>([]);
  const [category, setCategory] = useState(DOC_KINDS[0]);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState<{ id: string; key: string } | null>(null);
  useEffect(() => { void rpc("hr_registration_link_info", { p_token: token }).then(({ data }: any) => setInfo(data || false), () => setInfo(false)); }, [token]);
  const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const addFiles = (list: FileList | null) => {
    setErr("");
    const picked: FilePick[] = [];
    for (const file of Array.from(list || [])) {
      if (!FILE_TYPES.includes(file.type)) { setErr(`${file.name}: upload a PDF, JPG or PNG`); continue; }
      if (file.size > 10 * 1024 * 1024) { setErr(`${file.name}: files up to 10 MB`); continue; }
      picked.push({ file, category, state: "waiting" });
    }
    setFiles((cur) => [...cur, ...picked].slice(0, 10));
  };
  const uploadAll = async (reg: { id: string; key: string }, list: FilePick[]) => {
    const out = [...list];
    for (let i = 0; i < out.length; i++) {
      if (out[i].state === "sent") continue;
      out[i] = { ...out[i], state: "sending", error: undefined }; setFiles([...out]);
      try {
        const res = await fetch("/api/public/hr-registration-upload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, id: reg.id, key: reg.key, category: out[i].category, name: out[i].file.name, type: out[i].file.type, data: await asDataUrl(out[i].file) }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "The upload failed");
        out[i] = { ...out[i], state: "sent" };
      } catch (e) { out[i] = { ...out[i], state: "failed", error: (e as Error).message }; }
      setFiles([...out]);
    }
  };
  const submit = async () => {
    setErr("");
    if (!f.first_name.trim() || !f.last_name.trim()) return setErr("Enter your first and last name");
    if (!f.national_id.trim()) return setErr("Enter your ID or passport number");
    if (!f.phone.trim()) return setErr("Enter your phone number");
    if (!agree) return setErr("Tick the box to confirm your details");
    setBusy(true);
    try {
      const { data, error } = await rpc("hr_registration_submit", { p_token: token, p: f });
      if (error) throw error;
      setSent(data);
      await uploadAll(data, files);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  if (info === null) return <Frame title="Staff registration"><Card><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></Card></Frame>;
  if (info === false) return <Frame title="Staff registration"><Card><Alert text="This link is not valid. Ask HR for a new one." /></Card></Frame>;
  const failed = files.filter((x) => x.state === "failed");
  if (sent && !busy) return (
    <Frame title="Staff registration" company={info.company} logo={info.logo}>
      <Card className="text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-success" />
        <h1 className="mt-3 font-display text-2xl font-bold">Thank you, {f.first_name.trim()}</h1>
        <p className="mt-2 text-muted-foreground">Your details are with HR at {info.company}. They will contact you if anything is missing.</p>
        {failed.length > 0 && (
          <div className="mt-4 space-y-2 text-left">
            <Alert text={`${failed.length} file${failed.length === 1 ? "" : "s"} did not upload: ${failed.map((x) => `${x.file.name} (${x.error})`).join("; ")}`} />
            <button onClick={() => { setBusy(true); void uploadAll(sent, files).finally(() => setBusy(false)); }} className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary font-semibold text-primary-foreground"><Upload className="h-4 w-4" /> Try the files again</button>
          </div>
        )}
      </Card>
    </Frame>
  );
  if (!info.open) return <Frame title="Staff registration" company={info.company} logo={info.logo}><Card><Alert text="This link is closed (expired, switched off or used up). Ask HR for a new one." /></Card></Frame>;
  return (
    <Frame title={`Staff registration${info.department ? ` · ${info.department}` : ""}`} company={info.company} logo={info.logo}>
      <div className="space-y-4">
        <Card>
          <h1 className="font-display text-2xl font-bold">Welcome aboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Fill in your details for your staff file and payroll. Fields with * are needed. It takes about five minutes; have your ID, KRA PIN and bank details at hand.</p>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">About you</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <In label="First name" required><input className="fi" value={f.first_name} onChange={set("first_name")} autoComplete="given-name" /></In>
            <In label="Middle name"><input className="fi" value={f.other_names} onChange={set("other_names")} autoComplete="additional-name" /></In>
            <In label="Last name" required><input className="fi" value={f.last_name} onChange={set("last_name")} autoComplete="family-name" /></In>
            <In label="ID / passport no." required><input className="fi" value={f.national_id} onChange={set("national_id")} /></In>
            <In label="Date of birth"><input className="fi" type="date" value={f.date_of_birth} onChange={set("date_of_birth")} /></In>
            <In label="Gender"><select className="fi" value={f.gender} onChange={set("gender")}><option value="">-</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></In>
            <In label="Marital status"><select className="fi" value={f.marital_status} onChange={set("marital_status")}><option value="">-</option>{["Single", "Married", "Divorced", "Widowed"].map((x) => <option key={x}>{x}</option>)}</select></In>
            <In label="Phone" required><input className="fi" inputMode="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" placeholder="07…" /></In>
            <In label="Email"><input className="fi" type="email" value={f.email} onChange={set("email")} autoComplete="email" /></In>
            <In label="Home address" className="sm:col-span-3"><input className="fi" value={f.address} onChange={set("address")} placeholder="Estate, town" /></In>
          </div>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">Tax and statutory numbers</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <In label="KRA PIN"><input className="fi uppercase" value={f.kra_pin} onChange={set("kra_pin")} placeholder="A012345678Z" maxLength={11} /></In>
            <In label="NSSF no."><input className="fi" value={f.nssf_no} onChange={set("nssf_no")} /></In>
            <In label="SHA (SHIF) no."><input className="fi" value={f.shif_no} onChange={set("shif_no")} /></In>
          </div>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">Next of kin</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <In label="Full name"><input className="fi" value={f.kin_name} onChange={set("kin_name")} /></In>
            <In label="Relationship"><input className="fi" value={f.kin_relationship} onChange={set("kin_relationship")} placeholder="Spouse, parent…" /></In>
            <In label="Phone"><input className="fi" inputMode="tel" value={f.kin_phone} onChange={set("kin_phone")} /></In>
          </div>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">Where to pay your salary</h2>
          <div className="flex gap-2">{[["bank", "Bank account"], ["mpesa", "M-Pesa"]].map(([v, l]) => (
            <button key={v} type="button" onClick={() => setF({ ...f, payment_method: v })} className={cn("rounded-full px-4 py-1.5 text-sm font-medium", f.payment_method === v ? "bg-primary text-primary-foreground" : "bg-muted")}>{l}</button>
          ))}</div>
          {f.payment_method === "bank" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <In label="Bank"><input className="fi" value={f.bank_name} onChange={set("bank_name")} /></In>
              <In label="Branch"><input className="fi" value={f.bank_branch} onChange={set("bank_branch")} /></In>
              <In label="Account no."><input className="fi" inputMode="numeric" value={f.bank_account} onChange={set("bank_account")} /></In>
            </div>
          ) : <In label="M-Pesa number"><input className="fi sm:max-w-xs" inputMode="tel" value={f.mpesa_phone} onChange={set("mpesa_phone")} placeholder="07…" /></In>}
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">Documents</h2>
          <p className="text-sm text-muted-foreground">Photos or scans of your ID (both sides), KRA PIN certificate, NSSF and SHA cards and certificates. PDF, JPG or PNG, up to 10 MB each.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select className="fi sm:w-64" value={category} onChange={(e) => setCategory(e.target.value)}>{DOC_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
            <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-primary/50 px-4 text-sm font-semibold text-primary hover:bg-primary/5">
              <Upload className="h-4 w-4" /> Choose file
              <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
          {files.length > 0 && <ul className="divide-y divide-border rounded-xl border border-border text-sm">{files.map((x, i) => (
            <li key={i} className="flex items-center gap-2 px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{x.file.name}<span className="block text-xs text-muted-foreground">{x.category}</span></span>
              {x.state === "sending" ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : x.state === "sent" ? <CheckCircle2 className="h-4 w-4 text-success" />
                : <button type="button" aria-label="Remove" disabled={busy} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>}
            </li>))}</ul>}
        </Card>
        <Card className="space-y-3">
          <In label="Anything HR should know?"><textarea className="fi min-h-[70px]" value={f.note} onChange={set("note")} /></In>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>These details are true. I agree that {info.company} keeps them in my staff file for my employment and payroll.</span></label>
          {err && <Alert text={err} />}
          <button disabled={busy} onClick={() => void submit()} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary font-semibold text-primary-foreground disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {busy ? (sent ? "Uploading files…" : "Sending…") : "Send my details"}
          </button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Sent securely. Only HR at {info.company} can see them.</p>
        </Card>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------ careers */

type Job = { id: string; number: string | null; title: string; openings: number | null; department: string; location: string; type: string; description: string; posted: string; closes: string | null };
const CV_TYPES = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

/** /careers: the company's open vacancies and the apply form. */
export function CareersPage() {
  const [data, setData] = useState<{ company: string; logo: string | null; jobs: Job[] } | null>(null);
  const [error, setError] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [f, setF] = useState({ name: "", email: "", phone: "", note: "" });
  const [cv, setCv] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    fetch("/api/pub/careers").then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Not available"); setData(j); }).catch((e) => setError(e.message));
  }, []);
  const apply = async () => {
    setError("");
    if (!cv) return setError("Attach your CV");
    if (!CV_TYPES.includes(cv.type)) return setError("Attach your CV as a PDF or Word file");
    if (cv.size > 8 * 1024 * 1024) return setError("The CV must be under 8 MB");
    setBusy(true);
    try {
      const res = await fetch("/api/pub/careers/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job: job!.id, ...f, cv: { name: cv.name, type: cv.type, data: await asDataUrl(cv) } }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Not sent");
      setDone(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (!data) return <Frame title="Careers"><Card>{error ? <Alert text={error} /> : <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}</Card></Frame>;
  return (
    <Frame title="Careers" company={data.company} logo={data.logo}>
      {done ? (
        <Card className="text-center">
          <CheckCircle2 className="mx-auto h-14 w-14 text-success" />
          <h1 className="mt-3 font-display text-2xl font-bold">Application sent</h1>
          <p className="mt-2 text-muted-foreground">Thank you for applying for {job?.title}. {data.company} will contact you if you are shortlisted.</p>
        </Card>
      ) : job ? (
        <Card className="space-y-4">
          <button onClick={() => { setJob(null); setError(""); }} className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><ChevronLeft className="h-4 w-4" /> All vacancies</button>
          <div>
            <h1 className="font-display text-2xl font-bold">{job.title}</h1>
            <p className="mt-1 flex flex-wrap gap-3 text-sm text-muted-foreground">
              {job.department && <span className="inline-flex items-center gap-1"><Briefcase className="h-4 w-4" />{job.department}</span>}
              {job.location && <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{job.location}</span>}
              {job.closes && <span className="inline-flex items-center gap-1"><CalendarClock className="h-4 w-4" />Closes {new Date(job.closes).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}</span>}
            </p>
          </div>
          {job.description && <p className="whitespace-pre-wrap text-sm leading-relaxed">{job.description}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <In label="Full name" required className="sm:col-span-2"><input className="fi h-11" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></In>
            <In label="Email" required><input className="fi h-11" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></In>
            <In label="Phone" required><input className="fi h-11" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></In>
            <In label="Why you?" className="sm:col-span-2"><textarea className="fi min-h-[90px]" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="A few lines about you (optional)" /></In>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-primary/50 px-3 py-3 text-sm sm:col-span-2">
              <Upload className="h-4 w-4 text-primary" /><span className="min-w-0 flex-1 truncate">{cv ? cv.name : "Attach your CV (PDF or Word, up to 8 MB)"}</span>
              <input type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={(e) => setCv(e.target.files?.[0] || null)} />
            </label>
          </div>
          {error && <Alert text={error} />}
          <button disabled={busy || !f.name || !f.email || !f.phone} onClick={() => void apply()} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary font-semibold text-primary-foreground disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Apply
          </button>
        </Card>
      ) : (
        <div className="space-y-3">
          {!data.jobs.length && <Card><p className="text-sm text-muted-foreground">No open vacancies right now. Check again soon.</p></Card>}
          {data.jobs.map((j) => (
            <button key={j.id} onClick={() => { setJob(j); setDone(false); }} className="block w-full rounded-3xl border border-border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl">
              <p className="font-display text-lg font-bold">{j.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{[j.department, j.location, j.type, j.openings && j.openings > 1 ? `${j.openings} openings` : ""].filter(Boolean).join(" · ")}</p>
            </button>
          ))}
        </div>
      )}
    </Frame>
  );
}
