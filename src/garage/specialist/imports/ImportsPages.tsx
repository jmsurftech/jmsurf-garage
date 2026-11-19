import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, Calculator, FileBadge, Globe2, Plus, Settings2, Ship, ShoppingBag, UserRound, Link2 } from "lucide-react";
import { PageHeader, Panel } from "@/components/kit";
import { Picker } from "@/apps/fields";
import { fmtMoney } from "@/apps/format";
import { ORDER_STAGES, PREORDER_STAGES, SHIPMENT_STAGES } from "../apps";
import { jobsCost, newToken, num, patchRec, sb, useRecs, useRefresh, type Rec } from "../shared/db";
import { btn, btnPrimary, Gate, Labeled, LinesTable, ModuleHome, NumIn, RecTable, ShareLink, StageChip, useAction } from "../shared/ui";
import { ageRule, computeDuty, DUTY_NOTE, vehicleAge } from "../lib/duty";
import { fxSummary } from "../lib/fx";
import { profitOf } from "../lib/landedCost";
import { IMPORT_DEFAULTS, useImportSettings, type ImportSettings } from "./settings";
import { demurrage } from "../lib/calc";

export function ImportsHome() {
  const { data: orders = [] } = useRecs("imports", "import_order");
  const { data: shipments = [] } = useRecs("imports", "shipment");
  const { data: pre = [] } = useRecs("imports", "preorder");
  const { value: settings } = useImportSettings();
  const refresh = useRefresh();
  const { run } = useAction();
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const alerts = shipments.filter((s) => {
    const d = demurrage(s.data?.arrived, num(s.data?.free_days), num(s.data?.demurrage_rate));
    return d.daysLeft !== null && d.daysLeft <= num(settings.demurrageWarnDays) && !["released", "delivered"].includes(String(s.stage));
  });
  const openOrders = orders.filter((o) => ["ordered", "deposit_paid", "paid", "shipped"].includes(String(o.stage)));
  const preRec = pre.find((p) => p.id === linkFor);
  return (
    <ModuleHome module="imports" title="Imports" icon={Globe2}
      actions={<><Link to="/apps/imports/import_order?new=1" className={btnPrimary}><Plus className="h-4 w-4" /> New order</Link><Link to="/apps/imports/shipment?new=1" className={btn}><Ship className="h-4 w-4" /> New shipment</Link></>}
      stats={[
        { label: "Open orders", value: openOrders.length, icon: ShoppingBag, hint: fmtMoney(openOrders.reduce((a, o) => a + num(o.amount), 0)) },
        { label: "At sea", value: shipments.filter((s) => ["booked", "at_sea"].includes(String(s.stage))).length, icon: Ship },
        { label: "At port / clearing", value: shipments.filter((s) => ["at_port", "clearing"].includes(String(s.stage))).length, tone: "warning" },
        { label: "Demurrage alerts", value: alerts.length, tone: alerts.length ? "danger" : "success", icon: AlertTriangle },
      ]}
      links={[
        { to: "/apps/imports/import_order", label: "Import orders", icon: ShoppingBag },
        { to: "/apps/imports/shipment", label: "Shipments", icon: Ship },
        { to: "/apps/imports/preorder", label: "Customer pre-orders", icon: UserRound },
        { to: "/apps/imports/clearing_agent", label: "Clearing agents", icon: FileBadge },
        { to: "/apps/imports/registration", label: "NTSA & logbooks", icon: FileBadge },
        { to: "/garage/imports/duty", label: "Duty calculator", icon: Calculator },
        { to: "/garage/imports/reports", label: "Profit & exchange", icon: BarChart3 },
        { to: "/garage/imports/settings", label: "Rates & settings", icon: Settings2 },
      ]}>
      {alerts.length > 0 && (
        <Panel title="Demurrage alerts" icon={AlertTriangle}>
          <ul className="space-y-1 text-sm">{alerts.map((s) => { const d = demurrage(s.data?.arrived, num(s.data?.free_days), num(s.data?.demurrage_rate)); return <li key={s.id}><Link className="text-primary" to={`/garage/imports/shipments/${s.id}`}>{s.number} {s.title}</Link> · {d.daysOver ? `${d.daysOver} day(s) over, about ${fmtMoney(d.accrued)}` : `free days end ${d.freeUntil}`}</li>; })}</ul>
        </Panel>
      )}
      <Panel title="Shipments" icon={Ship} flush>
        <RecTable rows={shipments.filter((s) => s.stage !== "delivered").sort((a, b) => String(a.due_date || "9").localeCompare(String(b.due_date || "9")))} to={(r) => `/garage/imports/shipments/${r.id}`} empty="No shipments on the way."
          cols={[{ label: "Shipment", get: (r) => `${r.number || ""} ${r.title}` }, { label: "Vessel", get: (r) => r.data?.vessel || "—" }, { label: "ETA", get: (r) => (r.due_date ? String(r.due_date).slice(0, 10) : "—") }, { label: "Landed value", get: (r) => fmtMoney(num(r.amount)), num: true }, { label: "Stage", get: (r) => <StageChip stages={SHIPMENT_STAGES} stage={r.stage} /> }]} />
      </Panel>
      <Panel title="Import orders" icon={ShoppingBag} flush>
        <RecTable rows={orders.filter((o) => !["received", "cancelled"].includes(String(o.stage)))} to={(r) => `/garage/imports/orders/${r.id}`} empty="No open orders."
          cols={[{ label: "Order", get: (r) => `${r.number || ""} ${r.title}` }, { label: "Country", get: (r) => r.data?.country || "—" }, { label: "Order total", get: (r) => `${r.data?.currency || ""} ${num(r.data?.fc_total).toLocaleString()}`, num: true }, { label: "Paid", get: (r) => `${r.data?.currency || ""} ${num(r.data?.paid_fc).toLocaleString()}`, num: true }, { label: "Stage", get: (r) => <StageChip stages={ORDER_STAGES} stage={r.stage} /> }]} />
      </Panel>
      <Panel title="Customer pre-orders" icon={UserRound} description="Customers waiting for a car you are importing. Send them their status link." flush>
        <div className="overflow-x-auto">
          <table className="dt">
            <thead><tr><th>Pre-order</th><th className="num">Price</th><th className="num">Deposit</th><th>Stage</th><th /></tr></thead>
            <tbody>
              {pre.filter((p) => !["delivered", "cancelled"].includes(String(p.stage))).map((p) => (
                <tr key={p.id}>
                  <td data-label="Pre-order"><Link className="text-primary" to={`/apps/imports/preorder?open=${p.id}`}>{p.number} {p.title}</Link></td>
                  <td data-label="Price" className="num">{fmtMoney(num(p.amount))}</td><td data-label="Deposit" className="num">{fmtMoney(num(p.data?.deposit))}</td>
                  <td data-label="Stage"><StageChip stages={PREORDER_STAGES} stage={p.stage} /></td>
                  <td className="text-right"><button className={btn} onClick={() => void run("tok", async () => { if (!p.data?.token) { await patchRec(p.id, { data: { token: newToken() } }); refresh("imports"); } setLinkFor(linkFor === p.id ? null : p.id); })}><Link2 className="h-4 w-4" /> Status link</button></td>
                </tr>
              ))}
              {!pre.length && <tr><td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No pre-orders.</td></tr>}
            </tbody>
          </table>
        </div>
        {preRec?.data?.token && <div className="p-3"><ShareLink url={`${window.location.origin}/preorder/${preRec.data.token}`} label="Customer's status link" text={`Your vehicle order ${preRec.number}: follow its status here`} /></div>}
      </Panel>
    </ModuleHome>
  );
}

