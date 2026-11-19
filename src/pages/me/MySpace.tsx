import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Home, IdCard, Wallet, Plane, PiggyBank, Timer, Receipt, Megaphone, Briefcase, Printer, Plus, Lock, Unlock, Clock, LogIn, LogOut, CheckCircle2, Trash2, FileText, Send, Download, Eye,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { useBusinessSettings } from "@/hooks/useData";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, TableWrap, Pill } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { formatKES } from "@/lib/format";
import { fmtDate } from "@/lib/doc-pdf";
import { cn } from "@/lib/utils";
import { sb, fullName, ymd, type Employee } from "@/pages/hrm/hrData";
import { printPayslips } from "@/pages/hrm/payslipPrint";
import { openDoc, type PayrollDoc } from "@/pages/hrm/payrollDocs";
import { Leave } from "@/pages/hrm/LeaveAttendance";
import { CoverNotice } from "@/pages/hrm/LeaveWorkflow";
import DocumentsPanel, { EMPLOYEE_DOCS } from "@/components/DocumentsPanel";
import { UpcomingEventsPanel } from "@/pages/hrm/HrEvents";

import { PagedRows } from "@/components/Pager";
type Tab = "home" | "details" | "payslips" | "leave" | "loans" | "timesheet" | "expenses" | "notices" | "careers";
const TABS: [Tab, string, typeof Home][] = [
  ["home", "Home", Home], ["details", "My details", IdCard], ["payslips", "Payslips", Wallet], ["leave", "Leave", Plane], ["loans", "Loans", PiggyBank],
  ["timesheet", "Timesheet", Timer], ["expenses", "Expenses", Receipt], ["notices", "Memos & policies", Megaphone], ["careers", "Careers", Briefcase],
];

function useMe() {
  const { user } = useAuth() as any;
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["my-employee", user?.id, tenantId], enabled: !!user?.id && !!tenantId,
    queryFn: async () => (await sb.from("hr_employees").select("*, hr_departments(name), hr_designations(name)").eq("user_id", user.id).eq("tenant_id", tenantId).maybeSingle()).data as (Employee & { self_edit_unlocked: boolean; hr_departments?: { name: string }; hr_designations?: { name: string } }) | null,
  });
}

