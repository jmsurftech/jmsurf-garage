import { usePermissions } from "@/hooks/usePermissions";
import { useMemo, useState } from "react";
import Pager, { usePaged } from "@/components/Pager";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calculator, Lock, Plus, Download, Printer, CheckCircle2, Banknote, Trash2, FileSpreadsheet, Eye, Mail, Smartphone, MessageCircle, FileText, Check,
  RefreshCw, Users, UserPlus, UserMinus, Undo2, Pencil, Search, ListPlus, Landmark, BarChart3, FolderOpen,
} from "lucide-react";
import { useSelection, BulkBar, Tick } from "@/components/Bulk";
import { erpApi } from "@/lib/erpApi";
import { shareOnWhatsApp } from "@/lib/docSend";
import { useErpSettings } from "@/pages/settings/ErpSettingsTabs";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessSettings } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, TableWrap, Segmented, Pill } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";
import { formatKES } from "@/lib/format";
import { fmtDate } from "@/lib/doc-pdf";
import { saveFile } from "@/lib/erpApi";
import { cn } from "@/lib/utils";
import { printPayslips } from "./payslipPrint";
import { sb, useEmployees, useHrLookups, useHrSettings, fullName, csvOf, monthStart, monthEnd, ymd, type Employee } from "./hrData";
import { buildLine, eligibleStaff, loadRunInputs, periodLabel, refreshTotals, runTotals, type LineEdits } from "./payrollEngine";
import { RunDocuments } from "./PayrollDocsPanel";
import { p9Table, storeP9Docs, storePayslipDocs } from "./payrollDocs";
import { AddPerson, Adjustments, LineEditor, Payments, PayrollReports, ReportTable, WhoIsIn, money, printTable, type Rows } from "./PayrollParts";

type Tab = "lines" | "adjustments" | "payments" | "documents" | "returns" | "reports";
const r2 = (n: number) => Math.round(n * 100) / 100;
const STATUS_TONE: Record<string, "muted" | "info" | "success"> = { draft: "muted", approved: "info", paid: "success" };

/** Payroll shows pay: it needs "See salaries and bank details" (the database refuses payslips without it). */
export default function Payroll() {
  const { can } = usePermissions();
  if (!can("employees", "salary")) return <EmptyState icon={Lock} title="Payroll needs permission to see pay" description="Ask an admin to give your role “See salaries and bank details” under System → Users & Roles." />;
  return <PayrollInner />;
}

