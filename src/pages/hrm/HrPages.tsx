import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard, IdCard, Plane, CalendarCheck, Calculator, PiggyBank, CalendarDays, Plus, Check, X, Trash2, Settings2, Building2, Briefcase, Percent, Save, Cake, AlertTriangle, Pencil,
} from "lucide-react";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, TableWrap } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { formatKES } from "@/lib/format";
import { fmtDate } from "@/lib/doc-pdf";
import { DEFAULT_RATES, workingDays, type PayrollRates } from "@/lib/kenyaPayroll";
import { cn } from "@/lib/utils";
import { confirmAction } from "@/components/books/confirm";
import SystemShell from "@/pages/settings/SystemShell";
import { sb, useEmployees, useHrLookups, useHrSettings, fullName, ymd, type PayrollOptions } from "./hrData";
import { Toggle } from "@/pages/settings/ErpSettingsTabs";
import { Clock } from "lucide-react";
import { UpcomingEventsPanel } from "./HrEvents";

/* ───────────────────────────── Overview ───────────────────────────── */

import { useErpSettings } from "@/pages/settings/ErpSettingsTabs";
import { PagedRows } from "@/components/Pager";
/** First day of the month after a "YYYY-MM" month (months have 28–31 days, so never filter on -31). */
const nextMonthStart = (month: string) => { const [y, m] = month.split("-").map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`; };
export function HrOverview() {
  const tenantId = useTenantId();
  const { data: emps = [], isLoading, error } = useEmployees();
  const { data: lk } = useHrLookups();
  const today = ymd();
  const { data } = useQuery({
    queryKey: ["hr-overview", tenantId, today],
    enabled: !!tenantId,
    queryFn: async () => {
      const [pend, onLeave, att, run] = await Promise.all([
        sb.from("hr_leave_requests").select("id,employee_id,start_date,end_date,days").eq("tenant_id", tenantId).eq("status", "pending"),
        sb.from("hr_leave_requests").select("employee_id,end_date").eq("tenant_id", tenantId).eq("status", "approved").lte("start_date", today).gte("end_date", today),
        sb.from("hr_attendance").select("employee_id,status").eq("tenant_id", tenantId).eq("date", today),
        sb.from("hr_payroll_runs").select("period,status,totals").eq("tenant_id", tenantId).order("period", { ascending: false }).limit(1),
      ]);
      return { pending: pend.data || [], onLeave: onLeave.data || [], att: att.data || [], run: (run.data || [])[0] };
    },
  });
  if (isLoading) return <OrbLoader label="Loading HR…" />;
  if (error) return <EmptyState icon={IdCard} title="HRM needs the HRM permission" description={(error as Error).message} />;
  const current = emps.filter((e) => !["terminated", "resigned"].includes(e.status));
  const byId = new Map(emps.map((e) => [e.id, e]));
  const md = today.slice(5);
  const in30 = ymd(new Date(Date.now() + 30 * 86400000));
  const birthdays = current.filter((e) => e.date_of_birth && e.date_of_birth.slice(5) >= md).sort((a, b) => a.date_of_birth!.slice(5).localeCompare(b.date_of_birth!.slice(5))).slice(0, 5);
  const alerts = [
    ...current.filter((e) => e.contract_end && e.contract_end >= today && e.contract_end <= in30).map((e) => `${fullName(e)}'s contract ends ${fmtDate(e.contract_end!)}`),
    ...current.filter((e) => e.probation_end && e.probation_end >= today && e.probation_end <= in30).map((e) => `${fullName(e)}'s probation ends ${fmtDate(e.probation_end!)}`),
    ...current.filter((e) => !e.kra_pin || !e.nssf_no || !e.shif_no).map((e) => `${fullName(e)} is missing ${[!e.kra_pin && "KRA PIN", !e.nssf_no && "NSSF no.", !e.shif_no && "SHA no."].filter(Boolean).join(", ")}`),
  ];
  const present = (data?.att || []).filter((a: any) => ["present", "late", "half_day"].includes(a.status)).length;
  return (
    <div className="space-y-5">
      <PageHeader title="HR Overview" icon={LayoutDashboard} description="People, leave, attendance and payroll at a glance."
        actions={<Button asChild><Link to="/hrm/employees"><IdCard /> Employees</Link></Button>} />
      <StatGrid>
        <StatTile label="Employees" value={current.length} icon={IdCard} tone="primary" hint={`${(lk?.departments || []).length} departments`} />
        <StatTile label="Present today" value={`${present}/${current.length}`} icon={CalendarCheck} tone="success" />
        <StatTile label="On leave today" value={(data?.onLeave || []).length} icon={Plane} tone="info" />
        <StatTile label="Last payroll (net)" value={formatKES(Number(data?.run?.totals?.net || 0))} icon={Calculator} tone="muted" hint={data?.run ? `${data.run.period} · ${data.run.status}` : "None yet"} />
      </StatGrid>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Leave waiting for approval" icon={Plane} actions={<Button size="sm" variant="outline" asChild><Link to="/hrm/leave">Open</Link></Button>}>
          {(data?.pending || []).length === 0 ? <p className="text-sm text-muted-foreground">Nothing waiting.</p> :
            <ul className="space-y-1.5 text-sm">{data!.pending.map((r: any) => <li key={r.id} className="flex justify-between"><span>{fullName(byId.get(r.employee_id))}</span><span className="text-muted-foreground">{fmtDate(r.start_date)} · {r.days} d</span></li>)}</ul>}
        </Panel>
        <Panel title="Needs attention" icon={AlertTriangle}>
          {alerts.length === 0 ? <p className="text-sm text-muted-foreground">All records are complete.</p> : <ul className="space-y-1.5 text-sm">{alerts.slice(0, 10).map((a) => <li key={a}>• {a}</li>)}</ul>}
        </Panel>
        <Panel title="Upcoming birthdays" icon={Cake}>
          {birthdays.length === 0 ? <p className="text-sm text-muted-foreground">Add dates of birth to see birthdays.</p> :
            <ul className="space-y-1.5 text-sm">{birthdays.map((e) => <li key={e.id} className="flex justify-between"><span>{fullName(e)}</span><span className="text-muted-foreground">{new Date(`2000-${e.date_of_birth!.slice(5)}`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></li>)}</ul>}
        </Panel>
        <UpcomingEventsPanel manage />
        <Panel title="Quick links" icon={LayoutDashboard}>
          <div className="grid grid-cols-2 gap-2">
            {([["/hrm/attendance", "Mark attendance", CalendarCheck], ["/hrm/payroll", "Run payroll", Calculator], ["/hrm/loans", "Loans & advances", PiggyBank], ["/hrm/registrations", "Staff registrations", IdCard], ["/apps/recruitment/applicant", "Recruitment", Briefcase], ["/hrm/config", "HR settings & rates", Settings2]] as const).map(([to, l, I]) => (
              <Link key={to} to={to} className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm font-medium hover:border-primary"><I className="h-4 w-4 text-primary" />{l}</Link>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ───────────────────────────── Leave ───────────────────────────── */

export function Leave() {
  const tenantId = useTenantId();
  const { user } = useAuth() as any;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: emps = [] } = useEmployees();
  const { data: lk } = useHrLookups();
  const [view, setView] = useState("pending");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ employee_id: "", leave_type_id: "", start_date: ymd(), end_date: ymd(), reason: "" });
  const holidays = useMemo(() => new Set((lk?.holidays || []).map((h) => h.date)), [lk]);
  const days = f.start_date && f.end_date && f.end_date >= f.start_date ? workingDays(f.start_date, f.end_date, holidays) : 0;
  const { data = [], isLoading } = useQuery({
    queryKey: ["hr-leave", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await sb.from("hr_leave_requests").select("*").eq("tenant_id", tenantId).order("start_date", { ascending: false }).limit(1000)).data || [],
  });
  const byId = new Map(emps.map((e) => [e.id, e]));
  const typeName = new Map((lk?.leaveTypes || []).map((t) => [t.id, t.name]));
  const rows = (data as any[]).filter((r) => view === "all" || r.status === view);
  const save = async () => {
    if (!f.employee_id || !f.leave_type_id) return toast({ title: "Pick the employee and leave type", variant: "destructive" });
    if (days <= 0) return toast({ title: "The dates cover no working days", variant: "destructive" });
    const { error } = await sb.from("hr_leave_requests").insert({ ...f, tenant_id: tenantId, days, status: "approved", decided_by: user?.id, decided_at: new Date().toISOString() });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Leave recorded" }); setOpen(false); qc.invalidateQueries({ queryKey: ["hr-leave"] });
  };
  const decide = async (r: any, status: "approved" | "rejected") => {
    const { error } = await sb.from("hr_leave_requests").update({ status, decided_by: user?.id, decided_at: new Date().toISOString() }).eq("id", r.id);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["hr-leave"] });
  };
  if (isLoading) return <OrbLoader label="Loading leave…" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Leave" icon={Plane} description="Annual 21 days, sick, maternity 90 days, paternity 14 days and more (Employment Act 2007)."
        actions={<Button onClick={() => setOpen(true)}><Plus /> Record leave</Button>} />
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1 sm:w-fit">
        {["pending", "approved", "rejected", "all"].map((v) => <button key={v} onClick={() => setView(v)} className={cn("rounded-lg px-3 py-1.5 text-sm capitalize", view === v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{v}{v === "pending" ? ` (${(data as any[]).filter((r) => r.status === "pending").length})` : ""}</button>)}
      </div>
      <Panel flush>
        {rows.length === 0 ? <EmptyState icon={Plane} title="No leave here" /> : (
          <TableWrap><table className="dt">
            <thead><tr><th>Employee</th><th>Type</th><th>From</th><th className="hidden sm:table-cell">To</th><th className="num">Days</th><th className="hidden md:table-cell">Reason</th><th>Status</th></tr></thead>
            <tbody><PagedRows rows={rows} colSpan={7}>{(pageRows) => pageRows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{fullName(byId.get(r.employee_id))}</td><td>{typeName.get(r.leave_type_id) || "—"}</td>
                <td className="whitespace-nowrap">{fmtDate(r.start_date)}</td><td className="hidden whitespace-nowrap sm:table-cell">{fmtDate(r.end_date)}</td><td className="num">{r.days}</td>
                <td className="hidden max-w-[220px] truncate text-muted-foreground md:table-cell">{r.reason}</td>
                <td>{r.status === "pending" ? <span className="flex gap-1"><Button size="sm" onClick={() => decide(r, "approved")}><Check /> Approve</Button><Button size="sm" variant="ghost" onClick={() => decide(r, "rejected")}><X /></Button></span> : <span className="capitalize">{r.status}</span>}</td>
              </tr>
            ))}</PagedRows></tbody>
          </table></TableWrap>
        )}
      </Panel>
      <Modal open={open} onClose={() => setOpen(false)} title="Record leave" icon={Plane} footer={<Button onClick={save}>Save (approved)</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Employee" className="sm:col-span-2"><select className="fi" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}><option value="">Select…</option>{emps.filter((e) => !["terminated", "resigned"].includes(e.status)).map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}</select></Field>
          <Field label="Leave type" className="sm:col-span-2"><select className="fi" value={f.leave_type_id} onChange={(e) => setF({ ...f, leave_type_id: e.target.value })}><option value="">Select…</option>{(lk?.leaveTypes || []).filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}{t.days_per_year ? ` (${t.days_per_year} days a year)` : ""}</option>)}</select></Field>
          <Field label="From"><input className="fi" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
          <Field label="To"><input className="fi" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
          <p className="text-sm sm:col-span-2"><b>{days}</b> working day{days === 1 ? "" : "s"} (Sundays and public holidays not counted)</p>
          <Field label="Reason" className="sm:col-span-2"><textarea className="fi" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}

