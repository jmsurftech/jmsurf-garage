import { customerUrl } from "@/lib/host";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, ClipboardCheck, Download, FileSpreadsheet, Fuel, Gauge, Pencil, Plus, Receipt, Truck, Upload, Wrench, CheckCircle2, List } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader, PageLoader, Panel, Segmented, MoreMenu } from "@/components/kit";
import { fmtMoney } from "@/apps/format";
import { useTenantId } from "@/hooks/useTenantId";
import { APPROVAL_STAGES, CHECK_STAGES, FLEET_STAGES } from "../apps";
import { ensureVehicle, insertRec, jobsCost, logEvent, moveStage, newToken, num, patchRec, sb, sendToWorkshop, today, useRec, useRecs, useRefresh, useCustomers, type Rec } from "../shared/db";
import { createInvoice, invoiceBalance } from "../shared/billing";
import { downloadPdf, item, party } from "../shared/pdf";
import { btn, btnDark, btnPrimary, Gate, KV, Labeled, LinesTable, ModuleHome, NumIn, RecTable, ShareLink, StageBar, StageChip, useAction } from "../shared/ui";
import { contractPrice, costPerKm, normalisePlate, parseFuelCsv, serviceDue, withholdingVat, type FuelCsvRow } from "../lib/calc";

const portalUrl = (t: string) => customerUrl(`/fleet/${t}`);
const checkUrl = (t: string) => customerUrl(`/check/${t}`);
const monthKey = (d: string | Date) => new Date(d).toISOString().slice(0, 7);

export function FleetHome() {
  const { data: fleets = [] } = useRecs("fleet_contracts", "fleet");
  const { data: approvals = [] } = useRecs("fleet_contracts", "approval");
  const { data: checks = [] } = useRecs("fleet_contracts", "daily_check");
  const { data: fuel = [] } = useRecs("fleet_contracts", "fuel");
  const { data: customers = [] } = useCustomers();
  const cust = new Map(customers.map((c) => [c.id, c.name]));
  const m = monthKey(new Date());
  return (
    <ModuleHome module="fleet_contracts" title="Fleet contracts" icon={Truck}
      actions={<Link to="/apps/fleet_contracts/fleet?new=1" className={btnPrimary}><Plus className="h-4 w-4" /> New fleet account</Link>}
      stats={[
        { label: "Active fleets", value: fleets.filter((f) => f.stage === "active").length, icon: Briefcase },
        { label: "Waiting for approval", value: approvals.filter((a) => a.stage === "pending").length, tone: "warning" },
        { label: "Driver checks with faults", value: checks.filter((c) => c.stage === "faults").length, tone: "danger" },
        { label: "Fuel this month", value: fmtMoney(fuel.filter((f) => f.starts_at && monthKey(f.starts_at) === m).reduce((a, f) => a + num(f.amount), 0)), icon: Fuel },
      ]}
      links={[
        { to: "/apps/fleet_contracts/fleet", label: "Fleet accounts", icon: Briefcase },
        { to: "/apps/fleet_contracts/fleet_vehicle", label: "Fleet vehicles", icon: Truck },
        { to: "/apps/fleet_contracts/approval", label: "Approvals", icon: CheckCircle2 },
        { to: "/apps/fleet_contracts/lpo", label: "LPOs & LSOs", icon: FileSpreadsheet },
        { to: "/apps/fleet_contracts/fuel", label: "Fuel log", icon: Fuel },
        { to: "/apps/fleet_contracts/daily_check", label: "Driver checks", icon: ClipboardCheck },
      ]}>
      <Panel title="Fleet accounts" flush>
        <RecTable rows={fleets} to={(r) => `/garage/fleet/${r.id}`} empty="No fleet accounts yet."
          cols={[
            { label: "Fleet", get: (r) => r.title },
            { label: "Customer account", get: (r) => cust.get(r.customer_id || "") || "—" },
            { label: "Manager", get: (r) => r.data?.manager || "—" },
            { label: "Labour rate", get: (r) => (r.data?.labour_rate ? fmtMoney(num(r.data.labour_rate)) : "—"), num: true },
            { label: "Status", get: (r) => <StageChip stages={FLEET_STAGES} stage={r.stage} /> },
          ]} />
      </Panel>
    </ModuleHome>
  );
}

export function FleetAccount() {
  return <Gate module="fleet_contracts"><Account /></Gate>;
}

type Tab = "vehicles" | "approvals" | "fuel" | "checks" | "billing";

