import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Anchor, Calculator, ClipboardList, Download, FileText, PackageCheck, Pencil, Save, Ship, List } from "lucide-react";
import { EmptyState, PageHeader, PageLoader, Panel, Segmented, MoreMenu } from "@/components/kit";
import DocumentsPanel from "@/components/DocumentsPanel";
import { Picker } from "@/apps/fields";
import { fmtMoney } from "@/apps/format";
import { useTenantId } from "@/hooks/useTenantId";
import { SHIPMENT_STAGES } from "../apps";
import { logEvent, moveStage, num, patchRec, sb, today, useRec, useRecs, useRefresh, jobsCost } from "../shared/db";
import { downloadPdf, item, party } from "../shared/pdf";
import { btn, btnDark, btnPrimary, Gate, KV, LinesTable, StageBar, useAction, type Col } from "../shared/ui";
import { ALLOC_METHODS, landedCosts, profitOf, suggestedPrice, type AllocMethod } from "../lib/landedCost";
import { CLEARING_STEPS, COST_TYPES, demurrage, SHIPMENT_DOCS, useImportSettings } from "./settings";

const ITEM_COLS: Col[] = [
  { key: "description", label: "Item / vehicle", placeholder: "Enter item" },
  { key: "vin", label: "Chassis / part no." },
  { key: "qty", label: "Qty", type: "number", width: "70px" },
  { key: "value", label: "Value (company currency)", type: "money", width: "140px" },
  { key: "weight", label: "Weight kg", type: "number", width: "90px" },
  { key: "cbm", label: "CBM", type: "number", width: "80px" },
];
const COST_COLS: Col[] = [
  { key: "name", label: "Cost", type: "select", options: COST_TYPES, width: "200px" },
  { key: "amount", label: "Amount (company currency)", type: "money", width: "150px" },
  { key: "method", label: "Spread", type: "select", options: ["value", "weight", "volume", "count"], width: "120px" },
  { key: "note", label: "Note / reference", placeholder: "Enter reference" },
];

export default function Shipment() {
  return <Gate module="imports"><Inner /></Gate>;
}

