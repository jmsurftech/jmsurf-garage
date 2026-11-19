// HR report pack for the report centre ("Payroll & HR"): next of kin, age and retirement, new hires,
// separations, transfers, salary reviews, muster roll, annual leave schedule, sacco deductions, payroll
// checks and casual workers. Reports that show pay need "See salaries and bank details" (hr_can_see_pay);
// the database refuses payslips without it anyway.
import { supabase } from "@/integrations/supabase/client";
import type { Col, Ctx, Report } from "./moreReports";

const sb: any = supabase;
const G = "Payroll & HR";
const RETIRE_AGE = 60;
const n = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const name = (e: any) => (e ? [e.first_name, e.other_names, e.last_name].filter(Boolean).join(" ") : "");
const current = (e: any) => !["terminated", "resigned"].includes(e.status);
const label = (s: string) => String(s || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

async function employees(c: Ctx) {
  const { data, error } = await sb.from("hr_employees").select("*, hr_departments(name), hr_designations(name)").eq("tenant_id", c.tenantId).order("first_name");
  if (error) throw error;
  return (data || []) as any[];
}
async function needPay() {
  const { data } = await sb.rpc("hr_can_see_pay");
  if (data !== true) throw new Error("This report shows pay. You need \"See salaries and bank details\" on your role.");
}
const dept = (e: any) => e?.hr_departments?.name || "";
/** Whole years between two ISO dates. */
const yearsBetween = (from: string, to: string) => {
  const [a, b] = [new Date(`${from}T00:00:00`), new Date(`${to}T00:00:00`)];
  let y = b.getFullYear() - a.getFullYear();
  if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) y--;
  return y;
};
const addYears = (iso: string, y: number) => { const [yy, mm, dd] = iso.split("-").map(Number); const d = new Date(yy + y, mm - 1, dd); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/* Muster roll columns: one per day of the month. */
const DAY_COLS: Col[] = Array.from({ length: 31 }, (_, i) => ({ key: `d${i + 1}`, label: String(i + 1) }));
const MARK: Record<string, string> = { present: "P", late: "L", half_day: "½", absent: "A", leave: "LV", off: "O", holiday: "H" };

export const HR_REPORTS: Report[] = [
  { key: "hr_next_of_kin", group: G, label: "Next of kin", hint: "Emergency contacts for everyone on the staff list.",
    cols: [{ key: "employee", label: "Employee" }, { key: "no", label: "Staff no" }, { key: "department", label: "Department" }, { key: "phone", label: "Phone" }, { key: "kin", label: "Next of kin" }, { key: "relationship", label: "Relationship" }, { key: "kin_phone", label: "Their phone" }],
    load: async (c) => (await employees(c)).filter(current).map((e) => {
      const k = e.next_of_kin && typeof e.next_of_kin === "object" ? e.next_of_kin : {};
      return { employee: name(e), no: e.employee_no || "", department: dept(e), phone: e.phone || "", kin: k.name || "Not given", relationship: k.relationship || "", kin_phone: k.phone || "" };
    }) },

  { key: "hr_age_retirement", group: G, label: "Age and retirement", hint: `Ages and retirement dates at ${RETIRE_AGE}, soonest first.`,
    cols: [{ key: "employee", label: "Employee" }, { key: "department", label: "Department" }, { key: "dob", label: "Born" }, { key: "age", label: "Age", num: true }, { key: "retires", label: "Retires on" }, { key: "years_left", label: "Years left", num: true }, { key: "note", label: "Note" }],
    load: async (c) => {
      const t = todayIso();
      const rows = (await employees(c)).filter(current).map((e) => {
        if (!e.date_of_birth) return { employee: name(e), department: dept(e), dob: "", age: null, retires: "", years_left: null, note: "No date of birth", _sort: "9999" };
        const retires = addYears(e.date_of_birth, RETIRE_AGE);
        const left = yearsBetween(t, retires);
        const note = retires <= t ? "Past retirement age" : retires <= addYears(t, 1) ? "Retires within a year" : retires <= addYears(t, 5) ? "Retires within 5 years" : "";
        return { employee: name(e), department: dept(e), dob: e.date_of_birth, age: yearsBetween(e.date_of_birth, t), retires, years_left: Math.max(0, left), note, _sort: retires };
      });
      return rows.sort((a, b) => a._sort.localeCompare(b._sort)).map(({ _sort, ...r }) => { void _sort; return r; });
    } },

  { key: "hr_new_hires", group: G, label: "New hires", hint: "People who joined in the period.", dated: true,
    cols: [{ key: "employee", label: "Employee" }, { key: "no", label: "Staff no" }, { key: "department", label: "Department" }, { key: "title", label: "Job title" }, { key: "type", label: "Type" }, { key: "hired", label: "Joined" }, { key: "status", label: "Status" }],
    load: async (c) => (await employees(c)).filter((e) => e.hire_date >= c.from && e.hire_date <= c.to).sort((a, b) => a.hire_date.localeCompare(b.hire_date))
      .map((e) => ({ employee: name(e), no: e.employee_no || "", department: dept(e), title: e.hr_designations?.name || "", type: label(e.employment_type), hired: e.hire_date, status: label(e.status) })) },

  { key: "hr_separations", group: G, label: "Separations", hint: "Resignations, terminations, retirements and other exits in the period.", dated: true,
    cols: [{ key: "employee", label: "Employee" }, { key: "department", label: "Department" }, { key: "kind", label: "Reason for leaving" }, { key: "notice", label: "Notice given" }, { key: "last_day", label: "Last day" }, { key: "years", label: "Years served", num: true }, { key: "detail", label: "Details" }],
    load: async (c) => {
      const [emps, seps] = await Promise.all([employees(c), sb.from("hr_separations").select("*").eq("tenant_id", c.tenantId)]);
      const byId = new Map(emps.map((e) => [e.id, e]));
      const out: any[] = [];
      const seen = new Set<string>();
      for (const s of (seps.data || []) as any[]) {
        const day = s.last_day || s.notice_date;
        if (!day || day < c.from || day > c.to) continue;
        const e = byId.get(s.employee_id); seen.add(s.employee_id);
        out.push({ employee: name(e), department: dept(e), kind: label(s.kind), notice: s.notice_date, last_day: s.last_day || "", years: e ? Math.max(0, yearsBetween(e.hire_date, day)) : null, detail: s.reason || "" });
      }
      for (const e of emps) {
        if (seen.has(e.id) || current(e) || !e.exit_date || e.exit_date < c.from || e.exit_date > c.to) continue;
        out.push({ employee: name(e), department: dept(e), kind: label(e.status), notice: "", last_day: e.exit_date, years: Math.max(0, yearsBetween(e.hire_date, e.exit_date)), detail: e.exit_reason || "" });
      }
      return out.sort((a, b) => String(a.last_day || a.notice).localeCompare(String(b.last_day || b.notice)));
    } },

  { key: "hr_transfers", group: G, label: "Transfers", hint: "Moves between departments and branches in the period.", dated: true,
    cols: [{ key: "employee", label: "Employee" }, { key: "effective", label: "Effective" }, { key: "from_dept", label: "From department" }, { key: "to_dept", label: "To department" }, { key: "from_branch", label: "From branch" }, { key: "to_branch", label: "To branch" }, { key: "status", label: "Status" }, { key: "reason", label: "Reason" }],
    load: async (c) => {
      const [emps, moves, deps, locs] = await Promise.all([
        employees(c),
        sb.from("hr_movements").select("*").eq("tenant_id", c.tenantId).gte("effective_date", c.from).lte("effective_date", c.to).order("effective_date"),
        sb.from("hr_departments").select("id,name").eq("tenant_id", c.tenantId),
        sb.from("locations").select("id,name").eq("tenant_id", c.tenantId),
      ]);
      const byId = new Map(emps.map((e) => [e.id, e]));
      const dn = new Map(((deps.data || []) as any[]).map((d) => [d.id, d.name]));
      const ln = new Map(((locs.data || []) as any[]).map((d) => [d.id, d.name]));
      return ((moves.data || []) as any[]).filter((m) => m.status !== "rejected" && (m.kind === "transfer" || m.to_data?.department_id || m.to_data?.location_id)).map((m) => ({
        employee: name(byId.get(m.employee_id)), effective: m.effective_date,
        from_dept: dn.get(m.from_data?.department_id) || "", to_dept: m.to_data?.department_id ? dn.get(m.to_data.department_id) || "" : "(no change)",
        from_branch: ln.get(m.from_data?.location_id) || "", to_branch: m.to_data?.location_id ? ln.get(m.to_data.location_id) || "" : "(no change)",
        status: m.status === "applied" ? "Done" : label(m.status), reason: m.reason || "",
      }));
    } },

  { key: "hr_salary_reviews", group: G, label: "Salary reviews", hint: "Pay changes and promotions with old and new basic pay.", dated: true, chart: { x: "employee", y: "change_pct" },
    cols: [{ key: "employee", label: "Employee" }, { key: "kind", label: "Change" }, { key: "effective", label: "Effective" }, { key: "old_basic", label: "Old basic", money: true }, { key: "new_basic", label: "New basic", money: true }, { key: "change_pct", label: "Change %", num: true }, { key: "status", label: "Status" }, { key: "reason", label: "Reason" }],
    load: async (c) => {
      await needPay();
      const [emps, moves] = await Promise.all([employees(c), sb.from("hr_movements").select("*").eq("tenant_id", c.tenantId).gte("effective_date", c.from).lte("effective_date", c.to).order("effective_date")]);
      const byId = new Map(emps.map((e) => [e.id, e]));
      return ((moves.data || []) as any[]).filter((m) => m.status !== "rejected" && (m.to_data?.basic_salary !== undefined && m.to_data?.basic_salary !== null && m.to_data?.basic_salary !== "")).map((m) => {
        const before = n(m.from_data?.basic_salary), after = n(m.to_data.basic_salary);
        return { employee: name(byId.get(m.employee_id)), kind: label(m.kind === "salary_change" ? "pay change" : m.kind), effective: m.effective_date, old_basic: before, new_basic: after,
          change_pct: before > 0 ? r2(((after - before) / before) * 100) : null, status: m.status === "applied" ? "Done" : label(m.status), reason: m.reason || "" };
      });
    } },

  { key: "hr_muster_roll", group: G, label: "Muster roll", hint: "Attendance for every day of the month the period starts in (P present, L late, ½ half day, A absent, LV leave, O off, H holiday).", dated: true,
    cols: [{ key: "employee", label: "Employee" }, { key: "no", label: "Staff no" }, ...DAY_COLS, { key: "present", label: "Days worked", num: true }, { key: "absent", label: "Absent", num: true }],
    load: async (c) => {
      const month = c.from.slice(0, 7);
      const [y, m] = month.split("-").map(Number);
      const last = new Date(y, m, 0).getDate();
      const [emps, att] = await Promise.all([employees(c), sb.from("hr_attendance").select("employee_id,date,status").eq("tenant_id", c.tenantId).gte("date", `${month}-01`).lte("date", `${month}-${String(last).padStart(2, "0")}`).limit(20000)]);
      const byEmp = new Map<string, any[]>();
      for (const a of (att.data || []) as any[]) byEmp.set(a.employee_id, [...(byEmp.get(a.employee_id) || []), a]);
      const monthEnd = `${month}-${String(last).padStart(2, "0")}`;
      return emps.filter((e) => e.hire_date <= monthEnd && (current(e) || !e.exit_date || e.exit_date >= `${month}-01`)).map((e) => {
        const row: Record<string, any> = { employee: name(e), no: e.employee_no || "" };
        let present = 0, absent = 0;
        for (const a of byEmp.get(e.id) || []) {
          row[`d${Number(a.date.slice(8, 10))}`] = MARK[a.status] || "";
          if (a.status === "present" || a.status === "late") present += 1; else if (a.status === "half_day") present += 0.5; else if (a.status === "absent") absent += 1;
        }
        for (let d = 1; d <= 31; d++) if (row[`d${d}`] === undefined) row[`d${d}`] = d > last ? "" : "·";
        return { ...row, present, absent };
      });
    } },

  { key: "hr_leave_schedule", group: G, label: "Annual leave schedule", hint: "Annual leave booked or asked for, overlapping the period, by start date.", dated: true,
    cols: [{ key: "employee", label: "Employee" }, { key: "department", label: "Department" }, { key: "type", label: "Leave" }, { key: "from", label: "From" }, { key: "to", label: "To" }, { key: "days", label: "Days", num: true }, { key: "status", label: "Status" }],
    load: async (c) => {
      const [emps, types, leave] = await Promise.all([
        employees(c),
        sb.from("hr_leave_types").select("id,name").eq("tenant_id", c.tenantId),
        sb.from("hr_leave_requests").select("employee_id,leave_type_id,start_date,end_date,days,status").eq("tenant_id", c.tenantId).in("status", ["approved", "pending"]).lte("start_date", c.to).gte("end_date", c.from).order("start_date"),
      ]);
      const annual = new Map(((types.data || []) as any[]).filter((t) => /annual/i.test(t.name)).map((t) => [t.id, t.name]));
      const byId = new Map(emps.map((e) => [e.id, e]));
      return ((leave.data || []) as any[]).filter((l) => annual.has(l.leave_type_id)).map((l) => {
        const e = byId.get(l.employee_id);
        return { employee: name(e), department: dept(e), type: annual.get(l.leave_type_id), from: l.start_date, to: l.end_date, days: n(l.days), status: l.status === "pending" ? "Waiting for approval" : "Approved" };
      });
    } },

  { key: "hr_sacco", group: G, label: "Sacco deductions", hint: "Sacco amounts taken from pay, by month (payroll lines named sacco).", dated: true, chart: { x: "employee", y: "amount" },
    cols: [{ key: "month", label: "Month" }, { key: "employee", label: "Employee" }, { key: "no", label: "Staff no" }, { key: "item", label: "Deduction" }, { key: "amount", label: "Amount", money: true }],
    load: async (c) => {
      await needPay();
      const [emps, slips] = await Promise.all([
        employees(c),
        sb.from("hr_payslips").select("employee_id,employee_name,data,hr_payroll_runs!inner(period,period_start,status)").eq("tenant_id", c.tenantId)
          .gte("hr_payroll_runs.period_start", c.from).lte("hr_payroll_runs.period_start", c.to).neq("hr_payroll_runs.status", "draft").limit(20000),
      ]);
      if (slips.error) throw slips.error;
      const byId = new Map(emps.map((e) => [e.id, e]));
      const out: any[] = [];
      for (const s of (slips.data || []) as any[]) {
        for (const d of (Array.isArray(s.data?.other_deductions) ? s.data.other_deductions : []) as { name: string; amount: number }[]) {
          if (!/sacco/i.test(d.name || "")) continue;
          const e = byId.get(s.employee_id);
          out.push({ month: s.hr_payroll_runs?.period, employee: e ? name(e) : s.employee_name, no: e?.employee_no || "", item: d.name, amount: n(d.amount) });
        }
      }
      return out.sort((a, b) => `${a.month}${a.employee}`.localeCompare(`${b.month}${b.employee}`));
    } },

  { key: "hr_payroll_checks", group: G, label: "Payroll checks", hint: "Payroll lines to look at: net pay up or down over 25% on the month before, zero or negative net, missing KRA PIN, NSSF or SHA number.", dated: true,
    cols: [{ key: "month", label: "Month" }, { key: "employee", label: "Employee" }, { key: "issue", label: "Check" }, { key: "detail", label: "Details" }, { key: "net", label: "Net pay", money: true }, { key: "prev_net", label: "Month before", money: true }],
    load: async (c) => {
      await needPay();
      const [emps, runsRes] = await Promise.all([employees(c), sb.from("hr_payroll_runs").select("id,period,period_start,status").eq("tenant_id", c.tenantId).order("period")]);
      if (runsRes.error) throw runsRes.error;
      const runs = (runsRes.data || []) as any[];
      const inRange = runs.filter((r) => r.period_start >= c.from && r.period_start <= c.to);
      if (!inRange.length) return [];
      const prevOf = new Map(inRange.map((r) => [r.id, runs[runs.indexOf(r) - 1] || null]));
      const ids = [...new Set([...inRange.map((r) => r.id), ...[...prevOf.values()].filter(Boolean).map((r: any) => r.id)])];
      const { data: slips, error } = await sb.from("hr_payslips").select("run_id,employee_id,employee_name,net_pay").in("run_id", ids).limit(50000);
      if (error) throw error;
      const byRun = new Map<string, Map<string, any>>();
      for (const s of (slips || []) as any[]) { if (!byRun.has(s.run_id)) byRun.set(s.run_id, new Map()); byRun.get(s.run_id)!.set(s.employee_id, s); }
      const byId = new Map(emps.map((e) => [e.id, e]));
      const out: any[] = [];
      for (const r of inRange) {
        const prev = prevOf.get(r.id);
        for (const s of byRun.get(r.id)?.values() || []) {
          const e = byId.get(s.employee_id);
          const who = e ? name(e) : s.employee_name;
          const net = n(s.net_pay);
          const before = prev ? byRun.get(prev.id)?.get(s.employee_id) : null;
          const base = { month: r.period + (r.status === "draft" ? " (draft)" : ""), employee: who, net, prev_net: before ? n(before.net_pay) : null };
          if (net <= 0) out.push({ ...base, issue: net < 0 ? "Negative net pay" : "Zero net pay", detail: "Deductions take all the pay" });
          if (before && n(before.net_pay) > 0 && net > 0) {
            const pct = ((net - n(before.net_pay)) / n(before.net_pay)) * 100;
            if (Math.abs(pct) > 25) out.push({ ...base, issue: pct > 0 ? "Net pay jumped" : "Net pay dropped", detail: `${pct > 0 ? "+" : ""}${r2(pct)}% on ${prev.period}` });
          }
          if (prev && !before) out.push({ ...base, issue: "New on payroll", detail: `Not paid in ${prev.period}` });
          const missing = e ? [!e.kra_pin && "KRA PIN", !e.nssf_no && "NSSF no.", !e.shif_no && "SHA no."].filter(Boolean) : [];
          if (missing.length) out.push({ ...base, issue: "Missing statutory numbers", detail: missing.join(", ") });
        }
      }
      return out;
    } },

  { key: "hr_casuals", group: G, label: "Casual workers", hint: "Casual workers with the days they worked in the period.", dated: true, chart: { x: "name", y: "days" },
    cols: [{ key: "name", label: "Name" }, { key: "id_no", label: "ID no." }, { key: "kra_pin", label: "KRA PIN" }, { key: "phone", label: "Phone" }, { key: "skill", label: "Skill" }, { key: "state", label: "State" }, { key: "days", label: "Days worked", num: true }, { key: "last_day", label: "Last worked" }],
    load: async (c) => {
      const [cas, days] = await Promise.all([
        sb.from("hr_casuals").select("id,name,national_id,kra_pin,phone,skill,active").eq("tenant_id", c.tenantId).order("name"),
        sb.from("hr_casual_days").select("casual_id,work_date,days").eq("tenant_id", c.tenantId).gte("work_date", c.from).lte("work_date", c.to).limit(50000),
      ]);
      if (cas.error) throw cas.error;
      const worked = new Map<string, { days: number; last: string }>();
      for (const d of (days.data || []) as any[]) { const w = worked.get(d.casual_id) || { days: 0, last: "" }; w.days += n(d.days); if (d.work_date > w.last) w.last = d.work_date; worked.set(d.casual_id, w); }
      return ((cas.data || []) as any[]).filter((x) => x.active || worked.has(x.id)).map((x) => ({
        name: x.name, id_no: x.national_id || "", kra_pin: x.kra_pin || "", phone: x.phone || "", skill: x.skill || "", state: x.active ? "Active" : "Inactive",
        days: worked.get(x.id)?.days || 0, last_day: worked.get(x.id)?.last || "",
      }));
    } },
];
