import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Wallet, AlertTriangle, FileMinus, Users, Calculator, Plane, IdCard, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { Panel, StatGrid, StatTile, TableWrap, EmptyState } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { Button } from "@/components/ui/button";
import { formatKES } from "@/lib/format";
import { saveFile } from "@/lib/erpApi";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");

/** Receivables (ageing, credit notes) and HR (payroll, headcount, leave) reports. */
export default function BusinessReports({ view }: { view: "receivables" | "people" }) {
  return view === "receivables" ? <Receivables /> : <People />;
}

function Receivables() {
  const tenantId = useTenantId();
  const { data, isLoading } = useQuery({
    queryKey: ["rep-receivables", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const [d, cn, pend] = await Promise.all([
        sb.from("debts_view").select("*").eq("tenant_id", tenantId).limit(5000),
        sb.from("credit_notes").select("credit_note_number,customer_name,issue_date,total,amount_applied,amount_refunded,status").eq("tenant_id", tenantId).neq("status", "void").order("issue_date", { ascending: false }).limit(500),
        sb.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("approval_status", ["pending", "info_requested"]),
      ]);
      return { debts: (d.data || []) as any[], notes: (cn.data || []) as any[], pending: pend.count || 0 };
    },
  });
  const r = useMemo(() => {
    if (!data) return null;
    const buckets = [["Not yet due", (x: number) => x <= 0], ["1–30 days", (x: number) => x > 0 && x <= 30], ["31–60 days", (x: number) => x > 30 && x <= 60], ["61–90 days", (x: number) => x > 60 && x <= 90], ["Over 90 days", (x: number) => x > 90]] as const;
    const aging = buckets.map(([label, f]) => ({ label, amount: data.debts.filter((d) => f(Number(d.days_overdue || 0))).reduce((a, d) => a + Number(d.balance), 0) }));
    const byCustomer = new Map<string, { name: string; phone: string; balance: number; overdue: number; count: number; id: string }>();
    for (const d of data.debts) {
      const k = d.customer_id || d.customer_name;
      const c = byCustomer.get(k) || { name: d.customer_name, phone: d.customer_phone || "", balance: 0, overdue: 0, count: 0, id: d.customer_id };
      c.balance += Number(d.balance); c.count++; if (Number(d.days_overdue) > 0) c.overdue += Number(d.balance);
      byCustomer.set(k, c);
    }
    const total = data.debts.reduce((a, d) => a + Number(d.balance), 0);
    const unused = data.notes.filter((n) => n.status === "open").reduce((a, n) => a + Number(n.total) - Number(n.amount_applied) - Number(n.amount_refunded), 0);
    return { aging, top: [...byCustomer.values()].sort((a, b) => b.balance - a.balance), total, overdue: aging.slice(1).reduce((a, b) => a + b.amount, 0), unused };
  }, [data]);
  if (isLoading || !r) return <OrbLoader label="Loading receivables…" />;
  const max = Math.max(1, ...r.aging.map((a) => a.amount));
  return (
    <div className="space-y-5">
      <StatGrid>
        <StatTile label="Owed by customers" value={formatKES(r.total)} icon={Wallet} tone="primary" />
        <StatTile label="Overdue" value={formatKES(r.overdue)} icon={AlertTriangle} tone="danger" />
        <StatTile label="Unused credit notes" value={formatKES(r.unused)} icon={FileMinus} tone="info" />
        <StatTile label="Customers awaiting approval" value={data!.pending} icon={Users} tone="muted" hint={data!.pending ? "Customers → Pending approval" : undefined} />
      </StatGrid>
      <Panel title="Ageing" icon={AlertTriangle} description="Unpaid invoice balances by how late they are.">
        <div className="space-y-2.5">
          {r.aging.map((a) => (
            <div key={a.label} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-sm">
              <span className="text-muted-foreground">{a.label}</span>
              <span className="h-3 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${(a.amount / max) * 100}%` }} /></span>
              <span className="tabular-nums font-semibold">{formatKES(a.amount)}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel flush title="Who owes" icon={Wallet} actions={<Button size="sm" variant="outline" onClick={() => saveFile("receivables.csv", csv([["Customer", "Phone", "Invoices", "Balance", "Overdue"], ...r.top.map((c) => [c.name, c.phone, c.count, c.balance.toFixed(2), c.overdue.toFixed(2)])]), "text/csv")}><Download /> CSV</Button>}>
        {r.top.length === 0 ? <EmptyState icon={Wallet} title="Nobody owes anything" /> : (
          <TableWrap><table className="dt"><thead><tr><th>Customer</th><th className="hidden sm:table-cell">Phone</th><th className="num">Invoices</th><th className="num">Balance</th><th className="num">Overdue</th></tr></thead>
            <tbody><PagedRows rows={r.top.slice(0, 100)} colSpan={5}>{(pageRows) => pageRows.map((c) => (
              <tr key={c.id || c.name}><td className="font-medium">{c.id ? <Link className="text-primary hover:underline" to={`/customers/${c.id}`}>{c.name}</Link> : c.name}</td><td className="hidden text-muted-foreground sm:table-cell">{c.phone}</td><td className="num">{c.count}</td><td className="num font-semibold">{formatKES(c.balance)}</td><td className="num text-destructive">{c.overdue ? formatKES(c.overdue) : "—"}</td></tr>
            ))}</PagedRows></tbody></table></TableWrap>
        )}
      </Panel>
    </div>
  );
}

function People() {
  const tenantId = useTenantId();
  const { data, isLoading } = useQuery({
    queryKey: ["rep-people", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const [e, runs, leave] = await Promise.all([
        sb.from("hr_employees").select("id,status,department_id,basic_salary,hr_departments(name)").eq("tenant_id", tenantId),
        sb.from("hr_payroll_runs").select("period,status,totals").eq("tenant_id", tenantId).order("period", { ascending: false }).limit(24),
        sb.from("hr_leave_requests").select("days,status,start_date").eq("tenant_id", tenantId).gte("start_date", `${new Date().getFullYear()}-01-01`),
      ]);
      return { emps: (e.data || []) as any[], runs: (runs.data || []) as any[], leave: (leave.data || []) as any[], error: e.error };
    },
  });
  if (isLoading || !data) return <OrbLoader label="Loading HR reports…" />;
  if (data.error) return <EmptyState icon={Users} title="HR reports need the HRM permission" />;
  const active = data.emps.filter((e) => !["terminated", "resigned"].includes(e.status));
  const byDept = new Map<string, number>();
  active.forEach((e) => byDept.set(e.hr_departments?.name || "No department", (byDept.get(e.hr_departments?.name || "No department") || 0) + 1));
  const last = data.runs[0]?.totals || {};
  return (
    <div className="space-y-5">
      <StatGrid>
        <StatTile label="Employees" value={active.length} icon={IdCard} tone="primary" />
        <StatTile label="Last payroll (net)" value={formatKES(Number(last.net || 0))} icon={Calculator} tone="info" hint={data.runs[0]?.period} />
        <StatTile label="Employer cost (last run)" value={formatKES(Number(last.employer_cost || 0))} icon={Wallet} tone="muted" />
        <StatTile label="Leave days taken this year" value={data.leave.filter((l) => l.status === "approved").reduce((a, l) => a + Number(l.days), 0)} icon={Plane} tone="success" />
      </StatGrid>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Headcount by department" icon={Users}>
          {byDept.size === 0 ? <p className="text-sm text-muted-foreground">No employees yet. Add them under HRM → Employees.</p> :
            <ul className="space-y-2 text-sm">{[...byDept.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => <li key={d} className="flex justify-between"><span>{d}</span><b>{n}</b></li>)}</ul>}
        </Panel>
        <Panel flush title="Payroll by month" icon={Calculator}>
          {data.runs.length === 0 ? <EmptyState icon={Calculator} title="No payroll runs yet" /> : (
            <TableWrap><table className="dt"><thead><tr><th>Month</th><th className="num">Gross</th><th className="num">PAYE</th><th className="num">Net</th><th>Status</th></tr></thead>
              <tbody><PagedRows rows={data.runs} colSpan={5}>{(pageRows) => pageRows.map((r) => <tr key={r.period}><td>{r.period}</td><td className="num">{formatKES(Number(r.totals?.gross || 0))}</td><td className="num">{formatKES(Number(r.totals?.paye || 0))}</td><td className="num font-semibold">{formatKES(Number(r.totals?.net || 0))}</td><td className="capitalize">{r.status}</td></tr>)}</PagedRows></tbody></table></TableWrap>
          )}
        </Panel>
      </div>
    </div>
  );
}
