import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { Camera, MapPin, Navigation, Plus, Receipt, Settings2, Siren, Smartphone, Truck, Moon } from "lucide-react";
import { Modal, PageHeader, Panel } from "@/components/kit";
import DocumentsPanel from "@/components/DocumentsPanel";
import { LocationPicker, MultiMap, directionsUrl, useWatchPosition, type LatLng } from "@/components/maps/Maps";
import { fmtMoney } from "@/apps/format";
import { useLookup } from "@/apps/data";
import { useTenantId } from "@/hooks/useTenantId";
import { supabase } from "@/integrations/supabase/client";
import { TOW_STAGES, TRUCK_STAGES } from "../apps";
import { customerByPhone, insertRec, moveStage, num, patchRec, sb, useInvoices, useModuleSettings, useRecs, useRefresh, type Rec } from "../shared/db";
import { createInvoice, invoicePayLink, smsPayLink } from "../shared/billing";
import { btn, btnDark, btnPrimary, EmployeeSelect, Gate, Labeled, ModuleHome, NumIn, StageChip, useAction } from "../shared/ui";
import { DEFAULT_TOW_RATES, normalisePlate, roadKm, towPrice, type TowRates } from "../lib/calc";

const LIVE = ["requested", "dispatched", "on_site", "in_transit"];
export const useTowRates = () => useModuleSettings<TowRates>("towing", DEFAULT_TOW_RATES);
const pt = (x: any): LatLng | null => (x && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng)) ? { lat: Number(x.lat), lng: Number(x.lng) } : null);
const isNight = (d = new Date()) => d.getHours() >= 22 || d.getHours() < 6;

