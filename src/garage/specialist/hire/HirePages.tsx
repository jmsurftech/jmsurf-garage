import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, Camera, CarFront, ChevronLeft, ChevronRight, FileSignature, KeyRound, LogIn, LogOut, Pencil, Plus, Receipt, Wrench } from "lucide-react";
import { EmptyState, PageHeader, PageLoader, Panel } from "@/components/kit";
import DocumentsPanel from "@/components/DocumentsPanel";
import { SignaturePad } from "@/apps/fields";
import { fmtMoney } from "@/apps/format";
import { useTenantId } from "@/hooks/useTenantId";
import { HIRE_CAR_STAGES, HIRE_STAGES } from "../apps";
import { ensureVehicle, logEvent, moveStage, num, patchRec, sb, sendToWorkshop, useCustomers, useInvoices, useRec, useRecs, useRefresh, useVehicles, type Rec } from "../shared/db";
import { createInvoice } from "../shared/billing";
import { downloadPdf, item, party } from "../shared/pdf";
import { btn, btnDark, btnPrimary, Gate, KV, Labeled, ModuleHome, NumIn, StageBar, StageChip, useAction } from "../shared/ui";
import { daysBetween, hireCharges, hireDays, overlaps } from "../lib/calc";

const ACTIVE = ["reserved", "out"];