/* ───────────────────────────── duty calculator ───────────────────────────── */

export function DutyCalculator() {
  return <Gate module="imports"><Duty /></Gate>;
}

function Duty() {
  const { value: settings } = useImportSettings();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: shipments = [] } = useRecs("imports", "shipment");
  const { busy, run } = useAction();
  const [f, setF] = useState({ vehicle: "", crsp: null as number | null, year: new Date().getFullYear() - 5 as number | null, month: 1 as number | null, cc: 1500 as number | null });
  const [shipment, setShipment] = useState<string | null>(params.get("shipment"));
  const age = vehicleAge(num(f.year), num(f.month) || 1);
  const r = computeDuty({ crsp: num(f.crsp), ageYears: age, engineCc: num(f.cc), rates: settings });
  const rule = ageRule(num(f.year), settings);
  const rows: [string, number, string?][] = [
    ["CRSP", r.crsp], [`Depreciation (${r.depreciationPct}% for ${age} yr)`, r.crsp - r.depreciatedValue], ["Customs value", r.customsValue],
    [`Import duty (${settings.importDutyPct}%)`, r.importDuty, "Import duty"], [`Excise duty (${r.excisePct}%)`, r.excise, "Excise duty"], [`VAT (${settings.vatPct}%)`, r.vat, "VAT on import"],
    [`IDF fee (${settings.idfPct}%)`, r.idf, "IDF fee"], [`RDL (${settings.rdlPct}%)`, r.rdl, "RDL"],
  ];
  const addToShipment = () => run("add", async () => {
    if (!shipment) throw new Error("Choose the shipment");
    const s = shipments.find((x) => x.id === shipment);
    const add = rows.filter((x) => x[2] && x[1] > 0).map((x) => ({ name: x[2], amount: x[1], method: "value", note: f.vehicle || "Duty calculator" }));
    await patchRec(shipment, { data: { costs: [...(Array.isArray(s?.data?.costs) ? s!.data.costs : []), ...add] } });
    navigate(`/garage/imports/shipments/${shipment}`);
  }, "Duty lines added to the shipment costs");
  return (
    <div className="space-y-3">
      <PageHeader title="Vehicle duty calculator" icon={Calculator} actions={<Link to="/garage/imports/settings" className={btn}><Settings2 className="h-4 w-4" /> Rates</Link>} />
      <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs">{DUTY_NOTE}</p>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Vehicle">
          <div className="grid gap-2 sm:grid-cols-2">
            <Labeled label="Vehicle" className="sm:col-span-2"><input className="fi" placeholder="Enter make, model and grade" value={f.vehicle} onChange={(e) => setF({ ...f, vehicle: e.target.value })} /></Labeled>
            <Labeled label="KRA CRSP value" hint="From the KRA CRSP list for this make, model and engine."><NumIn value={f.crsp} onChange={(v) => setF({ ...f, crsp: v })} placeholder="Enter CRSP" /></Labeled>
            <Labeled label="Engine (cc)"><NumIn value={f.cc} onChange={(v) => setF({ ...f, cc: v })} /></Labeled>
            <Labeled label="Year of manufacture"><NumIn value={f.year} onChange={(v) => setF({ ...f, year: v })} /></Labeled>
            <Labeled label="Month of manufacture"><NumIn value={f.month} onChange={(v) => setF({ ...f, month: v })} /></Labeled>
          </div>
          <p className={`mt-3 rounded-xl p-2 text-sm ${rule.allowed ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
            {rule.allowed ? `Age rule: allowed (oldest model year this year: ${rule.oldestYear}).` : `Age rule: too old. The oldest model year allowed this year is ${rule.oldestYear} (your setting).`}
          </p>
        </Panel>
        <Panel title="Duty and taxes" flush>
          <table className="dt">
            <tbody>
              {rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{fmtMoney(v)}</td></tr>)}
              <tr className="font-bold"><td>Total duty and taxes</td><td className="num">{fmtMoney(r.total)}</td></tr>
            </tbody>
          </table>
          <div className="space-y-2 border-t border-border p-3">
            <Picker value={shipment} onChange={setShipment} options={shipments.map((s) => ({ id: s.id, label: `${s.number || ""} ${s.title}` }))} placeholder="Add to a shipment's costs…" />
            <button className={btnPrimary} disabled={!!busy || !r.total} onClick={addToShipment}>Add to shipment costs</button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ───────────────────────────── settings ───────────────────────────── */

export function ImportSettingsPage() {
  return <Gate module="imports"><SettingsInner /></Gate>;
}

function SettingsInner() {
  const s = useImportSettings();
  const [v, setV] = useState<ImportSettings | null>(null);
  const cur = v || s.value;
  const set = (p: Partial<ImportSettings>) => setV({ ...cur, ...p });
  const { busy, run } = useAction();
  const pct = (k: keyof ImportSettings, label: string, hint?: string) => (
    <Labeled label={label} hint={hint}><NumIn value={cur[k] as any} onChange={(x) => set({ [k]: x ?? 0 } as any)} /></Labeled>
  );
  return (
    <div className="space-y-3">
      <PageHeader title="Import rates & settings" icon={Settings2} actions={<button className={btnPrimary} disabled={!v || !!busy} onClick={() => void run("save", async () => { await s.save(cur); setV(null); }, "Settings saved")}>Save</button>} />
      <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs">{DUTY_NOTE} The figures already filled in are only a starting point.</p>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Duty and taxes">
          <div className="grid gap-2 sm:grid-cols-2">
            {pct("importDutyPct", "Import duty %")}{pct("vatPct", "VAT %")}{pct("idfPct", "IDF fee %")}{pct("rdlPct", "Railway development levy %")}
            <Labeled label="CRSP includes duty, excise and VAT" className="sm:col-span-2" hint="When on, the calculator backs the taxes out of the depreciated CRSP to find the customs value.">
              <input type="checkbox" checked={!!cur.crspIncludesTaxes} onChange={(e) => set({ crspIncludesTaxes: e.target.checked })} />
            </Labeled>
            {pct("ageLimitYears", "Used vehicles: age limit (years)", "The oldest model year allowed is this year minus this number, plus one.")}
          </div>
        </Panel>
        <Panel title="Prices and alerts">
          <div className="grid gap-2 sm:grid-cols-2">
            {pct("targetMarginPct", "Target margin % (on selling price)")}{pct("priceRoundTo", "Round car prices up to")}{pct("demurrageWarnDays", "Warn days before free days end")}
          </div>
        </Panel>
        <Panel title="Excise duty by engine size">
          <LinesTable cols={[{ key: "maxCc", label: "Up to cc (empty = above)", type: "number" }, { key: "pct", label: "Excise %", type: "number" }]}
            rows={cur.excise as any} onChange={(r) => set({ excise: r.map((x) => ({ maxCc: x.maxCc === "" || x.maxCc == null ? null : num(x.maxCc), pct: num(x.pct) })) })} addLabel="Add band" />
        </Panel>
        <Panel title="Depreciation by age">
          <LinesTable cols={[{ key: "maxAgeYears", label: "Up to age (years)", type: "number" }, { key: "pct", label: "Depreciation %", type: "number" }]}
            rows={cur.depreciation as any} onChange={(r) => set({ depreciation: r.map((x) => ({ maxAgeYears: num(x.maxAgeYears), pct: num(x.pct) })) })} addLabel="Add band" />
        </Panel>
      </div>
      <button className={btn} onClick={() => setV({ ...IMPORT_DEFAULTS })}>Reset the form to the starting values</button>
    </div>
  );
}

/* ───────────────────────────── reports ───────────────────────────── */

export function ImportReports() {
  return <Gate module="imports"><Reports /></Gate>;
}

function Reports() {
  const { data: orders = [] } = useRecs("imports", "import_order");
  const { data: shipments = [] } = useRecs("imports", "shipment");
  const { data: cars = [] } = useRecs("vehicle_yard", "car");
  const imported = cars.filter((c) => c.data?.import_order || c.data?.shipment);
  const ids = imported.map((c) => c.id);
  const prepQ = useQuery({
    queryKey: ["sp-prep-cost-all", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data: jobs } = await sb.from("garage_jobs").select("id, source").in("source->>car_id", ids);
      const cost = await jobsCost((jobs || []).map((j: any) => j.id));
      const out: Record<string, number> = {};
      for (const j of jobs || []) out[j.source?.car_id] = (out[j.source?.car_id] || 0) + (cost[j.id] || 0);
      return out;
    },
  });
  const prep = prepQ.data || {};
  const rows = imported.map((c) => {
    const sale = num(c.data?.sale?.price) || (c.stage === "sold" ? num(c.amount) : 0);
    const cost = num(c.data?.cost) + (prep[c.id] || 0);
    return { c, sale, cost, ...profitOf(sale, cost) };
  });
  const sold = rows.filter((r) => r.sale > 0);
  const byShipment = useMemo(() => shipments.map((s) => {
    const rs = sold.filter((r) => r.c.data?.shipment === s.id);
    return { s, n: rs.length, sale: rs.reduce((a, r) => a + r.sale, 0), cost: rs.reduce((a, r) => a + r.cost, 0), profit: rs.reduce((a, r) => a + r.profit, 0) };
  }).filter((x) => x.n), [shipments, sold]);
  const fx = orders.map((o) => ({ o, ...fxSummary(num(o.data?.fc_total), num(o.data?.rate), (o.data?.payments || []).map((p: any) => ({ amount_fc: num(p.amount_fc), rate: num(p.rate) || num(o.data?.rate) }))) })).filter((x) => x.paidFc > 0);
  return (
    <div className="space-y-3">
      <PageHeader title="Import profit & exchange" icon={BarChart3} actions={<Link className={btn} to="/garage/imports">Imports</Link>} />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label="Cars sold" value={sold.length} /><Tile label="Profit on cars sold" value={fmtMoney(sold.reduce((a, r) => a + r.profit, 0))} />
        <Tile label="Unsold imported cars (cost)" value={fmtMoney(rows.filter((r) => !r.sale).reduce((a, r) => a + r.cost, 0))} /><Tile label="Exchange gain / loss" value={fmtMoney(fx.reduce((a, x) => a + x.gainLoss, 0))} />
      </div>
      <Panel title="Profit per container" flush>
        <Table head={["Shipment", "Cars sold", "Sales", "Landed + prep", "Profit"]} rows={byShipment.map((x) => [<Link className="text-primary" to={`/garage/imports/shipments/${x.s.id}`}>{x.s.number} {x.s.title}</Link>, x.n, fmtMoney(x.sale), fmtMoney(x.cost), fmtMoney(x.profit)])} />
      </Panel>
      <Panel title="Profit per car" flush>
        <Table head={["Car", "Sold for", "Landed + prep", "Profit", "Margin"]} rows={sold.map((r) => [<Link className="text-primary" to={`/garage/yard/cars/${r.c.id}`}>{r.c.number} {r.c.title}</Link>, fmtMoney(r.sale), fmtMoney(r.cost), fmtMoney(r.profit), `${r.marginPct}%`])} />
      </Panel>
      <Panel title="Exchange gain / loss per order" flush>
        <Table head={["Order", "Order rate", "Average paid rate", "Paid (company currency)", "Gain / loss"]} rows={fx.map((x) => [<Link className="text-primary" to={`/garage/imports/orders/${x.o.id}`}>{x.o.number} {x.o.title}</Link>, num(x.o.data?.rate), x.averageRate, fmtMoney(x.paidLocal), fmtMoney(x.gainLoss)])} />
      </Panel>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: any }) {
  return <div className="rounded-2xl border border-border bg-card px-3 py-2"><p className="text-[11px] text-muted-foreground">{label}</p><p className="font-display text-[15px] font-bold tabular-nums">{value}</p></div>;
}

export function Table({ head, rows }: { head: string[]; rows: any[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="dt">
        <thead><tr>{head.map((h, i) => <th key={h} className={i ? "num" : ""}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} data-label={head[j]} className={j ? "num" : ""}>{c}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={head.length} className="py-6 text-center text-sm text-muted-foreground">Nothing yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export type { Rec };