function Account() {
  const { id = "" } = useParams();
  const { data: fleet, isLoading } = useRec(id);
  const refresh = useRefresh();
  const { busy, run } = useAction();
  const [tab, setTab] = useState<Tab>("vehicles");
  if (isLoading) return <PageLoader />;
  if (!fleet || fleet.app !== "fleet_contracts" || fleet.kind !== "fleet") return <EmptyState title="Fleet account not found" />;
  const token = fleet.data?.portal_token as string | undefined;
  return (
    <div className="space-y-3">
      <PageHeader title={fleet.title} icon={Truck} actions={<>
        <MoreMenu items={[{ label: "Contract & prices", icon: Pencil, to: `/apps/fleet_contracts/fleet?open=${fleet.id}` }, { label: "All fleets", icon: List, to: "/garage/fleet", separator: true }]} />
      </>} />
      <StageBar stages={FLEET_STAGES} value={fleet.stage} onChange={(s) => void run("st", async () => { await moveStage(fleet, s.key, s.label); refresh("fleet_contracts", fleet.id); })} />
      <Panel>
        <KV items={[
          ["Manager", fleet.data?.manager], ["Manager phone", fleet.data?.phone], ["Labour rate", fleet.data?.labour_rate ? fmtMoney(num(fleet.data.labour_rate)) : "List price"],
          ["Parts markup", fleet.data?.parts_markup != null && fleet.data?.parts_markup !== "" ? `${fleet.data.parts_markup}%` : "List price"],
          ["LPO required", fleet.data?.lpo_required ? "Yes" : "No"], ["Online approval above", fleet.data?.approval_limit ? fmtMoney(num(fleet.data.approval_limit)) : "Every job"],
          ["Withholding VAT", fleet.data?.government ? `${num(fleet.data?.wht_rate)}%` : "No"], ["Contract ends", fleet.ends_at ? String(fleet.ends_at).slice(0, 10) : "—"],
        ]} />
        <div className="mt-3">
          {token ? <ShareLink url={portalUrl(token)} phone={fleet.data?.phone} label="Fleet portal (vehicles, history, spend, approvals)" text={`${fleet.title}: your fleet portal`} />
            : <button className={btn} disabled={!!busy} onClick={() => void run("tok", async () => { await patchRec(fleet.id, { data: { portal_token: newToken() } }); refresh("fleet_contracts", fleet.id); })}>Make fleet portal link</button>}
        </div>
      </Panel>
      <Segmented<Tab> value={tab} onChange={setTab} options={[
        { value: "vehicles", label: "Vehicles" }, { value: "approvals", label: "Approvals & LPOs" }, { value: "fuel", label: "Fuel & cost per km" },
        { value: "checks", label: "Driver checks" }, { value: "billing", label: "Monthly invoice" },
      ]} />
      {tab === "vehicles" && <Vehicles fleet={fleet} />}
      {tab === "approvals" && <Approvals fleet={fleet} />}
      {tab === "fuel" && <FuelTab fleet={fleet} />}
      {tab === "checks" && <Checks fleet={fleet} />}
      {tab === "billing" && <Billing fleet={fleet} />}
    </div>
  );
}

/** Opens a job card for a fleet vehicle (asks for the LPO when the contract needs one). */
async function fleetJob(tenantId: string, fleet: Rec, v: Rec, complaint: string, extra: Record<string, any> = {}) {
  let lpo = extra.lpo_no as string | undefined;
  if (fleet.data?.lpo_required && !lpo) {
    lpo = window.prompt(`LPO / LSO number for ${v.title} (required by this contract)`) || "";
    if (!lpo.trim()) throw new Error("This fleet needs an LPO / LSO number before work starts");
  }
  const vehicleId = v.data?.vehicle_id || await ensureVehicle(tenantId, { plate: v.title, customer_id: fleet.customer_id });
  if (!v.data?.vehicle_id) await patchRec(v.id, { data: { vehicle_id: vehicleId } });
  const job = await sendToWorkshop(tenantId, {
    vehicle_id: vehicleId, customer_id: fleet.customer_id, job_type: "mechanical", complaint,
    source: { module: "fleet_contracts", fleet_id: fleet.id, fleet_vehicle_id: v.id, lpo_no: lpo || null, cost_centre: v.data?.cost_centre || null, department: v.data?.department || null, ...extra },
    payer_split: { fleet: "all" },
  });
  await logEvent(fleet.id, `Job ${job.job_no || ""} opened for ${v.title}${lpo ? ` on ${lpo}` : ""}.`);
  return job;
}

