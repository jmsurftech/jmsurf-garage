import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IdCard, Plus, Search, Pencil, Trash2, Download, Phone, Mail, Building2, CalendarDays, Wallet, FileText, Gavel, Star, UserCheck, LayoutGrid, List, Network } from "lucide-react";
import Pager, { usePaged, PagedRows } from "@/components/Pager";
import { useSelection, BulkBar, Tick } from "@/components/Bulk";
import { useTenantId } from "@/hooks/useTenantId";
import { useStaff } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, TableWrap } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";
import { formatKES } from "@/lib/format";
import { fmtDate } from "@/lib/doc-pdf";
import { saveFile } from "@/lib/erpApi";
import DocumentsPanel, { EMPLOYEE_DOCS } from "@/components/DocumentsPanel";
import { cn } from "@/lib/utils";
import { sb, useEmployees, useHrLookups, fullName, EMPLOYMENT_TYPES, EMP_STATUS, csvOf, ymd, type Employee } from "./hrData";
import { EmployeeLoginCard, EmployeeLoginsBulk } from "./EmployeeLogin";
import { BankFields } from "./BankFields";
import { usePermissions } from "@/hooks/usePermissions";

/** "See salaries and bank details" (Roles): without it pay and bank details are hidden (payslips and pay items are also refused by the database). */
function useSeePay() { const { can } = usePermissions(); return can("employees", "salary"); }
const HIDDEN = "Hidden";

const BLANK: Partial<Employee> = {
  first_name: "", last_name: "", other_names: "", gender: "", date_of_birth: null, marital_status: "", national_id: "", kra_pin: "", nssf_no: "", shif_no: "",
  phone: "", email: "", address: "", department_id: null, designation_id: null, manager_id: null, employment_type: "permanent", hire_date: ymd(), probation_end: null,
  contract_end: null, status: "active", basic_salary: 0, house_allowance: 0, payment_method: "bank", bank_name: "", bank_branch: "", bank_account: "", mpesa_phone: "",
  disability_exempt: false, insurance_premium: 0, pension_contribution: 0, mortgage_interest: 0, helb_deduction: 0, prmf_contribution: 0, notes: "", user_id: null, next_of_kin: {},
};