/** Service and paperwork flags for a hire car (from the workshop's vehicle list and job cards). */
function useServiceFlags(cars: Rec[]) {
  const { data: vehicles = [] } = useVehicles(cars.length > 0);
  const ids = cars.map((c) => c.data?.vehicle_id).filter(Boolean) as string[];
  const jobsQ = useQuery({
    queryKey: ["sp-hire-open-jobs", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => ((await sb.from("garage_jobs").select("id, vehicle_id, status, job_no").in("vehicle_id", ids).not("status", "in", "(done,completed,collected,closed,cancelled,invoiced,delivered)")).data || []) as any[],
  });
  return (c: Rec) => {
    const flags: string[] = [];
    const v = vehicles.find((x) => x.id === c.data?.vehicle_id);
    if ((jobsQ.data || []).some((j) => j.vehicle_id === c.data?.vehicle_id)) flags.push("In the workshop");
    if (num(c.data?.service_km) > 0 && num(c.quantity) - num(c.data?.last_service_km) >= num(c.data.service_km) - 500) flags.push("Service due");
    if (v?.insurance_expiry && daysBetween(new Date(), v.insurance_expiry) <= 14) flags.push("Insurance expiring");
    if (v?.inspection_expiry && daysBetween(new Date(), v.inspection_expiry) <= 14) flags.push("Inspection due");
    return flags;
  };
}

export function HireHome() {
  const { data: cars = [] } = useRecs("car_hire", "hire_car");
  const { data: bookings = [] } = useRecs("car_hire", "booking");
  const flags = useServiceFlags(cars);
  const today = new Date().toISOString().slice(0, 10);
  const due = bookings.filter((b) => b.stage === "out" && b.ends_at && String(b.ends_at).slice(0, 10) <= today);
  const flagged = cars.filter((c) => flags(c).length);
  // Utilisation over the last 30 days: hired car-days / available car-days.
  const from = new Date(Date.now() - 30 * 86400000), to = new Date();
  const hiredDays = bookings.filter((b) => ["out", "returned", "closed"].includes(String(b.stage)) && b.starts_at).reduce((a, b) => {
    const s = Math.max(new Date(b.starts_at!).getTime(), from.getTime()), e = Math.min(new Date(b.ends_at || b.starts_at!).getTime(), to.getTime());
    return a + Math.max(0, (e - s) / 86400000);
  }, 0);
  const fleetDays = cars.filter((c) => c.stage !== "retired").length * 30;
  const income30 = bookings.filter((b) => b.starts_at && new Date(b.starts_at) >= from).reduce((a, b) => a + num(b.amount), 0);
  return (
    <ModuleHome module="car_hire" title="Car hire" icon={KeyRound}
      actions={<Link to="/apps/car_hire/booking?new=1" className={btnPrimary}><Plus className="h-4 w-4" /> New booking</Link>}
      stats={[
        { label: "Cars available", value: cars.filter((c) => c.stage === "available").length, tone: "success", icon: CarFront },
        { label: "Out on hire", value: bookings.filter((b) => b.stage === "out").length, tone: "warning" },
        { label: "Due back today / late", value: due.length, tone: due.length ? "danger" : "muted" },
        { label: "Cars needing attention", value: flagged.length, tone: flagged.length ? "danger" : "success", icon: AlertTriangle, hint: `Utilisation 30 days ${fleetDays ? Math.round((hiredDays / fleetDays) * 100) : 0}% · ${fmtMoney(income30)}` },
      ]}
      links={[
        { to: "/garage/hire/calendar", label: "Availability", icon: CalendarDays },
        { to: "/apps/car_hire/booking", label: "Bookings", icon: KeyRound },
        { to: "/apps/car_hire/hire_car", label: "Hire fleet", icon: CarFront },
      ]}>
      {flagged.length > 0 && (
        <Panel title="Cars needing attention" icon={Wrench}>
          <ul className="space-y-1 text-sm">{flagged.map((c) => <li key={c.id}><Link className="text-primary" to={`/apps/car_hire/hire_car?open=${c.id}`}>{c.data?.plate} {c.title}</Link> · {flags(c).join(", ")}</li>)}</ul>
        </Panel>
      )}
      <Panel title="Bookings" flush>
        <div className="overflow-x-auto">
          <table className="dt">
            <thead><tr><th>Booking</th><th>Car</th><th>Out</th><th>Back</th><th className="num">Amount</th><th>Stage</th></tr></thead>
            <tbody>
              {bookings.filter((b) => ACTIVE.includes(String(b.stage)) || b.stage === "returned").map((b) => (
                <tr key={b.id}>
                  <td data-label="Booking"><Link className="text-primary" to={`/garage/hire/bookings/${b.id}`}>{b.number} {b.title}</Link></td>
                  <td data-label="Car">{cars.find((c) => c.id === b.parent_id)?.data?.plate || "—"}</td>
                  <td data-label="Out">{b.starts_at ? new Date(b.starts_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                  <td data-label="Back" className={due.includes(b) ? "font-semibold text-destructive" : ""}>{b.ends_at ? new Date(b.ends_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                  <td data-label="Amount" className="num">{fmtMoney(num(b.amount))}</td>
                  <td data-label="Stage"><StageChip stages={HIRE_STAGES} stage={b.stage} /></td>
                </tr>
              ))}
              {!bookings.length && <tr><td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No bookings yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </ModuleHome>
  );
}

export function HireCalendar() {
  return <Gate module="car_hire"><Calendar /></Gate>;
}

function Calendar() {
  const { data: cars = [] } = useRecs("car_hire", "hire_car");
  const { data: bookings = [] } = useRecs("car_hire", "booking");
  const flags = useServiceFlags(cars);
  const [start, setStart] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const on = (b: Rec, d: Date) => { const e = new Date(d); e.setDate(e.getDate() + 1); return !!b.starts_at && overlaps(b.starts_at, b.ends_at || b.starts_at, d.toISOString(), e.toISOString()); };
  return (
    <div className="space-y-3">
      <PageHeader title="Hire availability" icon={CalendarDays} actions={<>
        <button className={btn} onClick={() => { const d = new Date(start); d.setDate(d.getDate() - 7); setStart(d); }} aria-label="Earlier"><ChevronLeft className="h-4 w-4" /></button>
        <button className={btn} onClick={() => { const d = new Date(start); d.setDate(d.getDate() + 7); setStart(d); }} aria-label="Later"><ChevronRight className="h-4 w-4" /></button>
        <Link to="/apps/car_hire/booking?new=1" className={btnPrimary}><Plus className="h-4 w-4" /> Book</Link>
      </>} />
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[900px] text-xs">
          <thead><tr className="border-b border-border bg-muted/40"><th className="sticky left-0 w-40 bg-muted/40 px-2 py-2 text-left">Car</th>{days.map((d) => <th key={d.toISOString()} className="px-1 py-2 text-center font-semibold">{d.toLocaleDateString("en-KE", { weekday: "narrow", day: "numeric" })}</th>)}</tr></thead>
          <tbody>
            {cars.filter((c) => c.stage !== "retired").map((c) => {
              const fl = flags(c);
              return (
                <tr key={c.id} className="border-b border-border">
                  <td className="sticky left-0 bg-card px-2 py-1.5"><Link to={`/apps/car_hire/hire_car?open=${c.id}`} className="font-semibold">{c.data?.plate || c.title}</Link><p className="truncate text-[10px] text-muted-foreground">{c.title}</p>{fl.length > 0 && <p className="text-[10px] font-semibold text-destructive">{fl.join(", ")}</p>}</td>
                  {days.map((d) => {
                    const b = bookings.find((x) => x.parent_id === c.id && ACTIVE.concat("returned").includes(String(x.stage)) && on(x, d));
                    return (
                      <td key={d.toISOString()} className="p-0.5">
                        {b ? <Link to={`/garage/hire/bookings/${b.id}`} title={`${b.number} ${b.title}`} className={`block h-7 rounded ${b.stage === "out" ? "bg-amber-500/70" : b.stage === "reserved" ? "bg-blue-500/60" : "bg-violet-500/50"}`} />
                          : c.stage === "maintenance" ? <span className="block h-7 rounded bg-red-500/30" /> : <span className="block h-7 rounded bg-emerald-500/10" />}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!cars.length && <tr><td colSpan={15} className="py-6 text-center text-muted-foreground"><Link className="text-primary" to="/apps/car_hire/hire_car?new=1">Add your hire cars</Link></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Blue reserved · amber out on hire · violet returned · red in the workshop · green free.</p>
    </div>
  );
}

export function HireBooking() {
  return <Gate module="car_hire"><Booking /></Gate>;
}

function Booking() {
  const { id = "" } = useParams();
  const tenantId = useTenantId();
  const { data: b, isLoading } = useRec(id);
  const { data: car } = useRec(b?.parent_id);
  const { data: all = [] } = useRecs("car_hire", "booking");
  const { data: customers = [] } = useCustomers();
  const refresh = useRefresh();
  const { busy, run } = useAction();
  const [out, setOut] = useState<Record<string, any>>({});
  const [inn, setInn] = useState<Record<string, any>>({});
  const [sig, setSig] = useState<string | null>(null);
  useEffect(() => { if (b) { setOut(b.data?.out || {}); setInn(b.data?.in || {}); setSig(b.data?.signature || null); } }, [b?.id, b?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const invQ = useInvoices([b?.data?.invoice_id, b?.data?.deposit_invoice_id]);

  if (isLoading) return <PageLoader />;
  if (!b || b.app !== "car_hire" || b.kind !== "booking") return <EmptyState title="Booking not found" />;
  const cust = customers.find((c) => c.id === b.customer_id);
  const clash = all.filter((x) => x.id !== b.id && x.parent_id === b.parent_id && ACTIVE.includes(String(x.stage)) && b.starts_at && x.starts_at && overlaps(b.starts_at, b.ends_at || b.starts_at, x.starts_at, x.ends_at || x.starts_at));
  const days = hireDays(b.starts_at || new Date().toISOString(), inn.at || b.ends_at || new Date().toISOString());
  const rate = num(car?.amount);
  const ch = hireCharges({ days, dailyRate: rate, kmOut: num(out.km), kmIn: num(inn.km), kmPerDay: num(car?.data?.km_per_day), extraKmRate: num(car?.data?.extra_km), fuelOut: num(out.fuel), fuelIn: num(inn.fuel), fuelPerEighth: num(car?.data?.fuel_eighth), damage: num(inn.damage) });
  const deposit = num(b.data?.deposit) || num(car?.data?.deposit);

  const checkOut = () => run("out", async () => {
    if (!car) throw new Error("Choose the car on the booking first");
    if (!out.km) throw new Error("Enter the mileage out");
    if (clash.length) throw new Error(`This car is already booked then (${clash.map((x) => x.number).join(", ")})`);
    const next = { ...out, at: out.at || new Date().toISOString() };
    await patchRec(b.id, { data: { out: next, signature: sig } });
    await moveStage(b, "out", "Out on hire");
    await moveStage(car, "hired", "On hire");
    await patchRec(car.id, { quantity: num(out.km) } as any);
    await logEvent(b.id, `Checked out at ${num(out.km).toLocaleString()} km, fuel ${num(out.fuel)}/8.`);
    refresh("car_hire", b.id);
  }, "Car checked out");
  const checkIn = () => run("in", async () => {
    if (!inn.km) throw new Error("Enter the mileage in");
    if (num(inn.km) < num(out.km)) throw new Error("Mileage in is lower than mileage out");
    const next = { ...inn, at: inn.at || new Date().toISOString() };
    await patchRec(b.id, { amount: ch.total, data: { in: next, charges: ch } });
    await moveStage(b, "returned", "Returned");
    if (car) { await patchRec(car.id, { quantity: num(inn.km) } as any); await moveStage(car, "available", "Available"); }
    await logEvent(b.id, `Returned at ${num(inn.km).toLocaleString()} km, fuel ${num(inn.fuel)}/8. Charges ${fmtMoney(ch.total)}.`);
    refresh("car_hire", b.id);
  }, "Car checked in");
  const depositInvoice = () => run("dep", async () => {
    if (!b.customer_id) throw new Error("Set the customer first");
    if (!deposit) throw new Error("Set the deposit on the booking or the car");
    const i = await createInvoice(tenantId!, { customerId: b.customer_id, lines: [{ name: `Refundable hire deposit · ${car?.data?.plate || car?.title || ""}`, quantity: 1, rate: deposit }], subject: `Hire deposit ${b.number || ""}`, reference: b.number, source: "garage_hire", status: "sent", dueDays: 0 });
    await patchRec(b.id, { data: { deposit_invoice_id: i.id } }); refresh("car_hire", b.id); void invQ.refetch();
  }, "Deposit invoice created");
  const invoice = () => run("inv", async () => {
    if (!b.customer_id) throw new Error("Set the customer first");
    if (b.data?.invoice_id) throw new Error("Already invoiced");
    const plate = car?.data?.plate || car?.title || "";
    const lines = [
      { name: `Car hire ${plate}: ${ch.days} day(s)`, quantity: ch.days, rate },
      ...(ch.extraKm ? [{ name: `Extra kilometres (${ch.extraKm} km)`, quantity: ch.extraKm, rate: num(car?.data?.extra_km) }] : []),
      ...(ch.fuelShort ? [{ name: `Fuel short (${ch.fuelShort}/8 tank)`, quantity: ch.fuelShort, rate: num(car?.data?.fuel_eighth) }] : []),
      ...(ch.damage ? [{ name: `Damage: ${inn.damage_note || "see check-in report"}`, quantity: 1, rate: ch.damage }] : []),
    ];
    const i = await createInvoice(tenantId!, { customerId: b.customer_id, lines, subject: `Car hire ${b.number || ""}`, reference: b.number, source: "garage_hire", notes: deposit ? `Deposit of ${fmtMoney(deposit)} held separately.` : null });
    await patchRec(b.id, { amount: ch.total, data: { invoice_id: i.id } });
    await moveStage(b, "closed", "Closed");
    refresh("car_hire", b.id); void invQ.refetch();
  }, "Hire invoice created (draft) in Sales");
  const toWorkshop = () => run("ws", async () => {
    if (!car) throw new Error("No car on this booking");
    const vehicleId = car.data?.vehicle_id || await ensureVehicle(tenantId!, { plate: car.data?.plate || car.title });
    if (!car.data?.vehicle_id) await patchRec(car.id, { data: { vehicle_id: vehicleId } });
    await sendToWorkshop(tenantId!, { vehicle_id: vehicleId, job_type: inn.damage ? "body_paint" : "mechanical", complaint: `Hire return ${b.number}: ${inn.damage_note || inn.notes || "check after hire"}`, source: { module: "car_hire", booking_id: b.id, hire_car_id: car.id } });
    await moveStage(car, "maintenance", "In workshop"); refresh("car_hire");
  }, "Job card opened in the workshop");
  const contract = () => run("pdf", () => downloadPdf(tenantId!, {
    title: "Vehicle Hire Agreement", number: b.number, party: party("Hirer", cust?.name || b.title, [cust?.phone, b.data?.id_no ? `ID ${b.data.id_no}` : null, b.data?.licence ? `Licence ${b.data.licence}` : null]),
    secondParty: party("Vehicle", `${car?.title || ""} ${car?.data?.plate || ""}`, [car?.data?.category]),
    meta: [{ label: "Pick-up", value: b.starts_at ? new Date(b.starts_at).toLocaleString("en-KE") : "—" }, { label: "Return", value: b.ends_at ? new Date(b.ends_at).toLocaleString("en-KE") : "—" }, { label: "Mileage out", value: out.km ? `${num(out.km).toLocaleString()} km` : "—" }, { label: "Fuel out", value: out.fuel ? `${out.fuel}/8` : "—" }],
    currency: "KES", items: [item(`Hire ${car?.data?.plate || ""}`, hireDays(b.starts_at || new Date().toISOString(), b.ends_at || new Date().toISOString()), rate, "Days")],
    totals: { subtotal: num(b.amount) || rate, tax: 0, total: num(b.amount) || rate },
    sections: [
      { title: "Allowance", text: `${num(car?.data?.km_per_day) ? `${car?.data?.km_per_day} km per day free, then ${fmtMoney(num(car?.data?.extra_km))} per km.` : "Unlimited kilometres."} Missing fuel charged at ${fmtMoney(num(car?.data?.fuel_eighth))} per eighth of a tank.` },
      { title: "Deposit", text: deposit ? `Refundable deposit ${fmtMoney(deposit)}, returned after the car is checked in, less any charges.` : "No deposit." },
      { title: "Condition at pick-up", text: out.notes || "As per the photos taken at pick-up." },
      { title: "Hirer's duties", text: b.data?.with_driver ? "The vehicle is driven by our driver." : "The hirer drives only on a valid licence, does not sub-let the vehicle, reports any accident at once and returns the vehicle on time with the same fuel level." },
    ],
    signatures: ["Hirer", "For the company"],
  } as any, `${b.number || "hire"}-agreement.pdf`));

  const inv = invQ.data?.get(b.data?.invoice_id);
  const dep = invQ.data?.get(b.data?.deposit_invoice_id);
  return (
    <div className="space-y-3">
      <PageHeader title={`${b.number || ""} ${b.title}`} icon={KeyRound} actions={<>
        <Link className={btn} to={`/apps/car_hire/booking?open=${b.id}`}><Pencil className="h-4 w-4" /> Edit booking</Link>
        <button className={btn} disabled={!!busy} onClick={contract}><FileSignature className="h-4 w-4" /> Agreement PDF</button>
      </>} />
      <StageBar stages={HIRE_STAGES} value={b.stage} onChange={(s) => void run("st", async () => { await moveStage(b, s.key, s.label); refresh("car_hire", b.id); })} />
      {clash.length > 0 && <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">Double booking: this car is also booked on {clash.map((x) => x.number).join(", ")} for these dates.</p>}
      <Panel><KV items={[["Hirer", cust?.name], ["Phone", cust?.phone], ["Car", car ? `${car.data?.plate || ""} ${car.title}` : "—"], ["Daily rate", fmtMoney(rate)], ["Pick-up", b.starts_at ? new Date(b.starts_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : null], ["Return", b.ends_at ? new Date(b.ends_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : null], ["Licence", b.data?.licence], ["Deposit", fmtMoney(deposit)]]} /></Panel>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Check-out" icon={LogOut}>
          <div className="grid grid-cols-2 gap-2">
            <Labeled label="Mileage out (km)"><NumIn value={out.km} onChange={(v) => setOut({ ...out, km: v })} /></Labeled>
            <Labeled label="Fuel out (eighths, 8 = full)"><NumIn value={out.fuel} onChange={(v) => setOut({ ...out, fuel: v })} /></Labeled>
            <Labeled label="Condition / existing damage" className="col-span-2"><textarea className="fi" rows={2} placeholder="Enter scratches, dents, missing items" value={out.notes || ""} onChange={(e) => setOut({ ...out, notes: e.target.value })} /></Labeled>
          </div>
          <p className="mb-1 mt-2 text-xs text-muted-foreground">Hirer's signature</p>
          <SignaturePad value={sig} onChange={setSig} />
          <button className={`${btnPrimary} mt-2`} disabled={!!busy || b.stage !== "reserved"} onClick={checkOut}>{b.stage === "reserved" ? "Check out" : "Checked out"}</button>
        </Panel>
        <Panel title="Check-in" icon={LogIn}>
          <div className="grid grid-cols-2 gap-2">
            <Labeled label="Mileage in (km)"><NumIn value={inn.km} onChange={(v) => setInn({ ...inn, km: v })} /></Labeled>
            <Labeled label="Fuel in (eighths)"><NumIn value={inn.fuel} onChange={(v) => setInn({ ...inn, fuel: v })} /></Labeled>
            <Labeled label="Damage charge"><NumIn value={inn.damage} onChange={(v) => setInn({ ...inn, damage: v })} /></Labeled>
            <Labeled label="Damage found"><input className="fi" placeholder="Enter new damage" value={inn.damage_note || ""} onChange={(e) => setInn({ ...inn, damage_note: e.target.value })} /></Labeled>
          </div>
          <div className="mt-2 rounded-xl bg-muted/40 p-2 text-sm tabular-nums">
            {ch.days} day(s) × {fmtMoney(rate)} = {fmtMoney(ch.rental)}{ch.extraKm ? ` · ${ch.extraKm} extra km ${fmtMoney(ch.extraKmCharge)}` : ""}{ch.fuelShort ? ` · fuel ${fmtMoney(ch.fuelCharge)}` : ""}{ch.damage ? ` · damage ${fmtMoney(ch.damage)}` : ""} · <b>{fmtMoney(ch.total)}</b>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className={btnPrimary} disabled={!!busy || b.stage !== "out"} onClick={checkIn}>{b.stage === "out" ? "Check in" : "Checked in"}</button>
            <button className={btn} disabled={!!busy} onClick={toWorkshop}><Wrench className="h-4 w-4" /> To workshop</button>
          </div>
        </Panel>
      </div>
      <Panel title="Billing" icon={Receipt}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {dep ? <Link className="text-primary" to={`/sales/invoices/${dep.id}`}>Deposit {dep.invoice_number} · {dep.status}</Link> : <button className={btn} disabled={!!busy} onClick={depositInvoice}>Deposit invoice</button>}
          {inv ? <Link className="text-primary" to={`/sales/invoices/${inv.id}`}>Hire invoice {inv.invoice_number} · {inv.status}</Link> : <button className={btnDark} disabled={!!busy || !["returned", "out"].includes(String(b.stage))} onClick={invoice}><Receipt className="h-4 w-4" /> Hire invoice</button>}
        </div>
      </Panel>
      <Panel title="Damage check photos" icon={Camera}>
        <DocumentsPanel entityType="garage_hire" entityId={b.id} entityName={`${b.number || ""} ${b.title}`} checklist={["Photos at pick-up", "Photos at return", "Driving licence copy", "ID copy", "Signed agreement"]} />
      </Panel>
    </div>
  );
}
