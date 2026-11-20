import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BadgeDollarSign, Car, ClipboardCheck, Download, ExternalLink, FileSignature, FileText, Handshake, Landmark, MessageSquare, Pencil, Plus, Receipt, Repeat, ShieldCheck, Wrench, Warehouse, List } from "lucide-react";
import { EmptyState, PageHeader, PageLoader, Panel, MoreMenu } from "@/components/kit";
import DocumentsPanel from "@/components/DocumentsPanel";
import { SignaturePad } from "@/apps/fields";
import { fmtMoney } from "@/apps/format";
import { useTenantId } from "@/hooks/useTenantId";
import { CAR_STAGES } from "../apps";
import { ensureVehicle, jobsCost, logEvent, moveStage, num, patchRec, sb, sendToWorkshop, today, useCustomers, useInvoices, useJobsFrom, useRec, useRecs, useRefresh, type Rec } from "../shared/db";
import { createInvoice, invoiceBalance } from "../shared/billing";
import { downloadPdf, item, party } from "../shared/pdf";
import { btn, btnDark, btnPrimary, CustomerSelect, Gate, KV, Labeled, LinesTable, ModuleHome, NumIn, PublicPhotos, StageBar, StageChip, useAction } from "../shared/ui";
import { daysBetween, normalisePlate } from "../lib/calc";
import { profitOf } from "../lib/landedCost";

const OPEN = ["at_sea", "at_port", "prep", "in_yard", "reserved"];
const LOGBOOK_STEPS: [string, string][] = [
  ["forms", "Transfer forms signed by both parties"], ["ntsa", "Transfer started on NTSA"], ["fee", "Transfer fee paid"],
  ["issued", "New logbook issued"], ["handed", "Logbook handed to the buyer"],
];

function useSlug() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["sp-slug", tenantId],
    enabled: !!tenantId,
    staleTime: 3600_000,
    queryFn: async () => ((await sb.from("tenants_public").select("slug").eq("id", tenantId).maybeSingle()).data?.slug || null) as string | null,
  }).data;
}

