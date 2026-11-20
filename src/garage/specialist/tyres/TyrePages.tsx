import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Battery, CalendarSearch, CircleDot, Gauge, Plus, Receipt, Search, Warehouse } from "lucide-react";
import { Panel } from "@/components/kit";
import { fmtMoney } from "@/apps/format";
import { useTenantId } from "@/hooks/useTenantId";
import { num, patchRec, sb, useRecs, useRefresh, type Rec } from "../shared/db";
import { createInvoice } from "../shared/billing";
import { btn, btnPrimary, Labeled, ModuleHome, RecTable, useAction } from "../shared/ui";
import { normalisePlate, parseDot, parseTyreSize, warrantyLeft } from "../lib/calc";

export function TyresHome() {
  const tenantId = useTenantId();
  const refresh = useRefresh();
  const { busy, run } = useAction();
  const { data: jobs = [] } = useRecs("tyres", "tyre_job");
  const { data: hotel = [] } = useRecs("tyres", "tyre_hotel");
  const { data: batteries = [] } = useRecs("tyres", "battery");
  const [size, setSize] = useState("");
  const [dot, setDot] = useState("");
  const [serial, setSerial] = useState("");
  const parsed = parseTyreSize(size);
  const stockQ = useQuery({
    queryKey: ["sp-tyre-stock", parsed?.size],
    enabled: !!parsed,
    queryFn: async () => {
      const { width: w, profile: p, rim: r } = parsed!;
      const { data } = await sb.from("products").select("id, name, sku, price, stock").eq("is_active", true)
        .or(`name.ilike.%${w}/${p}%${r}%,name.ilike.%${w} ${p}%${r}%,sku.ilike.%${w}${p}%${r}%,name.ilike.%${w}${p}%${r}%`).order("name").limit(50);
      return (data || []) as any[];
    },
  });
  const dotInfo = dot ? parseDot(dot) : null;
  const bat = serial.trim() ? batteries.find((b) => b.title.toLowerCase() === serial.trim().toLowerCase()) : null;
  const w = bat?.starts_at ? warrantyLeft(String(bat.starts_at).slice(0, 10), num(bat.data?.months) || 12) : null;
  const invoice = (j: Rec) => run(j.id, async () => {
    if (!j.customer_id) throw new Error("Set the customer on the job first");
    if (!num(j.amount)) throw new Error("Enter the charge on the job first");
    const work = Array.isArray(j.data?.type) ? j.data.type.join(", ") : j.data?.type || "Tyre work";
    const inv = await createInvoice(tenantId!, { customerId: j.customer_id, lines: [{ name: `${work} · ${j.data?.plate || j.title}`, quantity: 1, rate: num(j.amount) }], subject: `Tyres ${j.number || ""}`, reference: j.number, source: "garage_tyres" });
    await patchRec(j.id, { data: { invoice_id: inv.id } }); refresh("tyres");
  }, "Draft invoice created in Sales");
  return (
    <ModuleHome module="tyres" title="Tyres, alignment & batteries" icon={CircleDot}
      actions={<Link to="/apps/tyres/tyre_job?new=1" className={btnPrimary}><Plus className="h-4 w-4" /> New tyre job</Link>}
      stats={[
        { label: "Jobs waiting / working", value: jobs.filter((j) => j.stage !== "done").length, icon: Gauge },
        { label: "Sets in the tyre hotel", value: hotel.filter((h) => h.stage === "stored").length, icon: Warehouse },
        { label: "Batteries under warranty", value: batteries.filter((b) => b.stage === "in_warranty").length, icon: Battery },
        { label: "Jobs today", value: jobs.filter((j) => new Date(j.created_at).toDateString() === new Date().toDateString()).length },
      ]}
      links={[
        { to: "/apps/tyres/tyre_job", label: "Tyre & alignment jobs", icon: Gauge },
        { to: "/apps/tyres/tyre_hotel", label: "Tyre hotel", icon: Warehouse },
        { to: "/apps/tyres/battery", label: "Batteries", icon: Battery },
      ]}>
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Tyre size search" icon={Search}>
          <input className="fi" placeholder="Enter tyre size" value={size} onChange={(e) => setSize(e.target.value)} />
          {parsed && <p className="mt-1 text-xs text-muted-foreground">Looking for {parsed.size}</p>}
          <ul className="mt-2 divide-y divide-border text-sm">
            {(stockQ.data || []).map((p) => <li key={p.id} className="flex justify-between gap-2 py-1.5"><span className="truncate">{p.name}</span><span className="shrink-0 tabular-nums">{p.stock ?? 0} · {fmtMoney(num(p.price))}</span></li>)}
            {parsed && stockQ.data && !stockQ.data.length && <li className="py-2 text-xs text-muted-foreground">No stock items with this size in the name.</li>}
          </ul>
        </Panel>
        <Panel title="DOT date check" icon={CalendarSearch}>
          <input className="fi" placeholder="Enter DOT code, e.g. last four digits" value={dot} onChange={(e) => setDot(e.target.value)} />
          {dot && (dotInfo ? <p className={`mt-2 text-sm ${dotInfo.ageMonths > 60 ? "text-destructive" : ""}`}>Made in week {dotInfo.week} of {dotInfo.year}: about {Math.floor(dotInfo.ageMonths / 12)} year(s) {dotInfo.ageMonths % 12} month(s) old.{dotInfo.ageMonths > 60 ? " Older than five years: inspect closely before fitting." : ""}</p> : <p className="mt-2 text-sm text-destructive">That is not a valid DOT date code.</p>)}
        </Panel>
        <Panel title="Battery warranty" icon={Battery}>
          <input className="fi" placeholder="Enter battery serial number" value={serial} onChange={(e) => setSerial(e.target.value)} />
          {serial.trim() && (bat ? (
            <div className="mt-2 text-sm">
              <Link className="font-medium text-primary" to={`/apps/tyres/battery?open=${bat.id}`}>{bat.data?.brand || "Battery"} · {bat.title}</Link>
              <p>{w ? (w.valid ? `Under warranty until ${w.expires} (${w.daysLeft} days left).` : `Warranty ended ${w.expires}.`) : "Sale date not recorded."}</p>
              <p className="text-xs text-muted-foreground">{(bat.data?.tests || []).length} test(s) recorded.</p>
            </div>
          ) : <p className="mt-2 text-sm text-muted-foreground">No battery with that serial number.</p>)}
        </Panel>
      </div>
      <Panel title="Recent tyre & alignment jobs" flush>
        <div className="overflow-x-auto">
          <table className="dt">
            <thead><tr><th>Job</th><th>Work</th><th>Size</th><th className="num">Charge</th><th /></tr></thead>
            <tbody>
              {jobs.slice(0, 50).map((j) => (
                <tr key={j.id}>
                  <td data-label="Job"><Link className="text-primary" to={`/apps/tyres/tyre_job?open=${j.id}`}>{j.number} {j.data?.plate || j.title}</Link></td>
                  <td data-label="Work">{Array.isArray(j.data?.type) ? j.data.type.join(", ") : j.data?.type || "—"}</td>
                  <td data-label="Size">{j.data?.size || "—"}</td>
                  <td data-label="Charge" className="num">{fmtMoney(num(j.amount))}</td>
                  <td className="text-right">{j.data?.invoice_id ? <Link className="text-sm text-primary" to={`/sales/invoices/${j.data.invoice_id}`}>Invoice</Link> : <button className={btn} disabled={!!busy} onClick={() => invoice(j)}><Receipt className="h-4 w-4" /> Invoice</button>}</td>
                </tr>
              ))}
              {!jobs.length && <tr><td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No tyre jobs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Tyre hotel" flush>
        <RecTable rows={hotel.filter((h) => h.stage === "stored")} to={(r) => `/apps/tyres/tyre_hotel?open=${r.id}`} empty="No stored tyres."
          cols={[{ label: "Set", get: (r) => `${r.number || ""} ${r.title}` }, { label: "Plate", get: (r) => normalisePlate(r.data?.plate) || "—" }, { label: "Size", get: (r) => r.data?.size || "—" }, { label: "Qty", get: (r) => num(r.quantity), num: true }, { label: "Rack", get: (r) => r.data?.rack || "—" }, { label: "Paid until", get: (r) => (r.ends_at ? String(r.ends_at).slice(0, 10) : "—") }]} />
      </Panel>
    </ModuleHome>
  );
}
