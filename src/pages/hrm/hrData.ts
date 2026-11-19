import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useErpSettings } from "@/pages/settings/ErpSettingsTabs";
import { mergeRates } from "@/lib/kenyaPayroll";

export const sb: any = supabase;

export type Employee = {
  id: string; tenant_id: string; user_id: string | null; employee_no: string | null; first_name: string; last_name: string; other_names: string | null;
  gender: string | null; date_of_birth: string | null; marital_status: string | null; national_id: string | null; kra_pin: string | null; nssf_no: string | null; shif_no: string | null;
  phone: string | null; email: string | null; address: string | null; photo_url: string | null; next_of_kin: any;
  department_id: string | null; designation_id: string | null; manager_id: string | null; employment_type: string; hire_date: string; probation_end: string | null; contract_end: string | null;
  status: string; exit_date: string | null; exit_reason: string | null; basic_salary: number; house_allowance: number; payment_method: string;
  bank_name: string | null; bank_branch: string | null; bank_account: string | null; mpesa_phone: string | null; disability_exempt: boolean;
  insurance_premium: number; pension_contribution: number; mortgage_interest: number; helb_deduction: number; notes: string | null;
  /** Post-retirement medical fund contribution a month (tax free up to the PRMF cap). */
  prmf_contribution?: number | null;
  /** Bank and branch codes from the Kenya bank list (for the bank payment file). */
  bank_code?: string | null;
  branch_code?: string | null;
  /** Contracted out of NSSF Tier II: this share of Tier II goes to the named private scheme. */
  nssf_contracted_out?: boolean | null;
  nssf_tier2_scheme?: string | null;
  nssf_tier2_scheme_pct?: number | null;
};

export const fullName = (e: Pick<Employee, "first_name" | "last_name" | "other_names"> | null | undefined) =>
  e ? [e.first_name, e.other_names, e.last_name].filter(Boolean).join(" ") : "";

export const EMPLOYMENT_TYPES = [["permanent", "Permanent"], ["contract", "Contract"], ["casual", "Casual"], ["intern", "Intern / attachment"], ["probation", "On probation"]] as const;
export const EMP_STATUS: Record<string, string> = {
  active: "bg-success/10 text-success", probation: "bg-info/10 text-info", on_leave: "bg-warning/15 text-warning",
  suspended: "bg-destructive/10 text-destructive", terminated: "bg-muted text-muted-foreground", resigned: "bg-muted text-muted-foreground",
};

export function useEmployees() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["hr-employees", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await sb.from("hr_employees").select("*").eq("tenant_id", tenantId).order("first_name");
      if (error) throw error;
      return (data || []) as Employee[];
    },
  });
}

export function useHrLookups() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["hr-lookups", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const [d, g, l, h] = await Promise.all([
        sb.from("hr_departments").select("*").eq("tenant_id", tenantId).order("name"),
        sb.from("hr_designations").select("*").eq("tenant_id", tenantId).order("name"),
        sb.from("hr_leave_types").select("*").eq("tenant_id", tenantId).order("name"),
        sb.from("hr_holidays").select("*").eq("tenant_id", tenantId).order("date"),
      ]);
      return {
        departments: (d.data || []) as { id: string; name: string; head_employee_id: string | null }[],
        designations: (g.data || []) as { id: string; name: string; department_id: string | null }[],
        leaveTypes: (l.data || []) as { id: string; name: string; days_per_year: number; paid: boolean; carry_forward_max: number; gender: string | null; requires_document: boolean; active: boolean }[],
        holidays: (h.data || []) as { id: string; date: string; name: string }[],
      };
    },
  });
}

/** Payroll options kept in erp_settings.hrm.payroll (System → HRM configuration). */
export type PayrollOptions = {
  /** Pay net to the whole shilling; PAYE and statutory lines stay exact. */
  round_net: boolean;
  /** The person who prepared or re-computed a payroll cannot approve it. */
  two_step: boolean;
  /** How part-month pay is counted for people who join or leave mid-month. */
  prorate_basis: "working" | "calendar";
  /** Optional limits on staff loan and advance requests from My Space (empty = no limit). */
  advance_max_pct: number | null;
  loan_max_amount: number | null;
  loan_max_months: number | null;
};
export const DEFAULT_PAYROLL_OPTIONS: PayrollOptions = { round_net: false, two_step: false, prorate_basis: "working", advance_max_pct: null, loan_max_amount: null, loan_max_months: null };

/** Leave options kept in erp_settings.hrm.leave. */
export type LeaveOptions = {
  /** Leave goes to the employee's line manager before HR (when the manager has a login). */
  manager_stage: boolean;
};
export const DEFAULT_LEAVE_OPTIONS: LeaveOptions = { manager_stage: true };

/** HR settings (statutory rates etc.) stored in erp_settings.hrm. */
export function useHrSettings() {
  const { settings, save, isLoading } = useErpSettings();
  const hrm = settings.hrm || {};
  const payroll: PayrollOptions = { ...DEFAULT_PAYROLL_OPTIONS, ...(hrm.payroll || {}) };
  const leave: LeaveOptions = { ...DEFAULT_LEAVE_OPTIONS, ...(hrm.leave || {}) };
  return { hrm, rates: mergeRates(hrm.rates), payroll, leave, save: (v: any) => save("hrm", { ...hrm, ...v }), isLoading };
}

export const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const monthStart = (period: string) => `${period}-01`;
export const monthEnd = (period: string) => { const [y, m] = period.split("-").map(Number); return ymd(new Date(y, m, 0)); };
export const csvOf = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