function PayrollInner() {
  const tenantId = useTenantId();
  const { user } = useAuth() as any;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: biz } = useBusinessSettings();
  const { data: emps = [] } = useEmployees();
  const { data: lk } = useHrLookups();
  const { rates, payroll: opts } = useHrSettings();
  const [runId, setRunId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("lines");
  const [year, setYear] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [period, setPeriod] = useState(ymd().slice(0, 7));
  const [payDate, setPayDate] = useState("");
  const [busy, setBusy] = useState("");
  const [slip, setSlip] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [who, setWho] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<{ title: string; name: string; rows: Rows } | null>(null);
  const [p9, setP9] = useState(false);
  const [sending, setSending] = useState("");
  const { settings: erpSet } = useErpSettings();
  const hrCfg = { auto_send_payslips: true, payslip_sms: true, ...(erpSet.hr || {}) };

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["hr-runs", tenantId], enabled: !!tenantId,
    queryFn: async () => (await sb.from("hr_payroll_runs").select("*").eq("tenant_id", tenantId).order("period", { ascending: false })).data || [],
  });
  const run = (runs as any[]).find((r) => r.id === runId) || null;
  const { data: slips = [] } = useQuery({
    queryKey: ["hr-slips", runId], enabled: !!runId,
    queryFn: async () => (await sb.from("hr_payslips").select("*").eq("run_id", runId).order("employee_name")).data || [],
  });
  const S = slips as any[];
  const shown = useMemo(() => S.filter((s) => !q.trim() || String(s.employee_name).toLowerCase().includes(q.trim().toLowerCase())), [S, q]);
  const pagedSlips = usePaged(shown, 25);
  const empById = useMemo(() => new Map(emps.map((e) => [e.id, e])), [emps]);
  const sel = useSelection(shown.map((x) => x.id));
  const years = [...new Set((runs as any[]).map((r) => String(r.period).slice(0, 4)))];
  const yearRuns = (runs as any[]).filter((r) => !year || String(r.period).startsWith(year));
  const draft = run?.status === "draft";
  const refresh = () => { qc.invalidateQueries({ queryKey: ["hr-runs"] }); qc.invalidateQueries({ queryKey: ["hr-slips"] }); };

  /** Email the full payslip and/or SMS the net pay (approved or paid runs only). */
  const sendSlips = async (ids: string[] | null, ch: { email: boolean; sms: boolean }, quiet = false) => {
    if (!run) return;
    setSending(ch.sms && !ch.email ? "sms" : "email");
    try {
      // Keep a copy of each payslip (Documents tab, My Space) before it goes out; sending does not wait on a failed copy.
      const toStore = ids?.length ? S.filter((x) => ids.includes(x.id)) : S;
      await storePayslipDocs(run, toStore, biz, empById).then(() => qc.invalidateQueries({ queryKey: ["hr-run-docs", run.id] }), () => {});
      const r: any = await erpApi("payslips/send", { run_id: run.id, payslip_ids: ids || [], ...ch });
      qc.invalidateQueries({ queryKey: ["hr-slips"] }); sel.clear();
      toast({ title: `Payslips sent: ${r.email || 0} by email, ${r.sms || 0} by SMS`, description: r.failed?.length ? r.failed.slice(0, 2).join(" · ") : r.skipped ? `${r.skipped} employee${r.skipped === 1 ? " has" : "s have"} no email or phone` : undefined });
    } catch (e: any) { if (!quiet) toast({ title: "Payslips not sent", description: e.message, variant: "destructive" }); }
    finally { setSending(""); }
  };
  const whatsappSlip = (s: any) => {
    const e = empById.get(s.employee_id) as Employee | undefined;
    shareOnWhatsApp(e?.phone || (e as any)?.mpesa_phone, `Hi ${e?.first_name || ""}, your ${run?.period} payslip from ${biz?.business_name || "us"}: gross KES ${money(s.gross)}, deductions KES ${money(Number(s.gross) - Number(s.net_pay))}, net pay KES ${money(s.net_pay)}.`);
  };

  /** Works out the lines for everyone in the run (minus those left out), keeping edits HR made to a line. */
  const computeLines = async (r: { id: string; period: string; excluded_employee_ids?: string[] }, keepEdits: Map<string, LineEdits>) => {
    const out = new Set(r.excluded_employee_ids || []);
    const staff = eligibleStaff(emps, r.period).filter((e) => !out.has(e.id));
    const inp = await loadRunInputs(staff.map((e) => e.id), r.period, r.id, lk);
    return staff.map((e) => ({ ...buildLine(e, inp, rates, opts, keepEdits.get(e.id) || null).row, tenant_id: tenantId, run_id: r.id }));
  };

  /** Builds every current employee's payslip for the month from pay items, loans, attendance and unpaid leave. */
  const generate = async () => {
    if ((runs as any[]).some((r) => r.period === period)) return toast({ title: `Payroll for ${period} already exists`, description: "Open it and use Re-compute, or delete the draft to start again.", variant: "destructive" });
    if (!eligibleStaff(emps, period).length) return toast({ title: "Add employees first (HRM → Employees)", variant: "destructive" });
    setBusy("new");
    try {
      const from = monthStart(period), to = monthEnd(period);
      const { data: newRun, error: rErr } = await sb.from("hr_payroll_runs").insert({ tenant_id: tenantId, period, period_start: from, period_end: to, pay_date: payDate || to, status: "draft", created_by: user?.id, computed_by: user?.id, computed_at: new Date().toISOString() }).select("*").single();
      if (rErr) throw rErr;
      const rows = await computeLines(newRun, new Map());
      const { error } = await sb.from("hr_payslips").insert(rows);
      if (error) { await sb.from("hr_payroll_runs").delete().eq("id", newRun.id); throw error; }
      await sb.from("hr_payroll_runs").update({ totals: runTotals(rows) }).eq("id", newRun.id);
      refresh(); setNewOpen(false); setRunId(newRun.id); setTab("lines");
      toast({ title: `Payroll for ${period} prepared`, description: `${rows.length} payslips. Check them, then approve.` });
    } catch (e: any) { toast({ title: "Payroll not prepared", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  };

  const recompute = async (fresh?: any) => {
    const r = fresh || run;
    if (!r || r.status !== "draft") return;
    setBusy("compute");
    try {
      const keep = new Map<string, LineEdits>(S.filter((s) => s.data?.edits).map((s) => [s.employee_id, s.data.edits]));
      const rows = await computeLines(r, keep);
      const del = await sb.from("hr_payslips").delete().eq("run_id", r.id);
      if (del.error) throw del.error;
      if (rows.length) { const { error } = await sb.from("hr_payslips").insert(rows); if (error) throw error; }
      await sb.from("hr_payroll_runs").update({ totals: runTotals(rows), computed_by: user?.id, computed_at: new Date().toISOString() }).eq("id", r.id);
      refresh();
      toast({ title: `${rows.length} line${rows.length === 1 ? "" : "s"} worked out`, description: keep.size ? `${keep.size} edited line${keep.size === 1 ? "" : "s"} kept their edits.` : undefined });
    } catch (e: any) { toast({ title: "Not re-computed", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  };

  const approve = async () => {
    if (!run) return;
    if (opts.two_step && (run.computed_by || run.created_by) === user?.id) return toast({ title: "Someone else must approve", description: "Two-step approval is on: the person who prepared this payroll cannot approve it.", variant: "destructive" });
    const zero = S.filter((s) => Number(s.net_pay) <= 0).map((s) => s.employee_name);
    if (!(await confirmAction({ title: `Approve payroll for ${periodLabel(run.period)}?`, message: `${zero.length ? `${zero.join(", ")} get no pay. ` : ""}${S.length} people · net ${formatKES(Number(run.totals?.net || 0))}. Lines are locked, loan and advance balances are reduced and the salary journal is posted.` }))) return;
    setBusy("approve");
    const { error } = await sb.rpc("hr_payroll_approve", { p_run: run.id });
    setBusy("");
    if (error) return toast({ title: "Not approved", description: error.message, variant: "destructive" });
    refresh(); qc.invalidateQueries({ queryKey: ["hr-loans"] });
    toast({ title: "Payroll approved", description: hrCfg.auto_send_payslips ? "Sending payslips to staff…" : undefined });
    if (hrCfg.auto_send_payslips) void sendSlips(null, { email: true, sms: !!hrCfg.payslip_sms }, true);
    else void storePayslipDocs(run, S, biz, empById).then(() => qc.invalidateQueries({ queryKey: ["hr-run-docs", run.id] }), () => {});
  };
  const reopen = async () => {
    if (!run) return;
    if (!(await confirmAction({ title: "Send back to draft?", message: "The salary journal is reversed and loan instalments go back on the balances. You can then change lines and re-compute." }))) return;
    setBusy("reopen");
    const { error } = await sb.rpc("hr_payroll_reopen", { p_run: run.id });
    setBusy("");
    if (error) return toast({ title: "Not sent back", description: error.message, variant: "destructive" });
    refresh(); qc.invalidateQueries({ queryKey: ["hr-loans"] }); toast({ title: "Back in draft" });
  };
  const markPaid = async () => {
    if (!run) return;
    const unpaid = S.filter((s) => s.pay_status !== "paid").length;
    if (!(await confirmAction({ title: `Mark ${periodLabel(run.period)} as paid?`, message: unpaid ? `${unpaid} line${unpaid === 1 ? " is" : "s are"} not marked paid yet; they are marked paid now. The salary payment is posted.` : "The salary payment is posted." }))) return;
    const now = new Date().toISOString();
    await sb.from("hr_payslips").update({ pay_status: "paid", paid_at: now }).eq("run_id", run.id).neq("pay_status", "paid");
    await sb.from("hr_payroll_runs").update({ status: "paid", paid_at: now }).eq("id", run.id);
    // The month's salaries also go into Expenses so profit reports include them.
    await sb.from("expenses").insert({ tenant_id: tenantId, amount: Number(run.totals?.net || 0) + Number(run.totals?.paye || 0) + Number(run.totals?.nssf || 0) * 2 + Number(run.totals?.shif || 0) + Number(run.totals?.housing || 0) * 2 + Number(run.totals?.nita || 0), category_name: "Salaries & wages", description: `Payroll ${run.period} (net pay, PAYE, NSSF, SHIF, Housing Levy, NITA)`, expense_date: run.pay_date || ymd() }).then(() => {}, () => {});
    refresh();
    toast({ title: "Marked as paid", description: "Salaries were added to Expenses." });
  };
  const remove = async () => {
    if (!run || run.status !== "draft") return;
    if (!(await confirmAction({ title: `Delete the ${run.period} draft?`, danger: true, confirmLabel: "Delete" }))) return;
    const { error } = await sb.from("hr_payroll_runs").delete().eq("id", run.id);
    if (error) return toast({ title: "Not deleted", description: error.message, variant: "destructive" });
    setRunId(null); refresh();
  };
  const leaveOut = async (ids: string[]) => {
    if (!run) return;
    const lines = S.filter((s) => ids.includes(s.id));
    if (!lines.length || !(await confirmAction({ title: `Leave ${lines.length} ${lines.length === 1 ? "person" : "people"} out of this payroll?`, message: "They stay out when you re-compute. Use Who is in to bring them back.", danger: true, confirmLabel: "Leave out" }))) return;
    const { error } = await sb.from("hr_payslips").delete().in("id", lines.map((s) => s.id));
    if (error) return toast({ title: "Not removed", description: error.message, variant: "destructive" });
    await sb.from("hr_payroll_runs").update({ excluded_employee_ids: [...new Set([...(run.excluded_employee_ids || []), ...lines.map((s) => s.employee_id)])] }).eq("id", run.id);
    await refreshTotals(run.id);
    sel.clear(); refresh(); toast({ title: "Left out" });
  };

  const exports = (kind: "summary" | "p10" | "nssf" | "scheme" | "shif" | "housing" | "register" | "helb"): [string, string, Rows] | null => {
    if (!run) return null;
    const e = (id: string) => empById.get(id) as Employee | undefined;
    // Contracted-out Tier II goes to the private scheme, not NSSF (lines from before the split have none).
    const sch = (s: any) => Number(s.data?.nssf_scheme || 0), erSch = (s: any) => Number(s.data?.employer_nssf_scheme || 0);
    const t2 = (s: any) => r2(Number(s.data?.nssf_tier2 ?? Number(s.nssf) - Number(s.data?.nssf_tier1 || 0)) - sch(s));
    const allowSum = (s: any) => (s.data?.allowances || []).reduce((x: number, a: any) => x + Number(a.amount || 0), 0);
    const files: Record<string, [string, string, Rows]> = {
      summary: ["Payroll summary", `payroll-${run.period}.csv`, [["Employee", "Basic", "Gross", "NSSF", "SHIF", "Housing Levy", "Taxable pay", "PAYE", "Loans", "Other deductions", "Net pay"], ...S.map((s) => [s.employee_name, s.basic, s.gross, s.nssf, s.shif, s.housing_levy, s.taxable_pay, s.paye, s.loan_deductions, s.other_deductions, s.net_pay])]],
      p10: ["KRA P10 (PAYE) return", `P10-${run.period}.csv`, [["PIN of employee", "Name of employee", "Residential status", "Type of employee", "Basic salary", "Housing allowance", "Other allowances", "Non-cash benefits", "Gross pay", "NSSF", "Pension", "PRMF", "Mortgage interest", "SHIF", "Housing Levy", "Taxable pay", "Tax charged", "Personal relief", "Insurance relief", "PAYE tax"],
        ...S.map((s) => [e(s.employee_id)?.kra_pin, s.employee_name, "Resident", "Primary Employee", s.basic, s.data?.allowances?.find((a: any) => a.name === "House allowance")?.amount || 0, (s.data?.allowances || []).filter((a: any) => a.name !== "House allowance").reduce((x: number, a: any) => x + a.amount, 0) + Number(s.data?.overtime || 0), Number(s.data?.benefits_taxed || 0), s.gross, s.nssf, Number(s.data?.pension || 0), Number(s.data?.prmf || 0), Number(s.data?.mortgage || 0), s.shif, s.housing_levy, s.taxable_pay, s.data?.tax_before_relief, s.data?.personal_relief, s.data?.insurance_relief, s.paye])]],
      nssf: ["NSSF contributions", `NSSF-${run.period}.csv`, [["Payroll number", "Surname", "Other names", "ID number", "KRA PIN", "NSSF number", "Gross pay", "Tier I employee", "Tier II employee", "Employer", "Total"], ...S.map((s) => [e(s.employee_id)?.employee_no, e(s.employee_id)?.last_name, `${e(s.employee_id)?.first_name || ""} ${e(s.employee_id)?.other_names || ""}`.trim(), e(s.employee_id)?.national_id, e(s.employee_id)?.kra_pin, e(s.employee_id)?.nssf_no, s.gross, s.data?.nssf_tier1 ?? s.nssf, t2(s), r2(Number(s.employer_nssf) - erSch(s)), r2(Number(s.nssf) - sch(s) + Number(s.employer_nssf) - erSch(s))])]],
      scheme: ["Pension scheme (NSSF Tier II contracted out)", `pension-scheme-${run.period}.csv`, [["Scheme", "Payroll number", "Employee", "ID number", "KRA PIN", "Share of Tier II", "Employee", "Employer", "Total"], ...S.filter((s) => sch(s) + erSch(s) > 0).map((s) => [s.data?.nssf_scheme_name, e(s.employee_id)?.employee_no, s.employee_name, e(s.employee_id)?.national_id, e(s.employee_id)?.kra_pin, `${Number(s.data?.nssf_scheme_pct ?? 100)}%`, sch(s), erSch(s), r2(sch(s) + erSch(s))])]],
      shif: ["SHIF contributions", `SHIF-${run.period}.csv`, [["Payroll number", "First name", "Last name", "ID number", "KRA PIN", "SHA number", "Phone", "Gross pay", "SHIF"], ...S.map((s) => [e(s.employee_id)?.employee_no, e(s.employee_id)?.first_name, e(s.employee_id)?.last_name, e(s.employee_id)?.national_id, e(s.employee_id)?.kra_pin, e(s.employee_id)?.shif_no, e(s.employee_id)?.phone, s.gross, s.shif])]],
      housing: ["Housing Levy return", `Housing-Levy-${run.period}.csv`, [["ID number", "Name", "KRA PIN", "Gross pay", "Employee levy", "Employer levy", "Total"], ...S.map((s) => [e(s.employee_id)?.national_id, s.employee_name, e(s.employee_id)?.kra_pin, s.gross, s.housing_levy, s.employer_housing, Number(s.housing_levy) + Number(s.employer_housing)])]],
      helb: ["HELB deductions", `HELB-${run.period}.csv`, [["ID number", "Name", "Payroll number", "HELB"], ...S.filter((s) => Number(s.data?.helb || 0) > 0).map((s) => [e(s.employee_id)?.national_id, s.employee_name, e(s.employee_id)?.employee_no, Number(s.data?.helb || 0)])]],
      register: ["Payroll register", `payroll-register-${run.period}.csv`, [["Employee", "Staff no", "Department", "Basic", "Allowances", "Overtime", "Unpaid days", "Gross", "Non-cash benefits", "NSSF", "SHIF", "Housing Levy", "Pension", "PRMF", "Insurance", "HELB", "Taxable", "PAYE", "Loans", "Other deductions", "Net", "Paid by", "Payment", "Reference"],
        ...S.map((s) => [s.employee_name, e(s.employee_id)?.employee_no, (lk?.departments || []).find((d) => d.id === e(s.employee_id)?.department_id)?.name, s.basic, allowSum(s), Number(s.data?.overtime || 0), Number(s.data?.unpaid_leave || 0), s.gross, Number(s.data?.benefits_noncash || 0), s.nssf, s.shif, s.housing_levy, Number(s.data?.pension || 0), Number(s.data?.prmf || 0), Number(s.data?.insurance || 0), Number(s.data?.helb || 0), s.taxable_pay, s.paye, s.loan_deductions, (s.data?.other_deductions || []).reduce((x: number, d: any) => x + Number(d.amount || 0), 0), s.net_pay, e(s.employee_id)?.payment_method, s.pay_status || "pending", s.pay_reference])]],
    };
    return files[kind];
  };
  const show = (kind: Parameters<typeof exports>[0]) => { const f = exports(kind); if (f) setPreview({ title: `${f[0]} · ${run?.period}`, name: f[1], rows: f[2] }); };
  /** Every return and the register in one Excel file, one sheet each. */
  const workbook = async () => {
    if (!run) return;
    setBusy("xlsx");
    try {
      const XLSX = await import("@e965/xlsx");
      const wb = XLSX.utils.book_new();
      for (const [k, sheet] of [["register", "Register"], ["p10", "P10 PAYE"], ["nssf", "NSSF"], ["scheme", "Pension scheme"], ["shif", "SHIF"], ["housing", "Housing Levy"], ["helb", "HELB"]] as const) {
        const f = exports(k); if (f) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(f[2]), sheet);
      }
      XLSX.writeFile(wb, `payroll-returns-${run.period}.xlsx`);
    } catch (e: any) { toast({ title: "File not made", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  };

  const printSlips = (only?: any) => printPayslips(only ? [only] : S, run?.period, biz, empById);

  if (isLoading) return <OrbLoader label="Loading payroll…" />;
  const t = run?.totals || {};
  const inRun = new Set(S.map((s) => s.employee_id));
  const paidCount = S.filter((s) => s.pay_status === "paid").length;
  const RETURNS: { k: Parameters<typeof exports>[0]; l: string; d: string }[] = [
    { k: "p10", l: "P10 · PAYE (KRA iTax)", d: `PAYE ${formatKES(Number(t.paye || 0))} · due by the 9th` },
    { k: "nssf", l: "NSSF return", d: `${formatKES(Number(t.nssf || 0) + Number(t.employer_nssf || t.nssf || 0) - Number(t.nssf_scheme || 0))} employee + employer · due by the 9th` },
    ...(Number(t.nssf_scheme || 0) > 0 ? [{ k: "scheme" as const, l: "Pension scheme (Tier II)", d: `${formatKES(Number(t.nssf_scheme))} employee + employer, sent to the private scheme instead of NSSF` }] : []),
    { k: "shif", l: "SHIF return", d: `${formatKES(Number(t.shif || 0))} · due by the 9th` },
    { k: "housing", l: "Housing Levy return", d: `${formatKES(Number(t.housing || 0) + Number(t.employer_housing || t.housing || 0))} employee + employer · due by the 9th` },
    { k: "helb", l: "HELB deductions", d: `${S.filter((s) => Number(s.data?.helb || 0) > 0).length} people` },
    { k: "register", l: "Payroll register", d: "Every line with all earnings and deductions" },
    { k: "summary", l: "Payroll summary", d: "One line per person: gross, deductions and net" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Payroll" icon={Calculator} description="Monthly payroll with PAYE, NSSF, SHIF, Housing Levy and NITA worked out for you."
        actions={<Button onClick={() => setNewOpen(true)}><Plus /> Run payroll</Button>} />
      {years.length > 1 && <Segmented value={year} onChange={setYear} options={[{ value: "", label: "All years" }, ...years.map((y) => ({ value: y, label: y }))]} />}
      <div className="flex flex-wrap gap-2 pb-1">
        {yearRuns.map((r) => (
          <button key={r.id} onClick={() => { setRunId(r.id); setQ(""); }} className={cn("shrink-0 rounded-2xl border px-4 py-2.5 text-left", runId === r.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40")}>
            <span className="block font-display font-bold">{periodLabel(r.period)}</span>
            <span className="block text-xs capitalize text-muted-foreground">{r.status} · {formatKES(Number(r.totals?.net || 0))} net</span>
          </button>
        ))}
      </div>
      {!run ? <Panel><EmptyState icon={Calculator} title={(runs as any[]).length ? "Pick a month above" : "No payroll yet"} description="Run a month's payroll: payslips from salary, pay items, loans, overtime and unpaid days." action={<Button onClick={() => setNewOpen(true)}><Plus /> Run payroll</Button>} /></Panel> : <>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 font-display text-lg font-bold">Payroll {periodLabel(run.period)} <Pill tone={STATUS_TONE[run.status] || "muted"} className="capitalize">{run.status}</Pill></h2>
            <p className="text-xs text-muted-foreground">
              {S.length} {S.length === 1 ? "person" : "people"}{run.pay_date ? ` · pay date ${fmtDate(run.pay_date)}` : ""}{run.computed_at ? ` · worked out ${fmtDate(run.computed_at)}` : ""}{run.approved_at ? ` · approved ${fmtDate(run.approved_at)}` : ""}{run.paid_at ? ` · paid ${fmtDate(run.paid_at)}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {draft && <Button variant="outline" onClick={() => setAddOpen(true)} disabled={!!busy}><UserPlus /> Add person</Button>}
            {draft && <Button variant="outline" onClick={() => setWho(true)} disabled={!!busy}><Users /> Who is in</Button>}
            {draft && <Button variant="outline" onClick={() => recompute()} disabled={!!busy}>{busy === "compute" ? <OrbSpinner /> : <RefreshCw />} Re-compute</Button>}
            {draft && S.length > 0 && <Button onClick={approve} disabled={!!busy}>{busy === "approve" ? <OrbSpinner /> : <CheckCircle2 />} Approve</Button>}
            {run.status === "approved" && <Button onClick={markPaid} disabled={!!busy}><Banknote /> Mark as paid</Button>}
            {run.status === "approved" && <Button variant="outline" onClick={reopen} disabled={!!busy}>{busy === "reopen" ? <OrbSpinner /> : <Undo2 />} Back to draft</Button>}
            <Button variant="outline" onClick={() => printSlips()}><Printer /> Print payslips</Button>
            {!draft && <Button variant="outline" onClick={() => sendSlips(null, { email: true, sms: !!hrCfg.payslip_sms })} disabled={!!sending}>{sending ? <OrbSpinner /> : <Mail />} Send all payslips</Button>}
            {draft && <Button variant="ghost" className="text-destructive" onClick={remove}><Trash2 /> Delete draft</Button>}
          </div>
        </div>
        <StatGrid>
          <StatTile label="Gross pay" value={formatKES(Number(t.gross || 0))} icon={Banknote} tone="primary" hint={`${S.length} employees`} />
          <StatTile label="PAYE to KRA" value={formatKES(Number(t.paye || 0))} icon={Calculator} tone="danger" hint="Due by the 9th" />
          <StatTile label="Net pay" value={formatKES(Number(t.net || 0))} icon={Banknote} tone="success" hint={run.status === "draft" ? undefined : `${paidCount} of ${S.length} paid`} />
          <StatTile label="Total employer cost" value={formatKES(Number(t.employer_cost || 0))} icon={Banknote} tone="muted" hint={`NSSF ${formatKES(Number(t.nssf || 0) + Number(t.employer_nssf || t.nssf || 0))} · SHIF ${formatKES(Number(t.shif || 0))} · Levy ${formatKES(Number(t.housing || 0) + Number(t.employer_housing || t.housing || 0))}`} />
        </StatGrid>
        {(run.excluded_employee_ids?.length || 0) > 0 && <p className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm"><UserMinus className="h-4 w-4" /> <b>{run.excluded_employee_ids.length}</b> left out of this payroll.{draft && <Button size="sm" variant="outline" onClick={() => setWho(true)}>Change who is in</Button>}</p>}
        {draft && opts.two_step && <p className="rounded-xl bg-info/10 px-3 py-2 text-sm">Two-step approval is on: someone other than the person who prepared this payroll approves it.</p>}
        <div className="overflow-x-auto">
          <Segmented<Tab> value={tab} onChange={setTab} options={[
            { value: "lines", label: <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4" /> Employees</span>, count: S.length },
            { value: "adjustments", label: <span className="inline-flex items-center gap-1.5"><ListPlus className="h-4 w-4" /> Adjustments</span> },
            { value: "payments", label: <span className="inline-flex items-center gap-1.5"><Banknote className="h-4 w-4" /> Payments</span> },
            { value: "documents", label: <span className="inline-flex items-center gap-1.5"><FolderOpen className="h-4 w-4" /> Documents</span> },
            { value: "returns", label: <span className="inline-flex items-center gap-1.5"><Landmark className="h-4 w-4" /> Returns</span> },
            { value: "reports", label: <span className="inline-flex items-center gap-1.5"><BarChart3 className="h-4 w-4" /> Reports</span> },
          ]} />
        </div>

        {tab === "lines" && <Panel flush title={`Payslips · ${run.period}`} icon={Calculator} description={draft ? "Draft: check, edit a line if needed, then approve." : `Locked. ${run.approved_at ? `Approved ${fmtDate(run.approved_at)}.` : ""}`}
          actions={<div className="relative w-full sm:w-56"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi h-9 pl-9" placeholder="Find an employee" value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
          <BulkBar sel={sel} noun="payslip">
            {draft ? <>
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => leaveOut(sel.ids)}><UserMinus /> Leave out</Button>
            </> : <>
              <Button size="sm" variant="outline" onClick={() => sendSlips(sel.ids, { email: true, sms: false })} disabled={!!sending}><Mail /> Email payslips</Button>
              <Button size="sm" variant="outline" onClick={() => sendSlips(sel.ids, { email: false, sms: true })} disabled={!!sending}><Smartphone /> SMS net pay</Button>
            </>}
            <Button size="sm" variant="outline" onClick={() => printPayslips(S.filter((x) => sel.has(x.id)), run.period, biz, empById)}><Printer /> Print</Button>
            <Button size="sm" variant="outline" onClick={() => saveFile(`payroll-${run.period}-selected.csv`, csvOf([["Employee", "Basic", "Gross", "PAYE", "NSSF", "SHIF", "Housing Levy", "Net pay"], ...S.filter((x) => sel.has(x.id)).map((s) => [s.employee_name, s.basic, s.gross, s.paye, s.nssf, s.shif, s.housing_levy, s.net_pay])]), "text/csv")}><Download /> Export</Button>
          </BulkBar>
          {S.length === 0 ? <EmptyState icon={Calculator} title="Nobody in this payroll" description={draft ? "Use Who is in or Add person, then Re-compute." : undefined} /> : <>
            <TableWrap><table className="dt">
              <thead><tr><th className="w-10"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} /></th><th>Employee</th><th className="num">Gross</th><th className="num hidden md:table-cell">NSSF</th><th className="num hidden md:table-cell">SHIF</th><th className="num hidden md:table-cell">Housing</th><th className="num">PAYE</th><th className="num hidden lg:table-cell">Loans/other</th><th className="num">Net pay</th><th /></tr></thead>
              <tbody>{pagedSlips.rows.map((s) => (
                <tr key={s.id} className={cn(sel.has(s.id) && "bg-primary/5")}><td data-label=""><Tick on={sel.has(s.id)} onChange={() => sel.toggle(s.id)} /></td>
                  <td className="font-medium">{s.employee_name}
                    <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] font-normal">
                      {s.data?.prorate_mode === "prorate" && <span className="text-warning">Paid {s.data.prorate_days}/{s.data.prorate_days_period} days</span>}
                      {s.data?.prorate_mode === "fixed" && <span className="text-warning">Fixed basic</span>}
                      {s.data?.edits && <span className="text-info">Edited</span>}
                      {s.pay_status === "paid" && <span className="text-success">Paid</span>}
                      {s.pay_status === "failed" && <span className="text-destructive">Payment failed</span>}
                      {(s.sent_email_at || s.sent_sms_at) && <span className="flex items-center gap-1 text-success"><Check className="h-3 w-3" /> Sent{s.sent_email_at ? " by email" : ""}{s.sent_sms_at ? `${s.sent_email_at ? " +" : " by"} SMS` : ""}</span>}
                    </span></td>
                  <td className="num">{money(s.gross)}</td><td className="num hidden md:table-cell">{money(s.nssf)}</td><td className="num hidden md:table-cell">{money(s.shif)}</td><td className="num hidden md:table-cell">{money(s.housing_levy)}</td><td className="num">{money(s.paye)}</td><td className="num hidden lg:table-cell">{money(Number(s.loan_deductions) + Number(s.other_deductions))}</td><td className="num font-semibold">{money(s.net_pay)}</td>
                  <td><span className="flex gap-1">
                    {draft && empById.get(s.employee_id) && <button className="icon-btn" onClick={() => setEdit(s)} aria-label="Edit line" title="Edit line"><Pencil className="h-4 w-4" /></button>}
                    <button className="icon-btn" onClick={() => setSlip(s)} aria-label="View"><Eye className="h-4 w-4" /></button>
                    <button className="icon-btn" onClick={() => printSlips(s)} aria-label="Print"><Printer className="h-4 w-4" /></button>
                    {!draft && <button className="icon-btn" title="Email this payslip" onClick={() => sendSlips([s.id], { email: true, sms: false })}><Mail className="h-4 w-4" /></button>}
                    <button className="icon-btn" title="WhatsApp" onClick={() => whatsappSlip(s)}><MessageCircle className="h-4 w-4" /></button>
                  </span></td></tr>
              ))}</tbody>
              <tfoot><tr><td /><td>Total</td><td className="num">{money(t.gross)}</td><td className="num hidden md:table-cell">{money(t.nssf)}</td><td className="num hidden md:table-cell">{money(t.shif)}</td><td className="num hidden md:table-cell">{money(t.housing)}</td><td className="num">{money(t.paye)}</td><td className="num hidden lg:table-cell" /><td className="num">{money(t.net)}</td><td /></tr></tfoot>
            </table></TableWrap>
            <Pager {...pagedSlips.pager} />
          </>}
        </Panel>}

        {tab === "adjustments" && <Adjustments run={run} emps={emps} onRecompute={() => recompute()} />}
        {tab === "payments" && <Payments run={run} slips={S} empById={empById} onChanged={refresh} onSend={(ids, ch) => sendSlips(ids, ch)} onPreview={(title, name, rows) => setPreview({ title, name, rows })} />}
        {tab === "documents" && <RunDocuments run={run} slips={S} biz={biz} empById={empById} />}
        {tab === "returns" && <Panel title="Statutory returns and exports" icon={Landmark} description="Files for KRA, NSSF, SHA and the Housing Levy, plus the full payroll register. Check each one before you upload it."
          actions={<div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={workbook} disabled={busy === "xlsx" || !S.length}>{busy === "xlsx" ? <OrbSpinner /> : <FileSpreadsheet />} All in one Excel file</Button>
            <Button size="sm" variant="outline" onClick={() => setP9(true)}><FileText /> P9 forms</Button>
          </div>}>
          {!S.length ? <EmptyState icon={Landmark} title="Nothing to file yet" /> : (
            <div className="grid gap-3 md:grid-cols-2">
              {RETURNS.map((x) => (
                <button key={x.k} type="button" onClick={() => show(x.k)} className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition hover:border-primary/40">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><FileSpreadsheet className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold group-hover:text-primary">{x.l}</span><span className="block break-words text-xs text-muted-foreground">{x.d}</span></span>
                  <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </Panel>}
        {tab === "reports" && <PayrollReports run={run} slips={S} runs={runs as any[]} empById={empById} onPreview={(title, name, rows) => setPreview({ title, name, rows })} />}
      </>}

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Run payroll" icon={Calculator} locked={busy === "new"} footer={<Button onClick={generate} disabled={busy === "new"}>{busy === "new" && <OrbSpinner />} Prepare payslips</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Month"><input className="fi" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
          <Field label="Pay date" hint="Empty: the last day of the month"><input className="fi" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Uses each employee's basic salary and house allowance, active pay items, loan and advance instalments, overtime from Attendance, absences and unpaid leave, and pro-rates anyone who joined or left in the month ({opts.prorate_basis === "calendar" ? "calendar days" : "working days"}). After preparing, you can add one-off adjustments, edit a line, or leave people out.</p>
      </Modal>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.title} icon={FileSpreadsheet} size="2xl" description="Check the figures, then download the file or print it."
        footer={<><Button onClick={() => preview && saveFile(preview.name, csvOf(preview.rows), "text/csv")}><Download /> Download {preview?.name}</Button><Button variant="outline" onClick={() => preview && printTable(preview.title, preview.rows, biz?.business_name)}><Printer /> Print</Button></>}>
        {preview && <ReportTable rows={preview.rows} />}
      </Modal>
      {p9 && <P9Sheet emps={emps} biz={biz} onClose={() => setP9(false)} />}
      {edit && run && empById.get(edit.employee_id) && <LineEditor run={run} slip={edit} emp={empById.get(edit.employee_id)!} onClose={() => setEdit(null)} onSaved={refresh} />}
      {who && run && <WhoIsIn run={run} emps={emps} onClose={() => setWho(false)} onSaved={async () => { setWho(false); const { data } = await sb.from("hr_payroll_runs").select("*").eq("id", run.id).single(); await recompute(data); }} />}
      {addOpen && run && <AddPerson run={run} emps={emps} inRun={inRun} onClose={() => setAddOpen(false)} onAdded={refresh} />}
      <Modal open={!!slip} onClose={() => setSlip(null)} title={slip?.employee_name} description={run?.period} size="md">
        {slip && <table className="w-full text-sm"><tbody>{([["Basic", slip.basic], ...(slip.data?.allowances || []).map((a: any) => [a.name, a.amount]), ["Overtime", slip.data?.overtime || 0], ["Unpaid days", -(slip.data?.unpaid_leave || 0)], ["Gross", slip.gross], ["Non-cash benefits (not paid)", slip.data?.benefits_noncash || 0], ["NSSF", -slip.nssf], [`of which to ${slip.data?.nssf_scheme_name || "pension scheme"}`, slip.data?.nssf_scheme || 0], ["SHIF", -slip.shif], ["Housing Levy", -slip.housing_levy], ["Taxable pay", slip.taxable_pay], ["PAYE", -slip.paye], ["Loans", -slip.loan_deductions], ["Other", -slip.other_deductions], ["Rounding", slip.data?.net_rounding || 0], ["Net pay", slip.net_pay]] as [string, number][]).filter(([, v]) => Number(v) !== 0).map(([l, v]) => (
          <tr key={l} className={cn(["Gross", "Net pay"].includes(l) && "font-bold")}><td className="py-1">{l}</td><td className="py-1 text-right tabular-nums">{money(v)}</td></tr>
        ))}</tbody></table>}
      </Modal>
    </div>
  );
}

/** KRA P9A (tax deduction card) for one employee and year, built from that year's payslips. */
function P9Sheet({ emps, biz, onClose }: { emps: Employee[]; biz: any; onClose: () => void }) {
  const tenantId = useTenantId();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [empId, setEmpId] = useState(emps[0]?.id || "");
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ["p9", tenantId, year, empId], enabled: !!tenantId && !!empId,
    queryFn: async () => (await sb.from("hr_payslips").select("*, hr_payroll_runs!inner(period,status)").eq("employee_id", empId).like("hr_payroll_runs.period", `${year}-%`).neq("hr_payroll_runs.status", "draft")).data || [],
  });
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const emp = emps.find((e) => e.id === empId);
  const table: Rows = p9Table(year, rows as any[]);
  /** Every employee paid in the year: build, store and email their P9. */
  const yearly = async () => {
    if (!tenantId) return;
    if (!(await confirmAction({ title: `Make and email the P9 of everyone paid in ${year}?`, message: "Each P9 is made from the person's approved payslips for the year, kept with their documents (they see it in My Space) and emailed to those with an email address." }))) return;
    setBusy(true);
    try {
      const r = await storeP9Docs(tenantId, year, emps, biz);
      if (!r.done.length) { toast({ title: `No P9s for ${year}`, description: r.failed[0] || "Nobody has approved payslips that year.", variant: "destructive" }); return; }
      const sent: any = await erpApi("payroll-docs/send", { document_ids: r.done.map((d) => d.id) }).catch((e: any) => ({ email: 0, failed: [e.message] }));
      toast({ title: `${r.done.length} P9${r.done.length === 1 ? "" : "s"} stored, ${sent.email || 0} emailed`, description: [...r.failed, ...(sent.failed || [])].slice(0, 2).join(" · ") || (sent.skipped ? `${sent.skipped} without an email address` : undefined) });
    } catch (e: any) { toast({ title: "P9s not made", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="P9 tax deduction card" icon={FileText} size="2xl" description="KRA P9A for the year, from the approved payslips. Give it to the employee for their iTax return."
      locked={busy} footer={<><Button variant="outline" onClick={yearly} disabled={busy}>{busy ? <OrbSpinner /> : <Mail />} Store and email everyone's P9 for {year}</Button><Button onClick={() => printTable(`P9A ${year} · ${fullName(emp)} · PIN ${emp?.kra_pin || "—"} · Employer PIN ${biz?.tax_pin || "—"}`, table, biz?.business_name)}><Printer /> Print P9</Button><Button variant="outline" onClick={() => saveFile(`P9-${year}-${fullName(emp).replace(/\s+/g, "-")}.csv`, csvOf(table), "text/csv")}><Download /> Download</Button></>}>
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="fi w-full sm:w-56" value={empId} onChange={(e) => setEmpId(e.target.value)}>{emps.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}</select>
        <select className="fi w-28" value={year} onChange={(e) => setYear(e.target.value)}>{[0, 1, 2, 3].map((n) => String(new Date().getFullYear() - n)).map((y) => <option key={y}>{y}</option>)}</select>
        {isFetching && <OrbSpinner className="h-5 w-5" />}
      </div>
      <p className="mb-2 text-sm"><b>{fullName(emp)}</b> · KRA PIN {emp?.kra_pin || "—"} · Employer {biz?.business_name} (PIN {biz?.tax_pin || "—"})</p>
      <ReportTable rows={table} />
    </Modal>
  );
}