function Vehicles({ fleet }: { fleet: Rec }) {
  const tenantId = useTenantId();
  const refresh = useRefresh();
  const { busy, run } = useAction();
  const { data: vehicles = [] } = useRecs("fleet_contracts", "fleet_vehicle", { parentId: fleet.id });
  const [f, setF] = useState({ plate: "", driver: "", driver_phone: "", department: "", cost_centre: "" });
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const add = () => run("add", async () => {
    const plate = normalisePlate(f.plate);
    if (!plate) throw new Error("Enter the number plate");
    const vehicleId = await ensureVehicle(tenantId!, { plate, customer_id: fleet.customer_id });
    const schedule = Array.isArray(fleet.data?.schedule) ? fleet.data.schedule[0] : null;
    await insertRec("fleet_contracts", "fleet_vehicle", { title: plate, parent_id: fleet.id, stage: "active", data: { ...f, plate: undefined, vehicle_id: vehicleId, check_token: newToken(), every_km: schedule?.every_km || null, every_months: schedule?.every_months || null } });
    setF({ plate: "", driver: "", driver_phone: "", department: "", cost_centre: "" }); refresh("fleet_contracts");
  }, "Vehicle added");
  return (
    <Panel title="Vehicles" icon={Truck} flush>
      <div className="overflow-x-auto">
        <table className="dt">
          <thead><tr><th>Plate</th><th>Driver</th><th>Department</th><th>Cost centre</th><th>Service</th><th /></tr></thead>
          <tbody>
            {vehicles.map((v) => {
              const due = serviceDue({ last_km: v.data?.last_km, last_date: v.data?.last_date, every_km: v.data?.every_km, every_months: v.data?.every_months, current_km: v.quantity });
              return (
                <tr key={v.id}>
                  <td data-label="Plate"><Link className="font-medium text-primary" to={`/apps/fleet_contracts/fleet_vehicle?open=${v.id}`}>{v.title}</Link></td>
                  <td data-label="Driver">{v.data?.driver || "—"}</td>
                  <td data-label="Department">{v.data?.department || "—"}</td>
                  <td data-label="Cost centre">{v.data?.cost_centre || "—"}</td>
                  <td data-label="Service">{due.due ? <span className="font-semibold text-destructive">Due{due.kmLeft !== null ? ` (${due.kmLeft} km)` : ""}{due.daysLeft !== null ? ` (${due.daysLeft} days)` : ""}</span> : due.kmLeft !== null || due.daysLeft !== null ? <span className="text-muted-foreground">{due.kmLeft !== null ? `${due.kmLeft} km left` : `${due.daysLeft} days left`}</span> : "—"}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className={btn} onClick={() => void run("tok", async () => { if (!v.data?.check_token) { await patchRec(v.id, { data: { check_token: newToken() } }); refresh("fleet_contracts"); } setLinkFor(linkFor === v.id ? null : v.id); })}><ClipboardCheck className="h-4 w-4" /> Check link</button>{" "}
                    <button className={btn} disabled={!!busy} onClick={() => void run("job", () => fleetJob(tenantId!, fleet, v, due.due ? "Scheduled service" : "Fleet job"), "Job card opened in the workshop")}><Wrench className="h-4 w-4" /> Job</button>
                  </td>
                </tr>
              );
            })}
            {!vehicles.length && <tr><td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Add the fleet's vehicles below.</td></tr>}
          </tbody>
        </table>
      </div>
      {linkFor && (() => { const v = vehicles.find((x) => x.id === linkFor); return v?.data?.check_token ? <div className="p-3"><ShareLink url={checkUrl(v.data.check_token)} phone={v.data?.driver_phone} label={`Daily check link for ${v.title} (driver opens it on the phone)`} text={`${v.title} daily check:`} /></div> : null; })()}
      <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-6">
        <input className="fi" placeholder="Enter number plate" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} />
        <input className="fi" placeholder="Enter driver's name" value={f.driver} onChange={(e) => setF({ ...f, driver: e.target.value })} />
        <input className="fi" placeholder="07XXXXXXXX" value={f.driver_phone} onChange={(e) => setF({ ...f, driver_phone: e.target.value })} />
        <input className="fi" placeholder="Enter department" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
        <input className="fi" placeholder="Enter cost centre" value={f.cost_centre} onChange={(e) => setF({ ...f, cost_centre: e.target.value })} />
        <button className={btnPrimary} disabled={!!busy} onClick={add}><Plus className="h-4 w-4" /> Add vehicle</button>
      </div>
    </Panel>
  );
}

