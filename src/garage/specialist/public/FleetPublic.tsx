import { useState } from "react";
import { useParams } from "react-router-dom";
import { Camera, CheckCircle2, X } from "lucide-react";
import { card, money, pub, PublicShell, PubState, usePub } from "./pub";

/* ───────────────────────────── fleet portal ───────────────────────────── */

export function FleetPortal() {
  const { token = "" } = useParams();
  const q = usePub("fleet", { token });
  const [tab, setTab] = useState<"approvals" | "vehicles" | "history" | "spend">("approvals");
  const d = q.data;
  return (
    <PublicShell company={d?.company} title={d ? `${d.fleet.title} · fleet portal` : "Fleet portal"} wide>
      <PubState loading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Vehicles" value={d.vehicles.length} />
            <Stat label="Waiting for you" value={d.approvals.filter((a: any) => a.stage === "pending").length} />
            <Stat label="Spend this year" value={money(d.spend.year, d.company.currency)} />
            <Stat label="Balance due" value={money(d.spend.balance, d.company.currency)} />
          </div>
          <div className="flex flex-wrap gap-1">
            {(["approvals", "vehicles", "history", "spend"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-xl px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-primary text-primary-foreground" : "border border-border"}`}>
                {{ approvals: "Approvals", vehicles: "Vehicles", history: "Service history", spend: "Invoices" }[t]}
              </button>
            ))}
          </div>
          {tab === "approvals" && <ApprovalsList token={token} rows={d.approvals} currency={d.company.currency} onDone={() => void q.refetch()} />}
          {tab === "vehicles" && (
            <div className="space-y-2">{d.vehicles.map((v: any) => (
              <div key={v.plate} className={card}>
                <div className="flex items-center justify-between"><b>{v.plate}</b>{v.service_due && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">Service due</span>}</div>
                <p className="text-sm text-muted-foreground">{[v.driver, v.department, v.cost_centre].filter(Boolean).join(" · ") || "—"}</p>
                <p className="text-xs text-muted-foreground">Spend this year {money(v.spend, d.company.currency)}{v.last_check ? ` · last driver check ${new Date(v.last_check).toLocaleDateString("en-KE")}` : ""}</p>
              </div>
            ))}{!d.vehicles.length && <p className="text-sm text-muted-foreground">No vehicles yet.</p>}</div>
          )}
          {tab === "history" && (
            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="dt"><thead><tr><th>Date</th><th>Vehicle</th><th>Job</th><th>Work</th><th>Status</th></tr></thead>
                <tbody>{d.jobs.map((j: any) => <tr key={j.id}><td data-label="Date">{String(j.created_at).slice(0, 10)}</td><td data-label="Vehicle">{j.plate}</td><td data-label="Job">{j.job_no || "—"}</td><td data-label="Work" className="whitespace-normal">{j.complaint || j.job_type}</td><td data-label="Status">{j.status}</td></tr>)}
                  {!d.jobs.length && <tr><td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No workshop visits yet.</td></tr>}</tbody></table>
            </div>
          )}
          {tab === "spend" && (
            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="dt"><thead><tr><th>Invoice</th><th>Date</th><th className="num">Total</th><th className="num">Balance</th><th /></tr></thead>
                <tbody>{d.invoices.map((i: any) => <tr key={i.invoice_number}><td data-label="Invoice">{i.invoice_number}</td><td data-label="Date">{i.issue_date}</td><td data-label="Total" className="num">{money(i.total, d.company.currency)}</td><td data-label="Balance" className="num">{money(i.balance, d.company.currency)}</td><td>{i.pay_url && i.balance > 0 && <a className="text-primary underline" href={i.pay_url}>Pay</a>}</td></tr>)}
                  {!d.invoices.length && <tr><td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No invoices yet.</td></tr>}</tbody></table>
            </div>
          )}
        </>
      )}
    </PublicShell>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return <div className={card}><p className="text-[11px] text-muted-foreground">{label}</p><p className="font-display text-lg font-bold tabular-nums">{value}</p></div>;
}