function Inner() {
  const { id = "" } = useParams();
  const tenantId = useTenantId();
  const { data: rec, isLoading } = useRec(id);
  const { data: agent } = useRec(rec?.data?.agent);
  const { data: orders = [] } = useRecs("imports", "import_order");
  const { data: cars = [] } = useRecs("vehicle_yard", "car");
  const { value: settings } = useImportSettings();
  const refresh = useRefresh();
  const { busy, run } = useAction();
  const [items, setItems] = useState<Record<string, any>[]>([]);
  const [costs, setCosts] = useState<Record<string, any>[]>([]);
  const [checklist, setChecklist] = useState<Record<string, { done?: boolean; date?: string; ref?: string }>>({});
  const [method, setMethod] = useState<AllocMethod>("value");
  const [dirty, setDirty] = useState(false);
  const [receive, setReceive] = useState<string | null>(null);

  useEffect(() => {
    if (!rec) return;
    setItems(Array.isArray(rec.data?.items) ? rec.data.items : []);
    setCosts(Array.isArray(rec.data?.costs) ? rec.data.costs : []);
    setChecklist(rec.data?.checklist || {});
    setMethod((rec.data?.method as AllocMethod) || "value");
    setDirty(false);
  }, [rec?.id, rec?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const linked = orders.filter((o) => o.data?.shipment === id);
  const landed = useMemo(() => landedCosts(
    items.map((it, i) => ({ id: String(i), value: num(it.value), weight: num(it.weight), volume: num(it.cbm), qty: num(it.qty) || 1 })),
    costs.map((c) => ({ name: c.name || "Cost", amount: num(c.amount), method: (c.method || null) as AllocMethod | null })),
    method,
  ), [items, costs, method]);
  const totalCost = costs.reduce((a, c) => a + num(c.amount), 0);
  const totalValue = items.reduce((a, i) => a + num(i.value), 0);

  // Prep jobs on the yard cars of this shipment, for profit per car.
  const carIds = items.map((i) => i.car_id).filter(Boolean) as string[];
  const prepQ = useQuery({
    queryKey: ["sp-prep-cost", carIds.join(",")],
    enabled: carIds.length > 0,
    queryFn: async () => {
      const { data: jobs } = await sb.from("garage_jobs").select("id, source").in("source->>car_id", carIds);
      const cost = await jobsCost((jobs || []).map((j: any) => j.id));
      const out: Record<string, number> = {};
      for (const j of jobs || []) out[j.source?.car_id] = (out[j.source?.car_id] || 0) + (cost[j.id] || 0);
      return out;
    },
  });
  const receivesQ = useQuery({
    queryKey: ["sp-receives", tenantId],
    enabled: !!tenantId,
    queryFn: async () => ((await sb.from("purchase_receives").select("id, receive_number, received_date, purchase_id").order("created_at", { ascending: false }).limit(200)).data || []) as any[],
  });

  if (isLoading) return <PageLoader />;
  if (!rec || rec.app !== "imports" || rec.kind !== "shipment") return <EmptyState title="Shipment not found" />;
  const dm = demurrage(rec.data?.arrived, num(rec.data?.free_days), num(rec.data?.demurrage_rate));
  const warn = dm.daysLeft !== null && dm.daysLeft <= num(settings.demurrageWarnDays) && !["released", "delivered"].includes(String(rec.stage));

  const data = () => ({
    items: items.map((i) => ({ ...i, qty: num(i.qty) || 1, value: num(i.value), weight: num(i.weight) || null, cbm: num(i.cbm) || null })),
    costs: costs.map((c) => ({ ...c, amount: num(c.amount) })), checklist, method,
    landed_total: Math.round((totalValue + totalCost) * 100) / 100,
  });
  const save = () => run("save", async () => { await patchRec(rec.id, { data: data(), amount: Math.round((totalValue + totalCost) * 100) / 100 }); setDirty(false); refresh("imports", rec.id); }, "Shipment saved");

  const pull = () => {
    const have = new Set(items.map((i) => `${i.order_id}:${i.line}`));
    const add: Record<string, any>[] = [];
    for (const o of linked) {
      const rate = num(o.data?.rate);
      (o.data?.items || []).forEach((it: any, line: number) => {
        if (have.has(`${o.id}:${line}`)) return;
        add.push({ description: it.description, vin: it.vin, qty: num(it.qty) || 1, value: Math.round(num(it.qty || 1) * num(it.price_fc) * rate * 100) / 100, weight: it.weight, cbm: it.cbm, order_id: o.id, line, car_id: it.car_id || null, year: it.year, engine_cc: it.engine_cc });
      });
    }
    if (!add.length) return;
    setItems([...items, ...add]); setDirty(true);
  };

  const applyToCars = () => run("cars", async () => {
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.car_id) continue;
      const l = landed[i];
      const car = cars.find((c) => c.id === it.car_id);
      const unit = l.unit;
      await patchRec(it.car_id, {
        data: { cost: unit, landed: { shipment: rec.id, value: l.value / l.qty, shares: Object.fromEntries(Object.entries(l.shares).map(([k, v]) => [k, Math.round((v / l.qty) * 100) / 100])) }, shipment: rec.id },
        ...(car && !num(car.amount) ? { amount: suggestedPrice(unit, settings.targetMarginPct, "margin", settings.priceRoundTo) } : {}),
      } as any);
      n++;
    }
    if (!n) throw new Error("No yard cars on this shipment. Add cars from the import order first.");
    await patchRec(rec.id, { data: { ...data(), landed_applied_at: new Date().toISOString() } });
    await logEvent(rec.id, `Landed cost written to ${n} yard car(s).`);
    refresh("vehicle_yard"); refresh("imports", rec.id);
  }, "Landed cost set on the yard cars");

  /** Parts imports received into stock: the same landed-cost posting as Purchases → Landed costs. */
  const applyToStock = () => run("stock", async () => {
    if (!receive) throw new Error("Choose the goods received note for these items");
    if (method === "weight" || method === "volume") throw new Error("Stock items can be spread by value or by count. Change the method first.");
    const charges = costs.filter((c) => num(c.amount) > 0).map((c) => ({ name: c.name || "Cost", amount: num(c.amount) }));
    if (!charges.length) throw new Error("Add the costs first");
    const r = (receivesQ.data || []).find((x) => x.id === receive);
    const { data: lc, error } = await sb.from("landed_costs").insert({ receive_id: receive, purchase_id: r?.purchase_id || null, charges, method: method === "count" ? "quantity" : "value" }).select("id").single();
    if (error) throw error;
    const { error: e2 } = await sb.rpc("apply_landed_cost", { p_id: lc.id });
    if (e2) throw e2;
    await patchRec(rec.id, { data: { ...data(), landed_cost_id: lc.id, landed_applied_at: new Date().toISOString() } });
    await logEvent(rec.id, `Landed cost applied to stock on ${r?.receive_number || "the goods received"}.`);
    refresh("imports", rec.id);
  }, "Item costs updated and posted to the books");

  const pdf = () => run("pdf", () => downloadPdf(tenantId!, {
    title: "Landed Cost Sheet", number: rec.number, party: party("Shipment", rec.title, [rec.data?.bl_no ? `B/L ${rec.data.bl_no}` : null, rec.data?.vessel]),
    meta: [{ label: "ETA", value: rec.due_date ? String(rec.due_date).slice(0, 10) : "—" }, { label: "Spread", value: ALLOC_METHODS.find((m) => m.value === method)?.label || method }],
    currency: "KES", items: items.map((it, i) => item(it.description || `Item ${i + 1}`, landed[i].qty, landed[i].unit, `Value ${fmtMoney(landed[i].value)} + costs ${fmtMoney(landed[i].extra)}`)),
    totals: { subtotal: totalValue + totalCost, tax: 0, total: totalValue + totalCost },
    sections: [{ title: "Costs", text: costs.map((c) => `${c.name}: ${fmtMoney(num(c.amount))}`).join("\n") }],
  } as any, `${rec.number || "shipment"}-landed-cost.pdf`));

  const prep = prepQ.data || {};
  const profitRows = items.map((it, i) => {
    const car = cars.find((c) => c.id === it.car_id);
    const sale = num(car?.data?.sale?.price) || (car?.stage === "sold" ? num(car?.amount) : 0);
    const cost = landed[i].landed + (prep[it.car_id] || 0);
    return { it, car, sale, cost, ...profitOf(sale, cost) };
  });
  const sold = profitRows.filter((r) => r.sale > 0);

  return (
    <div className="space-y-3">
      <PageHeader title={`${rec.number || ""} ${rec.title}`} icon={Ship} actions={<>
        <MoreMenu items={[{ label: "Edit details", icon: Pencil, to: `/apps/imports/shipment?open=${rec.id}` }, { label: "All imports", icon: List, to: "/garage/imports", separator: true }]} />
      </>} />
      <StageBar stages={SHIPMENT_STAGES} value={rec.stage} onChange={(s) => void run("st", async () => { await moveStage(rec, s.key, s.label); if (s.key === "at_port" && !rec.data?.arrived) await patchRec(rec.id, { data: { arrived: today() } }); refresh("imports", rec.id); })} />
      {warn && (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {dm.daysOver > 0 ? `Free days ended ${dm.freeUntil}. ${dm.daysOver} day(s) of demurrage so far: about ${fmtMoney(dm.accrued)}.` : `Free days end ${dm.freeUntil} (${dm.daysLeft} day(s) left). Clear and collect before then.`}
        </div>
      )}
      <Panel>
        <KV items={[
          ["B/L", rec.data?.bl_no], ["Vessel", rec.data?.vessel], ["Container", rec.data?.container], ["ETA Mombasa", rec.due_date ? String(rec.due_date).slice(0, 10) : null],
          ["Arrived", rec.data?.arrived], ["Free until", dm.freeUntil], ["Clearing agent", agent?.title], ["Orders", linked.map((o) => o.number).join(", ") || "—"],
        ]} />
      </Panel>

      <Panel title="Items" icon={PackageCheck} actions={<div className="flex gap-2"><button className={btn} onClick={pull} disabled={!linked.length}>Pull from orders</button><button className={btnPrimary} disabled={!dirty || !!busy} onClick={save}><Save className="h-4 w-4" /> Save</button></div>}>
        <LinesTable cols={ITEM_COLS} rows={items} onChange={(r) => { setItems(r); setDirty(true); }} newRow={{ qty: 1 }} addLabel="Add item" footer={<p className="text-sm tabular-nums">Value {fmtMoney(totalValue)}</p>} />
      </Panel>

      <Panel title="Costs to spread" icon={Calculator} description="Freight, insurance, duty and taxes, port, clearing, transport and inspection. Each cost can be spread its own way; empty means the shipment's method.">
        <LinesTable cols={COST_COLS} rows={costs} onChange={(r) => { setCosts(r); setDirty(true); }} newRow={{ name: "Freight" }} addLabel="Add cost" footer={<p className="text-sm tabular-nums">Costs {fmtMoney(totalCost)}</p>} />
        <p className="mt-2 text-xs text-muted-foreground">Work out duty per vehicle with the <Link to={`/garage/imports/duty?shipment=${rec.id}`} className="text-primary underline">duty calculator</Link>; it can add the lines here.</p>
      </Panel>

      <Panel title="Landed cost" icon={Anchor} actions={<button className={btn} disabled={!!busy} onClick={pdf}><Download className="h-4 w-4" /> PDF</button>}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Segmented value={method} onChange={(v) => { setMethod(v); setDirty(true); }} options={ALLOC_METHODS.map((m) => ({ value: m.value, label: m.label }))} />
        </div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="dt">
            <thead><tr><th>Item</th><th className="num">Value</th><th className="num">Costs</th><th className="num">Landed</th><th className="num">Per unit</th><th className="num">Price at {settings.targetMarginPct}% margin</th></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td data-label="Item">{it.description || `Item ${i + 1}`}{it.car_id && <Link className="ml-1 text-xs text-primary" to={`/garage/yard/cars/${it.car_id}`}>car</Link>}</td>
                  <td data-label="Value" className="num">{fmtMoney(landed[i]?.value || 0)}</td>
                  <td data-label="Costs" className="num" title={Object.entries(landed[i]?.shares || {}).map(([k, v]) => `${k}: ${fmtMoney(v)}`).join("\n")}>{fmtMoney(landed[i]?.extra || 0)}</td>
                  <td data-label="Landed" className="num font-semibold">{fmtMoney(landed[i]?.landed || 0)}</td>
                  <td data-label="Per unit" className="num">{fmtMoney(landed[i]?.unit || 0)}</td>
                  <td data-label="Suggested price" className="num">{fmtMoney(suggestedPrice(landed[i]?.unit || 0, settings.targetMarginPct, "margin", it.car_id ? settings.priceRoundTo : 1))}</td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Add items or pull them from the import orders.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 rounded-xl border border-border p-3">
            <p className="text-sm font-semibold">Cars for sale</p>
            <p className="text-xs text-muted-foreground">Writes each car's landed unit cost onto its yard record (and a suggested asking price where none is set).</p>
            <button className={btnDark} disabled={!!busy} onClick={applyToCars}>Set cost on yard cars</button>
          </div>
          <div className="space-y-2 rounded-xl border border-border p-3">
            <p className="text-sm font-semibold">Parts into stock</p>
            <p className="text-xs text-muted-foreground">Uses Purchases → Landed costs: raises the item costs on the goods received note and posts the charges to the books.</p>
            <Picker value={receive} onChange={setReceive} options={(receivesQ.data || []).map((r) => ({ id: r.id, label: r.receive_number || "Goods received", sub: r.received_date || "" }))} placeholder="Choose goods received…" />
            <button className={btnDark} disabled={!!busy || !!rec.data?.landed_cost_id} onClick={applyToStock}>{rec.data?.landed_cost_id ? "Applied to stock" : "Apply to stock"}</button>
          </div>
        </div>
      </Panel>

      <Panel title="Kenya clearing checklist" icon={ClipboardList} actions={<button className={btnPrimary} disabled={!dirty || !!busy} onClick={save}><Save className="h-4 w-4" /> Save</button>}>
        <div className="space-y-1.5">
          {CLEARING_STEPS.map(([k, label]) => {
            const c = checklist[k] || {};
            const set = (p: Partial<typeof c>) => { setChecklist({ ...checklist, [k]: { ...c, ...p } }); setDirty(true); };
            return (
              <div key={k} className="grid items-center gap-2 rounded-xl border border-border px-3 py-2 sm:grid-cols-[1fr_150px_200px]">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.done} onChange={(e) => set({ done: e.target.checked, date: e.target.checked ? c.date || today() : c.date })} /> <span className={c.done ? "line-through text-muted-foreground" : ""}>{label}</span></label>
                <input type="date" className="fi h-8" value={c.date || ""} onChange={(e) => set({ date: e.target.value })} />
                <input className="fi h-8" placeholder="Enter reference" value={c.ref || ""} onChange={(e) => set({ ref: e.target.value })} />
              </div>
            );
          })}
        </div>
      </Panel>

      {sold.length > 0 && (
        <Panel title="Profit on this container" flush>
          <div className="overflow-x-auto">
            <table className="dt">
              <thead><tr><th>Car</th><th className="num">Sold for</th><th className="num">Landed + prep</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
              <tbody>
                {sold.map((r, i) => <tr key={i}><td data-label="Car">{r.it.description}</td><td data-label="Sold for" className="num">{fmtMoney(r.sale)}</td><td data-label="Cost" className="num">{fmtMoney(r.cost)}</td><td data-label="Profit" className="num font-semibold">{fmtMoney(r.profit)}</td><td data-label="Margin" className="num">{r.marginPct}%</td></tr>)}
                <tr className="font-semibold"><td>Total</td><td className="num">{fmtMoney(sold.reduce((a, r) => a + r.sale, 0))}</td><td className="num">{fmtMoney(sold.reduce((a, r) => a + r.cost, 0))}</td><td className="num">{fmtMoney(sold.reduce((a, r) => a + r.profit, 0))}</td><td /></tr>
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Documents" icon={FileText}>
        <DocumentsPanel entityType="garage_shipment" entityId={rec.id} entityName={`${rec.number || ""} ${rec.title}`} checklist={SHIPMENT_DOCS} />
      </Panel>
    </div>
  );
}