function Approvals({ fleet }: { fleet: Rec }) {
  const refresh = useRefresh();
  const { busy, run } = useAction();
  const { data: approvals = [] } = useRecs("fleet_contracts", "approval", { parentId: fleet.id });
  const { data: lpos = [] } = useRecs("fleet_contracts", "lpo", { parentId: fleet.id });
  const { data: vehicles = [] } = useRecs("fleet_contracts", "fleet_vehicle", { parentId: fleet.id });
  const [req, setReq] = useState<{ title: string; plate: string; lines: Record<string, any>[] }>({ title: "", plate: "", lines: [{ description: "", qty: 1, price: "" }] });
  const total = req.lines.reduce((a, l) => a + num(l.qty) * num(l.price), 0);
  const token = fleet.data?.portal_token as string | undefined;
  const create = () => run("req", async () => {
    if (!req.title.trim()) throw new Error("Describe the work to approve");
    if (!token) await patchRec(fleet.id, { data: { portal_token: newToken() } });
    await insertRec("fleet_contracts", "approval", { title: req.title.trim(), parent_id: fleet.id, stage: "pending", amount: total, data: { plate: normalisePlate(req.plate), lines: req.lines.filter((l) => l.description) } });
    setReq({ title: "", plate: "", lines: [{ description: "", qty: 1, price: "" }] }); refresh("fleet_contracts", fleet.id);
  }, "Approval request created. Send the portal link to the fleet manager.");
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Ask the fleet manager to approve" icon={CheckCircle2} description="The manager approves or declines on the fleet portal and types the LPO / LSO number.">
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Labeled label="Work"><input className="fi" placeholder="Enter work to approve" value={req.title} onChange={(e) => setReq({ ...req, title: e.target.value })} /></Labeled>
            <Labeled label="Vehicle">
              <select className="fi" value={req.plate} onChange={(e) => setReq({ ...req, plate: e.target.value })}><option value="">Choose…</option>{vehicles.map((v) => <option key={v.id} value={v.title}>{v.title}</option>)}</select>
            </Labeled>
          </div>
          <LinesTable cols={[{ key: "description", label: "Description", placeholder: "Enter part or work" }, { key: "qty", label: "Qty", type: "number", width: "70px" }, { key: "price", label: "Price", type: "money", width: "110px" }]}
            rows={req.lines} onChange={(lines) => setReq({ ...req, lines })} newRow={{ qty: 1 }} footer={<b className="tabular-nums">{fmtMoney(total)}</b>} />
          <button className={btnPrimary} disabled={!!busy} onClick={create}>Create request</button>
          {token && <ShareLink url={portalUrl(token)} phone={fleet.data?.phone} label="Send the portal link" text={`${fleet.title}: work waiting for your approval`} />}
        </div>
      </Panel>
      <div className="space-y-3">
        <Panel title="Requests" flush>
          <RecTable rows={approvals} to={(r) => `/apps/fleet_contracts/approval?open=${r.id}`} empty="No requests yet."
            cols={[{ label: "Work", get: (r) => r.title }, { label: "Vehicle", get: (r) => r.data?.plate || "—" }, { label: "Amount", get: (r) => fmtMoney(num(r.amount)), num: true }, { label: "LPO", get: (r) => r.data?.lpo_no || "—" }, { label: "Status", get: (r) => <StageChip stages={APPROVAL_STAGES} stage={r.stage} /> }]} />
        </Panel>
        <Panel title="LPOs & LSOs" flush actions={<Link className={btn} to={`/apps/fleet_contracts/lpo?new=1`}><Plus className="h-4 w-4" /> Add</Link>}>
          <RecTable rows={lpos} to={(r) => `/apps/fleet_contracts/lpo?open=${r.id}`} empty="No LPOs recorded."
            cols={[{ label: "Number", get: (r) => r.title }, { label: "Type", get: (r) => r.data?.type || "LPO" }, { label: "Value", get: (r) => fmtMoney(num(r.amount)), num: true }, { label: "Valid until", get: (r) => (r.due_date ? String(r.due_date).slice(0, 10) : "—") }]} />
        </Panel>
      </div>
    </div>
  );
}