export function TowingHome() {
  const { data: tows = [] } = useRecs("towing", "tow");
  const { data: trucks = [] } = useRecs("towing", "truck");
  const m = new Date().toISOString().slice(0, 7);
  return (
    <ModuleHome module="towing" title="Towing & mobile mechanic" icon={Siren}
      actions={<Link to="/garage/towing/dispatch" className={btnPrimary}><MapPin className="h-4 w-4" /> Dispatch board</Link>}
      stats={[
        { label: "Live call-outs", value: tows.filter((t) => LIVE.includes(String(t.stage))).length, tone: "danger", icon: Siren },
        { label: "Trucks available", value: trucks.filter((t) => t.stage === "available").length, tone: "success", icon: Truck },
        { label: "Jobs this month", value: tows.filter((t) => t.created_at.startsWith(m)).length },
        { label: "Billed this month", value: fmtMoney(tows.filter((t) => t.created_at.startsWith(m)).reduce((a, t) => a + num(t.amount), 0)) },
      ]}
      links={[
        { to: "/garage/towing/dispatch", label: "Dispatch board", icon: MapPin },
        { to: "/garage/towing/driver", label: "Driver screen", icon: Smartphone, hint: "Phone" },
        { to: "/apps/towing/tow", label: "All call-outs", icon: Siren },
        { to: "/apps/towing/truck", label: "Trucks & vans", icon: Truck },
        { to: "/garage/towing/rates", label: "Prices", icon: Settings2 },
      ]}>
      <Panel title="Insurer towing claims" flush description="Call-outs charged to an insurer, by the insurer's authority number.">
        <div className="overflow-x-auto">
          <table className="dt">
            <thead><tr><th>Call-out</th><th>Authority no.</th><th className="num">Amount</th><th>Stage</th></tr></thead>
            <tbody>
              {tows.filter((t) => t.data?.insurer).map((t) => <tr key={t.id}><td data-label="Call-out"><Link className="text-primary" to={`/apps/towing/tow?open=${t.id}`}>{t.number} {t.title}</Link></td><td data-label="Authority">{t.data?.claim_no || "—"}</td><td data-label="Amount" className="num">{fmtMoney(num(t.amount))}</td><td data-label="Stage"><StageChip stages={TOW_STAGES} stage={t.stage} /></td></tr>)}
              {!tows.some((t) => t.data?.insurer) && <tr><td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No insurer call-outs.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </ModuleHome>
  );
}

function useLiveTowing() {
  const tenantId = useTenantId();
  const tows = useRecs("towing", "tow");
  const trucks = useRecs("towing", "truck");
  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase.channel(`towing-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_records", filter: `tenant_id=eq.${tenantId}` }, (p: any) => { if ((p.new || p.old)?.app === "towing") { void tows.refetch(); void trucks.refetch(); } })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { tows: tows.data || [], trucks: trucks.data || [], refetch: () => { void tows.refetch(); void trucks.refetch(); } };
}

export function TowDispatch() {
  return <Gate module="towing"><Dispatch /></Gate>;
}

function Dispatch() {
  const { tows, trucks, refetch } = useLiveTowing();
  const [open, setOpen] = useState<Rec | "new" | null>(null);
  const live = tows.filter((t) => LIVE.includes(String(t.stage)));
  const stops = [
    ...live.filter((t) => pt(t.data?.pickup_at)).map((t, i) => ({ id: t.id, at: pt(t.data.pickup_at)!, label: String(i + 1), color: t.stage === "requested" ? "#dc2626" : "#d97706" })),
    ...trucks.filter((t) => pt(t.data?.gps)).map((t) => ({ id: `truck:${t.id}`, at: pt(t.data.gps)!, label: "T", color: t.stage === "available" ? "#16a34a" : "#2563eb" })),
  ];
  return (
    <div className="space-y-3">
      <PageHeader title="Dispatch board" icon={MapPin} actions={<><Link className={btn} to="/garage/towing">Towing</Link><button className={btnPrimary} onClick={() => setOpen("new")}><Plus className="h-4 w-4" /> New call-out</button></>} />
      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <MultiMap stops={stops} className="h-[60svh]" onPick={(id) => { if (!id.startsWith("truck:")) setOpen(tows.find((t) => t.id === id) || null); }} />
        <div className="space-y-2">
          {live.map((t, i) => (
            <button key={t.id} onClick={() => setOpen(t)} className="block w-full rounded-2xl border border-border bg-card p-2.5 text-left hover:border-primary/40">
              <div className="flex items-center justify-between gap-2"><p className="font-semibold">{i + 1}. {t.title}</p><StageChip stages={TOW_STAGES} stage={t.stage} /></div>
              <p className="truncate text-xs text-muted-foreground">{t.data?.type} · {t.data?.pickup || "Pick-up not set"}{t.data?.drop ? ` → ${t.data.drop}` : ""}</p>
              <p className="text-xs">{trucks.find((x) => x.id === t.data?.truck)?.title || <span className="text-destructive">No truck yet</span>} · {fmtMoney(num(t.amount))}</p>
            </button>
          ))}
          {!live.length && <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No live call-outs.</p>}
          <Panel title="Trucks" flush>
            <ul className="divide-y divide-border text-sm">
              {trucks.map((t) => <li key={t.id} className="flex items-center justify-between px-3 py-1.5"><span>{t.title} <span className="text-xs text-muted-foreground">{t.data?.gps?.at ? `seen ${new Date(t.data.gps.at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}` : "no GPS"}</span></span><StageChip stages={TRUCK_STAGES} stage={t.stage} /></li>)}
              {!trucks.length && <li className="px-3 py-3 text-xs text-muted-foreground"><Link className="text-primary" to="/apps/towing/truck?new=1">Add your trucks</Link></li>}
            </ul>
          </Panel>
        </div>
      </div>
      {open && <TowSheet tow={open === "new" ? null : open} trucks={trucks} onClose={() => { setOpen(null); refetch(); }} />}
    </div>
  );
}

/** Call-out booking and handling (dispatcher and driver use the same sheet). */
function TowSheet({ tow, trucks, onClose }: { tow: Rec | null; trucks: Rec[]; onClose: () => void }) {
  const tenantId = useTenantId();
  const refresh = useRefresh();
  const { value: rates } = useTowRates();
  const { data: insurers = [] } = useRecs("insurance", "insurer");
  const { busy, run } = useAction();
  const [f, setF] = useState(() => ({
    type: tow?.data?.type || "Tow", name: tow?.title || "", phone: tow?.data?.phone || "", plate: tow?.data?.plate || "",
    pickup: tow?.data?.pickup || "", drop: tow?.data?.drop || "", pickup_at: pt(tow?.data?.pickup_at), drop_at: pt(tow?.data?.drop_at),
    truck: tow?.data?.truck || "", driver: tow?.employee_id || null as string | null, night: tow?.data?.night ?? isNight(),
    km: tow?.data?.km ?? null as number | null, amount: tow?.amount ?? null as number | null, insurer: tow?.data?.insurer || "", claim_no: tow?.data?.claim_no || "", notes: tow?.data?.notes || "",
  }));
  const [where, setWhere] = useState<"pickup" | "drop">("pickup");
  const autoKm = roadKm(f.pickup_at, f.drop_at, rates.roadFactor);
  const km = f.km ?? autoKm;
  const quote = towPrice(km, rates, { night: f.night });
  const price = f.amount ?? quote.total;
  const invQ = useInvoices([tow?.data?.invoice_id]);
  const inv = invQ.data?.get(tow?.data?.invoice_id);
  const [link, setLink] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 220 }).then(setQr).catch(() => setQr(null)); }, [link]);

  const save = () => run("save", async () => {
    if (!f.phone.trim() && !f.name.trim()) throw new Error("Enter the caller's name or phone");
    const customerId = tow?.customer_id || (f.phone ? await customerByPhone(tenantId!, f.phone, f.name) : null);
    const row: any = {
      title: f.name.trim() || f.plate || f.phone, customer_id: customerId, employee_id: f.driver, amount: price,
      data: { type: f.type, phone: f.phone, plate: normalisePlate(f.plate), pickup: f.pickup, drop: f.drop, pickup_at: f.pickup_at, drop_at: f.drop_at, truck: f.truck || null, night: f.night, km, insurer: f.insurer || null, claim_no: f.claim_no || null, notes: f.notes, quote },
    };
    if (tow) await patchRec(tow.id, row);
    else await insertRec("towing", "tow", { ...row, stage: f.truck ? "dispatched" : "requested" }, "TOW-");
    if (f.truck) { const t = trucks.find((x) => x.id === f.truck); if (t && t.stage !== "busy") await moveStage(t, "busy", "On a job"); }
    refresh("towing"); onClose();
  }, tow ? "Saved" : "Call-out booked");

  const ensureInvoice = async () => {
    if (tow?.data?.invoice_id) return tow.data.invoice_id as string;
    let customerId = tow?.customer_id || (f.phone ? await customerByPhone(tenantId!, f.phone, f.name) : null);
    const ins = insurers.find((i) => i.id === f.insurer);
    if (ins?.customer_id) customerId = ins.customer_id;
    if (!customerId) throw new Error("Enter the caller's phone first");
    const lines = [
      { name: `${f.type}${f.plate ? ` · ${normalisePlate(f.plate)}` : ""}: call-out`, quantity: 1, rate: ins ? price : quote.base || price },
      ...(!ins && quote.base && price > quote.base ? [{ name: `Distance ${quote.chargeableKm} km${f.pickup ? ` from ${f.pickup}` : ""}${f.drop ? ` to ${f.drop}` : ""}${quote.surcharge ? " incl. night rate" : ""}`, quantity: 1, rate: Math.round((price - quote.base) * 100) / 100 }] : []),
    ];
    const i = await createInvoice(tenantId!, { customerId, lines, subject: `${f.type} ${tow?.number || ""}`, reference: [tow?.number, f.claim_no].filter(Boolean).join(" / "), source: "garage_towing", status: ins ? "draft" : "sent", dueDays: ins ? num(ins.data?.terms_days) || 30 : 0 });
    await patchRec(tow!.id, { data: { invoice_id: i.id } });
    tow!.data = { ...(tow!.data || {}), invoice_id: i.id };
    void invQ.refetch();
    return i.id;
  };
  const next = tow ? TOW_STAGES[Math.min(TOW_STAGES.length - 2, TOW_STAGES.findIndex((s) => s.key === tow.stage) + 1)] : null;

  return (
    <Modal open onClose={onClose} size="xl" title={tow ? `${tow.number} · ${tow.title}` : "New call-out"} description={tow ? TOW_STAGES.find((s) => s.key === tow.stage)?.label : "Caller, places on the map, truck and price."}
      footer={<><button className={btn} onClick={onClose}>Close</button><button className={btnPrimary} disabled={!!busy} onClick={save}>{tow ? "Save" : "Book call-out"}</button></>}>
      <div className="space-y-3">
        {tow && (
          <div className="flex flex-wrap gap-2">
            {next && tow.stage !== "closed" && <button className={btnDark} disabled={!!busy} onClick={() => void run("mv", async () => { await moveStage(tow, next.key, next.label); if (next.key === "delivered" || next.key === "closed") { const t = trucks.find((x) => x.id === tow.data?.truck); if (t) await moveStage(t, "available", "Available"); } refresh("towing"); onClose(); })}>Mark {next.label.toLowerCase()}</button>}
            {pt(tow.data?.pickup_at) && <a className={btn} href={directionsUrl(pt(tow.data.pickup_at)!)} target="_blank" rel="noreferrer"><Navigation className="h-4 w-4" /> To pick-up</a>}
            {pt(tow.data?.drop_at) && <a className={btn} href={directionsUrl(pt(tow.data.drop_at)!)} target="_blank" rel="noreferrer"><Navigation className="h-4 w-4" /> To drop-off</a>}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          <Labeled label="Service"><select className="fi" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{["Tow", "Mobile mechanic", "Jump start", "Tyre change", "Fuel delivery", "Lock-out", "Recovery"].map((x) => <option key={x}>{x}</option>)}</select></Labeled>
          <Labeled label="Caller name"><input className="fi" placeholder="Enter caller's name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Labeled>
          <Labeled label="Caller phone"><input className="fi" inputMode="tel" placeholder="07XXXXXXXX" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Labeled>
          <Labeled label="Number plate"><input className="fi" placeholder="Enter number plate" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} /></Labeled>
          <Labeled label="Pick-up place"><input className="fi" placeholder="Enter road / landmark" value={f.pickup} onChange={(e) => setF({ ...f, pickup: e.target.value })} /></Labeled>
          <Labeled label="Drop-off place"><input className="fi" placeholder="Enter garage / address" value={f.drop} onChange={(e) => setF({ ...f, drop: e.target.value })} /></Labeled>
        </div>
        <div>
          <div className="mb-1 flex gap-1">
            {(["pickup", "drop"] as const).map((k) => <button key={k} onClick={() => setWhere(k)} className={`rounded-lg px-3 py-1 text-sm font-medium ${where === k ? "bg-primary text-primary-foreground" : "border border-border"}`}>{k === "pickup" ? "Pin pick-up" : "Pin drop-off"}{(k === "pickup" ? f.pickup_at : f.drop_at) ? " ✓" : ""}</button>)}
          </div>
          <LocationPicker key={where} value={where === "pickup" ? f.pickup_at : f.drop_at} onChange={(p) => setF(where === "pickup" ? { ...f, pickup_at: p } : { ...f, drop_at: p })} />
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <Labeled label="Truck"><select className="fi" value={f.truck} onChange={(e) => setF({ ...f, truck: e.target.value })}><option value="">Not yet</option>{trucks.filter((t) => t.stage !== "off" || t.id === f.truck).map((t) => <option key={t.id} value={t.id}>{t.title}{t.stage === "busy" ? " (busy)" : ""}</option>)}</select></Labeled>
          <Labeled label="Driver / mechanic"><EmployeeSelect value={f.driver} onChange={(v) => setF({ ...f, driver: v })} /></Labeled>
          <Labeled label="Distance (km)" hint={autoKm ? `Map estimate ${autoKm} km` : "Pin both places or type it"}><NumIn value={km} onChange={(v) => setF({ ...f, km: v })} /></Labeled>
          <Labeled label="Price" hint={`Price list: ${fmtMoney(quote.total)}`}><NumIn value={price} onChange={(v) => setF({ ...f, amount: v })} /></Labeled>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.night} onChange={(e) => setF({ ...f, night: e.target.checked, amount: null })} /> <Moon className="h-4 w-4" /> Night / holiday rate</label>
        <div className="grid gap-2 sm:grid-cols-2">
          <Labeled label="Insurer (towing claim)"><select className="fi" value={f.insurer} onChange={(e) => setF({ ...f, insurer: e.target.value })}><option value="">Customer pays</option>{insurers.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}</select></Labeled>
          <Labeled label="Insurer authority / claim number"><input className="fi" placeholder="Enter authority number" value={f.claim_no} onChange={(e) => setF({ ...f, claim_no: e.target.value })} /></Labeled>
        </div>
        <Labeled label="Notes"><textarea className="fi" rows={2} placeholder="Enter what happened, vehicle condition…" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Labeled>
        {tow && (
          <>
            <Panel title="On-site invoice & M-Pesa" icon={Receipt}>
              {inv ? <p className="mb-2 text-sm"><Link className="text-primary" to={`/sales/invoices/${inv.id}`}>{inv.invoice_number}</Link> · {fmtMoney(num(inv.total))} · {inv.status}</p> : null}
              {inv?.status !== "paid" && (
                <div className="flex flex-wrap gap-2">
                  <button className={btnPrimary} disabled={!!busy} onClick={() => void run("sms", async () => { const id = await ensureInvoice(); if (!f.insurer) setLink(await smsPayLink(id, f.phone, `${f.type} ${fmtMoney(price)}. Pay by M-Pesa:`)); }, f.insurer ? "Invoice drafted for the insurer" : "Payment link sent by SMS")}><Smartphone className="h-4 w-4" /> {f.insurer ? "Invoice insurer" : "Invoice & SMS pay link"}</button>
                  {!f.insurer && <button className={btn} disabled={!!busy} onClick={() => void run("qr", async () => { const id = await ensureInvoice(); setLink(await invoicePayLink(id)); })}>Show QR</button>}
                </div>
              )}
              {qr && <img src={qr} alt="Scan to pay" className="mx-auto mt-2 h-52 w-52 rounded-xl bg-white p-2" />}
            </Panel>
            <Panel title="Photos at pick-up" icon={Camera}>
              <DocumentsPanel entityType="garage_tow" entityId={tow.id} entityName={`${tow.number || ""} ${tow.title}`} checklist={["Photos at pick-up", "Photos at drop-off", "Signed tow sheet"]} />
            </Panel>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Driver's phone screen (bare): choose the truck, share live location, work the assigned jobs. */
export function TowDriver() {
  return <Gate module="towing"><Driver /></Gate>;
}

function Driver() {
  const { tows, trucks, refetch } = useLiveTowing();
  const [truckId, setTruckId] = useState<string>(() => { try { return localStorage.getItem("garage.tow.truck") || ""; } catch { return ""; } });
  const [sharing, setSharing] = useState(true);
  const { pos, error } = useWatchPosition(sharing && !!truckId);
  const [open, setOpen] = useState<Rec | null>(null);
  useEffect(() => { try { localStorage.setItem("garage.tow.truck", truckId); } catch { /* per device */ } }, [truckId]);
  // Send the truck's position at most every 30 seconds.
  const [last, setLast] = useState(0);
  useEffect(() => {
    if (!pos || !truckId || Date.now() - last < 30000) return;
    setLast(Date.now());
    void sb.from("app_records").select("data").eq("id", truckId).maybeSingle().then(({ data }: any) =>
      sb.from("app_records").update({ data: { ...(data?.data || {}), gps: { lat: pos.lat, lng: pos.lng, at: new Date().toISOString() } } }).eq("id", truckId));
  }, [pos, truckId]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = useMemo(() => tows.filter((t) => t.data?.truck === truckId && LIVE.includes(String(t.stage))), [tows, truckId]);
  return (
    <div className="min-h-[100svh] space-y-3 bg-background p-3">
      <div className="flex items-center gap-2"><Truck className="h-6 w-6 text-primary" /><h1 className="flex-1 font-display text-lg font-bold">Driver</h1><Link to="/garage/towing" className={btn}>Back</Link></div>
      <select className="fi" value={truckId} onChange={(e) => setTruckId(e.target.value)}><option value="">Choose your truck…</option>{trucks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sharing} onChange={(e) => setSharing(e.target.checked)} /> Share my location with dispatch {pos ? "✓" : ""}</label>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {mine.map((t) => (
        <button key={t.id} onClick={() => setOpen(t)} className="block w-full rounded-2xl border border-border bg-card p-3 text-left">
          <div className="flex items-center justify-between"><p className="text-lg font-bold">{t.title}</p><StageChip stages={TOW_STAGES} stage={t.stage} /></div>
          <p className="text-sm text-muted-foreground">{t.data?.type} · {t.data?.pickup}{t.data?.drop ? ` → ${t.data.drop}` : ""}</p>
          {t.data?.phone && <a href={`tel:${t.data.phone}`} onClick={(e) => e.stopPropagation()} className="mt-1 inline-block text-sm font-semibold text-primary">Call {t.data.phone}</a>}
        </button>
      ))}
      {truckId && !mine.length && <p className="py-10 text-center text-sm text-muted-foreground">No jobs for this truck right now.</p>}
      {open && <TowSheet tow={open} trucks={trucks} onClose={() => { setOpen(null); refetch(); }} />}
    </div>
  );
}

export function TowRatesPage() {
  return <Gate module="towing"><RatesInner /></Gate>;
}

function RatesInner() {
  const s = useTowRates();
  const [v, setV] = useState<TowRates | null>(null);
  const cur = v || s.value;
  const { busy, run } = useAction();
  const field = (k: keyof TowRates, label: string, hint?: string) => <Labeled label={label} hint={hint}><NumIn value={cur[k]} onChange={(x) => setV({ ...cur, [k]: x ?? 0 })} /></Labeled>;
  const ex = towPrice(25, cur);
  return (
    <div className="space-y-3">
      <PageHeader title="Towing prices" icon={Settings2} actions={<button className={btnPrimary} disabled={!v || !!busy} onClick={() => void run("s", async () => { await s.save(cur); setV(null); }, "Saved")}>Save</button>} />
      <Panel>
        <div className="grid gap-2 sm:grid-cols-3">
          {field("base", "Call-out / hook-up fee")}{field("perKm", "Price per km")}{field("includedKm", "Km included in the call-out fee")}
          {field("nightPct", "Night / holiday extra %")}{field("minimum", "Minimum charge")}{field("roadFactor", "Road distance factor", "Map straight-line km × this ≈ road km (e.g. 1.3).")}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Example: a 25 km tow costs {fmtMoney(ex.total)}.</p>
      </Panel>
    </div>
  );
}
