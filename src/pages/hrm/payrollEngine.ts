/**
 * Builds payroll lines (hr_payslips rows) from an employee's salary, pay items,
 * loans, attendance, unpaid leave, this run's one-off adjustments and any edits
 * HR made to the line. Prepare, Re-compute, Add person and Edit line all use it,
 * so a line always works out the same way.
 */
import { computePayslip, workingDays, type Payslip, type PayrollRates } from "@/lib/kenyaPayroll";
import { sb, fullName, monthStart, monthEnd, type Employee, type PayrollOptions } from "./hrData";

export type ProrateMode = "auto" | "full" | "prorate" | "fixed";
export type AdjKind = "earning" | "nontaxable" | "benefit" | "deduction";
export const ADJ_KINDS: Record<AdjKind, string> = {
  earning: "Earning (taxed)",
  nontaxable: "Reimbursement (not taxed)",
  benefit: "Non-cash benefit",
  deduction: "Deduction",
};

/** What HR changed on one line; kept on the line so a re-compute keeps it. */
export type LineEdits = {
  mode?: ProrateMode;
  days?: number | null;
  days_period?: number | null;
  fixed?: number | null;
  overtime_hours?: number | null;
  unpaid_days?: number | null;
  allowances?: { name: string; amount: number; taxable: boolean }[] | null;
  deductions?: { name: string; amount: number }[] | null;
  edited_by?: string | null;
  edited_at?: string | null;
};

export type Adjustment = { id: string; run_id: string; employee_id: string; kind: AdjKind; name: string; amount: number };

