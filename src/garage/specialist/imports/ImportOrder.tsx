import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Car, FileText, Globe2, Landmark, Pencil, Save } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader, PageLoader, Panel } from "@/components/kit";
import DocumentsPanel from "@/components/DocumentsPanel";
import { fmtMoney } from "@/apps/format";
import { useLookup } from "@/apps/data";
import { useModules } from "@/hooks/useModules";
import { ORDER_STAGES } from "../apps";
import { insertRec, logEvent, moveStage, num, patchRec, useRec, useRefresh } from "../shared/db";
import { btn, btnPrimary, Gate, KV, LinesTable, StageBar, useAction, type Col } from "../shared/ui";
import { fxSummary } from "../lib/fx";
import { ageRule } from "../lib/duty";
import { ORDER_DOCS, useImportSettings } from "./settings";

const ITEM_COLS: Col[] = [
  { key: "description", label: "Item / vehicle", placeholder: "Enter make and model or part" },
  { key: "vin", label: "Chassis / part no.", placeholder: "Enter chassis or part number" },
  { key: "year", label: "Year", type: "number", width: "80px" },
  { key: "engine_cc", label: "cc", type: "number", width: "80px" },
  { key: "qty", label: "Qty", type: "number", width: "70px" },
  { key: "price_fc", label: "Unit price (order currency)", type: "money", width: "130px" },
  { key: "weight", label: "Weight kg", type: "number", width: "90px" },
  { key: "cbm", label: "CBM", type: "number", width: "80px" },
  { key: "is_car", label: "Car for the yard", type: "checkbox", width: "80px" },
];
const PAY_COLS: Col[] = [
  { key: "date", label: "Date", type: "date", width: "140px" },
  { key: "kind", label: "Payment", type: "select", options: ["Deposit", "Balance", "Other"], width: "120px" },
  { key: "amount_fc", label: "Amount (order currency)", type: "money", width: "140px" },
  { key: "rate", label: "Exchange rate paid", type: "number", width: "120px" },
  { key: "tt_ref", label: "TT / swift reference", placeholder: "Enter TT reference" },
];

export default function ImportOrder() {
  return <Gate module="imports"><Inner /></Gate>;
}

