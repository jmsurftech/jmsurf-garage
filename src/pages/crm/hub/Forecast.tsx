import { useMemo, useState } from "react";
import { BarChart3, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Segmented, StatGrid, StatTile } from "@/components/kit";
import { downloadCsv } from "@/components/Bulk";
import { formatKES } from "@/lib/format";
import { useLookups, useModuleRows } from "./fields";
import { isClosedStage, MODULES, stageLabel } from "./modules";

/** Revenue forecast from open deals (by closing month and owner) and how closed deals went. */
export default function Forecast() {
  const lk = useLookups();
  const { data: deals = [] } = useModuleRows(MODULES.deals);
  const [months, setMonths] = useState("6");
  const f = useMemo(() => {
    const now = new Date();
    const keys = Array.from({ length: Number(months) }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
    const open = deals.filter((d: any) => !isClosedStage(d.stage));
    const byMonth = keys.map((k) => {
      const list = open.filter((d: any) => String(d.closing_date || "").slice(0, 7) === k);
      const won = deals.filter((d: any) => d.stage === "won" && String(d.closing_date || d.closed_at || "").slice(0, 7) === k);
      return { k, n: list.length, pipeline: list.reduce((a: number, d: any) => a + Number(d.amount || 0), 0), weighted: list.reduce((a: number, d: any) => a + Number(d.amount || 0) * Number(d.probability || 0) / 100, 0), won: won.reduce((a: number, d: any) => a + Number(d.amount || 0), 0) };
    });
    const noDate = open.filter((d: any) => !d.closing_date);
    const owners = [...new Set(deals.map((d: any) => d.owner_id || ""))].map((o) => {
      const mine = deals.filter((d: any) => (d.owner_id || "") === o);
      const op = mine.filter((d: any) => !isClosedStage(d.stage));
      const closed = mine.filter((d: any) => isClosedStage(d.stage));
      return { o, name: lk.userName.get(o) || "Nobody", open: op.reduce((a: number, d: any) => a + Number(d.amount || 0), 0), weighted: op.reduce((a: number, d: any) => a + Number(d.amount || 0) * Number(d.probability || 0) / 100, 0), won: mine.filter((d: any) => d.stage === "won").reduce((a: number, d: any) => a + Number(d.amount || 0), 0), rate: closed.length ? Math.round(closed.filter((d: any) => d.stage === "won").length / closed.length * 100) : 0 };
    }).sort((a, b) => b.open - a.open);
    const sources = [...new Set(deals.map((d: any) => d.source || "Not set"))].map((s) => {
      const list = deals.filter((d: any) => (d.source || "Not set") === s);
      const closed = list.filter((d: any) => isClosedStage(d.stage));
      return { s, n: list.length, won: list.filter((d: any) => d.stage === "won").reduce((a: number, d: any) => a + Number(d.amount || 0), 0), rate: closed.length ? Math.round(closed.filter((d: any) => d.stage === "won").length / closed.length * 100) : 0 };
    }).sort((a, b) => b.won - a.won);
    return { byMonth, noDate, owners, sources, open };
  }, [deals, months, lk]);
  const max = Math.max(1, ...f.byMonth.map((x) => x.pipeline));
  const label = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString("en-KE", { month: "short", year: "numeric" });

  return (
    <div className="crm-ui space-y-5 p-4 sm:p-6">
      <PageHeader title="Forecast" icon={BarChart3} description="Open deals by the month they should close, weighted by probability."
        actions={<>
          <Segmented value={months} onChange={setMonths} options={[{ value: "3", label: "3 months" }, { value: "6", label: "6 months" }, { value: "12", label: "12 months" }]} />
          <Button variant="outline" size="sm" onClick={() => downloadCsv("forecast.csv", ["Month", "Deals", "Pipeline", "Weighted", "Won"], f.byMonth.map((x) => [label(x.k), x.n, x.pipeline, Math.round(x.weighted), x.won]))}><Download /> Export</Button>
        </>} />
      <StatGrid className="lg:grid-cols-3">
        <StatTile label="Pipeline in range" value={formatKES(f.byMonth.reduce((a, x) => a + x.pipeline, 0))} hint={`${f.byMonth.reduce((a, x) => a + x.n, 0)} deals`} tone="primary" />
        <StatTile label="Weighted forecast" value={formatKES(f.byMonth.reduce((a, x) => a + x.weighted, 0))} hint="Amount × probability" tone="info" />
        <StatTile label="Open deals without a closing date" value={f.noDate.length} hint={formatKES(f.noDate.reduce((a: number, d: any) => a + Number(d.amount || 0), 0))} tone="muted" />
      </StatGrid>
      <Panel title="By closing month">
        <div className="flex h-56 items-end gap-3">
          {f.byMonth.map((x) => (
            <div key={x.k} className="flex flex-1 flex-col items-center gap-1" title={`${label(x.k)}: pipeline ${formatKES(x.pipeline)}, weighted ${formatKES(x.weighted)}, won ${formatKES(x.won)}`}>
              <div className="relative flex w-full max-w-[56px] flex-1 items-end">
                <div className="w-full rounded-t-md bg-primary/25" style={{ height: `${(x.pipeline / max) * 100}%` }} />
                <div className="absolute bottom-0 left-0 w-full rounded-t-md bg-primary" style={{ height: `${(x.weighted / max) * 100}%` }} />
              </div>
              <span className="text-[11px] text-muted-foreground">{label(x.k)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground"><span className="mr-1 inline-block h-2 w-3 rounded bg-primary/25" />Pipeline <span className="ml-3 mr-1 inline-block h-2 w-3 rounded bg-primary" />Weighted</p>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel flush title="By owner">
          <table className="dt"><thead><tr><th>Owner</th><th className="text-right">Open</th><th className="text-right">Weighted</th><th className="text-right">Won</th><th className="text-right">Win rate</th></tr></thead><tbody>
            {f.owners.map((o) => <tr key={o.o}><td>{o.name}</td><td className="text-right tabular-nums">{formatKES(o.open)}</td><td className="text-right tabular-nums">{formatKES(o.weighted)}</td><td className="text-right tabular-nums">{formatKES(o.won)}</td><td className="text-right">{o.rate}%</td></tr>)}
          </tbody></table>
        </Panel>
        <Panel flush title="By lead source">
          <table className="dt"><thead><tr><th>Source</th><th className="text-right">Deals</th><th className="text-right">Won</th><th className="text-right">Win rate</th></tr></thead><tbody>
            {f.sources.map((s) => <tr key={s.s}><td>{s.s}</td><td className="text-right">{s.n}</td><td className="text-right tabular-nums">{formatKES(s.won)}</td><td className="text-right">{s.rate}%</td></tr>)}
          </tbody></table>
        </Panel>
      </div>
      <Panel flush title="Open deals in range">
        <table className="dt"><thead><tr><th>Deal</th><th>Stage</th><th>Closing</th><th className="text-right">Amount</th><th className="text-right">Weighted</th></tr></thead><tbody>
          {f.open.filter((d: any) => d.closing_date && f.byMonth.some((x) => String(d.closing_date).slice(0, 7) === x.k)).sort((a: any, b: any) => String(a.closing_date).localeCompare(String(b.closing_date))).map((d: any) => (
            <tr key={d.id}><td><a className="font-medium text-primary hover:underline" href={`/crm/deals/${d.id}`}>{d.name}</a></td><td className="text-xs">{stageLabel(d.stage)}</td><td className="text-xs">{d.closing_date}</td><td className="text-right tabular-nums">{formatKES(Number(d.amount || 0))}</td><td className="text-right tabular-nums">{formatKES(Number(d.amount || 0) * Number(d.probability || 0) / 100)}</td></tr>))}
        </tbody></table>
      </Panel>
    </div>
  );
}