/* ───────────────────────────── Attendance ───────────────────────────── */

const ATT = [["present", "Present", "bg-success text-white"], ["late", "Late", "bg-warning text-white"], ["half_day", "Half day", "bg-info text-white"], ["absent", "Absent", "bg-destructive text-white"], ["leave", "Leave", "bg-primary text-primary-foreground"], ["off", "Off", "bg-muted-foreground text-white"]] as const;

export function Attendance() {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: emps = [] } = useEmployees();
  const [date, setDate] = useState(ymd());
  const [month, setMonth] = useState(ymd().slice(0, 7));
  const current = emps.filter((e) => !["terminated", "resigned"].includes(e.status));
  const { data: day = [] } = useQuery({ queryKey: ["hr-att-day", tenantId, date], enabled: !!tenantId, queryFn: async () => (await sb.from("hr_attendance").select("*").eq("tenant_id", tenantId).eq("date", date)).data || [] });
  const { data: monthRows = [] } = useQuery({
    queryKey: ["hr-att-month", tenantId, month], enabled: !!tenantId,
    queryFn: async () => (await sb.from("hr_attendance").select("employee_id,status,overtime_hours").eq("tenant_id", tenantId).gte("date", `${month}-01`).lt("date", nextMonthStart(month))).data || [],
  });
  const byEmp = new Map((day as any[]).map((a) => [a.employee_id, a]));
  const mark = async (empId: string, patch: any) => {
    const cur = byEmp.get(empId);
    const row = { tenant_id: tenantId, employee_id: empId, date, status: cur?.status || "present", ...patch };
    if (row.clock_in && row.clock_out) { const [a, b] = [row.clock_in, row.clock_out].map((t: string) => Number(t.slice(0, 2)) + Number(t.slice(3, 5)) / 60); row.hours = Math.max(0, Math.round((b - a) * 100) / 100); }
    const { error } = await sb.from("hr_attendance").upsert(row, { onConflict: "employee_id,date" });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["hr-att-day"] }); qc.invalidateQueries({ queryKey: ["hr-att-month"] });
  };
  const markAll = async () => {
    const rows = current.filter((e) => !byEmp.has(e.id)).map((e) => ({ tenant_id: tenantId, employee_id: e.id, date, status: "present" }));
    if (!rows.length) return;
    const { error } = await sb.from("hr_attendance").upsert(rows, { onConflict: "employee_id,date" });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["hr-att-day"] }); qc.invalidateQueries({ queryKey: ["hr-att-month"] });
  };
  const summary = (id: string) => { const r = (monthRows as any[]).filter((x) => x.employee_id === id); return { p: r.filter((x) => ["present", "late", "half_day"].includes(x.status)).length, a: r.filter((x) => x.status === "absent").length, ot: r.reduce((s, x) => s + Number(x.overtime_hours || 0), 0) }; };
  return (
    <div className="space-y-5">
      <PageHeader title="Attendance" icon={CalendarCheck} description="Mark the register each day; overtime and absences flow into payroll."
        actions={<Button variant="outline" onClick={markAll}><Check /> Mark everyone else present</Button>} />
      <div className="flex flex-wrap items-center gap-2"><input type="date" className="fi w-auto" value={date} onChange={(e) => setDate(e.target.value)} /><span className="text-sm text-muted-foreground">{new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long" })}</span></div>
      <Panel flush>
        {current.length === 0 ? <EmptyState icon={CalendarCheck} title="Add employees first" /> : (
          <ul className="divide-y divide-border">{current.map((e) => {
            const a = byEmp.get(e.id);
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
                <span className="min-w-[150px] flex-1 font-medium">{fullName(e)}</span>
                <div className="flex flex-wrap gap-1">{ATT.map(([v, l, c]) => <button key={v} onClick={() => mark(e.id, { status: v })} className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", a?.status === v ? c : "bg-muted text-muted-foreground hover:bg-muted/70")}>{l}</button>)}</div>
                <input type="time" className="fi h-8 w-[104px] text-xs" value={a?.clock_in?.slice(0, 5) || ""} onChange={(ev) => mark(e.id, { clock_in: ev.target.value || null, clock_out: a?.clock_out || null })} aria-label="Clock in" />
                <input type="time" className="fi h-8 w-[104px] text-xs" value={a?.clock_out?.slice(0, 5) || ""} onChange={(ev) => mark(e.id, { clock_out: ev.target.value || null, clock_in: a?.clock_in || null })} aria-label="Clock out" />
                <input type="number" min={0} step="0.5" className="fi h-8 w-20 text-xs" placeholder="OT h" value={a?.overtime_hours || ""} onChange={(ev) => mark(e.id, { overtime_hours: Number(ev.target.value) || 0 })} aria-label="Overtime hours" />
              </li>
            );
          })}</ul>
        )}
      </Panel>
      <Panel flush title="Monthly summary" icon={CalendarDays} actions={<input type="month" className="fi h-8 w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />}>
        <TableWrap><table className="dt"><thead><tr><th>Employee</th><th className="num">Days present</th><th className="num">Absent</th><th className="num">Overtime hours</th></tr></thead>
          <tbody><PagedRows rows={current} colSpan={4}>{(pageRows) => pageRows.map((e) => { const s = summary(e.id); return <tr key={e.id}><td>{fullName(e)}</td><td className="num">{s.p}</td><td className="num text-destructive">{s.a || "—"}</td><td className="num">{s.ot || "—"}</td></tr>; })}</PagedRows></tbody></table></TableWrap>
      </Panel>
    </div>
  );
}

/* ───────────────────────────── Loans & advances ───────────────────────────── */

export function Loans() {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: emps = [] } = useEmployees();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<any | null>(null);
  const { data: repayments = [] } = useQuery({ queryKey: ["hr-loan-repay", history?.id], enabled: !!history?.id, queryFn: async () => (await sb.from("hr_loan_repayments").select("*").eq("loan_id", history.id).order("paid_on", { ascending: false })).data || [] });
  const [f, setF] = useState({ employee_id: "", kind: "advance", principal: "", monthly_installment: "", issued_on: ymd(), note: "" });
  const { data = [], isLoading } = useQuery({ queryKey: ["hr-loans", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("hr_loans").select("*").eq("tenant_id", tenantId).order("issued_on", { ascending: false })).data || [] });
  const byId = new Map(emps.map((e) => [e.id, e]));
  const save = async () => {
    const p = Number(f.principal);
    if (!f.employee_id || !(p > 0)) return toast({ title: "Pick the employee and amount", variant: "destructive" });
    const inst = Number(f.monthly_installment) || p;
    const { error } = await sb.from("hr_loans").insert({ ...f, tenant_id: tenantId, principal: p, monthly_installment: Math.min(inst, p), balance: p });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    setOpen(false); qc.invalidateQueries({ queryKey: ["hr-loans"] }); toast({ title: "Recorded", description: "It is deducted in the next payroll." });
  };
  /** A request from My Space: approving gives it today and recovers it from the next payroll. */
  const decideReq = async (l: any, ok: boolean) => {
    const { error } = await sb.from("hr_loans").update(ok ? { status: "active", issued_on: ymd() } : { status: "rejected" }).eq("id", l.id);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: ok ? "Approved" : "Rejected", description: ok ? "It is recovered from the next payroll." : undefined }); qc.invalidateQueries({ queryKey: ["hr-loans"] });
  };
  const close = async (l: any, status: string) => { await sb.from("hr_loans").update({ status, balance: status === "cleared" ? 0 : l.balance }).eq("id", l.id); qc.invalidateQueries({ queryKey: ["hr-loans"] }); };
  if (isLoading) return <OrbLoader label="Loading…" />;
  const active = (data as any[]).filter((l) => l.status === "active");
  const requested = (data as any[]).filter((l) => l.status === "requested");
  return (
    <div className="space-y-5">
      <PageHeader title="Loans & Advances" icon={PiggyBank} description="Salary advances and staff loans, recovered automatically from payroll." actions={<Button onClick={() => setOpen(true)}><Plus /> New advance / loan</Button>} />
      <StatGrid><StatTile label="Outstanding" value={formatKES(active.reduce((a, l) => a + Number(l.balance), 0))} icon={PiggyBank} tone="warning" hint={`${active.length} active`} />{requested.length > 0 && <StatTile label="Requests waiting" value={requested.length} icon={PiggyBank} tone="danger" />}<StatTile label="Recovered next payroll" value={formatKES(active.reduce((a, l) => a + Math.min(Number(l.monthly_installment), Number(l.balance)), 0))} icon={Calculator} tone="info" /></StatGrid>
      <Panel flush>
        {(data as any[]).length === 0 ? <EmptyState icon={PiggyBank} title="No loans or advances" /> : (
          <TableWrap><table className="dt"><thead><tr><th>Employee</th><th>Type</th><th>Issued</th><th className="num">Amount</th><th className="num">Monthly</th><th className="num">Balance</th><th>Status</th></tr></thead>
            <tbody><PagedRows rows={(data as any[])} colSpan={7}>{(pageRows) => pageRows.map((l) => <tr key={l.id} className="cursor-pointer" onClick={() => setHistory(l)}><td className="font-medium">{fullName(byId.get(l.employee_id))}<span className="block text-xs font-normal text-muted-foreground">{Math.round(((Number(l.principal) - Number(l.balance)) / Number(l.principal)) * 100)}% repaid</span></td><td className="capitalize">{l.kind}</td><td>{fmtDate(l.issued_on)}</td><td className="num">{formatKES(Number(l.principal))}</td><td className="num">{formatKES(Number(l.monthly_installment))}</td><td className="num font-semibold">{formatKES(Number(l.balance))}</td>
              <td onClick={(e) => e.stopPropagation()}>{l.status === "requested" ? <span className="flex gap-1"><Button size="sm" onClick={() => decideReq(l, true)}><Check /> Approve</Button><Button size="sm" variant="ghost" onClick={() => decideReq(l, false)} aria-label="Reject"><X /></Button></span> : l.status === "active" ? <span className="flex gap-1"><Button size="sm" variant="outline" onClick={() => close(l, "cleared")}>Mark cleared</Button><Button size="sm" variant="ghost" onClick={() => close(l, "cancelled")}><X /></Button></span> : <span className="capitalize">{l.status}</span>}</td></tr>)}</PagedRows></tbody></table></TableWrap>
        )}
      </Panel>
      <Modal open={!!history} onClose={() => setHistory(null)} title={history ? `${history.kind === "loan" ? "Loan" : "Advance"} · ${fullName(byId.get(history.employee_id))}` : ""} icon={PiggyBank}
        description={history ? `${formatKES(Number(history.principal))} given ${fmtDate(history.issued_on)} · ${formatKES(Number(history.monthly_installment))} a month` : ""}>
        {history && <div className="space-y-4">
          <div className="h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-success" style={{ width: `${Math.min(100, ((Number(history.principal) - Number(history.balance)) / Number(history.principal)) * 100)}%` }} /></div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm"><div className="rounded-xl bg-muted/50 p-2"><p className="text-xs text-muted-foreground">Given</p><b>{formatKES(Number(history.principal))}</b></div><div className="rounded-xl bg-muted/50 p-2"><p className="text-xs text-muted-foreground">Repaid</p><b className="text-success">{formatKES(Number(history.principal) - Number(history.balance))}</b></div><div className="rounded-xl bg-muted/50 p-2"><p className="text-xs text-muted-foreground">Balance</p><b>{formatKES(Number(history.balance))}</b></div></div>
          {Number(history.balance) > 0 && Number(history.monthly_installment) > 0 && <p className="text-sm text-muted-foreground">Cleared in about {Math.ceil(Number(history.balance) / Number(history.monthly_installment))} more payroll{Math.ceil(Number(history.balance) / Number(history.monthly_installment)) === 1 ? "" : "s"}.</p>}
          <p className="text-sm font-semibold">Deductions from payroll</p>
          {(repayments as any[]).length === 0 ? <p className="text-sm text-muted-foreground">Nothing recovered yet. It is deducted when the next payroll is approved.</p> :
            <table className="dt dt-keep"><thead><tr><th>Date</th><th>Payroll</th><th className="num">Amount</th><th className="num">Balance after</th></tr></thead>
              <tbody><PagedRows rows={(repayments as any[])} colSpan={4}>{(pageRows) => pageRows.map((r) => <tr key={r.id}><td>{fmtDate(r.paid_on)}</td><td>{r.note || "—"}</td><td className="num">{formatKES(Number(r.amount))}</td><td className="num">{formatKES(Number(r.balance_after || 0))}</td></tr>)}</PagedRows></tbody></table>}
        </div>}
      </Modal>
      <Modal open={open} onClose={() => setOpen(false)} title="New advance or loan" icon={PiggyBank} footer={<Button onClick={save}>Save</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Employee" className="sm:col-span-2"><select className="fi" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}><option value="">Select…</option>{emps.filter((e) => !["terminated", "resigned"].includes(e.status)).map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}</select></Field>
          <Field label="Type"><select className="fi" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="advance">Salary advance</option><option value="loan">Staff loan</option></select></Field>
          <Field label="Date given"><input className="fi" type="date" value={f.issued_on} onChange={(e) => setF({ ...f, issued_on: e.target.value })} /></Field>
          <Field label="Amount"><input className="fi" type="number" value={f.principal} onChange={(e) => setF({ ...f, principal: e.target.value })} /></Field>
          <Field label="Recover per month" hint="Empty: all in the next payroll"><input className="fi" type="number" value={f.monthly_installment} onChange={(e) => setF({ ...f, monthly_installment: e.target.value })} /></Field>
          <Field label="Note" className="sm:col-span-2"><input className="fi" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}

/* ───────────────────────────── Holidays ───────────────────────────── */

export function Holidays() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: lk, isLoading } = useHrLookups();
  const [f, setF] = useState({ date: ymd(), name: "" });
  const [edit, setEdit] = useState<{ id: string; date: string; name: string } | null>(null);
  const saveEdit = async () => {
    if (!edit?.name.trim()) return;
    const { error } = await sb.from("hr_holidays").update({ date: edit.date, name: edit.name.trim() }).eq("id", edit.id);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Holiday updated" }); setEdit(null); qc.invalidateQueries({ queryKey: ["hr-lookups"] });
  };
  const add = async () => {
    if (!f.name.trim()) return;
    const { error } = await sb.from("hr_holidays").upsert({ tenant_id: tenantId, date: f.date, name: f.name.trim() }, { onConflict: "tenant_id,date" });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    setF({ ...f, name: "" }); qc.invalidateQueries({ queryKey: ["hr-lookups"] });
  };
  const del = async (id: string) => { if (!(await confirmAction({ title: "Delete this holiday?", danger: true, confirmLabel: "Delete" }))) return; await sb.from("hr_holidays").delete().eq("id", id); toast({ title: "Holiday deleted" }); qc.invalidateQueries({ queryKey: ["hr-lookups"] }); };
  if (isLoading) return <OrbLoader label="Loading…" />;
  const years = [...new Set((lk?.holidays || []).map((h) => h.date.slice(0, 4)))];
  return (
    <div className="space-y-5">
      <PageHeader title="Holidays" icon={CalendarDays} description="Kenyan public holidays (Public Holidays Act). Add gazetted extra days here; leave and payroll skip them." />
      <Panel><div className="flex flex-wrap items-end gap-2"><Field label="Date"><input className="fi" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field><Field label="Holiday" className="min-w-[220px] flex-1"><input className="fi" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Idd-ul-Fitr" /></Field><Button onClick={add}><Plus /> Add</Button></div></Panel>
      {years.map((y) => (
        <Panel key={y} flush title={y} icon={CalendarDays}>
          <ul className="divide-y divide-border">{(lk?.holidays || []).filter((h) => h.date.startsWith(y)).map((h) => (
            <li key={h.id} className={cn("flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5", h.date < ymd() && "opacity-50")}><span className="w-36 text-muted-foreground">{new Date(`${h.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span><span className="flex-1 font-medium">{h.name}</span><button className="icon-btn" onClick={() => setEdit({ id: h.id, date: h.date, name: h.name })} aria-label="Edit"><Pencil className="h-4 w-4" /></button><button className="icon-btn-danger" onClick={() => del(h.id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button></li>
          ))}</ul>
        </Panel>
      ))}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit holiday" icon={CalendarDays} footer={<Button onClick={saveEdit}>Save</Button>}>
        {edit && <div className="space-y-3"><Field label="Date"><input className="fi" type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></Field><Field label="Holiday"><input className="fi" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field></div>}
      </Modal>
    </div>
  );
}

/* ───────────────────────────── HRM configuration ───────────────────────────── */

export function HrConfig() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: lk, isLoading } = useHrLookups();
  const { rates, save, hrm, payroll, leave } = useHrSettings();
  const saveManagerStage = async (v: boolean) => { const { error } = await save({ leave: { ...leave, manager_stage: v } }); toast(error ? { title: "Not saved", description: error.message, variant: "destructive" } : { title: v ? "Line managers approve leave first" : "Leave goes straight to HR" }); };
  const [r, setR] = useState<PayrollRates | null>(null);
  const [po, setPo] = useState<PayrollOptions | null>(null);
  const curPo = po || payroll;
  const savePo = async () => { const { error } = await save({ payroll: curPo }); toast(error ? { title: "Not saved", description: error.message, variant: "destructive" } : { title: "Payroll options saved" }); setPo(null); };
  const limit = (k: "advance_max_pct" | "loan_max_amount" | "loan_max_months", label: string, hint: string) => (
    <Field label={label} hint={hint}><input className="fi" type="number" min={0} placeholder="No limit" value={curPo[k] ?? ""} onChange={(e) => setPo({ ...curPo, [k]: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
  );
  const cur = r || rates;
  const [newDept, setNewDept] = useState("");
  const [newJob, setNewJob] = useState({ name: "", department_id: "" });
  const [lt, setLt] = useState({ name: "", days_per_year: "", paid: true });
  const refresh = () => qc.invalidateQueries({ queryKey: ["hr-lookups"] });
  const ins = async (table: string, row: any) => { const { error } = await sb.from(table).insert({ tenant_id: tenantId, ...row }); if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" }); refresh(); };
  const del = async (table: string, id: string) => { if (!(await confirmAction({ title: "Remove this?", danger: true, confirmLabel: "Remove" }))) return; const { error } = await sb.from(table).delete().eq("id", id); if (error) toast({ title: "Not removed", description: error.message, variant: "destructive" }); else toast({ title: "Removed" }); refresh(); };
  const [ren, setRen] = useState<{ table: string; row: any } | null>(null);
  const saveRen = async () => {
    if (!ren) return;
    const { id, ...patch } = ren.row;
    const { error } = await sb.from(ren.table).update(patch).eq("id", id);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Saved" }); setRen(null); refresh();
  };
  const num = (k: keyof PayrollRates, label: string, hint?: string) => (
    <Field label={label} hint={hint}><input className="fi" type="number" step="0.01" value={cur[k] as number} onChange={(e) => setR({ ...cur, [k]: Number(e.target.value) })} /></Field>
  );
  const saveRates = async () => { const { error } = await save({ rates: cur }); toast(error ? { title: "Not saved", description: error.message, variant: "destructive" } : { title: "Payroll rates saved" }); setR(null); };
  if (isLoading) return <SystemShell><OrbLoader label="Loading…" /></SystemShell>;
  return (
    <SystemShell>
      <div className="space-y-5">
        <PageHeader title="HRM configuration" icon={Settings2} description="Departments, job titles, leave types and Kenyan statutory rates." />
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Departments" icon={Building2}>
            <div className="mb-3 flex gap-2"><input className="fi" value={newDept} onChange={(e) => setNewDept(e.target.value)} placeholder="New department" /><Button onClick={() => { if (newDept.trim()) { void ins("hr_departments", { name: newDept.trim() }); setNewDept(""); } }}><Plus /></Button></div>
            <ul className="space-y-1">{(lk?.departments || []).map((d) => <li key={d.id} className="flex items-center gap-1 rounded-lg bg-muted/50 px-3 py-1.5 text-sm"><span className="flex-1">{d.name}</span><button className="icon-btn" onClick={() => setRen({ table: "hr_departments", row: { id: d.id, name: d.name } })} aria-label="Edit"><Pencil className="h-4 w-4" /></button><button className="icon-btn-danger" onClick={() => del("hr_departments", d.id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button></li>)}</ul>
          </Panel>
          <Panel title="Job titles" icon={Briefcase}>
            <div className="mb-3 flex flex-wrap gap-2"><input className="fi min-w-[140px] flex-1" value={newJob.name} onChange={(e) => setNewJob({ ...newJob, name: e.target.value })} placeholder="e.g. Company attendant" />
              <select className="fi w-auto" value={newJob.department_id} onChange={(e) => setNewJob({ ...newJob, department_id: e.target.value })}><option value="">Any department</option>{(lk?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
              <Button onClick={() => { if (newJob.name.trim()) { void ins("hr_designations", { name: newJob.name.trim(), department_id: newJob.department_id || null }); setNewJob({ name: "", department_id: "" }); } }}><Plus /></Button></div>
            <ul className="space-y-1">{(lk?.designations || []).map((d) => <li key={d.id} className="flex items-center gap-1 rounded-lg bg-muted/50 px-3 py-1.5 text-sm"><span className="flex-1">{d.name}</span><button className="icon-btn" onClick={() => setRen({ table: "hr_designations", row: { id: d.id, name: d.name, department_id: d.department_id } })} aria-label="Edit"><Pencil className="h-4 w-4" /></button><button className="icon-btn-danger" onClick={() => del("hr_designations", d.id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button></li>)}</ul>
          </Panel>
        </div>
        <Panel title="Leave types" icon={Plane}>
          <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_140px_auto_auto]"><input className="fi" value={lt.name} onChange={(e) => setLt({ ...lt, name: e.target.value })} placeholder="Leave name" /><input className="fi" type="number" value={lt.days_per_year} onChange={(e) => setLt({ ...lt, days_per_year: e.target.value })} placeholder="Days a year" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={lt.paid} onChange={(e) => setLt({ ...lt, paid: e.target.checked })} /> Paid</label>
            <Button onClick={() => { if (lt.name.trim()) { void ins("hr_leave_types", { name: lt.name.trim(), days_per_year: Number(lt.days_per_year) || 0, paid: lt.paid }); setLt({ name: "", days_per_year: "", paid: true }); } }}><Plus /></Button></div>
          <TableWrap><table className="dt"><thead><tr><th>Leave</th><th className="num">Days a year</th><th>Paid</th><th className="num">Carry forward</th><th /></tr></thead>
            <tbody><PagedRows rows={(lk?.leaveTypes || [])} colSpan={5}>{(pageRows) => pageRows.map((t) => <tr key={t.id}><td className="font-medium">{t.name}{t.gender ? <span className="ml-1 text-xs text-muted-foreground">({t.gender})</span> : null}</td><td className="num">{t.days_per_year}</td><td>{t.paid ? "Yes" : "No"}</td><td className="num">{t.carry_forward_max}</td><td><span className="flex gap-1"><button className="icon-btn" onClick={() => setRen({ table: "hr_leave_types", row: { id: t.id, name: t.name, days_per_year: t.days_per_year, paid: t.paid, carry_forward_max: t.carry_forward_max, requires_document: t.requires_document, active: t.active } })} aria-label="Edit"><Pencil className="h-4 w-4" /></button><button className="icon-btn-danger" onClick={() => del("hr_leave_types", t.id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button></span></td></tr>)}</PagedRows></tbody></table></TableWrap>
          <div className="mt-3"><Toggle label="Line manager approves first" hint="Leave goes to the employee's line manager, then to HR. Off, or with no manager login, it goes straight to HR." checked={leave.manager_stage} onChange={(v) => void saveManagerStage(v)} /></div>
        </Panel>
        <WorkHoursPanel />
        <Panel title="Statutory rates (Kenya)" icon={Percent} description="Change these when KRA, NSSF or SHA announce new rates. They apply to the next payroll run.">
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-semibold">PAYE monthly bands</p>
              <div className="space-y-2">{cur.paye_bands.map((b, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-20 text-muted-foreground">{i === 0 ? "First" : "Next"}</span>
                  <input className="fi w-36" type="number" placeholder="no limit" value={b.upto ?? ""} onChange={(e) => setR({ ...cur, paye_bands: cur.paye_bands.map((x, j) => (j === i ? { ...x, upto: e.target.value === "" ? null : Number(e.target.value) } : x)) })} />
                  <span>at</span><input className="fi w-24" type="number" step="0.5" value={b.rate} onChange={(e) => setR({ ...cur, paye_bands: cur.paye_bands.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) } : x)) })} /><span>%</span>
                </div>
              ))}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {num("personal_relief", "Personal relief / month")}{num("insurance_relief_rate", "Insurance relief %")}{num("insurance_relief_cap", "Insurance relief cap")}
              {num("nssf_rate", "NSSF % (each side)")}{num("nssf_lower_limit", "NSSF lower earnings limit", "Tier I")}{num("nssf_upper_limit", "NSSF upper earnings limit", "Tier II")}
              {num("shif_rate", "SHIF %")}{num("shif_min", "SHIF minimum")}{num("housing_rate", "Housing Levy % (employee)")}{num("housing_employer_rate", "Housing Levy % (employer)")}
              {num("nita", "NITA per employee")}{num("pension_cap", "Pension tax-free cap")}{num("mortgage_cap", "Mortgage interest cap")}{num("disability_exemption", "Disability exemption")}
              {num("overtime_rate", "Overtime rate (× hourly)", "1.5 weekdays")}{num("working_days", "Working days a month")}
              {num("prmf_cap", "PRMF tax-free cap", "Post-retirement medical fund")}{num("benefit_exempt", "Non-cash benefits tax free up to")}
            </div>
            <div className="flex flex-wrap gap-2"><Button onClick={saveRates}><Save /> Save rates</Button><Button variant="ghost" onClick={() => setR({ ...DEFAULT_RATES })}>Reset to the 2026 defaults</Button></div>
            {hrm?.rates_updated_at && <p className="text-xs text-muted-foreground">Last changed {fmtDate(hrm.rates_updated_at)}</p>}
          </div>
        </Panel>
        <Panel title="Payroll options" icon={Calculator} description="How payroll is worked out and approved, and what staff can ask for in My Space.">
          <div className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <Toggle label="Round net pay to whole shillings" hint="PAYE and statutory deductions stay exact; the cents go to Rounding in the books." checked={curPo.round_net} onChange={(v) => setPo({ ...curPo, round_net: v })} />
              <Toggle label="Two-step approval" hint="The person who prepares or re-computes a payroll cannot approve it." checked={curPo.two_step} onChange={(v) => setPo({ ...curPo, two_step: v })} />
            </div>
            <Field label="Part-month pay counted in" hint="For people who join or leave during the month. A single line can still be changed."><select className="fi sm:w-64" value={curPo.prorate_basis} onChange={(e) => setPo({ ...curPo, prorate_basis: e.target.value as PayrollOptions["prorate_basis"] })}><option value="working">Working days</option><option value="calendar">Calendar days</option></select></Field>
            <p className="pt-2 text-sm font-semibold">Staff loan and advance requests</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {limit("advance_max_pct", "Advances up to (% of basic)", "Open advances included")}
              {limit("loan_max_amount", "Largest loan (KES)", "One request")}
              {limit("loan_max_months", "Loan repaid over up to (months)", "")}
            </div>
            <div className="flex flex-wrap gap-2"><Button onClick={savePo} disabled={!po}><Save /> Save options</Button>{po && <Button variant="ghost" onClick={() => setPo(null)}>Cancel</Button>}</div>
          </div>
        </Panel>
        <Modal open={!!ren} onClose={() => setRen(null)} title="Edit" icon={Pencil} footer={<Button onClick={saveRen}><Save /> Save</Button>}>
          {ren && <div className="space-y-3">
            <Field label="Name"><input className="fi" value={ren.row.name} onChange={(e) => setRen({ ...ren, row: { ...ren.row, name: e.target.value } })} /></Field>
            {ren.table === "hr_designations" && <Field label="Department"><select className="fi" value={ren.row.department_id || ""} onChange={(e) => setRen({ ...ren, row: { ...ren.row, department_id: e.target.value || null } })}><option value="">Any</option>{(lk?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}
            {ren.table === "hr_leave_types" && <>
              <Field label="Days a year"><input className="fi" type="number" value={ren.row.days_per_year} onChange={(e) => setRen({ ...ren, row: { ...ren.row, days_per_year: Number(e.target.value) } })} /></Field>
              <Field label="Days that can carry forward"><input className="fi" type="number" value={ren.row.carry_forward_max} onChange={(e) => setRen({ ...ren, row: { ...ren.row, carry_forward_max: Number(e.target.value) } })} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={ren.row.paid} onChange={(e) => setRen({ ...ren, row: { ...ren.row, paid: e.target.checked } })} /> Paid leave</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={ren.row.requires_document} onChange={(e) => setRen({ ...ren, row: { ...ren.row, requires_document: e.target.checked } })} /> Needs a supporting document</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={ren.row.active} onChange={(e) => setRen({ ...ren, row: { ...ren.row, active: e.target.checked } })} /> Available to request</label>
            </>}
          </div>}
        </Modal>
      </div>
    </SystemShell>
  );
}



export const DEFAULT_HR = { work_start: "08:00", work_end: "17:00", grace_minutes: 15, workdays: [1, 2, 3, 4, 5, 6], clock_prompt: true, auto_send_payslips: true, payslip_sms: true };
const WEEK = [["1", "Mon"], ["2", "Tue"], ["3", "Wed"], ["4", "Thu"], ["5", "Fri"], ["6", "Sat"], ["0", "Sun"]] as const;

/** Working hours used by clock-in/out (late, early leave, overtime) and payslip sending after approval. */
function WorkHoursPanel() {
  const { settings, save } = useErpSettings();
  const { toast } = useToast();
  const saved = { ...DEFAULT_HR, ...(settings.hr || {}) };
  const [h, setH] = useState<typeof DEFAULT_HR | null>(null);
  const cur = h || saved;
  const set = (k: keyof typeof DEFAULT_HR, v: any) => setH({ ...cur, [k]: v });
  const doSave = async () => {
    const { error } = await save("hr", cur) as any;
    toast(error ? { title: "Not saved", description: error.message, variant: "destructive" } : { title: "Working hours saved" });
    if (!error) setH(null);
  };
  return (
    <Panel title="Working hours & attendance" icon={Clock} description="Staff clock in on arrival and out when they leave. Time after hours counts as overtime.">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Work starts"><input className="fi" type="time" value={cur.work_start} onChange={(e) => set("work_start", e.target.value)} /></Field>
        <Field label="Work ends"><input className="fi" type="time" value={cur.work_end} onChange={(e) => set("work_end", e.target.value)} /></Field>
        <Field label="Late after (minutes of grace)"><input className="fi" type="number" min={0} value={cur.grace_minutes} onChange={(e) => set("grace_minutes", Number(e.target.value) || 0)} /></Field>
      </div>
      <Field label="Working days" className="mt-3">
        <div className="flex flex-wrap gap-1.5">{WEEK.map(([d, l]) => {
          const on = cur.workdays.includes(Number(d));
          return <button key={d} type="button" onClick={() => set("workdays", on ? cur.workdays.filter((x) => x !== Number(d)) : [...cur.workdays, Number(d)])} className={cn("rounded-full px-3 py-1.5 text-sm font-medium", on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{l}</button>;
        })}</div>
      </Field>
      <div className="mt-4 space-y-2 rounded-xl border border-border p-3 text-sm">
        <label className="flex items-center justify-between gap-3"><span>Ask staff to clock in when they open the system, and to clock out at the end of the day</span><input type="checkbox" className="h-4 w-4 accent-primary" checked={cur.clock_prompt} onChange={(e) => set("clock_prompt", e.target.checked)} /></label>
        <label className="flex items-center justify-between gap-3"><span>Email every payslip to staff as soon as payroll is approved</span><input type="checkbox" className="h-4 w-4 accent-primary" checked={cur.auto_send_payslips} onChange={(e) => set("auto_send_payslips", e.target.checked)} /></label>
        <label className="flex items-center justify-between gap-3"><span>Also send an SMS with the net pay</span><input type="checkbox" className="h-4 w-4 accent-primary" checked={cur.payslip_sms} onChange={(e) => set("payslip_sms", e.target.checked)} /></label>
      </div>
      <div className="mt-3"><Button onClick={doSave} disabled={!h}><Save /> Save working hours</Button></div>
    </Panel>
  );
}