/** My Space: everything an employee does for themselves (payslips, leave, loans, hours, claims, memos, careers). */
export default function MySpace() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t[0] === params.get("tab")) ? params.get("tab") : "home") as Tab;
  const go = (t: Tab) => setParams(t === "home" ? {} : { tab: t }, { replace: true });
  const { data: me, isLoading } = useMe();
  if (isLoading) return <OrbLoader label="Loading My Space…" />;
  return (
    <div className="space-y-4">
      <PageHeader title="My Space" icon={Home} />
      <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1 scrollbar-none">
        {TABS.map(([v, l, I]) => (
          <button key={v} onClick={() => go(v)} className={cn("flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm transition-colors", tab === v ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            <I className="h-4 w-4" />{l}
          </button>
        ))}
      </nav>
      {!me && tab !== "leave" ? (
        <Panel><EmptyState icon={IdCard} title="Your login is not linked to an employee record" description="Ask HR to link your login on your employee record (HRM → Employees)." /></Panel>
      ) : (
        <>
          {tab === "home" && me && <HomeTab me={me} go={go} />}
          {tab === "details" && me && <DetailsTab me={me} />}
          {tab === "payslips" && me && <PayslipsTab me={me} />}
          {tab === "leave" && <Leave />}
          {tab === "loans" && me && <LoansTab me={me} />}
          {tab === "timesheet" && me && <TimesheetTab me={me} />}
          {tab === "expenses" && me && <ExpensesTab me={me} />}
          {tab === "notices" && me && <NoticesTab me={me} />}
          {tab === "careers" && me && <CareersTab me={me} />}
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── Home ───────────────────────────── */

function HomeTab({ me, go }: { me: Employee; go: (t: Tab) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: today } = useQuery({ queryKey: ["my-clock", me.id, ymd()], queryFn: async () => (await sb.from("hr_attendance").select("*").eq("employee_id", me.id).eq("date", ymd()).maybeSingle()).data });
  const { data: slip } = useQuery({ queryKey: ["my-last-slip", me.id], queryFn: async () => (await sb.from("hr_payslips").select("net_pay, hr_payroll_runs!inner(period,status)").eq("employee_id", me.id).neq("hr_payroll_runs.status", "draft").order("created_at", { ascending: false }).limit(1).maybeSingle()).data });
  const { data: loans = [] } = useQuery({ queryKey: ["my-loans", me.id], queryFn: async () => (await sb.from("hr_loans").select("*").eq("employee_id", me.id)).data || [] });
  const { data: memos = [] } = useMyMemos(me);
  const unread = (memos as any[]).filter((m) => !m.read).length;
  const clock = async (action: "in" | "out") => {
    const { error } = await sb.rpc("hr_clock", { p_action: action, p_reason: null });
    if (error) return toast({ title: "Not recorded", description: error.message, variant: "destructive" });
    toast({ title: action === "in" ? "Clocked in" : "Clocked out" }); qc.invalidateQueries({ queryKey: ["my-clock"] });
  };
  const owed = (loans as any[]).filter((l) => l.status === "active").reduce((a, l) => a + Number(l.balance), 0);
  const hello = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";
  return (
    <div className="space-y-3">
      <Panel>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground">{me.first_name[0]}{me.last_name?.[0] || ""}</div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-bold">{hello}, {me.first_name}</p>
            <p className="text-sm text-muted-foreground">{[(me as any).hr_designations?.name, (me as any).hr_departments?.name, me.employee_no].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground"><Clock className="mr-1 inline h-4 w-4" />{today?.clock_in ? `In ${String(today.clock_in).slice(0, 5)}${today.clock_out ? ` · Out ${String(today.clock_out).slice(0, 5)}` : ""}` : "Not clocked in"}</span>
            {!today?.clock_in ? <Button onClick={() => clock("in")}><LogIn /> Clock in</Button> : !today?.clock_out ? <Button variant="outline" onClick={() => clock("out")}><LogOut /> Clock out</Button> : null}
          </div>
        </div>
      </Panel>
      <CoverNotice />
      <StatGrid>
        <StatTile label="Last net pay" value={slip ? formatKES(Number(slip.net_pay)) : "-"} hint={(slip as any)?.hr_payroll_runs?.period} icon={Wallet} tone="success" />
        <StatTile label="Loans to repay" value={formatKES(owed)} icon={PiggyBank} tone={owed ? "warning" : "muted"} />
        <StatTile label="Unread memos" value={unread} icon={Megaphone} tone={unread ? "danger" : "muted"} />
        <StatTile label="With us since" value={fmtDate(me.hire_date)} icon={IdCard} tone="info" />
      </StatGrid>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([["leave", "Request leave", Plane], ["loans", "Ask for an advance", PiggyBank], ["timesheet", "Log my hours", Timer], ["expenses", "Claim an expense", Receipt]] as [Tab, string, typeof Home][]).map(([t, l, I]) => (
          <button key={t} onClick={() => go(t)} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left text-sm font-semibold transition-colors hover:border-primary/40 hover:bg-primary/5">
            <span className="g-tile sm"><I className="h-4 w-4" /></span>{l}
          </button>
        ))}
      </div>
      <UpcomingEventsPanel />
    </div>
  );
}

/* ───────────────────────────── Details ───────────────────────────── */

const DETAIL_FIELDS: [string, string][] = [
  ["phone", "Phone"], ["personal_email", "Personal email"], ["address", "Home address"], ["postal_address", "Postal address"], ["marital_status", "Marital status"],
  ["next_of_kin", "Next of kin"], ["next_of_kin_relationship", "Relationship"], ["next_of_kin_phone", "Next of kin phone"],
  ["kra_pin", "KRA PIN"], ["nssf_no", "NSSF number"], ["shif_no", "SHA (SHIF) number"],
  ["bank_name", "Bank"], ["bank_branch", "Branch"], ["bank_account", "Account number"], ["mpesa_phone", "M-Pesa number"],
];

function DetailsTab({ me }: { me: any }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState<Record<string, string> | null>(null);
  const kin = me.next_of_kin && typeof me.next_of_kin === "object" ? me.next_of_kin : { name: me.next_of_kin || "" };
  const val = (k: string) => (k === "next_of_kin" ? kin.name || "" : k === "next_of_kin_relationship" ? kin.relationship || "" : k === "next_of_kin_phone" ? kin.phone || "" : me[k] ?? "");
  const save = async () => {
    const { error } = await sb.rpc("hr_update_my_details", { p: f });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Details saved", description: "HR locks them again until you need another change." }); setF(null); qc.invalidateQueries({ queryKey: ["my-employee"] });
  };
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
      <Panel title="My details" icon={IdCard} actions={me.self_edit_unlocked ? <Button size="sm" onClick={() => setF(Object.fromEntries(DETAIL_FIELDS.map(([k]) => [k, String(val(k))])))}><Unlock /> Edit</Button> : <Pill tone="muted"><Lock className="h-3 w-3" /> Locked by HR</Pill>}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {([["Full name", fullName(me)], ["Employee no.", me.employee_no], ["ID number", me.national_id], ["Date of birth", me.date_of_birth ? fmtDate(me.date_of_birth) : ""], ["Job title", me.hr_designations?.name], ["Department", me.hr_departments?.name], ["Joined", fmtDate(me.hire_date)], ["Paid by", me.payment_method === "mpesa" ? "M-Pesa" : me.payment_method === "bank" ? "Bank" : me.payment_method]] as [string, unknown][])
            .concat(DETAIL_FIELDS.map(([k, l]) => [l, val(k)]))
            .map(([l, v]) => <div key={l} className="flex justify-between gap-3 border-b border-border/60 py-1"><dt className="text-muted-foreground">{l}</dt><dd className="text-right font-medium">{String(v || "-")}</dd></div>)}
        </dl>
        {!me.self_edit_unlocked && <p className="mt-3 text-xs text-muted-foreground">Need a change? Ask HR to unlock your details.</p>}
      </Panel>
      <DocumentsPanel entityType="employee" entityId={me.id} entityName={fullName(me)} checklist={EMPLOYEE_DOCS} noDelete />
      <Modal open={!!f} onClose={() => setF(null)} title="Edit my details" icon={IdCard} size="lg" footer={<><Button variant="outline" onClick={() => setF(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {f && <div className="grid gap-3 sm:grid-cols-2">{DETAIL_FIELDS.map(([k, l]) => (
          <Field key={k} label={l}>{k === "marital_status" ? <select className="fi" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}><option value="">-</option>{["single", "married", "divorced", "widowed"].map((x) => <option key={x} value={x} className="capitalize">{x}</option>)}</select>
            : <input className="fi" value={f[k]} onChange={(e) => setF({ ...f, [k]: k === "kra_pin" ? e.target.value.toUpperCase() : e.target.value })} />}</Field>))}</div>}
      </Modal>
    </div>
  );
}

/* ───────────────────────────── Payslips ───────────────────────────── */

function PayslipsTab({ me }: { me: Employee }) {
  const { data: biz } = useBusinessSettings();
  const { data: slips = [], isLoading } = useQuery({ queryKey: ["my-payslips-all", me.id], queryFn: async () => (await sb.from("hr_payslips").select("*, hr_payroll_runs!inner(period,status)").eq("employee_id", me.id).neq("hr_payroll_runs.status", "draft").order("created_at", { ascending: false })).data || [] });
  const year = new Date().getFullYear();
  const ytd = (slips as any[]).filter((s) => String(s.hr_payroll_runs?.period).startsWith(String(year)));
  const sum = (k: string) => ytd.reduce((a, s) => a + Number(s[k] || 0), 0);
  const print = (s: any) => printPayslips([s], s.hr_payroll_runs?.period, biz, new Map([[me.id, me]]));
  if (isLoading) return <OrbLoader label="Loading payslips…" />;
  return (
    <div className="space-y-3">
      <StatGrid>
        <StatTile label={`Gross ${year}`} value={formatKES(sum("gross"))} icon={Wallet} tone="primary" />
        <StatTile label={`PAYE ${year}`} value={formatKES(sum("paye"))} icon={Receipt} tone="danger" />
        <StatTile label={`NSSF + SHIF ${year}`} value={formatKES(sum("nssf") + sum("shif"))} icon={PiggyBank} tone="info" />
        <StatTile label={`Net ${year}`} value={formatKES(sum("net_pay"))} icon={CheckCircle2} tone="success" />
      </StatGrid>
      <Panel flush title="Payslips" icon={Wallet} actions={ytd.length > 0 && <Button size="sm" variant="outline" onClick={() => printP9(ytd, me, biz, year)}><Printer /> P9 {year}</Button>}>
        {(slips as any[]).length === 0 ? <EmptyState icon={Wallet} title="No payslips yet" /> : (
          <TableWrap><table className="dt"><thead><tr><th>Month</th><th className="num">Gross</th><th className="num">PAYE</th><th className="num">Deductions</th><th className="num">Net pay</th><th /></tr></thead>
            <tbody><PagedRows rows={(slips as any[])} colSpan={6}>{(pageRows) => pageRows.map((s) => (
              <tr key={s.id}><td className="font-medium">{s.hr_payroll_runs?.period}</td><td className="num">{formatKES(Number(s.gross))}</td><td className="num">{formatKES(Number(s.paye))}</td>
                <td className="num">{formatKES(Number(s.gross) - Number(s.net_pay))}</td><td className="num font-semibold">{formatKES(Number(s.net_pay))}</td>
                <td className="text-right"><Button size="sm" variant="outline" onClick={() => print(s)}><Printer /> Payslip</Button></td></tr>))}</PagedRows></tbody></table></TableWrap>
        )}
      </Panel>
      <MyPayrollDocs me={me} />
    </div>
  );
}

/** Payslips and P9s HR stored for me, to open or download. */
function MyPayrollDocs({ me }: { me: Employee }) {
  const { toast } = useToast();
  const { data: docs = [] } = useQuery({
    queryKey: ["my-payroll-docs", me.id],
    queryFn: async () => ((await sb.from("hr_payroll_documents").select("*").eq("employee_id", me.id).order("period", { ascending: false })).data || []) as PayrollDoc[],
  });
  if (!docs.length) return null;
  const get = async (d: PayrollDoc, mode: "view" | "download") => {
    try {
      await openDoc(d, mode);
      void sb.from("hr_payroll_document_deliveries").insert({ tenant_id: d.tenant_id, document_id: d.id, channel: "portal", status: "sent" }).then(() => {}, () => {});
    } catch (e: any) { toast({ title: "File not opened", description: e.message, variant: "destructive" }); }
  };
  return (
    <Panel flush title="My payroll documents" icon={FileText} description="Payslips and P9 tax cards from HR.">
      <TableWrap><table className="dt"><thead><tr><th>Document</th><th>Period</th><th>Added</th><th /></tr></thead>
        <tbody><PagedRows rows={docs} colSpan={4}>{(rows) => rows.map((d) => (
          <tr key={d.id}><td className="font-medium">{d.kind === "p9" ? "P9 tax deduction card" : "Payslip"}</td><td>{d.period}</td><td>{fmtDate(d.updated_at || d.created_at)}</td>
            <td><span className="flex justify-end gap-1">
              <Button size="sm" variant="outline" onClick={() => get(d, "view")}><Eye /> Open</Button>
              <Button size="sm" variant="outline" onClick={() => get(d, "download")}><Download /> Download</Button>
            </span></td></tr>
        ))}</PagedRows></tbody></table></TableWrap>
    </Panel>
  );
}

/** KRA P9A tax deduction card for the year, from the employee's payslips. */
function printP9(slips: any[], me: Employee, biz: any, year: number) {
  const w = window.open("", "_blank"); if (!w) return;
  const m = (n: unknown) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rows = [...slips].sort((a, b) => String(a.hr_payroll_runs?.period).localeCompare(String(b.hr_payroll_runs?.period)));
  const tot = (k: string) => rows.reduce((a, s) => a + Number(s[k] || 0), 0);
  w.document.write(`<!doctype html><html><head><title>P9 ${year}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px;text-align:right}td:first-child,th:first-child{text-align:left}h2{margin:0}</style></head><body>
    <h2>P9A Tax Deduction Card ${year}</h2><p>Employer: <b>${biz?.business_name || ""}</b> PIN ${biz?.tax_pin || "-"}<br>Employee: <b>${fullName(me)}</b> PIN ${me.kra_pin || "-"}</p>
    <table><tr><th>Month</th><th>Basic</th><th>Gross pay</th><th>NSSF</th><th>SHIF</th><th>Housing Levy</th><th>Taxable pay</th><th>PAYE</th></tr>
    ${rows.map((s) => `<tr><td>${s.hr_payroll_runs?.period}</td><td>${m(s.basic)}</td><td>${m(s.gross)}</td><td>${m(s.nssf)}</td><td>${m(s.shif)}</td><td>${m(s.housing_levy)}</td><td>${m(s.taxable_pay)}</td><td>${m(s.paye)}</td></tr>`).join("")}
    <tr><th>Total</th><th>${m(tot("basic"))}</th><th>${m(tot("gross"))}</th><th>${m(tot("nssf"))}</th><th>${m(tot("shif"))}</th><th>${m(tot("housing_levy"))}</th><th>${m(tot("taxable_pay"))}</th><th>${m(tot("paye"))}</th></tr></table>
    <script>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

/* ───────────────────────────── Loans ───────────────────────────── */

function LoansTab({ me }: { me: Employee }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState<{ kind: string; amount: string; months: string; reason: string } | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ["my-loans", me.id], queryFn: async () => (await sb.from("hr_loans").select("*").eq("employee_id", me.id).order("created_at", { ascending: false })).data || [] });
  const ask = async () => {
    const { error } = await sb.rpc("hr_request_loan", { p_kind: f!.kind, p_amount: Number(f!.amount), p_months: Number(f!.months) || 1, p_reason: f!.reason || null });
    if (error) return toast({ title: "Not sent", description: error.message, variant: "destructive" });
    toast({ title: "Request sent to HR" }); setF(null); qc.invalidateQueries({ queryKey: ["my-loans"] });
  };
  if (isLoading) return <OrbLoader label="Loading…" />;
  const cap = Number(me.basic_salary) / 2;
  return (
    <Panel flush title="Loans & advances" icon={PiggyBank} actions={<Button size="sm" onClick={() => setF({ kind: "advance", amount: "", months: "1", reason: "" })}><Plus /> Request</Button>}>
      {(data as any[]).length === 0 ? <EmptyState icon={PiggyBank} title="No loans or advances" /> : (
        <TableWrap><table className="dt"><thead><tr><th>Date</th><th>Type</th><th className="num">Amount</th><th className="num">Monthly</th><th className="num">Balance</th><th>Status</th></tr></thead>
          <tbody><PagedRows rows={(data as any[])} colSpan={6}>{(pageRows) => pageRows.map((l) => <tr key={l.id}><td>{fmtDate(l.issued_on)}</td><td className="capitalize">{l.kind}</td><td className="num">{formatKES(Number(l.principal))}</td><td className="num">{formatKES(Number(l.monthly_installment))}</td><td className="num font-semibold">{formatKES(Number(l.balance))}</td><td><Pill tone={l.status === "active" ? "warning" : l.status === "cleared" ? "success" : l.status === "requested" ? "info" : "muted"}>{l.status === "requested" ? "Waiting for HR" : l.status}</Pill></td></tr>)}</PagedRows></tbody></table></TableWrap>
      )}
      <Modal open={!!f} onClose={() => setF(null)} title="Request an advance or loan" icon={PiggyBank} footer={<Button onClick={ask}><Send /> Send to HR</Button>}>
        {f && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type"><select className="fi" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="advance">Salary advance</option><option value="loan">Staff loan</option></select></Field>
          <Field label="Amount" hint={f.kind === "advance" && cap > 0 ? `Usually up to ${formatKES(cap)}` : undefined}><input className="fi" type="number" placeholder="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Repay over (months)"><input className="fi" type="number" min={1} max={24} value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></Field>
          <Field label="Monthly deduction"><input className="fi bg-muted/40" readOnly value={formatKES((Number(f.amount) || 0) / Math.max(1, Number(f.months) || 1))} /></Field>
          <Field label="Reason" className="sm:col-span-2"><input className="fi" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </div>}
      </Modal>
    </Panel>
  );
}

/* ───────────────────────────── Timesheet ───────────────────────────── */

function TimesheetTab({ me }: { me: Employee }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const [weekOf, setWeekOf] = useState(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); });
  const daysOfWeek = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(`${weekOf}T00:00:00`); d.setDate(d.getDate() + i); return ymd(d); }), [weekOf]);
  const [f, setF] = useState({ work_date: ymd(), project: "", task: "", hours: "", billable: false });
  const { data = [] } = useQuery({ queryKey: ["my-timesheet", me.id, weekOf], queryFn: async () => (await sb.from("hr_timesheets").select("*").eq("employee_id", me.id).gte("work_date", daysOfWeek[0]).lte("work_date", daysOfWeek[6]).order("work_date")).data || [] });
  const add = async () => {
    if (!f.task.trim() || !(Number(f.hours) > 0)) return toast({ title: "Enter the task and hours", variant: "destructive" });
    const { error } = await sb.from("hr_timesheets").insert({ tenant_id: tenantId, employee_id: me.id, work_date: f.work_date, project: f.project || null, task: f.task.trim(), hours: Number(f.hours), billable: f.billable, status: "submitted" });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    setF({ ...f, task: "", hours: "" }); qc.invalidateQueries({ queryKey: ["my-timesheet"] });
  };
  const del = async (id: string) => { await sb.from("hr_timesheets").delete().eq("id", id); qc.invalidateQueries({ queryKey: ["my-timesheet"] }); };
  const shift = (n: number) => { const d = new Date(`${weekOf}T00:00:00`); d.setDate(d.getDate() + n * 7); setWeekOf(ymd(d)); };
  const total = (data as any[]).reduce((a, t) => a + Number(t.hours), 0);
  return (
    <div className="space-y-3">
      <Panel>
        <div className="grid gap-2 sm:grid-cols-[150px_1fr_1.4fr_90px_auto_auto] sm:items-end">
          <Field label="Date"><input className="fi" type="date" value={f.work_date} onChange={(e) => setF({ ...f, work_date: e.target.value })} /></Field>
          <Field label="Project / client"><input className="fi" value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })} /></Field>
          <Field label="What I did"><input className="fi" value={f.task} onChange={(e) => setF({ ...f, task: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} /></Field>
          <Field label="Hours"><input className="fi" type="number" step="0.25" placeholder="0" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
          <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Billable</label>
          <Button onClick={add}><Plus /> Add</Button>
        </div>
      </Panel>
      <Panel flush title={`Week of ${fmtDate(weekOf)} · ${total} h`} icon={Timer} actions={<><Button size="sm" variant="outline" onClick={() => shift(-1)}>Previous</Button><Button size="sm" variant="outline" onClick={() => shift(1)}>Next</Button></>}>
        {(data as any[]).length === 0 ? <EmptyState icon={Timer} title="No hours this week" /> : (
          <TableWrap><table className="dt"><thead><tr><th>Day</th><th>Project</th><th>Task</th><th className="num">Hours</th><th>Status</th><th /></tr></thead>
            <tbody><PagedRows rows={(data as any[])} colSpan={6}>{(pageRows) => pageRows.map((t) => <tr key={t.id}><td>{new Date(`${t.work_date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</td><td>{t.project || "-"}</td><td>{t.task}</td><td className="num">{Number(t.hours)}</td>
              <td><Pill tone={t.status === "approved" ? "success" : t.status === "rejected" ? "danger" : "warning"}>{t.status}</Pill></td>
              <td className="text-right">{t.status !== "approved" && <button className="icon-btn-danger" onClick={() => del(t.id)} aria-label="Delete"><Trash2 className="h-4 w-4" /></button>}</td></tr>)}</PagedRows></tbody></table></TableWrap>
        )}
      </Panel>
    </div>
  );
}

/* ───────────────────────────── Expenses ───────────────────────────── */

function ExpensesTab({ me }: { me: Employee }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const [f, setF] = useState<{ title: string; date: string; method: string; lines: { category: string; merchant: string; amount: string }[] } | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ["my-claims", me.id], queryFn: async () => (await sb.from("app_records").select("*").eq("app", "expense").eq("kind", "claim").eq("employee_id", me.id).order("created_at", { ascending: false })).data || [] });
  const total = f ? f.lines.reduce((a, l) => a + (Number(l.amount) || 0), 0) : 0;
  const submit = async () => {
    if (!f!.title.trim() || !(total > 0)) return toast({ title: "Enter the purpose and amounts", variant: "destructive" });
    const { error } = await sb.from("app_records").insert({ tenant_id: tenantId, app: "expense", kind: "claim", title: f!.title.trim(), stage: "submitted", employee_id: me.id, amount: total, starts_at: f!.date,
      data: { lines: f!.lines.filter((l) => Number(l.amount) > 0).map((l) => ({ date: f!.date, category: l.category, merchant: l.merchant, amount: Number(l.amount) })), method: f!.method } });
    if (error) return toast({ title: "Not sent", description: /module|policy/i.test(error.message) ? "Expense claims are not switched on for your company. Ask your admin." : error.message, variant: "destructive" });
    toast({ title: "Claim sent for approval" }); setF(null); qc.invalidateQueries({ queryKey: ["my-claims"] });
  };
  if (isLoading) return <OrbLoader label="Loading…" />;
  return (
    <Panel flush title="Expense claims" icon={Receipt} actions={<Button size="sm" onClick={() => setF({ title: "", date: ymd(), method: "M-Pesa", lines: [{ category: "Transport", merchant: "", amount: "" }] })}><Plus /> New claim</Button>}>
      {(data as any[]).length === 0 ? <EmptyState icon={Receipt} title="No claims yet" description="Claim back what you spent for work: fuel, fare, meals, airtime." /> : (
        <TableWrap><table className="dt"><thead><tr><th>Date</th><th>Purpose</th><th className="num">Amount</th><th>Status</th></tr></thead>
          <tbody><PagedRows rows={(data as any[])} colSpan={4}>{(pageRows) => pageRows.map((c) => <tr key={c.id}><td>{c.starts_at ? fmtDate(c.starts_at) : fmtDate(c.created_at)}</td><td className="font-medium">{c.title}<span className="block text-xs font-normal text-muted-foreground">{c.number}</span></td><td className="num font-semibold">{formatKES(Number(c.amount))}</td><td><Pill tone={c.stage === "approved" || c.stage === "reimbursed" ? "success" : c.stage === "rejected" ? "danger" : "warning"}>{c.stage}</Pill></td></tr>)}</PagedRows></tbody></table></TableWrap>
      )}
      <Modal open={!!f} onClose={() => setF(null)} title="New expense claim" icon={Receipt} size="lg" footer={<><span className="mr-auto text-sm font-semibold">Total {formatKES(total)}</span><Button onClick={submit}><Send /> Submit</Button></>}>
        {f && <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Purpose" className="sm:col-span-3"><input className="fi" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Client visit, Nakuru" /></Field>
            <Field label="Date"><input className="fi" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Pay me by"><select className="fi" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{["M-Pesa", "Bank transfer", "Payroll", "Cash"].map((x) => <option key={x}>{x}</option>)}</select></Field>
          </div>
          {f.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_110px_auto] gap-2">
              <select className="fi" value={l.category} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)) })}>{["Transport", "Fuel", "Meals", "Accommodation", "Airtime / data", "Supplies", "Other"].map((x) => <option key={x}>{x}</option>)}</select>
              <input className="fi" placeholder="Where" value={l.merchant} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, merchant: e.target.value } : x)) })} />
              <input className="fi text-right" type="number" placeholder="0" value={l.amount} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
              <button className="icon-btn-danger" onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })} disabled={f.lines.length === 1} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
            </div>))}
          <Button size="sm" variant="outline" onClick={() => setF({ ...f, lines: [...f.lines, { category: "Transport", merchant: "", amount: "" }] })}><Plus /> Add line</Button>
        </div>}
      </Modal>
    </Panel>
  );
}