function ApprovalsList({ token, rows, currency, onDone }: { token: string; rows: any[]; currency: string; onDone: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", lpo_no: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const decide = async (id: string, decision: "approved" | "declined") => {
    setBusy(true); setErr(null);
    try { await pub("fleet/approve", { token, id, decision, ...form }); setOpen(null); setForm({ name: "", lpo_no: "", note: "" }); onDone(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing to approve.</p>;
  return (
    <div className="space-y-2">
      {rows.map((a) => (
        <div key={a.id} className={card}>
          <div className="flex items-start justify-between gap-2">
            <div><p className="font-semibold">{a.title}</p><p className="text-xs text-muted-foreground">{a.plate || ""} · {new Date(a.created_at).toLocaleDateString("en-KE")}</p></div>
            <div className="text-right"><p className="font-bold tabular-nums">{money(a.amount, currency)}</p>
              <span className={`text-xs font-semibold ${a.stage === "approved" ? "text-success" : a.stage === "declined" ? "text-destructive" : "text-warning"}`}>{a.stage === "pending" ? "Waiting for you" : a.stage === "approved" ? `Approved${a.lpo_no ? ` · ${a.lpo_no}` : ""}` : "Declined"}</span></div>
          </div>
          {Array.isArray(a.lines) && a.lines.length > 0 && (
            <ul className="mt-2 divide-y divide-border text-sm">{a.lines.map((l: any, i: number) => <li key={i} className="flex justify-between py-1"><span>{l.description} × {l.qty || 1}</span><span className="tabular-nums">{money((Number(l.qty) || 1) * (Number(l.price) || 0), currency)}</span></li>)}</ul>
          )}
          {a.stage === "pending" && (open === a.id ? (
            <div className="mt-2 space-y-2">
              <input className="fi" placeholder="Enter your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="fi" placeholder="Enter LPO / LSO number" value={form.lpo_no} onChange={(e) => setForm({ ...form, lpo_no: e.target.value })} />
              <textarea className="fi" rows={2} placeholder="Enter a note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              {err && <p className="text-sm text-destructive">{err}</p>}
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => void decide(a.id, "approved")} className="flex-1 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Approve</button>
                <button disabled={busy} onClick={() => void decide(a.id, "declined")} className="flex-1 rounded-xl border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50">Decline</button>
              </div>
            </div>
          ) : <button onClick={() => setOpen(a.id)} className="mt-2 w-full rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Review & decide</button>)}
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── driver daily check ───────────────────────────── */

const ITEMS: [string, string][] = [
  ["tyres", "Tyres (pressure, cuts, tread)"], ["lights", "Lights and indicators"], ["oil", "Engine oil level"], ["coolant", "Coolant / water"],
  ["brakes", "Brakes"], ["wipers", "Wipers and washer"], ["mirrors", "Mirrors and glass"], ["body", "Body (new dents or scratches)"],
  ["warning", "Dashboard warning lights"], ["safety", "Fire extinguisher, triangles, first aid"],
];

/** Shrinks a photo on the phone before upload. */
function shrink(file: File, max = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.8));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error("That photo could not be read"));
    img.src = URL.createObjectURL(file);
  });
}

export function DriverCheck() {
  const { token = "" } = useParams();
  const q = usePub("check", { token });
  const [ans, setAns] = useState<Record<string, "ok" | "fault">>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [driver, setDriver] = useState("");
  const [odometer, setOdometer] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ faults: number } | null>(null);
  const d = q.data;
  const submit = async () => {
    setErr(null);
    if (ITEMS.some(([k]) => !ans[k])) return setErr("Mark every item OK or Fault.");
    if (!driver.trim()) return setErr("Enter your name.");
    setBusy(true);
    try {
      const r = await pub("check/submit", { token, driver, odometer: Number(odometer.replace(/\D/g, "")) || null, answers: ans, notes, photos });
      setDone({ faults: r.faults });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <PublicShell company={d?.company} title="Daily vehicle check">
      <PubState loading={q.isLoading} error={q.error} />
      {d && done && (
        <div className="py-12 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
          <p className="mt-3 text-lg font-semibold">Check sent</p>
          <p className="text-sm text-muted-foreground">{done.faults ? `${done.faults} fault(s) reported. The garage will contact you.` : "All items OK. Drive safely."}</p>
        </div>
      )}
      {d && !done && (
        <>
          <div className={card}><p className="text-xs text-muted-foreground">Vehicle</p><p className="font-display text-2xl font-bold">{d.plate}</p><p className="text-sm text-muted-foreground">{d.fleet}</p></div>
          <div className="grid grid-cols-2 gap-2">
            <input className="fi" placeholder="Enter your name" value={driver} onChange={(e) => setDriver(e.target.value)} onFocus={() => { if (!driver && d.driver) setDriver(d.driver); }} />
            <input className="fi" inputMode="numeric" placeholder="Enter odometer (km)" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
          </div>
          <div className="space-y-2">
            {ITEMS.map(([k, label]) => (
              <div key={k} className={card}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{label}</span>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => setAns({ ...ans, [k]: "ok" })} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${ans[k] === "ok" ? "bg-success text-white" : "border border-border"}`}>OK</button>
                    <button onClick={() => setAns({ ...ans, [k]: "fault" })} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${ans[k] === "fault" ? "bg-destructive text-white" : "border border-border"}`}>Fault</button>
                  </div>
                </div>
                {ans[k] === "fault" && <input className="fi mt-2" placeholder="Describe the fault" value={notes[k] || ""} onChange={(e) => setNotes({ ...notes, [k]: e.target.value })} />}
              </div>
            ))}
          </div>
          <div className={card}>
            <p className="mb-2 text-sm font-medium">Photos of any damage</p>
            <div className="grid grid-cols-3 gap-2">
              {photos.map((p, i) => <div key={i} className="relative aspect-square overflow-hidden rounded-xl"><img src={p} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" /><button onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white" aria-label="Remove"><X className="h-3.5 w-3.5" /></button></div>)}
              {photos.length < 6 && (
                <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-xs text-muted-foreground">
                  <Camera className="h-5 w-5" /> Add photo
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { const s = await shrink(f); setPhotos((p) => [...p, s]); } catch (x: any) { setErr(x.message); } } e.target.value = ""; }} />
                </label>
              )}
            </div>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <button disabled={busy} onClick={() => void submit()} className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Sending…" : "Send check"}</button>
        </>
      )}
    </PublicShell>
  );
}
