import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Car, CheckCircle2, Search, Ship } from "lucide-react";
import { card, money, pub, PublicShell, PubState, usePub } from "./pub";

const STAGE_LABEL: Record<string, string> = { at_sea: "On the way", at_port: "At the port", prep: "Being prepared", in_yard: "Available", reserved: "Reserved" };

/** Public listings page per company: /yard/<company>. */
export function YardListings() {
  const { slug = "" } = useParams();
  const q = usePub("yard", { slug });
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState("new");
  const cars = useMemo(() => {
    const t = term.trim().toLowerCase();
    const list = (q.data?.cars || []).filter((c: any) => !t || `${c.title} ${c.make} ${c.model} ${c.year} ${c.body} ${c.fuel}`.toLowerCase().includes(t));
    return [...list].sort((a: any, b: any) => sort === "low" ? (a.price || 9e15) - (b.price || 9e15) : sort === "high" ? (b.price || 0) - (a.price || 0) : String(b.created_at).localeCompare(String(a.created_at)));
  }, [q.data, term, sort]);
  const d = q.data;
  return (
    <PublicShell company={d?.company} title="Cars for sale" wide>
      <Helmet><meta name="robots" content="index,follow" /></Helmet>
      <PubState loading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Search make, model, year…" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
            <select className="fi w-auto" value={sort} onChange={(e) => setSort(e.target.value)}><option value="new">Newest</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option></select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cars.map((c: any) => (
              <Link key={c.id} to={`/yard/${slug}/${c.id}`} className="overflow-hidden rounded-2xl border border-border bg-card hover:border-primary/40">
                <div className="relative aspect-[4/3] bg-muted">
                  {c.photos?.[0] ? <img src={c.photos[0]} alt={c.title} className="h-full w-full object-cover" loading="lazy" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><Car className="h-10 w-10" /></div>}
                  <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">{STAGE_LABEL[c.stage] || "Available"}</span>
                </div>
                <div className="space-y-1 p-3">
                  <p className="font-semibold">{c.title}</p>
                  <p className="text-xs text-muted-foreground">{[c.mileage ? `${Number(c.mileage).toLocaleString()} km` : null, c.transmission, c.fuel, c.engine_cc ? `${c.engine_cc} cc` : null].filter(Boolean).join(" · ")}</p>
                  <p className="font-display text-lg font-bold">{c.price ? money(c.price, d.company.currency) : "Ask for price"}</p>
                </div>
              </Link>
            ))}
            {!cars.length && <p className="col-span-full py-12 text-center text-sm text-muted-foreground">No cars listed right now.</p>}
          </div>
        </>
      )}
    </PublicShell>
  );
}

