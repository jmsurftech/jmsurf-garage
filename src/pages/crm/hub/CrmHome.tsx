import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarClock, Handshake, LayoutDashboard, Magnet, Plus, Trophy, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Segmented, StatGrid, StatTile } from "@/components/kit";
import { useAuth } from "@/hooks/useAuth";
import { formatKES } from "@/lib/format";
import { useCrmRefresh, useLookups, useModuleRows } from "./fields";
import { isClosedStage, MODULES, STAGES } from "./modules";
import { ActivityForm, ActivityRow, activityWhen, isOverdue, useActivities, useRelatedNames } from "./activities";
import RecordForm from "./RecordForm";

/** CRM home: the pipeline, this month's numbers, what is due today and the newest leads. */
export default function CrmHome() {
  const nav = useNavigate();
  const { user } = useAuth();
  const lk = useLookups();
  const refresh = useCrmRefresh();
  const [whose, setWhose] = useState<"mine" | "all">("all");
  const [create, setCreate] = useState<"leads" | "deals" | null>(null);
  const [act, setAct] = useState<any | null>(null);
  const { data: deals = [] } = useModuleRows(MODULES.deals);
  const { data: leads = [] } = useModuleRows(MODULES.leads);
  const { data: acts = [], refetch } = useActivities();
  const mine = (owner: string | null) => whose === "all" || owner === user?.id;

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
  const s = useMemo(() => {
    const d = deals.filter((x: any) => mine(x.owner_id));
    const open = d.filter((x: any) => !isClosedStage(x.stage));
    const wonMonth = d.filter((x: any) => x.stage === "won" && String(x.closed_at || x.updated_at).slice(0, 10) >= monthStart);
    const closed = d.filter((x: any) => isClosedStage(x.stage));
    const l = leads.filter((x: any) => mine(x.salesperson_id));
    return {
      open, openValue: open.reduce((a: number, x: any) => a + Number(x.amount || 0), 0),
      weighted: open.reduce((a: number, x: any) => a + Number(x.amount || 0) * Number(x.probability || 0) / 100, 0),
      closing: open.filter((x: any) => x.closing_date && x.closing_date >= monthStart && x.closing_date <= monthEnd),
      wonMonth, wonValue: wonMonth.reduce((a: number, x: any) => a + Number(x.amount || 0), 0),
      winRate: closed.length ? Math.round((closed.filter((x: any) => x.stage === "won").length / closed.length) * 100) : 0,
      newLeads: l.filter((x: any) => !x.converted_contact_id).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8),
      leadsWeek: l.filter((x: any) => x.created_at >= new Date(Date.now() - 7 * 864e5).toISOString()).length,
      bySource: Object.entries(l.reduce((a: Record<string, number>, x: any) => { const k = x.source || "Not set"; a[k] = (a[k] || 0) + 1; return a; }, {} as Record<string, number>) as Record<string, number>).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 8),
    };
  }, [deals, leads, whose, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const due = acts.filter((a) => !a.done && (whose === "all" || !a.assigned_to || a.assigned_to === user?.id) && String(activityWhen(a) || "").slice(0, 10) <= today)
    .sort((a, b) => String(activityWhen(a)).localeCompare(String(activityWhen(b)))).slice(0, 12);
  const names = useRelatedNames(due);
  const stages = STAGES.filter((x) => !isClosedStage(x.key)).map((st) => {
    const list = s.open.filter((x: any) => x.stage === st.key);
    return { ...st, n: list.length, v: list.reduce((a: number, x: any) => a + Number(x.amount || 0), 0) };
  });
  const maxV = Math.max(1, ...stages.map((x) => x.v));
  const maxSrc = Math.max(1, ...s.bySource.map((x) => x[1] as number));

  return (
    <div className="crm-ui space-y-5 p-4 sm:p-6">
      <PageHeader title="CRM home" icon={LayoutDashboard} description="Your pipeline, this month and what needs doing today."
        actions={<>
          <Segmented value={whose} onChange={(v) => setWhose(v as "mine" | "all")} options={[{ value: "mine", label: "Mine" }, { value: "all", label: "Everyone" }]} />
          <Button variant="outline" size="sm" onClick={() => setCreate("leads")}><Plus /> Lead</Button>
          <Button size="sm" onClick={() => setCreate("deals")}><Plus /> Deal</Button>
        </>} />
      <StatGrid className="lg:grid-cols-4">
        <StatTile label="Open pipeline" value={formatKES(s.openValue)} hint={`${s.open.length} deals · weighted ${formatKES(s.weighted)}`} icon={Handshake} tone="primary" />
        <StatTile label="Closing this month" value={formatKES(s.closing.reduce((a: number, x: any) => a + Number(x.amount || 0), 0))} hint={`${s.closing.length} deals`} icon={CalendarClock} tone="info" />
        <StatTile label="Won this month" value={formatKES(s.wonValue)} hint={`${s.wonMonth.length} deals · win rate ${s.winRate}%`} icon={Trophy} tone="success" />
        <StatTile label="New leads this week" value={s.leadsWeek} hint={`${leads.filter((x: any) => !x.converted_contact_id).length} open leads`} icon={Magnet} tone="muted" />
      </StatGrid>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Pipeline by stage" icon={TrendingUp} actions={<Button size="sm" variant="ghost" asChild><Link to="/crm/deals?mode=board">Open board</Link></Button>}>
          <ul className="space-y-2.5">
            {stages.map((x) => (
              <li key={x.key} className="cursor-pointer" onClick={() => nav("/crm/deals?mode=board")}>
                <div className="flex justify-between text-xs"><span className="font-medium">{x.label} <span className="text-muted-foreground">· {x.n}</span></span><span className="tabular-nums">{formatKES(x.v)}</span></div>
                <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(x.v / maxV) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel flush title="Due today and overdue" icon={CalendarClock} actions={<Button size="sm" variant="ghost" asChild><Link to="/crm/activities">All activities</Link></Button>}>
          {due.length ? <ul className="divide-y divide-border">{due.map((a) => <ActivityRow key={a.id} a={a} related={names.get(`${a.related_type}:${a.related_id}`)} onChanged={() => { void refetch(); refresh(); }} onOpen={(row) => setAct(row)} />)}</ul>
            : <p className="px-4 py-6 text-sm text-muted-foreground">Nothing due. {acts.some(isOverdue) ? "" : "You are up to date."}</p>}
        </Panel>
        <Panel flush title="Deals closing this month" icon={Handshake}>
          {s.closing.length ? (
            <table className="dt"><thead><tr><th>Deal</th><th>Account</th><th>Closing</th><th className="text-right">Amount</th></tr></thead><tbody>
              {s.closing.sort((a: any, b: any) => String(a.closing_date).localeCompare(String(b.closing_date))).slice(0, 10).map((d: any) => (
                <tr key={d.id} className="cursor-pointer" onClick={() => nav(`/crm/deals/${d.id}`)}><td className="font-medium text-primary">{d.name}</td><td className="text-xs">{lk.accountName.get(d.customer_id) || d.account_name || "—"}</td><td className="text-xs">{d.closing_date}</td><td className="text-right tabular-nums">{formatKES(Number(d.amount || 0))}</td></tr>))}
            </tbody></table>
          ) : <p className="px-4 py-6 text-sm text-muted-foreground">No open deals close this month.</p>}
        </Panel>
        <Panel title="Leads by source" icon={Magnet}>
          {s.bySource.length ? <ul className="space-y-2.5">{s.bySource.map(([k, n]) => (
            <li key={k}><div className="flex justify-between text-xs"><span className="font-medium">{k}</span><span>{n as number}</span></div><div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-amber-500" style={{ width: `${((n as number) / maxSrc) * 100}%` }} /></div></li>
          ))}</ul> : <p className="text-sm text-muted-foreground">No leads yet.</p>}
        </Panel>
        <Panel flush title="Newest leads" icon={Magnet} actions={<Button size="sm" variant="ghost" asChild><Link to="/crm/leads">All leads</Link></Button>}>
          {s.newLeads.length ? <ul className="divide-y divide-border">{s.newLeads.map((l: any) => (
            <li key={l.id}><Link to={`/crm/leads/${l.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/40">
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{MODULES.leads.title(l)}</span><span className="block truncate text-xs text-muted-foreground">{[l.partner_name, l.source, l.lead_status].filter(Boolean).join(" · ")}</span></span>
              <span className="shrink-0 text-xs text-muted-foreground">{String(l.created_at).slice(0, 10)}</span>
            </Link></li>))}</ul> : <p className="px-4 py-6 text-sm text-muted-foreground">No open leads.</p>}
        </Panel>
      </div>
      {create && <RecordForm m={MODULES[create]} open onClose={() => setCreate(null)} onSaved={(row) => nav(`/crm/${create}/${row.id}`)} />}
      <ActivityForm open={!!act} onClose={() => { setAct(null); void refetch(); }} activity={act} />
    </div>
  );
}