/* ───────────────────────── Memos & policies ───────────────────────── */

function useMyMemos(me: Employee) {
  return useQuery({
    queryKey: ["my-memos", me.id],
    queryFn: async () => {
      const [m, r] = await Promise.all([sb.from("hr_memos").select("*").order("published_at", { ascending: false }).limit(50), sb.from("hr_memo_reads").select("*").eq("employee_id", me.id)]);
      const reads = new Map((r.data || []).map((x: any) => [x.memo_id, x]));
      return (m.data || []).map((x: any) => ({ ...x, read: reads.has(x.id), acked: !!(reads.get(x.id) as any)?.acked_at }));
    },
  });
}

function NoticesTab({ me }: { me: Employee }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const tenantId = useTenantId();
  const { data: memos = [] } = useMyMemos(me);
  const { data: policies = [] } = useQuery({ queryKey: ["my-policies", me.id], queryFn: async () => {
    const [p, a] = await Promise.all([sb.from("hr_policies").select("*").eq("status", "published").order("title"), sb.from("hr_policy_acks").select("*").eq("employee_id", me.id)]);
    return (p.data || []).map((x: any) => ({ ...x, acked: (a.data || []).some((y: any) => y.policy_id === x.id && y.version === x.version) }));
  } });
  const [open, setOpen] = useState<{ kind: "memo" | "policy"; item: any } | null>(null);
  const openMemo = async (m: any) => {
    setOpen({ kind: "memo", item: m });
    if (!m.read) { await sb.from("hr_memo_reads").upsert({ memo_id: m.id, employee_id: me.id, tenant_id: tenantId }, { onConflict: "memo_id,employee_id" }); qc.invalidateQueries({ queryKey: ["my-memos"] }); }
  };
  const ack = async () => {
    const it = open!.item;
    const { error } = open!.kind === "memo"
      ? await sb.from("hr_memo_reads").upsert({ memo_id: it.id, employee_id: me.id, tenant_id: tenantId, acked_at: new Date().toISOString() }, { onConflict: "memo_id,employee_id" })
      : await sb.from("hr_policy_acks").insert({ policy_id: it.id, employee_id: me.id, tenant_id: tenantId, version: it.version });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Acknowledged" }); setOpen(null); qc.invalidateQueries({ queryKey: ["my-memos"] }); qc.invalidateQueries({ queryKey: ["my-policies"] });
  };
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel flush title="Memos" icon={Megaphone}>
        {(memos as any[]).length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">No memos.</p> :
          <ul className="divide-y divide-border"><PagedRows rows={(memos as any[])} list>{(pageRows) => pageRows.map((m) => (
            <li key={m.id}><button onClick={() => openMemo(m)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted/40">
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", m.read ? "bg-transparent" : "bg-primary")} />
              <span className="min-w-0 flex-1"><span className={cn("block truncate text-sm", !m.read && "font-semibold")}>{m.title}</span><span className="text-xs text-muted-foreground">{fmtDate(m.published_at)}</span></span>
              {m.requires_ack && !m.acked && <Pill tone="warning">Acknowledge</Pill>}
            </button></li>))}</PagedRows></ul>}
      </Panel>
      <Panel flush title="Company policies" icon={FileText}>
        {(policies as any[]).length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">No policies yet.</p> :
          <ul className="divide-y divide-border"><PagedRows rows={(policies as any[])} list>{(pageRows) => pageRows.map((p) => (
            <li key={p.id}><button onClick={() => setOpen({ kind: "policy", item: p })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40">
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.title}</span><span className="text-xs text-muted-foreground">{p.category} · v{p.version}</span></span>
              {p.requires_ack && (p.acked ? <Pill tone="success">Done</Pill> : <Pill tone="warning">Read & accept</Pill>)}
            </button></li>))}</PagedRows></ul>}
      </Panel>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.item.title || ""} icon={open?.kind === "memo" ? Megaphone : FileText} size="lg"
        footer={open && open.item.requires_ack && !open.item.acked ? <Button onClick={ack}><CheckCircle2 /> I have read and accept</Button> : undefined}>
        {open && <div className="whitespace-pre-line text-sm leading-relaxed">{open.item.body || "-"}</div>}
      </Modal>
    </div>
  );
}