export type RunInputs = {
  period: string;
  items: any[];
  loans: any[];
  att: any[];
  leave: any[];
  adjustments: Adjustment[];
  unpaidTypes: Set<string>;
  holidays: Set<string>;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Calendar days between two dates, both included. */
export function calendarDays(from: string, to: string) {
  const a = new Date(`${from}T00:00:00Z`).getTime(), b = new Date(`${to}T00:00:00Z`).getTime();
  return b < a ? 0 : Math.round((b - a) / 86_400_000) + 1;
}

/** Everyone a run can include: current staff, plus anyone who left during the month. */
export function eligibleStaff(emps: Employee[], period: string) {
  const from = monthStart(period), to = monthEnd(period);
  return emps.filter((e) => (e.hire_date || "") <= to && (!["terminated", "resigned"].includes(e.status) || (e.exit_date && e.exit_date >= from)));
}

/** Loads everything a run needs for these employees in one go. */
export async function loadRunInputs(ids: string[], period: string, runId: string | null, lk: { leaveTypes?: { id: string; paid: boolean }[]; holidays?: { date: string }[] } | undefined): Promise<RunInputs> {
  const from = monthStart(period), to = monthEnd(period);
  const none = { data: [] as any[] };
  const [items, loans, att, leave, adj] = ids.length ? await Promise.all([
    sb.from("hr_pay_items").select("*").in("employee_id", ids).eq("active", true),
    sb.from("hr_loans").select("*").in("employee_id", ids).eq("status", "active"),
    sb.from("hr_attendance").select("employee_id,status,overtime_hours").in("employee_id", ids).gte("date", from).lte("date", to),
    sb.from("hr_leave_requests").select("employee_id,leave_type_id,start_date,end_date,status,half_day").in("employee_id", ids).eq("status", "approved").lte("start_date", to).gte("end_date", from),
    runId ? sb.from("hr_payroll_adjustments").select("*").eq("run_id", runId) : Promise.resolve(none),
  ]) : [none, none, none, none, none];
  return {
    period,
    items: items.data || [], loans: loans.data || [], att: att.data || [], leave: leave.data || [], adjustments: (adj.data || []) as Adjustment[],
    unpaidTypes: new Set((lk?.leaveTypes || []).filter((t) => !t.paid).map((t) => t.id)),
    holidays: new Set((lk?.holidays || []).map((h) => h.date)),
  };
}

export type BuiltLine = { row: Record<string, any>; p: Payslip };

/** One employee's payslip row for the month. */
export function buildLine(e: Employee, inp: RunInputs, rates: PayrollRates, opts: PayrollOptions, edits?: LineEdits | null): BuiltLine {
  const { period, holidays } = inp;
  const from = monthStart(period), to = monthEnd(period);
  const count = (a: string, b: string) => (opts.prorate_basis === "calendar" ? calendarDays(a, b) : workingDays(a, b, holidays));
  const ed = edits || {};

  // Joined or left during the month: pay the days worked unless HR chose otherwise.
  const totalDays = count(from, to);
  const start = e.hire_date && e.hire_date > from ? e.hire_date : from;
  const end = e.exit_date && e.exit_date < to ? e.exit_date : to;
  const worked = start > end ? 0 : count(start, end);
  const midPeriod = start > from || end < to;
  const mode: Exclude<ProrateMode, "auto"> = ed.mode && ed.mode !== "auto" ? ed.mode : midPeriod ? "prorate" : "full";
  const daysPeriod = ed.days_period ?? totalDays;
  const days = ed.days ?? worked;
  const factor = mode === "prorate" && daysPeriod > 0 ? Math.min(1, Math.max(0, days / daysPeriod)) : 1;
  const fullBasic = Number(e.basic_salary) || 0;
  const basic = mode === "fixed" ? r2(Math.max(0, Number(ed.fixed ?? fullBasic))) : r2(fullBasic * factor);

  const mine = inp.items.filter((i: any) => i.employee_id === e.id);
  const adjs = inp.adjustments.filter((a) => a.employee_id === e.id);
  const contractAllowances = [
    ...(Number(e.house_allowance) > 0 ? [{ name: "House allowance", amount: Number(e.house_allowance), taxable: true }] : []),
    ...mine.filter((i: any) => i.kind === "allowance").map((i: any) => ({ name: i.name, amount: Number(i.amount), taxable: i.taxable !== false })),
  ].map((a) => ({ ...a, amount: r2(a.amount * factor) }));
  const allowances = [
    ...(ed.allowances ?? contractAllowances),
    ...adjs.filter((a) => a.kind === "earning" || a.kind === "nontaxable").map((a) => ({ name: a.name, amount: Number(a.amount), taxable: a.kind === "earning" })),
  ];
  const deductions = [
    ...(ed.deductions ?? mine.filter((i: any) => i.kind === "deduction").map((i: any) => ({ name: i.name, amount: Number(i.amount) }))),
    ...adjs.filter((a) => a.kind === "deduction").map((a) => ({ name: a.name, amount: Number(a.amount) })),
  ];
  const benefitItems = [
    ...mine.filter((i: any) => i.kind === "benefit" && i.taxable !== false).map((i: any) => ({ name: i.name, amount: Number(i.amount) })),
    ...adjs.filter((a) => a.kind === "benefit").map((a) => ({ name: a.name, amount: Number(a.amount) })),
  ];

  const myLoans = inp.loans.filter((l: any) => l.employee_id === e.id);
  const loanParts = myLoans.map((l: any) => ({ id: l.id, kind: l.kind, amount: r2(Math.min(Number(l.monthly_installment) || Number(l.balance), Number(l.balance))) }));
  const loanDeduction = loanParts.reduce((a, l) => a + l.amount, 0);

  const dayRate = fullBasic / (rates.working_days || 26);
  const autoOt = inp.att.filter((a: any) => a.employee_id === e.id).reduce((s: number, a: any) => s + Number(a.overtime_hours || 0), 0);
  const absent = inp.att.filter((a: any) => a.employee_id === e.id && a.status === "absent").length;
  // A half day of unpaid leave counts as 0.5 (and as nothing when it falls on a rest day or holiday).
  const unpaidLeave = inp.leave.filter((l: any) => l.employee_id === e.id && inp.unpaidTypes.has(l.leave_type_id))
    .reduce((s: number, l: any) => s + workingDays(l.start_date < from ? from : l.start_date, l.end_date > to ? to : l.end_date, holidays) * (l.half_day ? 0.5 : 1), 0);
  const schemePct = e.nssf_contracted_out ? Number(e.nssf_tier2_scheme_pct ?? 100) : 0;
  const ot = ed.overtime_hours ?? autoOt;
  const unpaidDays = ed.unpaid_days ?? unpaidLeave + absent;

  const p = computePayslip({
    basic, allowances, deductions, loanDeduction,
    overtimePay: r2((dayRate / 8) * (rates.overtime_rate || 1.5) * ot),
    unpaidLeaveDeduction: r2(dayRate * unpaidDays),
    pension: Number(e.pension_contribution), mortgageInterest: Number(e.mortgage_interest), insurancePremium: Number(e.insurance_premium),
    helb: Number(e.helb_deduction), disability: e.disability_exempt, prmf: Number(e.prmf_contribution || 0),
    nonCashBenefits: benefitItems.reduce((a, b) => a + b.amount, 0), roundNet: opts.round_net, nssfSchemePct: schemePct,
  }, rates);

  return {
    p,
    row: {
      employee_id: e.id, employee_name: fullName(e), basic: p.basic, gross: p.gross, taxable_pay: p.taxable_pay,
      nssf: p.nssf, shif: p.shif, housing_levy: p.housing_levy, paye: p.paye, loan_deductions: p.loan_deductions,
      other_deductions: r2(p.other_deductions.reduce((a, d) => a + d.amount, 0) + p.helb + p.pension + p.prmf + p.insurance), net_pay: p.net_pay,
      employer_nssf: p.employer_nssf, employer_housing: p.employer_housing, nita: p.nita,
      data: {
        ...p, overtime_hours: ot, absent_days: ed.unpaid_days != null ? 0 : absent, unpaid_leave_days: ed.unpaid_days != null ? ed.unpaid_days : unpaidLeave,
        proration: factor, prorate_mode: mode, prorate_days: mode === "prorate" ? days : null, prorate_days_period: mode === "prorate" ? daysPeriod : null,
        prorate_basis: opts.prorate_basis, mid_period: midPeriod, full_basic: fullBasic, benefit_items: benefitItems,
        adjustments: adjs.map((a) => ({ kind: a.kind, name: a.name, amount: Number(a.amount) })),
        nssf_scheme_name: schemePct > 0 ? (e.nssf_tier2_scheme || "Private pension scheme") : null,
        loans: loanParts, edits: edits && Object.keys(edits).length ? edits : null,
      },
    },
  };
}

export type RunTotals = Record<"gross" | "paye" | "nssf" | "nssf_scheme" | "shif" | "housing" | "net" | "employer_cost" | "employer_nssf" | "employer_housing" | "nita" | "loans" | "other" | "count", number>;

/** Run totals from its lines (kept on hr_payroll_runs.totals). */
export function runTotals(rows: any[]): RunTotals {
  const t: RunTotals = { gross: 0, paye: 0, nssf: 0, nssf_scheme: 0, shif: 0, housing: 0, net: 0, employer_cost: 0, employer_nssf: 0, employer_housing: 0, nita: 0, loans: 0, other: 0, count: rows.length };
  for (const s of rows) {
    t.gross += Number(s.gross) || 0; t.paye += Number(s.paye) || 0; t.nssf += Number(s.nssf) || 0; t.shif += Number(s.shif) || 0;
    t.housing += Number(s.housing_levy) || 0; t.net += Number(s.net_pay) || 0; t.employer_nssf += Number(s.employer_nssf) || 0;
    t.employer_housing += Number(s.employer_housing) || 0; t.nita += Number(s.nita) || 0; t.loans += Number(s.loan_deductions) || 0; t.other += Number(s.other_deductions) || 0;
    // Employee + employer NSSF sent to a private scheme (already inside nssf and employer_nssf).
    t.nssf_scheme += (Number(s.nssf_scheme ?? s.data?.nssf_scheme) || 0) + (Number(s.employer_nssf_scheme ?? s.data?.employer_nssf_scheme) || 0);
  }
  t.employer_cost = t.gross + t.employer_nssf + t.employer_housing + t.nita;
  for (const k of Object.keys(t) as (keyof RunTotals)[]) t[k] = r2(t[k]);
  return t;
}

/** Re-reads a run's lines and stores fresh totals on it. */
export async function refreshTotals(runId: string) {
  const { data } = await sb.from("hr_payslips").select("gross,paye,nssf,shif,housing_levy,net_pay,employer_nssf,employer_housing,nita,loan_deductions,other_deductions,nssf_scheme:data->nssf_scheme,employer_nssf_scheme:data->employer_nssf_scheme").eq("run_id", runId);
  const t = runTotals(data || []);
  await sb.from("hr_payroll_runs").update({ totals: t }).eq("id", runId);
  return t;
}

/** "2547XXXXXXXX" for M-Pesa bulk files; empty when the number cannot be read. */
export function msisdn(phone: string | null | undefined) {
  const d = String(phone || "").replace(/\D/g, "");
  if (/^254[17]\d{8}$/.test(d)) return d;
  if (/^0[17]\d{8}$/.test(d)) return `254${d.slice(1)}`;
  if (/^[17]\d{8}$/.test(d)) return `254${d}`;
  return "";
}

/** Why an employee cannot be paid with the file for their method, or "" when they can. */
export function payProblem(e: Employee | undefined) {
  if (!e) return "no staff record";
  if (e.payment_method === "mpesa") return msisdn(e.mpesa_phone || e.phone) ? "" : "no M-Pesa number";
  if (e.payment_method === "bank") return !e.bank_account ? "no account number" : !e.bank_name ? "no bank" : "";
  return "";
}

export const PAY_METHOD: Record<string, string> = { bank: "Bank", mpesa: "M-Pesa", cash: "Cash", cheque: "Cheque" };
export const periodLabel = (p?: string | null) => (p ? new Date(`${p}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "");