function Inner() {
  const { id = "" } = useParams();
  const { data: rec, isLoading } = useRec(id);
  const { data: shipment } = useRec(rec?.data?.shipment);
  const { data: suppliers = [] } = useLookup("supplier");
  const { has } = useModules();
  const { value: settings } = useImportSettings();
  const refresh = useRefresh();
  const { busy, run } = useAction();
  const [items, setItems] = useState<Record<string, any>[]>([]);
  const [pays, setPays] = useState<Record<string, any>[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!rec) return;
    setItems(Array.isArray(rec.data?.items) ? rec.data.items : []);
    setPays(Array.isArray(rec.data?.payments) ? rec.data.payments : []);
    setDirty(false);
  }, [rec?.id, rec?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <PageLoader />;
  if (!rec || rec.app !== "imports" || rec.kind !== "import_order") return <EmptyState title="Import order not found" />;
  const ccy = rec.data?.currency || "USD";
  const rate = num(rec.data?.rate);
  const totalFc = items.reduce((a, i) => a + num(i.qty || 1) * num(i.price_fc), 0);
  const fx = fxSummary(totalFc, rate, pays.map((p) => ({ amount_fc: num(p.amount_fc), rate: num(p.rate) || rate })));
  const tooOld = items.filter((i) => i.is_car && num(i.year) > 0 && !ageRule(num(i.year), settings).allowed);

  const save = () => run("save", async () => {
    if (!rate) throw new Error("Enter the order's exchange rate first (Edit details)");
    const clean = items.map((i) => ({ ...i, qty: num(i.qty) || 1, price_fc: num(i.price_fc), year: num(i.year) || null, engine_cc: num(i.engine_cc) || null, weight: num(i.weight) || null, cbm: num(i.cbm) || null }));
    const cp = pays.map((p) => ({ ...p, amount_fc: num(p.amount_fc), rate: num(p.rate) || rate }));
    const s = fxSummary(totalFc, rate, cp);
    await patchRec(rec.id, { amount: s.bookedLocal, data: { items: clean, payments: cp, fc_total: totalFc, fx_gain_loss: s.gainLoss, paid_fc: s.paidFc } });
    // Payment stage follows the money.
    if (["draft", "ordered", "deposit_paid"].includes(String(rec.stage)) && s.paidFc > 0) await moveStage(rec, s.balanceFc <= 0.005 ? "paid" : "deposit_paid", s.balanceFc <= 0.005 ? "Paid in full" : "Deposit paid");
    setDirty(false); refresh("imports", rec.id);
  }, "Order saved");

  const makeCars = () => run("cars", async () => {
    if (!has("vehicle_yard")) throw new Error("Switch on Vehicle yard to keep stock cars");
    const next = [...items];
    let n = 0;
    for (let i = 0; i < next.length; i++) {
      const it = next[i];
      if (!it.is_car || it.car_id) continue;
      const parts = String(it.description || "").trim().split(/\s+/);
      const car = await insertRec("vehicle_yard", "car", {
        title: [it.description, it.year].filter(Boolean).join(" ") || "Imported car", stage: "at_sea",
        data: { make: parts[0] || null, model: parts.slice(1).join(" ") || null, year: num(it.year) || null, engine_cc: num(it.engine_cc) || null, chassis: it.vin || null, import_order: rec.id, shipment: rec.data?.shipment || null, cost: Math.round(num(it.price_fc) * rate * 100) / 100, listed: false },
      }, "CAR-");
      next[i] = { ...it, car_id: car.id }; n++;
    }
    if (!n) throw new Error("Tick 'Car for the yard' on the vehicle lines first");
    await patchRec(rec.id, { data: { items: next } });
    await logEvent(rec.id, `${n} car(s) added to the yard as 'At sea'.`);
    setItems(next); refresh("imports", rec.id); refresh("vehicle_yard");
  }, "Cars added to the yard stock");

  return (
    <div className="space-y-3">
      <PageHeader title={`${rec.number || ""} ${rec.title}`} icon={Globe2} actions={<>
        <Link to={`/apps/imports/import_order?open=${rec.id}`} className={btn}><Pencil className="h-4 w-4" /> Edit details</Link>
        <Link to="/garage/imports" className={btn}>Imports</Link>
      </>} />
      <StageBar stages={ORDER_STAGES} value={rec.stage} onChange={(s) => void run("st", async () => { await moveStage(rec, s.key, s.label); refresh("imports", rec.id); })} />
      <Panel>
        <KV items={[
          ["Supplier / auction", suppliers.find((s) => s.id === rec.supplier_id)?.label], ["Country", rec.data?.country], ["Currency", ccy], ["Order rate", rate || "Not set"],
          ["Order total", `${ccy} ${totalFc.toLocaleString()}`], ["In company currency", fmtMoney(fx.bookedLocal)],
          ["Shipment", shipment ? <Link className="text-primary" to={`/garage/imports/shipments/${shipment.id}`}>{shipment.number} {shipment.title}</Link> : "Not on a shipment"],
          ["Exchange gain / loss", <span className={fx.gainLoss < 0 ? "text-destructive" : "text-success"}>{fmtMoney(fx.gainLoss)}</span>],
        ]} />
      </Panel>
      {tooOld.length > 0 && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Age rule: {tooOld.map((i) => `${i.description || "vehicle"} (${i.year})`).join(", ")} {tooOld.length > 1 ? "are" : "is"} older than your setting allows (oldest model year {ageRule(2000, settings).oldestYear}). Check before paying.
        </div>
      )}
      <Panel title="Items" icon={Car} actions={<div className="flex gap-2"><button className={btn} disabled={!!busy} onClick={makeCars}><Car className="h-4 w-4" /> Add cars to yard</button><button className={btnPrimary} disabled={!dirty || !!busy} onClick={save}><Save className="h-4 w-4" /> Save</button></div>}>
        <LinesTable cols={ITEM_COLS} rows={items} onChange={(r) => { setItems(r); setDirty(true); }} newRow={{ qty: 1, is_car: true }} addLabel="Add item"
          footer={<p className="text-sm tabular-nums">{ccy} {totalFc.toLocaleString()} · {fmtMoney(fx.bookedLocal)}</p>} />
      </Panel>
      <Panel title="Payments" icon={Landmark} description="Deposit and balance payments, each at the rate the bank actually used. The difference to the order rate is the exchange gain or loss."
        actions={<button className={btnPrimary} disabled={!dirty || !!busy} onClick={save}><Save className="h-4 w-4" /> Save</button>}>
        <LinesTable cols={PAY_COLS} rows={pays} onChange={(r) => { setPays(r); setDirty(true); }} newRow={{ kind: pays.length ? "Balance" : "Deposit", rate }} addLabel="Add payment" />
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-muted/40 p-3 text-sm sm:grid-cols-5">
          <p>Paid <b className="block tabular-nums">{ccy} {fx.paidFc.toLocaleString()}</b></p>
          <p>Cost in company currency <b className="block tabular-nums">{fmtMoney(fx.paidLocal)}</b></p>
          <p>Average rate <b className="block tabular-nums">{fx.averageRate || "—"}</b></p>
          <p>Balance <b className="block tabular-nums">{ccy} {fx.balanceFc.toLocaleString()}</b></p>
          <p>Gain / loss <b className={`block tabular-nums ${fx.gainLoss < 0 ? "text-destructive" : "text-success"}`}>{fmtMoney(fx.gainLoss)}</b></p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Upload the swift / TT copy for each payment under Documents below.</p>
      </Panel>
      <Panel title="Documents" icon={FileText}>
        <DocumentsPanel entityType="garage_import_order" entityId={rec.id} entityName={`${rec.number || ""} ${rec.title}`} checklist={ORDER_DOCS} />
      </Panel>
    </div>
  );
}