function FuelTab({ fleet }: { fleet: Rec }) {
  const refresh = useRefresh();
  const { busy, run } = useAction();
  const { data: fuel = [] } = useRecs("fleet_contracts", "fuel", { parentId: fleet.id });
  const { data: vehicles = [] } = useRecs("fleet_contracts", "fleet_vehicle", { parentId: fleet.id });
  const [preview, setPreview] = useState<FuelCsvRow[] | null>(null);
  const [entry, setEntry] = useState({ plate: "", date: today(), litres: null as number | null, amount: null as number | null, odometer: null as number | null });
  const vehicleIds = vehicles.map((v) => v.data?.vehicle_id).filter(Boolean) as string[];
  const { data: serviceCost = {} } = useQuery({
    queryKey: ["sp-fleet-service-cost", fleet.id, vehicleIds.join(",")],
    enabled: vehicleIds.length > 0,
    queryFn: async () => {
      const { data: jobs } = await sb.from("garage_jobs").select("id, vehicle_id").in("vehicle_id", vehicleIds);
      const cost = await jobsCost((jobs || []).map((j: any) => j.id));
      const out: Record<string, number> = {};
      for (const j of jobs || []) out[j.vehicle_id] = (out[j.vehicle_id] || 0) + (cost[j.id] || 0);
      return out;
    },
  });
  const perVehicle = useMemo(() => vehicles.map((v) => {
    const entries = fuel.filter((f) => normalisePlate(f.title) === v.title).map((f) => ({ odometer: num(f.data?.odometer), litres: num(f.quantity), amount: num(f.amount) }));
    const svc = serviceCost[v.data?.vehicle_id] || 0;
    return { v, svc, ...costPerKm(entries, svc) };
  }), [vehicles, fuel, serviceCost]);

  const onFile = async (file: File | null) => {
    if (!file) return;
    const { rows, missing } = parseFuelCsv(await file.text());
    if (missing.length) return toast.error(`The file has no ${missing.join(", ")} column`);
    setPreview(rows);
  };
  const importRows = () => run("imp", async () => {
    const rows = (preview || []).map((r) => ({
      app: "fleet_contracts", kind: "fuel", title: r.plate, parent_id: fleet.id, quantity: r.litres || null, amount: r.amount || null,
      starts_at: isNaN(new Date(r.date).getTime()) ? null : new Date(r.date).toISOString(), data: { odometer: r.odometer || null, station: r.station || null, card: r.card || null, product: r.product || null, source: "csv" },
    }));
    for (let i = 0; i < rows.length; i += 200) { const { error } = await sb.from("app_records").insert(rows.slice(i, i + 200)); if (error) throw error; }
    setPreview(null); refresh("fleet_contracts");
  }, "Fuel entries imported");
  const addOne = () => run("one", async () => {
    if (!entry.plate) throw new Error("Choose the vehicle");
    await insertRec("fleet_contracts", "fuel", { title: entry.plate, parent_id: fleet.id, quantity: entry.litres, amount: entry.amount, starts_at: new Date(entry.date).toISOString(), data: { odometer: entry.odometer } });
    if (entry.odometer) { const v = vehicles.find((x) => x.title === entry.plate); if (v && num(entry.odometer) > num(v.quantity)) await patchRec(v.id, { quantity: entry.odometer } as any); }
    setEntry({ ...entry, litres: null, amount: null, odometer: null }); refresh("fleet_contracts");
  }, "Fuel entry saved");

  return (
    <div className="space-y-3">
      <Panel title="Cost per km" icon={Gauge} flush description="Fuel from the log plus workshop job cost, over the kilometres between the first and last odometer reading.">
        <div className="overflow-x-auto">
          <table className="dt">
            <thead><tr><th>Vehicle</th><th className="num">Km</th><th className="num">Litres</th><th className="num">Km / litre</th><th className="num">Fuel</th><th className="num">Workshop</th><th className="num">Cost / km</th></tr></thead>
            <tbody>
              {perVehicle.map((p) => (
                <tr key={p.v.id}><td data-label="Vehicle">{p.v.title}</td><td data-label="Km" className="num">{p.km.toLocaleString()}</td><td data-label="Litres" className="num">{p.litres}</td><td data-label="Km / litre" className="num">{p.kmPerLitre || "—"}</td><td data-label="Fuel" className="num">{fmtMoney(p.fuel)}</td><td data-label="Workshop" className="num">{fmtMoney(p.svc)}</td><td data-label="Cost / km" className="num font-semibold">{p.costPerKm ? fmtMoney(p.costPerKm) : "—"}</td></tr>
              ))}
              {!perVehicle.length && <tr><td colSpan={7} className="py-6 text-center text-sm text-muted-foreground">Add vehicles first.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Fuel log" icon={Fuel} actions={
        <label className={btn}><Upload className="h-4 w-4" /> Import fuel card CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0] || null)} /></label>
      }>
        {preview ? (
          <div className="space-y-2">
            <p className="text-sm">{preview.length} rows read. Plates that are not fleet vehicles are still saved under this fleet.</p>
            <div className="max-h-64 overflow-auto rounded-xl border border-border">
              <table className="dt"><thead><tr><th>Date</th><th>Plate</th><th className="num">Litres</th><th className="num">Amount</th><th className="num">Odometer</th><th>Station</th></tr></thead>
                <tbody>{preview.slice(0, 200).map((r, i) => <tr key={i}><td>{r.date}</td><td>{r.plate}</td><td className="num">{r.litres}</td><td className="num">{fmtMoney(r.amount)}</td><td className="num">{r.odometer || ""}</td><td>{r.station}</td></tr>)}</tbody></table>
            </div>
            <div className="flex gap-2"><button className={btn} onClick={() => setPreview(null)}>Cancel</button><button className={btnPrimary} disabled={!!busy} onClick={importRows}>Import {preview.length} entries</button></div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-6">
              <select className="fi" value={entry.plate} onChange={(e) => setEntry({ ...entry, plate: e.target.value })}><option value="">Vehicle…</option>{vehicles.map((v) => <option key={v.id}>{v.title}</option>)}</select>
              <input className="fi" type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} />
              <NumIn value={entry.litres} onChange={(v) => setEntry({ ...entry, litres: v })} placeholder="Litres" />
              <NumIn value={entry.amount} onChange={(v) => setEntry({ ...entry, amount: v })} placeholder="Amount" />
              <NumIn value={entry.odometer} onChange={(v) => setEntry({ ...entry, odometer: v })} placeholder="Odometer" />
              <button className={btnPrimary} disabled={!!busy} onClick={addOne}><Plus className="h-4 w-4" /> Add</button>
            </div>
            <RecTable rows={fuel.slice(0, 100)} to={(r) => `/apps/fleet_contracts/fuel?open=${r.id}`} empty="No fuel entries yet."
              cols={[{ label: "Vehicle", get: (r) => r.title }, { label: "Date", get: (r) => (r.starts_at ? String(r.starts_at).slice(0, 10) : "—") }, { label: "Litres", get: (r) => num(r.quantity), num: true }, { label: "Amount", get: (r) => fmtMoney(num(r.amount)), num: true }, { label: "Odometer", get: (r) => r.data?.odometer || "—", num: true }]} />
          </div>
        )}
      </Panel>
    </div>
  );
}