export function YardListing() {
  const { slug = "", id = "" } = useParams();
  const q = usePub("yard/car", { slug, id });
  const [img, setImg] = useState(0);
  const [f, setF] = useState({ name: "", phone: "", message: "" });
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = q.data;
  const send = async () => {
    setErr(null);
    if (!f.name.trim() || f.phone.replace(/\D/g, "").length < 9) return setErr("Enter your name and phone number.");
    setBusy(true);
    try { await pub("yard/enquiry", { slug, id, ...f }); setSent(true); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <PublicShell company={d?.company} title={d?.car?.title || "Car for sale"} wide>
      <PubState loading={q.isLoading} error={q.error} />
      {d && (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <div className="space-y-2">
            <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-muted">{d.car.photos?.[img] ? <img src={d.car.photos[img]} alt={d.car.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><Car className="h-12 w-12" /></div>}</div>
            {d.car.photos?.length > 1 && <div className="flex gap-2 overflow-x-auto">{d.car.photos.map((p: string, i: number) => <button key={p} onClick={() => setImg(i)} className={`h-16 w-20 shrink-0 overflow-hidden rounded-lg border-2 ${i === img ? "border-primary" : "border-transparent"}`}><img src={p} alt="" className="h-full w-full object-cover" /></button>)}</div>}
            {d.car.description && <div className={card}><p className="whitespace-pre-wrap text-sm">{d.car.description}</p></div>}
            {d.car.features && <div className={card}><p className="mb-1 text-sm font-semibold">Features</p><p className="whitespace-pre-wrap text-sm">{d.car.features}</p></div>}
          </div>
          <div className="space-y-3">
            <div className={card}>
              <p className="font-display text-xl font-bold">{d.car.title}</p>
              <p className="font-display text-2xl font-bold text-primary">{d.car.price ? money(d.car.price, d.company.currency) : "Ask for price"}</p>
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">{["at_sea", "at_port"].includes(d.car.stage) && <Ship className="h-3.5 w-3.5" />}{STAGE_LABEL[d.car.stage] || "Available"}{d.car.location ? ` · ${d.car.location}` : ""}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                {[["Year", d.car.year], ["Mileage", d.car.mileage ? `${Number(d.car.mileage).toLocaleString()} km` : null], ["Engine", d.car.engine_cc ? `${d.car.engine_cc} cc` : null], ["Fuel", d.car.fuel], ["Transmission", d.car.transmission], ["Body", d.car.body], ["Colour", d.car.colour]].filter(([, v]) => v).map(([k, v]) => (
                  <div key={k as string}><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>
                ))}
              </dl>
            </div>
            <div className={card}>
              {sent ? <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-5 w-5 text-success" /> Thank you. We will call you shortly.</p> : (
                <div className="space-y-2">
                  <p className="font-semibold">Interested? Leave your number</p>
                  <input className="fi" placeholder="Enter your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                  <input className="fi" inputMode="tel" placeholder="07XXXXXXXX" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
                  <textarea className="fi" rows={2} placeholder="Enter a message (optional)" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
                  {err && <p className="text-sm text-destructive">{err}</p>}
                  <button disabled={busy} onClick={() => void send()} className="w-full rounded-xl bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Sending…" : "Send"}</button>
                </div>
              )}
            </div>
            <Link to={`/yard/${slug}`} className="block text-center text-sm text-primary">All cars</Link>
          </div>
        </div>
      )}
    </PublicShell>
  );
}

/** Customer pre-order status: /preorder/<token>. */
export function PreorderStatus() {
  const { token = "" } = useParams();
  const q = usePub("preorder", { token });
  const d = q.data;
  const steps: [string, string][] = [["enquiry", "Order received"], ["deposit_paid", "Deposit paid"], ["ordered", "Bought from the supplier"], ["shipped", "Shipped"], ["arrived", "Arrived at Mombasa"], ["cleared", "Cleared"], ["delivered", "Delivered to you"]];
  const cur = steps.findIndex(([k]) => k === d?.stage);
  return (
    <PublicShell company={d?.company} title="Your vehicle order">
      <PubState loading={q.isLoading} error={q.error} />
      {d && (
        <>
          <div className={card}>
            <p className="text-xs text-muted-foreground">{d.number}</p>
            <p className="font-display text-xl font-bold">{d.title}</p>
            {d.spec && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{d.spec}</p>}
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <p>Price <b className="block">{d.price ? money(d.price, d.company.currency) : "—"}</b></p>
              <p>Deposit <b className="block">{money(d.deposit, d.company.currency)}</b></p>
              <p>Ship ETA <b className="block">{d.eta || "—"}</b></p>
              <p>Expected <b className="block">{d.expected || "—"}</b></p>
            </div>
          </div>
          {d.stage === "cancelled" ? <p className="text-sm text-destructive">This order was cancelled. Please contact us.</p> : (
            <ol className="space-y-2">
              {steps.map(([k, label], i) => (
                <li key={k} className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm ${i <= cur ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i <= cur ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{i < cur ? "✓" : i + 1}</span>
                  <span className={i === cur ? "font-semibold" : ""}>{label}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </PublicShell>
  );
}