export default function Employees() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { data: emps = [], isLoading, error } = useEmployees();
  const { data: lk } = useHrLookups();
  const seePay = useSeePay();
  const pay = (v: number) => (seePay ? formatKES(v) : HIDDEN);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("current");
  const [dept, setDept] = useState("");
  const [edit, setEdit] = useState<Partial<Employee> | null>(null);
  const [mode, setMode] = useState<"list" | "cards" | "departments">(() => { try { return (localStorage.getItem("emps.mode") as any) || "list"; } catch { return "list"; } });
  const pickMode = (m: "list" | "cards" | "departments") => { setMode(m); try { localStorage.setItem("emps.mode", m); } catch { /* private window */ } };
  const qc = useQueryClient();
  const { toast } = useToast();
  const deptName = useMemo(() => new Map((lk?.departments || []).map((d) => [d.id, d.name])), [lk]);
  const desName = useMemo(() => new Map((lk?.designations || []).map((d) => [d.id, d.name])), [lk]);
  const rows = emps.filter((e) => (status === "all" || (status === "current" ? !["terminated", "resigned"].includes(e.status) : e.status === status))
    && (!dept || e.department_id === dept) && (!q.trim() || `${fullName(e)} ${e.employee_no} ${e.phone} ${e.national_id}`.toLowerCase().includes(q.trim().toLowerCase())));
  const current = emps.filter((e) => !["terminated", "resigned"].includes(e.status));
  const selected = id ? emps.find((e) => e.id === id) : null;
  const paged = usePaged(rows, 25);
  const sel = useSelection(paged.rows.map((e) => e.id));
  const setMany = async (patch: Record<string, unknown>, msg: string) => {
    const { error } = await sb.from("hr_employees").update(patch).in("id", sel.ids);
    if (error) return toast({ title: "Not changed", description: error.message, variant: "destructive" });
    sel.clear(); qc.invalidateQueries({ queryKey: ["hr-employees"] }); toast({ title: msg });
  };

  if (isLoading) return <OrbLoader label="Loading employees…" />;
  if (error) return <EmptyState icon={IdCard} title="HRM is for owners, managers and staff with the HRM permission" description={(error as Error).message} />;

  const exportCsv = () => saveFile("employees.csv", csvOf([
    ["Employee no", "Name", "ID number", "KRA PIN", "NSSF no", "SHA/SHIF no", "Phone", "Email", "Department", "Job title", "Type", "Hire date", "Status", ...(seePay ? ["Basic salary", "Bank", "Account", "M-Pesa"] : [])],
    ...emps.map((e) => [e.employee_no, fullName(e), e.national_id, e.kra_pin, e.nssf_no, e.shif_no, e.phone, e.email, deptName.get(e.department_id || ""), desName.get(e.designation_id || ""), e.employment_type, e.hire_date, e.status, ...(seePay ? [e.basic_salary, e.bank_name, e.bank_account, e.mpesa_phone] : [])]),
  ]), "text/csv");

  return (
    <div className="space-y-5">
      <PageHeader title="Employees" icon={IdCard} description="Everyone on the payroll: personal, statutory, job and pay details."
        actions={<><EmployeeLoginsBulk emps={emps as any} /><Button variant="outline" onClick={exportCsv}><Download /> Export</Button><Button onClick={() => setEdit({ ...BLANK })}><Plus /> Add employee</Button></>} />
      <StatGrid>
        <StatTile label="Monthly basic pay" value={pay(current.reduce((a, e) => a + Number(e.basic_salary) + Number(e.house_allowance), 0))} icon={Wallet} tone="info" />
        <StatTile label="On probation" value={current.filter((e) => e.status === "probation" || (e.probation_end && e.probation_end >= ymd())).length} icon={UserCheck} tone="warning" />
        <StatTile label="Contracts ending in 30 days" value={current.filter((e) => e.contract_end && e.contract_end >= ymd() && e.contract_end <= ymd(new Date(Date.now() + 30 * 86400000))).length} icon={CalendarDays} tone="danger" />
      </StatGrid>
      <div className="flex flex-wrap items-center gap-2">
        <select className="fi w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="current">Current staff</option><option value="all">Everyone</option>
          {Object.keys(EMP_STATUS).map((s) => <option key={s} value={s} className="capitalize">{s.replace("_", " ")}</option>)}
        </select>
        <select className="fi w-auto" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{(lk?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <div className="relative ml-auto w-full sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Name, number, phone or ID…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="flex rounded-full border border-border bg-card p-0.5">
          {([["list", List, "List"], ["cards", LayoutGrid, "Cards"], ["departments", Network, "By department"]] as const).map(([m, I, l]) => (
            <button key={m} onClick={() => pickMode(m)} title={l} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground")}><I className="h-4 w-4" /><span className="hidden sm:inline">{l}</span></button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? <Panel><EmptyState icon={IdCard} title={emps.length ? "Nobody matches" : "No employees yet"} description="Add each employee once; payroll, leave and attendance follow from here." /></Panel> : mode === "list" ? (
        <Panel flush>
          <BulkBar sel={sel} noun="employee">
            <select className="fi h-8 w-48 text-sm" value="" onChange={(e) => e.target.value && setMany({ department_id: e.target.value }, "Department changed")}><option value="">Move to department…</option>{(lk?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            <select className="fi h-8 w-44 text-sm" value="" onChange={(e) => e.target.value && setMany({ status: e.target.value }, "Status changed")}><option value="">Set status…</option>{Object.keys(EMP_STATUS).map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}</select>
            <Button size="sm" variant="outline" onClick={() => saveFile("employees-selected.csv", csvOf([["Employee no", "Name", "Phone", "Email", "Department", "Job title", "Status", ...(seePay ? ["Basic salary"] : [])], ...emps.filter((e) => sel.has(e.id)).map((e) => [e.employee_no, fullName(e), e.phone, e.email, deptName.get(e.department_id || ""), desName.get(e.designation_id || ""), e.status, ...(seePay ? [e.basic_salary] : [])])]), "text/csv")}><Download /> Export</Button>
          </BulkBar>
          <TableWrap><table className="dt">
            <thead><tr><th className="w-10"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} /></th><th>Employee</th><th>No.</th><th>Job title</th><th>Department</th><th>Phone</th><th>Type</th><th>Status</th><th className="num">Basic pay</th></tr></thead>
            <tbody>{paged.rows.map((e) => (
              <tr key={e.id} className={cn("cursor-pointer", sel.has(e.id) && "bg-primary/5")} onClick={() => navigate(`/hrm/employees/${e.id}`)}>
                <td data-label=""><Tick on={sel.has(e.id)} onChange={() => sel.toggle(e.id)} /></td>
                <td data-label="Employee"><span className="flex items-center gap-2.5">{e.photo_url ? <img src={e.photo_url} alt="" className="h-8 w-8 rounded-xl object-cover" /> : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-bold text-primary">{e.first_name.charAt(0)}{e.last_name.charAt(0)}</span>}<span className="font-semibold text-primary">{fullName(e)}</span></span></td>
                <td data-label="No.">{e.employee_no || "—"}</td>
                <td data-label="Job title">{desName.get(e.designation_id || "") || "—"}</td>
                <td data-label="Department">{deptName.get(e.department_id || "") || "—"}</td>
                <td data-label="Phone">{e.phone || "—"}</td>
                <td data-label="Type" className="capitalize">{String(e.employment_type || "").replace("_", " ")}</td>
                <td data-label="Status"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", EMP_STATUS[e.status])}>{e.status.replace("_", " ")}</span></td>
                <td data-label="Basic pay" className="num">{pay(Number(e.basic_salary))}</td>
              </tr>
            ))}</tbody>
          </table></TableWrap>
          <Pager {...paged.pager} />
        </Panel>
      ) : mode === "departments" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...(lk?.departments || []).map((d) => ({ id: d.id as string | null, name: d.name })), { id: null, name: "No department" }].map((d) => {
            const people = rows.filter((e) => (e.department_id || null) === d.id);
            if (!people.length) return null;
            return (
              <Panel key={d.id || "none"} title={d.name} icon={Building2} description={`${people.length} ${people.length === 1 ? "person" : "people"} ${seePay ? ` · ${formatKES(people.reduce((a, e) => a + Number(e.basic_salary), 0))} basic pay` : ""}`}>
                <ul className="divide-y divide-border">{people.map((e) => (
                  <li key={e.id}><button onClick={() => navigate(`/hrm/employees/${e.id}`)} className="flex w-full items-center gap-3 py-2.5 text-left hover:text-primary">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-bold text-primary">{e.first_name.charAt(0)}{e.last_name.charAt(0)}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{fullName(e)}</span><span className="block truncate text-xs text-muted-foreground">{desName.get(e.designation_id || "") || "No job title"}</span></span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", EMP_STATUS[e.status])}>{e.status.replace("_", " ")}</span>
                  </button></li>
                ))}</ul>
              </Panel>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <PagedRows rows={rows} gridSpan>{(pageRows) => pageRows.map((e) => (
            <button key={e.id} onClick={() => navigate(`/hrm/employees/${e.id}`)} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg">
              {e.photo_url ? <img src={e.photo_url} alt="" className="h-12 w-12 rounded-2xl object-cover" /> :
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 font-display text-lg font-bold text-primary-foreground">{e.first_name.charAt(0)}{e.last_name.charAt(0)}</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{fullName(e)}</span>
                <span className="block truncate text-xs text-muted-foreground">{desName.get(e.designation_id || "") || "No job title"} · {deptName.get(e.department_id || "") || "No department"}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", EMP_STATUS[e.status])}>{e.status.replace("_", " ")}</span>
                  {e.employee_no && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">{e.employee_no}</span>}
                </span>
              </span>
              <span className="text-right text-sm font-semibold tabular-nums">{pay(Number(e.basic_salary))}</span>
            </button>
          ))}</PagedRows>
        </div>
      )}
      {edit && <EmployeeForm value={edit} onClose={() => setEdit(null)} />}
      {selected && <EmployeeProfile emp={selected} onClose={() => navigate("/hrm/employees")} onEdit={() => setEdit(selected)} deptName={deptName.get(selected.department_id || "")} jobName={desName.get(selected.designation_id || "")} />}
    </div>
  );
}

function EmployeeForm({ value, onClose }: { value: Partial<Employee>; onClose: () => void }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: lk } = useHrLookups();
  const { data: emps = [] } = useEmployees();
  const { data: staff = [] } = useStaff();
  const seePay = useSeePay();
  const [f, setF] = useState<any>({ ...BLANK, ...value, next_of_kin: value.next_of_kin || {} });
  const [tab, setTab] = useState<"personal" | "job" | "pay" | "statutory">("personal");
  const [busy, setBusy] = useState(false);
  const up = (p: any) => setF((x: any) => ({ ...x, ...p }));
  const kin = (p: any) => setF((x: any) => ({ ...x, next_of_kin: { ...(x.next_of_kin || {}), ...p } }));
  const linkedUsers = new Set(emps.filter((e) => e.id !== value.id && e.user_id).map((e) => e.user_id));

  const save = async () => {
    if (!f.first_name?.trim()) return toast({ title: "Enter the first name", variant: "destructive" });
    if (f.kra_pin && !/^[AP]\d{9}[A-Z]$/i.test(f.kra_pin.trim())) return toast({ title: "KRA PIN looks wrong", description: "It is a letter, 9 digits and a letter, e.g. A012345678Z.", variant: "destructive" });
    setBusy(true);
    try {
      const payload: any = { ...f, tenant_id: tenantId, updated_at: new Date().toISOString() };
      for (const k of Object.keys(payload)) if (k.startsWith("_")) delete payload[k];
      if ("nssf_tier2_scheme_pct" in payload) payload.nssf_tier2_scheme_pct = Math.min(100, Math.max(0, Number(payload.nssf_tier2_scheme_pct ?? 100) || 0));
      if (payload.nssf_contracted_out && !String(payload.nssf_tier2_scheme || "").trim()) { setBusy(false); return toast({ title: "Enter the pension scheme's name", description: "It shows on payslips and the scheme's return.", variant: "destructive" }); }
      for (const k of ["date_of_birth", "probation_end", "contract_end", "exit_date", "department_id", "designation_id", "manager_id", "user_id"]) if (!payload[k]) payload[k] = null;
      for (const k of ["basic_salary", "house_allowance", "insurance_premium", "pension_contribution", "mortgage_interest", "helb_deduction", "prmf_contribution"]) payload[k] = Number(payload[k]) || 0;
      payload.kra_pin = payload.kra_pin ? String(payload.kra_pin).trim().toUpperCase() : null;
      // Only sent when used, so saving still works before the PRMF column exists.
      if (!payload.prmf_contribution && !Number((value as any).prmf_contribution)) delete payload.prmf_contribution;
      if (!value.id) { const { data } = await sb.rpc("hr_next_employee_no"); payload.employee_no = payload.employee_no || data; delete payload.id; }
      const r = value.id ? await sb.from("hr_employees").update(payload).eq("id", value.id) : await sb.from("hr_employees").insert(payload);
      if (r.error) throw r.error;
      qc.invalidateQueries({ queryKey: ["hr-employees"] });
      toast({ title: value.id ? "Employee updated" : "Employee added" });
      onClose();
    } catch (e: any) { toast({ title: "Not saved", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const T = (k: string, label: string, opts: { type?: string; placeholder?: string; hint?: string } = {}) => (
    <Field label={label} hint={opts.hint}><input className="fi" type={opts.type || "text"} value={f[k] ?? ""} placeholder={opts.placeholder} onChange={(e) => up({ [k]: e.target.value })} /></Field>
  );
  return (
    <Modal open onClose={onClose} title={value.id ? `Edit ${fullName(value as Employee)}` : "Add employee"} icon={IdCard} size="2xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy && <OrbSpinner />} Save employee</Button></>}>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">
        {([["personal", "Personal"], ["job", "Job"], ...(seePay ? [["pay", "Pay & bank"]] as const : []), ["statutory", "Statutory & tax"]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setTab(v)} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-sm", tab === v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{l}</button>
        ))}
      </div>
      {tab === "personal" && <div className="grid gap-3 sm:grid-cols-3">
        {T("first_name", "First name *")}{T("other_names", "Middle name")}{T("last_name", "Surname")}
        <Field label="Gender"><select className="fi" value={f.gender || ""} onChange={(e) => up({ gender: e.target.value })}><option value="">—</option><option value="female">Female</option><option value="male">Male</option></select></Field>
        {T("date_of_birth", "Date of birth", { type: "date" })}
        <Field label="Marital status"><select className="fi" value={f.marital_status || ""} onChange={(e) => up({ marital_status: e.target.value })}><option value="">—</option><option>Single</option><option>Married</option><option>Divorced</option><option>Widowed</option></select></Field>
        {T("phone", "Phone", { placeholder: "07…" })}{T("email", "Email", { type: "email" })}{T("address", "Home address")}
        <div className="sm:col-span-3 mt-2 text-sm font-semibold">Next of kin</div>
        <Field label="Name"><input className="fi" value={f.next_of_kin?.name || ""} onChange={(e) => kin({ name: e.target.value })} /></Field>
        <Field label="Relationship"><input className="fi" value={f.next_of_kin?.relationship || ""} onChange={(e) => kin({ relationship: e.target.value })} /></Field>
        <Field label="Phone"><input className="fi" value={f.next_of_kin?.phone || ""} onChange={(e) => kin({ phone: e.target.value })} /></Field>
      </div>}
      {tab === "job" && <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Department"><select className="fi" value={f.department_id || ""} onChange={(e) => up({ department_id: e.target.value })}><option value="">—</option>{(lk?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Job title"><select className="fi" value={f.designation_id || ""} onChange={(e) => up({ designation_id: e.target.value })}><option value="">—</option>{(lk?.designations || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Reports to"><select className="fi" value={f.manager_id || ""} onChange={(e) => up({ manager_id: e.target.value })}><option value="">—</option>{emps.filter((e) => e.id !== value.id).map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}</select></Field>
        <Field label="Employment type"><select className="fi" value={f.employment_type} onChange={(e) => up({ employment_type: e.target.value })}>{EMPLOYMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        {T("hire_date", "Date hired", { type: "date" })}
        <Field label="Status"><select className="fi" value={f.status} onChange={(e) => up({ status: e.target.value })}>{Object.keys(EMP_STATUS).map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></Field>
        {T("probation_end", "Probation ends", { type: "date", hint: "Up to 6 months (Employment Act s.42)" })}
        {T("contract_end", "Contract ends", { type: "date" })}
        <Field label="System login" hint="Link to a staff account so they see their payslips and can ask for leave.">
          <select className="fi" value={f.user_id || ""} onChange={(e) => up({ user_id: e.target.value })}><option value="">Not linked</option>{(staff as any[]).filter((s) => !linkedUsers.has(s.user_id)).map((s) => <option key={s.user_id} value={s.user_id}>{s.display_name}</option>)}</select>
        </Field>
        {["terminated", "resigned"].includes(f.status) && <>{T("exit_date", "Exit date", { type: "date" })}<Field label="Exit reason" className="sm:col-span-2"><input className="fi" value={f.exit_reason || ""} onChange={(e) => up({ exit_reason: e.target.value })} /></Field></>}
        <Field label="Notes" className="sm:col-span-3"><textarea className="fi" value={f.notes || ""} onChange={(e) => up({ notes: e.target.value })} /></Field>
      </div>}
      {tab === "pay" && seePay && <div className="grid gap-3 sm:grid-cols-3">
        {T("basic_salary", "Basic salary (monthly)", { type: "number" })}{T("house_allowance", "House allowance", { type: "number" })}
        <Field label="Paid by"><select className="fi" value={f.payment_method} onChange={(e) => up({ payment_method: e.target.value })}><option value="bank">Bank transfer</option><option value="mpesa">M-Pesa</option><option value="cash">Cash</option><option value="cheque">Cheque</option></select></Field>
        {f.payment_method === "bank" && <><BankFields f={f} onChange={up} />{T("bank_account", "Account number")}</>}
        {f.payment_method === "mpesa" && T("mpesa_phone", "M-Pesa number")}
        <div className="space-y-3 rounded-xl border border-border p-3 sm:col-span-3">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!f.nssf_contracted_out} onChange={(e) => up({ nssf_contracted_out: e.target.checked, ...(e.target.checked && f.nssf_tier2_scheme_pct == null ? { nssf_tier2_scheme_pct: 100 } : {}) })} /> NSSF Tier II goes to a private pension scheme</label>
          {f.nssf_contracted_out && <div className="grid gap-3 sm:grid-cols-2">
            {T("nssf_tier2_scheme", "Scheme", { placeholder: "e.g. Britam" })}
            {T("nssf_tier2_scheme_pct", "Share of Tier II to the scheme (%)", { type: "number", hint: "100 sends all of Tier II" })}
          </div>}
          <p className="text-xs text-muted-foreground">The NSSF deduction and tax stay the same. Tier I always goes to NSSF; this share of Tier II (employee and employer) goes to the scheme and is left off the NSSF return.</p>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-3">Other allowances (transport, airtime, commission…) and deductions (SACCO, welfare…) are added on the employee's profile under Pay items.</p>
      </div>}
      {tab === "statutory" && <div className="grid gap-3 sm:grid-cols-3">
        {T("national_id", "National ID / passport")}{T("kra_pin", "KRA PIN", { placeholder: "A012345678Z" })}{T("nssf_no", "NSSF number")}{T("shif_no", "SHA / SHIF number")}
        {T("insurance_premium", "Life/health insurance premium (monthly)", { type: "number", hint: "Taken from net pay; 15% tax relief up to 5,000" })}
        {T("pension_contribution", "Pension contribution (monthly)", { type: "number", hint: "Tax free up to 30,000 with NSSF" })}
        {T("mortgage_interest", "Mortgage interest (monthly)", { type: "number", hint: "Tax free up to 30,000" })}
        {T("helb_deduction", "HELB deduction (monthly)", { type: "number" })}
        {T("prmf_contribution", "Post-retirement medical fund (monthly)", { type: "number", hint: "Tax free up to 15,000" })}
        <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!f.disability_exempt} onChange={(e) => up({ disability_exempt: e.target.checked })} /> Has a KRA disability exemption certificate (first 150,000 a month tax free)</label>
      </div>}
    </Modal>
  );
}

function EmployeeProfile({ emp, onClose, onEdit, deptName, jobName }: { emp: Employee; onClose: () => void; onEdit: () => void; deptName?: string; jobName?: string }) {
  const seePay = useSeePay();
  const [tab, setTab] = useState<"overview" | "pay" | "leave" | "docs" | "discipline" | "appraisals">("overview");
  const qc = useQueryClient();
  const { toast } = useToast();
  const remove = async () => {
    if (!(await confirmAction({ title: `Delete ${fullName(emp)}?`, message: "Their payslips, leave and attendance are deleted too. To keep the history, set the status to Resigned or Terminated instead.", danger: true, confirmLabel: "Delete" }))) return;
    const { error } = await sb.from("hr_employees").delete().eq("id", emp.id);
    if (error) return toast({ title: "Not deleted", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["hr-employees"] });
    onClose();
  };
  /** My Space: lets the employee correct their own bio data, next of kin and bank details once (locks again after saving). */
  const toggleLock = async () => {
    const next = !(emp as any).self_edit_unlocked;
    const { error } = await sb.from("hr_employees").update({ self_edit_unlocked: next }).eq("id", emp.id);
    if (error) return toast({ title: "Not changed", description: error.message, variant: "destructive" });
    toast({ title: next ? "They can now edit their details in My Space" : "Details locked" }); qc.invalidateQueries({ queryKey: ["hr-employees"] });
  };
  const info: [any, string, any][] = [
    [Building2, "Department · Job", `${deptName || "—"} · ${jobName || "—"}`], [CalendarDays, "Hired", fmtDate(emp.hire_date)], [Phone, "Phone", emp.phone || "—"], [Mail, "Email", emp.email || "—"],
    [IdCard, "ID · KRA PIN", `${emp.national_id || "—"} · ${emp.kra_pin || "—"}`], [IdCard, "NSSF · SHA", `${emp.nssf_no || "—"} · ${emp.shif_no || "—"}`],
    ...(seePay ? [[Wallet, "Basic + house", formatKES(Number(emp.basic_salary) + Number(emp.house_allowance))]] as [any, string, any][] : []), ...(!seePay ? [] : [[Wallet, "Paid by", emp.payment_method === "bank" ? `${emp.bank_name || "Bank"} ${emp.bank_account || ""}` : emp.payment_method === "mpesa" ? `M-Pesa ${emp.mpesa_phone || ""}` : emp.payment_method]] as [any, string, any][]),
  ];
  return (
    <Modal open onClose={onClose} title={fullName(emp)} description={`${emp.employee_no || ""} · ${emp.employment_type} · ${emp.status.replace("_", " ")}`} icon={IdCard} size="2xl"
      footer={<><Button variant="ghost" className="text-destructive" onClick={remove}><Trash2 /> Delete</Button>{emp.user_id && <Button variant="outline" className="sm:ml-auto" onClick={toggleLock}>{(emp as any).self_edit_unlocked ? "Lock details" : "Let them edit details"}</Button>}<Button onClick={onEdit}><Pencil /> Edit</Button></>}>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">
        {([["overview", "Overview"], ...(seePay ? [["pay", "Pay items & loans"]] as const : []), ["leave", "Leave"], ["docs", "Documents"], ["discipline", "Discipline"], ["appraisals", "Appraisals"]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setTab(v)} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-sm", tab === v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{l}</button>
        ))}
      </div>
      {tab === "overview" && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{info.map(([I, l, v]) => (
        <div key={l} className="rounded-xl border border-border p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><I className="h-3.5 w-3.5" />{l}</p><p className="mt-0.5 font-medium">{v}</p></div>
      ))}{emp.next_of_kin?.name && <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Next of kin</p><p className="mt-0.5 font-medium">{emp.next_of_kin.name} ({emp.next_of_kin.relationship || "—"}) {emp.next_of_kin.phone}</p></div>}<EmployeeLoginCard emp={emp as any} /></div>}
      {tab === "pay" && seePay && <PayItems emp={emp} />}
      {tab === "leave" && <EmpLeave emp={emp} />}
      {tab === "docs" && <DocumentsPanel entityType="employee" entityId={emp.id} entityName={fullName(emp)} checklist={EMPLOYEE_DOCS} />}
      {tab === "discipline" && <SimpleList emp={emp} table="hr_disciplinary" title="Disciplinary record" icon={Gavel} fields={[["date", "Date", "date"], ["kind", "Type (verbal/written/final warning, suspension…)", "text"], ["description", "What happened", "area"], ["action", "Action taken", "text"]]} />}
      {tab === "appraisals" && <SimpleList emp={emp} table="hr_appraisals" title="Appraisals" icon={Star} fields={[["period", "Period (e.g. 2026 H1)", "text"], ["score", "Score (1–5)", "number"], ["reviewer", "Reviewer", "text"], ["strengths", "Strengths", "area"], ["improvements", "To improve", "area"], ["goals", "Goals", "area"]]} />}
    </Modal>
  );
}

function PayItems({ emp }: { emp: Employee }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [n, setN] = useState({ kind: "allowance", name: "", amount: "", taxable: true });
  const { data } = useQuery({
    queryKey: ["hr-pay-items", emp.id],
    queryFn: async () => {
      const [i, l] = await Promise.all([sb.from("hr_pay_items").select("*").eq("employee_id", emp.id).order("created_at"), sb.from("hr_loans").select("*").eq("employee_id", emp.id).order("issued_on", { ascending: false })]);
      return { items: (i.data || []) as any[], loans: (l.data || []) as any[] };
    },
  });
  const add = async () => {
    if (!n.name.trim() || !(Number(n.amount) > 0)) return toast({ title: "Enter a name and amount", variant: "destructive" });
    const { error } = await sb.from("hr_pay_items").insert({ tenant_id: emp.tenant_id, employee_id: emp.id, kind: n.kind, name: n.name.trim(), amount: Number(n.amount), taxable: n.kind === "deduction" ? false : n.taxable });
    if (error) return toast({ title: "Not added", description: error.message, variant: "destructive" });
    setN({ ...n, name: "", amount: "" });
    qc.invalidateQueries({ queryKey: ["hr-pay-items", emp.id] });
  };
  const toggle = async (it: any) => { await sb.from("hr_pay_items").update({ active: !it.active }).eq("id", it.id); qc.invalidateQueries({ queryKey: ["hr-pay-items", emp.id] }); };
  const del = async (it: any) => { await sb.from("hr_pay_items").delete().eq("id", it.id); qc.invalidateQueries({ queryKey: ["hr-pay-items", emp.id] }); };
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[140px_1fr_140px_auto_auto] sm:items-end">
        <Field label="Type"><select className="fi" value={n.kind} onChange={(e) => setN({ ...n, kind: e.target.value })}><option value="allowance">Allowance</option><option value="benefit">Benefit (non-cash)</option><option value="deduction">Deduction</option></select></Field>
        <Field label="Name"><input className="fi" value={n.name} placeholder="Transport, SACCO…" onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
        <Field label="Monthly amount"><input className="fi" type="number" value={n.amount} onChange={(e) => setN({ ...n, amount: e.target.value })} /></Field>
        {n.kind !== "deduction" && <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={n.taxable} onChange={(e) => setN({ ...n, taxable: e.target.checked })} /> Taxable</label>}
        <Button onClick={add}><Plus /> Add</Button>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {(data?.items || []).length === 0 && <li className="p-3 text-sm text-muted-foreground">No allowances or deductions yet.</li>}
        {(data?.items || []).map((it) => (
          <li key={it.id} className={cn("flex items-center gap-3 p-3 text-sm", !it.active && "opacity-50")}>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", it.kind === "deduction" ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success")}>{it.kind}</span>
            <span className="flex-1">{it.name}{it.kind !== "deduction" && !it.taxable ? " (not taxed)" : ""}</span>
            <b className="tabular-nums">{formatKES(Number(it.amount))}</b>
            <Button size="sm" variant="ghost" onClick={() => toggle(it)}>{it.active ? "Pause" : "Resume"}</Button>
            <button className="icon-btn-danger" onClick={() => del(it)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
      {(data?.loans || []).length > 0 && <div><p className="mb-1 text-sm font-semibold">Loans & advances</p>
        <ul className="space-y-1 text-sm">{data!.loans.map((l) => <li key={l.id} className="flex justify-between rounded-lg bg-muted/50 px-3 py-1.5"><span className="capitalize">{l.kind} · {fmtDate(l.issued_on)} · {l.status}</span><b>{formatKES(Number(l.balance))} left</b></li>)}</ul></div>}
    </div>
  );
}

function EmpLeave({ emp }: { emp: Employee }) {
  const { data: lk } = useHrLookups();
  const { data = [] } = useQuery({
    queryKey: ["hr-emp-leave", emp.id],
    queryFn: async () => (await sb.from("hr_leave_requests").select("*").eq("employee_id", emp.id).order("start_date", { ascending: false })).data || [],
  });
  const year = String(new Date().getFullYear());
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {(lk?.leaveTypes || []).filter((t) => t.days_per_year > 0 && (!t.gender || t.gender === emp.gender)).map((t) => {
          const used = (data as any[]).filter((r) => r.leave_type_id === t.id && r.status === "approved" && String(r.start_date).startsWith(year)).reduce((a, r) => a + Number(r.days), 0);
          return <div key={t.id} className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">{t.name}</p><p className="font-display text-lg font-bold">{Math.max(0, t.days_per_year - used)} <span className="text-xs font-normal text-muted-foreground">of {t.days_per_year} left</span></p></div>;
        })}
      </div>
      <ul className="space-y-1 text-sm">{(data as any[]).map((r) => <li key={r.id} className="flex justify-between rounded-lg bg-muted/50 px-3 py-1.5"><span>{(lk?.leaveTypes || []).find((t) => t.id === r.leave_type_id)?.name || "Leave"} · {fmtDate(r.start_date)} – {fmtDate(r.end_date)}</span><span className="capitalize">{r.days} d · {r.status}</span></li>)}</ul>
    </div>
  );
}

function SimpleList({ emp, table, title, icon: Icon, fields }: { emp: Employee; table: string; title: string; icon: any; fields: [string, string, string][] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const blank = Object.fromEntries(fields.map(([k, , t]) => [k, t === "date" ? ymd() : ""]));
  const [f, setF] = useState<any>(blank);
  const [open, setOpen] = useState(false);
  useEffect(() => setF(blank), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data = [] } = useQuery({ queryKey: [table, emp.id], queryFn: async () => (await sb.from(table).select("*").eq("employee_id", emp.id).order("created_at", { ascending: false })).data || [] });
  const add = async () => {
    const payload: any = { tenant_id: emp.tenant_id, employee_id: emp.id };
    for (const [k, , t] of fields) payload[k] = f[k] === "" ? null : t === "number" ? Number(f[k]) : f[k];
    if (!payload[fields[0][0]]) return toast({ title: `Enter the ${fields[0][1].toLowerCase()}`, variant: "destructive" });
    const { error } = await sb.from(table).insert(payload);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    setOpen(false);
    qc.invalidateQueries({ queryKey: [table, emp.id] });
  };
  const del = async (id: string) => { await sb.from(table).delete().eq("id", id); qc.invalidateQueries({ queryKey: [table, emp.id] }); };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="flex items-center gap-2 font-semibold"><Icon className="h-4 w-4 text-primary" />{title}</p><Button size="sm" variant="outline" onClick={() => setOpen(!open)}><Plus /> Add</Button></div>
      {open && <div className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-2">
        {fields.map(([k, l, t]) => <Field key={k} label={l} className={t === "area" ? "sm:col-span-2" : ""}>{t === "area" ? <textarea className="fi" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /> : <input className="fi" type={t} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>)}
        <div className="sm:col-span-2"><Button onClick={add}>Save</Button></div>
      </div>}
      {(data as any[]).length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : (
        <ul className="space-y-2">{(data as any[]).map((r) => (
          <li key={r.id} className="rounded-xl border border-border p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">{fields.map(([k, l, t]) => r[k] ? <p key={k}><span className="text-muted-foreground">{l.split(" (")[0]}: </span>{t === "url" ? <a href={r[k]} target="_blank" rel="noopener noreferrer" className="text-primary underline">Open</a> : t === "date" ? fmtDate(r[k]) : String(r[k])}</p> : null)}</div>
              <button className="icon-btn-danger" onClick={() => del(r.id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
            </div>
          </li>
        ))}</ul>
      )}
    </div>
  );
}