function Checks({ fleet }: { fleet: Rec }) {
  const tenantId = useTenantId();
  const refresh = useRefresh();
  const { busy, run } = useAction();
  const { data: checks = [] } = useRecs("fleet_contracts", "daily_check", { parentId: fleet.id });
  const { data: vehicles = [] } = useRecs("fleet_contracts", "fleet_vehicle", { parentId: fleet.id });
  const toJob = (c: Rec) => run(c.id, async () => {
    const v = vehicles.find((x) => x.id === c.data?.fleet_vehicle_id) || vehicles.find((x) => x.title === normalisePlate(c.data?.plate));
    if (!v) throw new Error("This vehicle is not on the fleet list");
    await fleetJob(tenantId!, fleet, v, `Driver check faults: ${c.data?.faults || ""}`, { check_id: c.id });
    await moveStage(c, "sent", "Sent to workshop"); refresh("fleet_contracts");
  }, "Job card opened in the workshop");
  return (
    <Panel title="Driver daily checks" icon={ClipboardCheck} flush description="Drivers fill these on their phone from the vehicle's check link. Faults can go straight to the workshop.">
      <div className="overflow-x-auto">
        <table className="dt">
          <thead><tr><th>Vehicle</th><th>Driver</th><th>When</th><th>Faults</th><th>Status</th><th /></tr></thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id}>
                <td data-label="Vehicle"><Link className="text-primary" to={`/apps/fleet_contracts/daily_check?open=${c.id}`}>{c.data?.plate || c.title}</Link></td>
                <td data-label="Driver">{c.data?.driver || "—"}</td>
                <td data-label="When">{c.starts_at ? new Date(c.starts_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                <td data-label="Faults" className="max-w-xs whitespace-normal">{c.data?.faults || "—"}</td>
                <td data-label="Status"><StageChip stages={CHECK_STAGES} stage={c.stage} /></td>
                <td className="text-right">{c.stage === "faults" && <button className={btnDark} disabled={!!busy} onClick={() => toJob(c)}><Wrench className="h-4 w-4" /> To workshop</button>}</td>
              </tr>
            ))}
            {!checks.length && <tr><td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No checks yet. Send each driver the check link from the Vehicles tab.</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Billing({ fleet }: { fleet: Rec }) {
  const tenantId = useTenantId();
  const refresh = useRefresh();
  const { busy, run } = useAction();
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const { data: vehicles = [] } = useRecs("fleet_contracts", "fleet_vehicle", { parentId: fleet.id });
  const vehicleIds = vehicles.map((v) => v.data?.vehicle_id).filter(Boolean) as string[];
  const plateOf = new Map(vehicles.map((v) => [v.data?.vehicle_id, v]));
  const jobsQ = useQuery({
    queryKey: ["sp-fleet-jobs", fleet.id, month, vehicleIds.join(",")],
    enabled: vehicleIds.length > 0,
    queryFn: async () => {
      const from = `${month}-01`;
      const d = new Date(from); d.setMonth(d.getMonth() + 1);
      const { data: jobs } = await sb.from("garage_jobs").select("id, job_no, status, vehicle_id, invoice_id, created_at, source, complaint").in("vehicle_id", vehicleIds)
        .gte("created_at", from).lt("created_at", d.toISOString().slice(0, 10)).is("invoice_id", null).neq("status", "cancelled").order("created_at");
      const ids = (jobs || []).map((j: any) => j.id);
      const { data: lines } = ids.length ? await sb.from("garage_job_lines").select("*").in("job_id", ids) : { data: [] };
      const itemIds = Array.from(new Set((lines || []).map((l: any) => l.item_id).filter(Boolean)));
      const { data: prods } = itemIds.length ? await sb.from("products").select("id, cost_price, name").in("id", itemIds) : { data: [] };
      return { jobs: jobs || [], lines: lines || [], prods: new Map<string, any>((prods || []).map((p: any) => [p.id, p])) };
    },
  });
  const [pick, setPick] = useState<Set<string>>(new Set());
  useEffect(() => { setPick(new Set((jobsQ.data?.jobs || []).map((j: any) => j.id))); }, [jobsQ.data]);
  const contract = { labour_rate: num(fleet.data?.labour_rate) || null, parts_markup: fleet.data?.parts_markup === "" || fleet.data?.parts_markup == null ? null : num(fleet.data.parts_markup) };
  const priced = (jobsQ.data?.jobs || []).map((j: any) => {
    const ls = (jobsQ.data?.lines || []).filter((l: any) => l.job_id === j.id && (!l.payer || l.payer === "fleet" || l.payer === "customer"));
    const lines = ls.map((l: any) => {
      const prod = jobsQ.data?.prods.get(l.item_id);
      const rate = contractPrice({ kind: l.kind, rate: num(l.rate), cost: prod?.cost_price }, contract);
      return { name: `${j.job_no || "Job"} ${plateOf.get(j.vehicle_id)?.title || ""}: ${l.description || l.name || prod?.name || l.kind}`, quantity: num(l.qty) || 1, rate, item_id: l.kind === "part" ? l.item_id : null };
    });
    return { job: j, lines, total: lines.reduce((a: number, l: any) => a + l.quantity * l.rate, 0) };
  });
  const chosen = priced.filter((p) => pick.has(p.job.id));
  const total = chosen.reduce((a, p) => a + p.total, 0);
  const wht = fleet.data?.government ? withholdingVat(total, num(fleet.data?.wht_rate)) : 0;

  const invoicesQ = useQuery({
    queryKey: ["sp-fleet-invoices", fleet.customer_id],
    enabled: !!fleet.customer_id,
    queryFn: async () => ((await sb.from("invoices").select("id, invoice_number, issue_date, due_date, total, amount_paid, status, subject").eq("customer_id", fleet.customer_id).neq("status", "void").order("issue_date", { ascending: false }).limit(200)).data || []) as any[],
  });
  const whtList: { invoice_id: string; number: string; month: string; amount: number; certificate?: string; date?: string }[] = Array.isArray(fleet.data?.wht) ? fleet.data.wht : [];

  const make = () => run("inv", async () => {
    if (!fleet.customer_id) throw new Error("Set the fleet's customer account first");
    if (!chosen.length) throw new Error("Choose the jobs to invoice");
    const lines = chosen.flatMap((p) => p.lines);
    const lpos = Array.from(new Set(chosen.map((p) => p.job.source?.lpo_no).filter(Boolean)));
    const inv = await createInvoice(tenantId!, {
      customerId: fleet.customer_id, lines, subject: `${fleet.title}: fleet services ${month}`, reference: lpos.join(", ") || null, source: "garage_fleet",
      dueDays: num(fleet.data?.terms_days) || 30, notes: wht ? `Withholding VAT expected: ${fmtMoney(wht)}.` : null,
    });
    for (const p of chosen) await sb.from("garage_jobs").update({ invoice_id: inv.id }).eq("id", p.job.id);
    if (wht) await patchRec(fleet.id, { data: { wht: [...whtList, { invoice_id: inv.id, number: inv.number, month, amount: wht }] } });
    await logEvent(fleet.id, `Monthly invoice ${inv.number} for ${month}: ${chosen.length} job(s).`);
    void jobsQ.refetch(); void invoicesQ.refetch(); refresh("fleet_contracts", fleet.id);
  }, "Consolidated invoice created (draft) in Sales");

  const statement = () => run("pdf", async () => {
    const open = (invoicesQ.data || []).filter((i) => invoiceBalance(i) > 0);
    const items = open.map((i) => item(`${i.invoice_number} · ${i.subject || ""}`, 1, invoiceBalance(i), `Issued ${i.issue_date} · total ${fmtMoney(num(i.total))}`));
    const t = items.reduce((a, i) => a + i.amount, 0);
    await downloadPdf(tenantId!, { title: "Fleet Statement", number: null, party: party("Fleet", fleet.title, [fleet.data?.manager, fleet.data?.email]), meta: [{ label: "Date", value: new Date().toLocaleDateString("en-KE") }], currency: "KES", items, totals: { subtotal: t, tax: 0, total: t }, sections: [] } as any, `statement-${fleet.title.replace(/\s+/g, "-")}.pdf`);
  });

  return (
    <div className="space-y-3">
      <Panel title="Monthly consolidated invoice" icon={Receipt} description="Uninvoiced workshop jobs for this fleet's vehicles in the month, priced at the contract labour rate and parts markup.">
        <div className="space-y-2">
          <input type="month" className="fi w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="dt">
              <thead><tr><th /><th>Job</th><th>Vehicle</th><th>Cost centre</th><th>LPO</th><th className="num">Contract price</th></tr></thead>
              <tbody>
                {priced.map((p) => (
                  <tr key={p.job.id}>
                    <td><input type="checkbox" checked={pick.has(p.job.id)} onChange={(e) => { const n = new Set(pick); if (e.target.checked) n.add(p.job.id); else n.delete(p.job.id); setPick(n); }} /></td>
                    <td data-label="Job">{p.job.job_no || "Job card"} <span className="text-xs text-muted-foreground">{p.job.status}</span></td>
                    <td data-label="Vehicle">{plateOf.get(p.job.vehicle_id)?.title}</td>
                    <td data-label="Cost centre">{p.job.source?.cost_centre || plateOf.get(p.job.vehicle_id)?.data?.cost_centre || "—"}</td>
                    <td data-label="LPO">{p.job.source?.lpo_no || "—"}</td>
                    <td data-label="Contract price" className="num">{fmtMoney(p.total)}</td>
                  </tr>
                ))}
                {!priced.length && <tr><td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">{jobsQ.isLoading ? "Loading…" : "No uninvoiced jobs this month."}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">Total <b className="tabular-nums">{fmtMoney(total)}</b>{wht ? <> · withholding VAT <b className="tabular-nums">{fmtMoney(wht)}</b></> : null}</p>
            <button className={btnPrimary} disabled={!!busy || !chosen.length} onClick={make}><Receipt className="h-4 w-4" /> Create invoice</button>
          </div>
        </div>
      </Panel>
      <Panel title="Statement" flush actions={<button className={btn} disabled={!!busy} onClick={statement}><Download className="h-4 w-4" /> PDF</button>}>
        <div className="overflow-x-auto">
          <table className="dt">
            <thead><tr><th>Invoice</th><th>Date</th><th>Subject</th><th className="num">Total</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {(invoicesQ.data || []).map((i) => <tr key={i.id}><td data-label="Invoice"><Link className="text-primary" to={`/sales/invoices/${i.id}`}>{i.invoice_number}</Link></td><td data-label="Date">{i.issue_date}</td><td data-label="Subject">{i.subject || "—"}</td><td data-label="Total" className="num">{fmtMoney(num(i.total))}</td><td data-label="Balance" className="num">{fmtMoney(invoiceBalance(i))}</td></tr>)}
              {!(invoicesQ.data || []).length && <tr><td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No invoices yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      {fleet.data?.government && (
        <Panel title="Withholding VAT certificates" flush description="Government and appointed agents pay less the withholding VAT and send a certificate. Record each certificate number here.">
          <div className="overflow-x-auto">
            <table className="dt">
              <thead><tr><th>Invoice</th><th>Month</th><th className="num">Withheld</th><th>Certificate number</th><th>Received</th></tr></thead>
              <tbody>
                {whtList.map((w, i) => (
                  <tr key={w.invoice_id}>
                    <td data-label="Invoice">{w.number}</td><td data-label="Month">{w.month}</td><td data-label="Withheld" className="num">{fmtMoney(w.amount)}</td>
                    <td data-label="Certificate"><input className="fi h-8" placeholder="Enter certificate number" defaultValue={w.certificate || ""} onBlur={(e) => { if (e.target.value !== (w.certificate || "")) void run("wht", async () => { const next = whtList.map((x, j) => (j === i ? { ...x, certificate: e.target.value, date: x.date || today() } : x)); await patchRec(fleet.id, { data: { wht: next } }); refresh("fleet_contracts", fleet.id); }, "Saved"); }} /></td>
                    <td data-label="Received">{w.date || "—"}</td>
                  </tr>
                ))}
                {!whtList.length && <tr><td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No withholding VAT yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