export function YardHome() {
  const { data: cars = [] } = useRecs("vehicle_yard", "car");
  const { data: enquiries = [] } = useRecs("vehicle_yard", "enquiry");
  const slug = useSlug();
  const [stage, setStage] = useState<string>("open");
  const shown = cars.filter((c) => (stage === "open" ? OPEN.includes(String(c.stage)) : c.stage === stage));
  const stock = cars.filter((c) => OPEN.includes(String(c.stage)));
  const sold30 = cars.filter((c) => c.stage === "sold" && c.data?.sale?.date && daysBetween(c.data.sale.date) <= 30);
  return (
    <ModuleHome module="vehicle_yard" title="Vehicle yard" icon={Warehouse}
      actions={<>{slug && <a href={`/yard/${slug}`} target="_blank" rel="noreferrer" className={btn}><ExternalLink className="h-4 w-4" /> Public listings</a>}<Link to="/apps/vehicle_yard/car?new=1" className={btnPrimary}><Plus className="h-4 w-4" /> Add car</Link></>}
      stats={[
        { label: "Cars in stock", value: stock.length, icon: Car, hint: `${cars.filter((c) => ["at_sea", "at_port"].includes(String(c.stage))).length} on the way` },
        { label: "Stock at cost", value: fmtMoney(stock.reduce((a, c) => a + num(c.data?.cost), 0)) },
        { label: "Sold in 30 days", value: sold30.length, tone: "success", hint: fmtMoney(sold30.reduce((a, c) => a + num(c.data?.sale?.price), 0)) },
        { label: "New enquiries", value: enquiries.filter((e) => e.stage === "new").length, tone: "warning", icon: MessageSquare },
      ]}
      links={[
        { to: "/apps/vehicle_yard/car", label: "Stock board", icon: Car },
        { to: "/apps/vehicle_yard/enquiry", label: "Enquiries", icon: MessageSquare },
        { to: "/apps/vehicle_yard/valuation", label: "Trade-ins", icon: Repeat },
      ]}>
      <div className="flex flex-wrap gap-1">
        {[["open", "In stock"], ...CAR_STAGES.map((s) => [s.key, s.label])].map(([k, l]) => (
          <button key={k} onClick={() => setStage(k)} className={`rounded-xl px-3 py-1 text-[13px] font-medium ${stage === k ? "bg-primary text-primary-foreground" : "border border-border"}`}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map((c) => (
          <Link key={c.id} to={`/garage/yard/cars/${c.id}`} className="overflow-hidden rounded-2xl border border-border bg-card hover:border-primary/40">
            <div className="aspect-[4/3] bg-muted">{c.data?.photos?.[0] ? <img src={c.data.photos[0]} alt="" className="h-full w-full object-cover" loading="lazy" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><Car className="h-8 w-8" /></div>}</div>
            <div className="space-y-1 p-2.5">
              <div className="flex items-start justify-between gap-2"><p className="truncate text-sm font-semibold">{c.title}</p><StageChip stages={CAR_STAGES} stage={c.stage} /></div>
              <p className="text-xs text-muted-foreground">{[c.data?.mileage ? `${num(c.data.mileage).toLocaleString()} km` : null, c.data?.transmission, c.data?.location].filter(Boolean).join(" · ")}</p>
              <p className="font-display font-bold tabular-nums">{c.amount ? fmtMoney(num(c.amount)) : "Price not set"}</p>
              {OPEN.includes(String(c.stage)) && <p className="text-[11px] text-muted-foreground">{daysBetween(c.created_at)} days in stock</p>}
            </div>
          </Link>
        ))}
        {!shown.length && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">No cars here.</p>}
      </div>
      <SalesReport cars={cars} />
    </ModuleHome>
  );
}

/** Cars sold in the last 90 days with profit (landed / purchase cost + workshop prep + other costs). */
function SalesReport({ cars }: { cars: Rec[] }) {
  const sold = cars.filter((c) => c.stage === "sold" && c.data?.sale?.date && daysBetween(c.data.sale.date) <= 90);
  const ids = sold.map((c) => c.id);
  const prepQ = useQuery({
    queryKey: ["sp-yard-prep", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data: jobs } = await sb.from("garage_jobs").select("id, source").in("source->>car_id", ids);
      const cost = await jobsCost((jobs || []).map((j: any) => j.id));
      const out: Record<string, number> = {};
      for (const j of jobs || []) out[j.source?.car_id] = (out[j.source?.car_id] || 0) + (cost[j.id] || 0);
      return out;
    },
  });
  const rows = sold.map((c) => {
    const cost = num(c.data?.cost) + (prepQ.data?.[c.id] || 0) + (c.data?.extra_costs || []).reduce((a: number, e: any) => a + num(e.amount), 0);
    const sale = num(c.data?.sale?.price) || num(c.amount);
    return { c, cost, sale, ...profitOf(sale, cost), days: daysBetween(c.created_at, c.data.sale.date) };
  });
  return (
    <Panel title="Sales in the last 90 days" icon={BadgeDollarSign} flush>
      <div className="overflow-x-auto">
        <table className="dt">
          <thead><tr><th>Car</th><th>Sold</th><th className="num">Days in stock</th><th className="num">Price</th><th className="num">Cost</th><th className="num">Profit</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.c.id}><td data-label="Car"><Link className="text-primary" to={`/garage/yard/cars/${r.c.id}`}>{r.c.number} {r.c.title}</Link></td><td data-label="Sold">{r.c.data?.sale?.date}</td><td data-label="Days" className="num">{r.days}</td><td data-label="Price" className="num">{fmtMoney(r.sale)}</td><td data-label="Cost" className="num">{fmtMoney(r.cost)}</td><td data-label="Profit" className="num font-semibold">{fmtMoney(r.profit)} <span className="text-xs text-muted-foreground">{r.marginPct}%</span></td></tr>)}
            {rows.length > 0 && <tr className="font-semibold"><td colSpan={3}>Total</td><td className="num">{fmtMoney(rows.reduce((a, r) => a + r.sale, 0))}</td><td className="num">{fmtMoney(rows.reduce((a, r) => a + r.cost, 0))}</td><td className="num">{fmtMoney(rows.reduce((a, r) => a + r.profit, 0))}</td></tr>}
            {!rows.length && <tr><td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No cars sold in the last 90 days.</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function YardCar() {
  return <Gate module="vehicle_yard"><CarPage /></Gate>;
}

function CarPage() {
  const { id = "" } = useParams();
  const tenantId = useTenantId();
  const { data: car, isLoading } = useRec(id);
  const { data: customers = [] } = useCustomers();
  const { data: valuations = [] } = useRecs("vehicle_yard", "valuation");
  const { data: jobs = [], refetch: refetchJobs } = useJobsFrom("car_id", id);
  const refresh = useRefresh();
  const { busy, run } = useAction();
  const [photos, setPhotos] = useState<string[]>([]);
  const [extra, setExtra] = useState<Record<string, any>[]>([]);
  const [res, setRes] = useState<Record<string, any>>({});
  const [fin, setFin] = useState<Record<string, any>>({});
  const [sale, setSale] = useState<Record<string, any>>({});
  const [warranty, setWarranty] = useState<Record<string, any>>({});
  const [logbook, setLogbook] = useState<Record<string, { done?: boolean; date?: string }>>({});
  const [sig, setSig] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!car) return;
    setPhotos(car.data?.photos || []); setExtra(car.data?.extra_costs || []); setRes(car.data?.reservation || {}); setFin(car.data?.finance || {});
    setSale(car.data?.sale || {}); setWarranty(car.data?.warranty || {}); setLogbook(car.data?.logbook || {}); setSig(car.data?.sale?.signature || null); setDirty(false);
  }, [car?.id, car?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const costQ = useQuery({ queryKey: ["sp-car-jobs-cost", jobs.map((j) => j.id).join(",")], enabled: jobs.length > 0, queryFn: () => jobsCost(jobs.map((j) => j.id)) });
  const invQ = useInvoices([res.invoice_id, sale.invoice_id]);
  const prepCost = Object.values(costQ.data || {}).reduce((a, b) => a + b, 0);

  if (isLoading) return <PageLoader />;
  if (!car || car.app !== "vehicle_yard" || car.kind !== "car") return <EmptyState title="Car not found" />;
  const extraCost = extra.reduce((a, e) => a + num(e.amount), 0);
  const totalCost = num(car.data?.cost) + prepCost + extraCost;
  const price = num(sale.price) || num(car.amount);
  const p = profitOf(price, totalCost);
  const tradeIn = valuations.find((v) => v.id === sale.trade_in);
  const custName = (cid?: string) => customers.find((c) => c.id === cid)?.name || "";
  const set = (fn: (x: any) => void, v: any) => { fn(v); setDirty(true); };

  const save = (extraPatch: Record<string, any> = {}) => run("save", async () => {
    await patchRec(car.id, { data: { photos, extra_costs: extra.map((e) => ({ ...e, amount: num(e.amount) })), reservation: res, finance: fin, sale: { ...sale, signature: sig }, warranty, logbook, ...extraPatch } });
    setDirty(false); refresh("vehicle_yard", car.id);
  }, "Saved");

  const prep = () => run("prep", async () => {
    const plate = normalisePlate(car.data?.plate) || normalisePlate(car.data?.chassis);
    if (!plate) throw new Error("Enter the plate or chassis number first (Edit details)");
    const vehicleId = car.data?.vehicle_id || await ensureVehicle(tenantId!, { plate, make: car.data?.make, model: car.data?.model, year: num(car.data?.year) || null, vin: car.data?.chassis || null, mileage: num(car.data?.mileage) || null });
    const what = window.prompt("What needs doing? (service, repairs, detailing…)", "Pre-sale preparation") || "Pre-sale preparation";
    const job = await sendToWorkshop(tenantId!, { vehicle_id: vehicleId, customer_id: null, job_type: "prep", complaint: `${car.number || ""} ${car.title}: ${what}`, source: { module: "vehicle_yard", car_id: car.id } });
    await patchRec(car.id, { data: { vehicle_id: vehicleId } });
    if (["at_port", "in_yard", "at_sea"].includes(String(car.stage))) await moveStage(car, "prep", "In prep");
    await logEvent(car.id, `Prep job ${job.job_no || ""} opened in the workshop.`);
    void refetchJobs(); refresh("vehicle_yard", car.id);
  }, "Prep job opened; its cost is added to this car");

  const reserve = () => run("res", async () => {
    if (!res.customer_id) throw new Error("Choose the customer");
    if (!num(res.deposit)) throw new Error("Enter the deposit");
    const inv = res.invoice_id ? { id: res.invoice_id } : await createInvoice(tenantId!, { customerId: res.customer_id, lines: [{ name: `Reservation deposit: ${car.title}${car.data?.chassis ? ` (chassis ${car.data.chassis})` : ""}`, quantity: 1, rate: num(res.deposit) }], subject: `Deposit ${car.number || ""}`, reference: car.number, source: "garage_yard", status: "sent", dueDays: 0 });
    const next = { ...res, invoice_id: inv.id, date: res.date || today() };
    await patchRec(car.id, { customer_id: res.customer_id, data: { reservation: next } });
    await moveStage(car, "reserved", "Reserved");
    await logEvent(car.id, `Reserved for ${custName(res.customer_id)} with a deposit of ${fmtMoney(num(res.deposit))}.`);
    setRes(next); refresh("vehicle_yard", car.id); void invQ.refetch();
  }, "Reserved. The deposit invoice is in Sales.");

  const sell = () => run("sell", async () => {
    const customerId = sale.customer_id || res.customer_id;
    if (!customerId) throw new Error("Choose the buyer");
    if (!num(sale.price)) throw new Error("Enter the selling price");
    if (sale.invoice_id) throw new Error("This sale is already invoiced");
    const deposit = res.invoice_id && res.customer_id === customerId ? num(res.deposit) : 0;
    const ti = num(tradeIn?.amount);
    const inv = await createInvoice(tenantId!, {
      customerId, lines: [{ name: `${car.title}${car.data?.chassis ? `, chassis ${car.data.chassis}` : ""}${car.data?.plate ? `, ${car.data.plate}` : ""}`, quantity: 1, rate: num(sale.price) }],
      discount: deposit + ti, subject: `Vehicle sale ${car.number || ""}`, reference: car.number, source: "garage_yard", status: "draft", dueDays: 0,
      notes: [deposit ? `Less reservation deposit ${fmtMoney(deposit)} (invoiced separately).` : "", ti ? `Less trade-in ${tradeIn?.title || ""} valued at ${fmtMoney(ti)}.` : "", fin.type && fin.type !== "Cash" ? `Financed by ${fin.lender || fin.type}.` : ""].filter(Boolean).join(" ") || null,
    });
    const next = { ...sale, customer_id: customerId, invoice_id: inv.id, date: sale.date || today(), signature: sig };
    await patchRec(car.id, { customer_id: customerId, data: { sale: next, warranty, finance: fin } });
    if (tradeIn && tradeIn.stage !== "accepted") await moveStage(tradeIn, "accepted", "Accepted");
    await moveStage(car, "sold", "Sold");
    await logEvent(car.id, `Sold to ${custName(customerId)} for ${fmtMoney(num(sale.price))}. Invoice ${inv.number}.`);
    setSale(next); refresh("vehicle_yard", car.id); void invQ.refetch();
  }, "Sale invoice created (draft) in Sales");

  const buyer = customers.find((c) => c.id === (sale.customer_id || res.customer_id));
  const specs: [string, any][] = [["Make", car.data?.make], ["Model", car.data?.model], ["Year", car.data?.year], ["Mileage", car.data?.mileage ? `${num(car.data.mileage).toLocaleString()} km` : null], ["Colour", car.data?.colour], ["Engine", car.data?.engine_cc ? `${car.data.engine_cc} cc` : null], ["Fuel", car.data?.fuel], ["Transmission", car.data?.transmission], ["Chassis", car.data?.chassis], ["Plate", car.data?.plate]];
  const agreementPdf = () => run("agr", () => downloadPdf(tenantId!, {
    title: "Vehicle Sale Agreement", number: car.number, party: party("Buyer", buyer?.name || "—", [buyer?.phone]), secondParty: party("Vehicle", car.title, [car.data?.chassis ? `Chassis ${car.data.chassis}` : null, car.data?.plate]),
    meta: [{ label: "Date", value: sale.date || today() }, { label: "Payment", value: fin.type || "Cash" }],
    currency: "KES", items: [item(car.title, 1, num(sale.price) || num(car.amount))],
    totals: { subtotal: num(sale.price) || num(car.amount), tax: 0, total: num(sale.price) || num(car.amount) },
    sections: [
      { title: "Vehicle", text: specs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n") },
      ...(res.deposit ? [{ title: "Deposit", text: `Deposit received: ${fmtMoney(num(res.deposit))}` }] : []),
      ...(tradeIn ? [{ title: "Trade-in", text: `${tradeIn.title} accepted at ${fmtMoney(num(tradeIn.amount))}` }] : []),
      ...(fin.type && fin.type !== "Cash" ? [{ title: "Financing", text: [fin.type, fin.lender, fin.amount ? `Amount financed ${fmtMoney(num(fin.amount))}` : "", fin.months ? `${fin.months} months` : "", fin.ref ? `Ref ${fin.ref}` : ""].filter(Boolean).join(" · ") }] : []),
      { title: "Warranty", text: warranty.months ? `${warranty.months} months${warranty.km ? ` or ${num(warranty.km).toLocaleString()} km, whichever comes first` : ""}. ${warranty.terms || ""}` : "Sold as seen, no warranty unless written here." },
      { title: "Terms", text: sale.terms || "The buyer has inspected the vehicle. Ownership passes once the full price is paid. The seller hands over the logbook and signed transfer forms on full payment." },
    ],
    signatures: ["Buyer", "Seller"],
  } as any, `${car.number || "car"}-sale-agreement.pdf`));
  const receiptPdf = () => run("rcpt", async () => {
    const paid = [invQ.data?.get(res.invoice_id), invQ.data?.get(sale.invoice_id)].filter(Boolean).reduce((a, i: any) => a + num(i.amount_paid), 0);
    await downloadPdf(tenantId!, {
      title: "Vehicle Payment Receipt", number: car.number, party: party("Received from", buyer?.name || "—", [buyer?.phone]),
      meta: [{ label: "Date", value: new Date().toLocaleDateString("en-KE") }],
      currency: "KES", items: [item(`Payments towards ${car.title}`, 1, paid)], totals: { subtotal: paid, tax: 0, total: paid, paid },
      sections: [{ title: "Balance", text: `Price ${fmtMoney(num(sale.price) || num(car.amount))}. Paid ${fmtMoney(paid)}. Trade-in ${fmtMoney(num(tradeIn?.amount))}.` }], signatures: ["Received by"],
    } as any, `${car.number || "car"}-receipt.pdf`);
  });

  return (
    <div className="space-y-3">
      <PageHeader title={`${car.number || ""} ${car.title}`} icon={Car} actions={<>
        <MoreMenu items={[{ label: "Edit details", icon: Pencil, to: `/apps/vehicle_yard/car?open=${car.id}` }, { label: "All cars in the yard", icon: List, to: "/garage/yard", separator: true }]} />
        <button className={btnPrimary} disabled={!dirty || !!busy} onClick={() => save()}>Save</button>
      </>} />
      <StageBar stages={CAR_STAGES} value={car.stage} onChange={(s) => void run("st", async () => { await moveStage(car, s.key, s.label); refresh("vehicle_yard", car.id); })} />
      <Panel title="Photos" description="The first photo is the main one on the public listings page.">
        <PublicPhotos folder={`yard/${car.id}`} value={photos} onChange={(v) => set(setPhotos, v)} />
      </Panel>
      <Panel><KV items={[...specs, ["Location", car.data?.location], ["Asking", fmtMoney(num(car.amount))]] as any} /></Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Cost & profit" icon={BadgeDollarSign}>
          <div className="space-y-2">
            <KV className="sm:grid-cols-2" items={[["Purchase / landed cost", fmtMoney(num(car.data?.cost))], ["Workshop prep", fmtMoney(prepCost)], ["Other costs", fmtMoney(extraCost)], ["Total cost", <b>{fmtMoney(totalCost)}</b>], [sale.price ? "Sold for" : "Asking", fmtMoney(price)], ["Profit", <b className={p.profit < 0 ? "text-destructive" : "text-success"}>{fmtMoney(p.profit)} ({p.marginPct}%)</b>]]} />
            <LinesTable cols={[{ key: "name", label: "Other cost", placeholder: "Enter cost, e.g. inspection" }, { key: "amount", label: "Amount", type: "money", width: "120px" }]} rows={extra} onChange={(r) => set(setExtra, r)} addLabel="Add cost" />
          </div>
        </Panel>
        <Panel title="Workshop prep" icon={Wrench} actions={<button className={btnDark} disabled={!!busy} onClick={prep}><Wrench className="h-4 w-4" /> Send to workshop</button>}>
          <ul className="divide-y divide-border text-sm">
            {jobs.map((j) => <li key={j.id} className="flex justify-between py-1.5"><span>{j.job_no || "Job card"} · {j.complaint?.split(": ").pop()}</span><span className="text-xs text-muted-foreground">{j.status} · {fmtMoney(costQ.data?.[j.id] || 0)}</span></li>)}
            {!jobs.length && <li className="py-2 text-xs text-muted-foreground">No prep jobs yet.</li>}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Reservation" icon={Handshake} description="Takes a deposit on a payable invoice and marks the car reserved.">
          <div className="grid gap-2 sm:grid-cols-2">
            <Labeled label="Customer" className="sm:col-span-2"><CustomerSelect value={res.customer_id} onChange={(v) => set(setRes, { ...res, customer_id: v })} /></Labeled>
            <Labeled label="Deposit"><NumIn value={res.deposit} onChange={(v) => set(setRes, { ...res, deposit: v })} /></Labeled>
            <Labeled label="Hold until"><input type="date" className="fi" value={res.until || ""} onChange={(e) => set(setRes, { ...res, until: e.target.value })} /></Labeled>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button className={btnPrimary} disabled={!!busy || !!res.invoice_id} onClick={reserve}>{res.invoice_id ? "Reserved" : "Reserve"}</button>
            {res.invoice_id && invQ.data?.get(res.invoice_id) && <Link className="text-sm text-primary" to={`/sales/invoices/${res.invoice_id}`}>Deposit {invQ.data.get(res.invoice_id).invoice_number} · {invoiceBalance(invQ.data.get(res.invoice_id)) > 0 ? `${fmtMoney(invoiceBalance(invQ.data.get(res.invoice_id)))} due` : "paid"}</Link>}
          </div>
        </Panel>
        <Panel title="Financing" icon={Landmark}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Labeled label="Payment"><select className="fi" value={fin.type || "Cash"} onChange={(e) => set(setFin, { ...fin, type: e.target.value })}>{["Cash", "Bank finance", "Hire purchase", "Sacco", "Insurance premium finance"].map((x) => <option key={x}>{x}</option>)}</select></Labeled>
            <Labeled label="Bank / financier"><input className="fi" placeholder="Enter lender" value={fin.lender || ""} onChange={(e) => set(setFin, { ...fin, lender: e.target.value })} /></Labeled>
            <Labeled label="Amount financed"><NumIn value={fin.amount} onChange={(v) => set(setFin, { ...fin, amount: v })} /></Labeled>
            <Labeled label="Months"><NumIn value={fin.months} onChange={(v) => set(setFin, { ...fin, months: v })} /></Labeled>
            <Labeled label="Reference / offer letter"><input className="fi" placeholder="Enter reference" value={fin.ref || ""} onChange={(e) => set(setFin, { ...fin, ref: e.target.value })} /></Labeled>
            <Labeled label="Status"><select className="fi" value={fin.status || ""} onChange={(e) => set(setFin, { ...fin, status: e.target.value })}>{["", "Applied", "Approved", "Paid out to us", "Declined"].map((x) => <option key={x} value={x}>{x || "—"}</option>)}</select></Labeled>
          </div>
        </Panel>
      </div>

      <Panel title="Sale" icon={Receipt}>
        <div className="grid gap-2 sm:grid-cols-4">
          <Labeled label="Buyer" className="sm:col-span-2"><CustomerSelect value={sale.customer_id || res.customer_id} onChange={(v) => set(setSale, { ...sale, customer_id: v })} /></Labeled>
          <Labeled label="Selling price"><NumIn value={sale.price} onChange={(v) => set(setSale, { ...sale, price: v })} /></Labeled>
          <Labeled label="Sale date"><input type="date" className="fi" value={sale.date || ""} onChange={(e) => set(setSale, { ...sale, date: e.target.value })} /></Labeled>
          <Labeled label="Trade-in" className="sm:col-span-2">
            <select className="fi" value={sale.trade_in || ""} onChange={(e) => set(setSale, { ...sale, trade_in: e.target.value || null })}><option value="">None</option>{valuations.filter((v) => v.stage !== "declined").map((v) => <option key={v.id} value={v.id}>{v.title} · {fmtMoney(num(v.amount))}</option>)}</select>
          </Labeled>
          <Labeled label="Warranty (months)"><NumIn value={warranty.months} onChange={(v) => set(setWarranty, { ...warranty, months: v })} /></Labeled>
          <Labeled label="Warranty (km)"><NumIn value={warranty.km} onChange={(v) => set(setWarranty, { ...warranty, km: v })} /></Labeled>
          <Labeled label="Warranty terms" className="sm:col-span-4"><input className="fi" placeholder="Enter what the warranty covers" value={warranty.terms || ""} onChange={(e) => set(setWarranty, { ...warranty, terms: e.target.value })} /></Labeled>
          <Labeled label="Agreement terms" className="sm:col-span-4"><textarea className="fi" rows={2} placeholder="Enter any special terms" value={sale.terms || ""} onChange={(e) => set(setSale, { ...sale, terms: e.target.value })} /></Labeled>
        </div>
        <div className="mt-2"><p className="mb-1 text-xs text-muted-foreground">Buyer's signature</p><SignaturePad value={sig} onChange={(v) => set(setSig, v)} /></div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={btnPrimary} disabled={!!busy || !!sale.invoice_id} onClick={sell}><Receipt className="h-4 w-4" /> {sale.invoice_id ? "Sold" : "Sell & invoice"}</button>
          <button className={btn} disabled={!!busy} onClick={agreementPdf}><FileSignature className="h-4 w-4" /> Sale agreement</button>
          <button className={btn} disabled={!!busy} onClick={receiptPdf}><Download className="h-4 w-4" /> Receipt</button>
          {sale.invoice_id && invQ.data?.get(sale.invoice_id) && <Link className="text-sm text-primary" to={`/sales/invoices/${sale.invoice_id}`}>Invoice {invQ.data.get(sale.invoice_id).invoice_number} · {invQ.data.get(sale.invoice_id).status}</Link>}
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Logbook transfer" icon={ClipboardCheck}>
          <div className="space-y-1.5">
            {LOGBOOK_STEPS.map(([k, label]) => {
              const c = logbook[k] || {};
              return (
                <div key={k} className="flex items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-sm">
                  <input type="checkbox" checked={!!c.done} onChange={(e) => set(setLogbook, { ...logbook, [k]: { done: e.target.checked, date: e.target.checked ? c.date || today() : c.date } })} />
                  <span className="flex-1">{label}</span>
                  <input type="date" className="fi h-8 w-36" value={c.date || ""} onChange={(e) => set(setLogbook, { ...logbook, [k]: { ...c, date: e.target.value } })} />
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel title="After-sale warranty" icon={ShieldCheck}>
          {sale.date && warranty.months ? (() => {
            const end = new Date(sale.date); end.setMonth(end.getMonth() + num(warranty.months));
            const left = daysBetween(new Date(), end);
            return <p className="text-sm">{left >= 0 ? `Under warranty until ${end.toISOString().slice(0, 10)} (${left} days left)` : `Warranty ended ${end.toISOString().slice(0, 10)}`}{warranty.km ? ` or at ${num(warranty.km).toLocaleString()} km` : ""}.</p>;
          })() : <p className="text-sm text-muted-foreground">Set the sale date and warranty months.</p>}
          <p className="mt-2 text-xs text-muted-foreground">Warranty repairs go to the workshop as a warranty job from the vehicle's job card.</p>
        </Panel>
      </div>

      <Panel title="Documents" icon={FileText}>
        <DocumentsPanel entityType="garage_yard_car" entityId={car.id} entityName={`${car.number || ""} ${car.title}`} checklist={["Logbook copy", "Import documents", "Inspection report", "Signed sale agreement", "Transfer forms", "Buyer's ID copy", "Buyer's KRA PIN"]} />
      </Panel>
    </div>
  );
}

export { useSlug };