/* ───────────────────────────── Careers ───────────────────────────── */

function CareersTab({ me }: { me: Employee }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const [apply, setApply] = useState<{ job: any; note: string } | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ["my-careers", tenantId], queryFn: async () => {
    const [j, a] = await Promise.all([
      sb.from("app_records").select("*").eq("app", "recruitment").eq("kind", "job").eq("stage", "open").eq("archived", false).order("created_at", { ascending: false }),
      sb.from("app_records").select("parent_id, data").eq("app", "recruitment").eq("kind", "applicant"),
    ]);
    const mine = new Set((a.data || []).filter((x: any) => x.data?.employee_id === me.id).map((x: any) => x.parent_id));
    return (j.data || []).map((x: any) => ({ ...x, applied: mine.has(x.id) }));
  } });
  const send = async () => {
    const { error } = await sb.from("app_records").insert({ tenant_id: tenantId, app: "recruitment", kind: "applicant", title: fullName(me), parent_id: apply!.job.id, stage: "new", employee_id: me.id,
      data: { email: me.email, phone: me.phone, source: "Internal", employee_id: me.id, notes: apply!.note } });
    if (error) return toast({ title: "Not sent", description: error.message, variant: "destructive" });
    toast({ title: "Application sent", description: "HR will get back to you." }); setApply(null); qc.invalidateQueries({ queryKey: ["my-careers"] });
  };
  if (isLoading) return <OrbLoader label="Loading…" />;
  return (
    <div className="space-y-3">
      {(data as any[]).length === 0 ? <Panel><EmptyState icon={Briefcase} title="No open positions right now" /></Panel> : (
        <div className="grid gap-3 md:grid-cols-2"><PagedRows rows={(data as any[])} gridSpan>{(pageRows) => pageRows.map((j) => (
          <Panel key={j.id} title={j.title} icon={Briefcase} actions={j.applied ? <Pill tone="success">Applied</Pill> : <Button size="sm" onClick={() => setApply({ job: j, note: "" })}>Apply</Button>}>
            <p className="text-xs text-muted-foreground">{[j.data?.department, j.data?.location, j.data?.type].filter(Boolean).join(" · ")}</p>
            {j.data?.description && <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm">{j.data.description}</p>}
          </Panel>))}</PagedRows></div>
      )}
      <Modal open={!!apply} onClose={() => setApply(null)} title={apply ? `Apply: ${apply.job.title}` : ""} icon={Briefcase} footer={<Button onClick={send}><Send /> Send application</Button>}>
        {apply && <Field label="Why you are a good fit"><textarea className="fi min-h-[120px]" value={apply.note} onChange={(e) => setApply({ ...apply, note: e.target.value })} /></Field>}
      </Modal>
    </div>
  );
}

