import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileSignature, ArrowRightLeft, ListChecks, DoorOpen, Megaphone, BookOpenCheck, HardHat, Timer, Plus, Check, X, Printer, RefreshCw, Download, Trash2, Pencil, CheckCircle2, AlertTriangle, Wallet, CalendarCheck,
} from "lucide-react";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, TableWrap, Pill, Segmented } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { formatKES } from "@/lib/format";
import { fmtDate } from "@/lib/doc-pdf";
import { computePayslip } from "@/lib/kenyaPayroll";
import { useBusinessSettings } from "@/hooks/useData";
import { confirmAction } from "@/components/books/confirm";
import { cn } from "@/lib/utils";
import { sb, useEmployees, useHrLookups, useHrSettings, fullName, ymd, csvOf, EMPLOYMENT_TYPES, type Employee } from "./hrData";

import { PagedRows } from "@/components/Pager";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const days = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000);
const downloadCsv = (name: string, rows: (string | number | null | undefined)[][]) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csvOf(rows)], { type: "text/csv" }));
  a.download = name; a.click();
};
/** Opens a printable page (letters, certificates) in a new tab. */
function printPage(title: string, body: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:Inter,Arial,sans-serif;color:#222;max-width:720px;margin:40px auto;padding:0 24px;font-size:14px;line-height:1.6}
    h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 6px}table{width:100%;border-collapse:collapse;margin-top:8px}
    td,th{border-bottom:1px solid #e5e5e5;padding:6px 4px;text-align:left}td.n,th.n{text-align:right}.muted{color:#777;font-size:12px}
    .sig{margin-top:56px;display:flex;gap:48px}.sig div{flex:1;border-top:1px solid #333;padding-top:6px;font-size:12px}
  </style></head><body>${body}<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}
const useActive = () => {
  const { data: emps = [], ...rest } = useEmployees();
  return { emps, active: emps.filter((e) => !["terminated", "resigned"].includes(e.status)), byId: new Map(emps.map((e) => [e.id, e])), ...rest };
};
const EmpSelect = ({ value, onChange, list }: { value: string; onChange: (v: string) => void; list: Employee[] }) => (
  <select className="fi" value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">Select employee…</option>
    {list.map((e) => <option key={e.id} value={e.id}>{fullName(e)}{e.employee_no ? ` · ${e.employee_no}` : ""}</option>)}
  </select>
);

/* ───────────────────────────── Contracts ───────────────────────────── */

const CONTRACT_KINDS: [string, string][] = [["permanent", "Permanent"], ["fixed_term", "Fixed term"], ["probation", "Probation"], ["casual", "Casual"], ["internship", "Internship / attachment"], ["consultancy", "Consultancy"]];
const kindLabel = (k: string) => CONTRACT_KINDS.find((x) => x[0] === k)?.[1] || k;

export function Contracts() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: biz } = useBusinessSettings();
  const { active, byId, emps } = useActive();
  const [tab, setTab] = useState<"active" | "expiring" | "all">("active");
  const [edit, setEdit] = useState<any | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ["hr-contracts", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("hr_contracts").select("*").eq("tenant_id", tenantId).order("start_date", { ascending: false })).data || [] });
  const today = ymd();
  const left = (c: any) => (c.end_date ? days(today, c.end_date) : null);
  const expiring = (data as any[]).filter((c) => c.status === "active" && left(c) !== null && (left(c) as number) <= 60);
  const rows = tab === "expiring" ? expiring : tab === "active" ? (data as any[]).filter((c) => c.status === "active") : (data as any[]);
  const blank = () => ({ employee_id: "", kind: "permanent", start_date: today, end_date: "", salary: "", notice_days: 30, terms: "", status: "active", signed_on: "" });
  const save = async () => {
    if (!edit.employee_id) return toast({ title: "Pick the employee", variant: "destructive" });
    const row = { ...edit, tenant_id: tenantId, salary: Number(edit.salary) || 0, notice_days: Number(edit.notice_days) || 30, end_date: edit.end_date || null, signed_on: edit.signed_on || null };
    const { error } = edit.id ? await sb.from("hr_contracts").update(row).eq("id", edit.id) : await sb.from("hr_contracts").insert({ ...row, contract_no: `CT-${String((data as any[]).length + 1).padStart(4, "0")}` });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    if (row.end_date) await sb.from("hr_employees").update({ contract_end: row.end_date }).eq("id", row.employee_id);
    toast({ title: "Contract saved" }); setEdit(null); qc.invalidateQueries({ queryKey: ["hr-contracts"] });
  };
  const renew = (c: any) => {
    const start = c.end_date ? ymd(new Date(new Date(`${c.end_date}T00:00:00`).getTime() + 86400000)) : today;
    setEdit({ ...blank(), employee_id: c.employee_id, kind: c.kind, start_date: start, salary: c.salary, notice_days: c.notice_days, terms: c.terms || "", _renews: c.id });
  };
  const saveRenewal = async () => { const from = edit._renews; delete edit._renews; await save(); if (from) { await sb.from("hr_contracts").update({ status: "renewed" }).eq("id", from); qc.invalidateQueries({ queryKey: ["hr-contracts"] }); } };
  const print = (c: any) => {
    const e = byId.get(c.employee_id);
    printPage(`Contract ${c.contract_no || ""}`, `<h1>Contract of employment</h1><p class="muted">${esc(biz?.business_name)} · ${esc(c.contract_no)}</p>
      <p>This contract is made between <b>${esc(biz?.business_name)}</b> (the employer) and <b>${esc(fullName(e))}</b>, ID ${esc(e?.national_id || "-")}, KRA PIN ${esc(e?.kra_pin || "-")} (the employee), under the Employment Act, 2007.</p>
      <table><tr><td>Type</td><td>${esc(kindLabel(c.kind))}</td></tr><tr><td>Starts</td><td>${esc(fmtDate(c.start_date))}</td></tr><tr><td>Ends</td><td>${c.end_date ? esc(fmtDate(c.end_date)) : "Open-ended"}</td></tr>
      <tr><td>Monthly basic salary</td><td>${esc(formatKES(Number(c.salary)))}</td></tr><tr><td>Notice period</td><td>${c.notice_days} days</td></tr></table>
      ${c.terms ? `<h2>Terms</h2><p>${esc(c.terms).replace(/\n/g, "<br>")}</p>` : ""}
      <div class="sig"><div>For the employer</div><div>Employee</div></div>`);
  };
  if (isLoading) return <OrbLoader label="Loading contracts…" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Contracts" icon={FileSignature} actions={<Button onClick={() => setEdit(blank())}><Plus /> New contract</Button>} />
      <StatGrid>
        <StatTile label="Active contracts" value={(data as any[]).filter((c) => c.status === "active").length} icon={FileSignature} tone="primary" />
        <StatTile label="Ending in 60 days" value={expiring.length} icon={AlertTriangle} tone={expiring.length ? "warning" : "muted"} />
        <StatTile label="Staff without a contract" value={active.filter((e) => !(data as any[]).some((c) => c.employee_id === e.id && c.status === "active")).length} icon={X} tone="danger" />
        <StatTile label="Fixed term" value={(data as any[]).filter((c) => c.status === "active" && c.kind === "fixed_term").length} icon={Timer} tone="info" />
      </StatGrid>
      <Segmented value={tab} onChange={(v) => setTab(v as typeof tab)} options={[{ value: "active", label: "Active" }, { value: "expiring", label: "Ending soon", count: expiring.length }, { value: "all", label: "All" }]} />
      <Panel flush>
        {rows.length === 0 ? <EmptyState icon={FileSignature} title="No contracts here" /> : (
          <TableWrap><table className="dt"><thead><tr><th>Employee</th><th>Type</th><th>Starts</th><th>Ends</th><th className="num">Salary</th><th>Status</th><th /></tr></thead>
            <tbody><PagedRows rows={rows} colSpan={7}>{(pageRows) => pageRows.map((c) => { const l = left(c); return (
              <tr key={c.id}>
                <td className="font-medium">{fullName(byId.get(c.employee_id))}<span className="block text-xs font-normal text-muted-foreground">{c.contract_no}</span></td>
                <td>{kindLabel(c.kind)}</td><td>{fmtDate(c.start_date)}</td>
                <td>{c.end_date ? fmtDate(c.end_date) : "Open-ended"}{l !== null && c.status === "active" && <span className={cn("block text-xs", l < 0 ? "text-destructive" : l <= 60 ? "text-[hsl(32_90%_38%)]" : "text-muted-foreground")}>{l < 0 ? `${-l} days ago` : `${l} days left`}</span>}</td>
                <td className="num">{formatKES(Number(c.salary))}</td>
                <td><Pill tone={c.status === "active" ? "success" : c.status === "draft" ? "warning" : "muted"}>{c.status}</Pill></td>
                <td><span className="flex justify-end gap-1">
                  {c.status === "active" && c.end_date && <Button size="sm" variant="outline" onClick={() => renew(c)}><RefreshCw /> Renew</Button>}
                  <button className="icon-btn" onClick={() => print(c)} aria-label="Print"><Printer className="h-4 w-4" /></button>
                  <button className="icon-btn" onClick={() => setEdit({ ...c, end_date: c.end_date || "", signed_on: c.signed_on || "" })} aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                </span></td>
              </tr>); })}</PagedRows></tbody></table></TableWrap>
        )}
      </Panel>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?._renews ? "Renew contract" : edit?.id ? "Edit contract" : "New contract"} icon={FileSignature} size="lg"
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={edit?._renews ? saveRenewal : save}>Save</Button></>}>
        {edit && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Employee" required className="sm:col-span-2"><EmpSelect value={edit.employee_id} onChange={(v) => { const e = byId.get(v); setEdit({ ...edit, employee_id: v, salary: edit.salary || e?.basic_salary || "" }); }} list={edit.id ? emps : active} /></Field>
          <Field label="Type"><select className="fi" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{CONTRACT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Status"><select className="fi" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{["draft", "active", "expired", "terminated", "renewed"].map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}</select></Field>
          <Field label="Starts"><input className="fi" type="date" value={edit.start_date} onChange={(e) => setEdit({ ...edit, start_date: e.target.value })} /></Field>
          <Field label="Ends" hint="Empty for open-ended"><input className="fi" type="date" value={edit.end_date} onChange={(e) => setEdit({ ...edit, end_date: e.target.value })} /></Field>
          <Field label="Monthly basic salary"><input className="fi" type="number" placeholder="0" value={edit.salary} onChange={(e) => setEdit({ ...edit, salary: e.target.value })} /></Field>
          <Field label="Notice (days)"><input className="fi" type="number" value={edit.notice_days} onChange={(e) => setEdit({ ...edit, notice_days: e.target.value })} /></Field>
          <Field label="Signed on"><input className="fi" type="date" value={edit.signed_on} onChange={(e) => setEdit({ ...edit, signed_on: e.target.value })} /></Field>
          <Field label="Terms" className="sm:col-span-2"><textarea className="fi min-h-[110px]" value={edit.terms} onChange={(e) => setEdit({ ...edit, terms: e.target.value })} placeholder="Duties, hours, benefits, probation, confidentiality…" /></Field>
        </div>}
      </Modal>
    </div>
  );
}

/* ───────────────────────────── Movements ───────────────────────────── */

const MOVE_KINDS: [string, string][] = [["promotion", "Promotion"], ["salary_change", "Pay change"], ["transfer", "Transfer"], ["redesignation", "Change of title"], ["confirmation", "Confirmation after probation"], ["acting", "Acting appointment"], ["demotion", "Demotion"]];

export function Movements() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { active, byId } = useActive();
  const { data: lk } = useHrLookups();
  const { data: locs = [] } = useQuery({ queryKey: ["locations-lite", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("locations").select("id,name").eq("tenant_id", tenantId).order("name")).data || [] });
  const [edit, setEdit] = useState<any | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ["hr-movements", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("hr_movements").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false })).data || [] });
  const nameOf = (list: any[] | undefined, id?: string) => list?.find((x) => x.id === id)?.name || "";
  const describe = (d: any) => [nameOf(lk?.designations, d.designation_id), nameOf(lk?.departments, d.department_id), nameOf(locs as any[], d.location_id), d.basic_salary ? formatKES(Number(d.basic_salary)) : "", d.employment_type || ""].filter(Boolean).join(" · ") || "-";
  const save = async () => {
    const e = byId.get(edit.employee_id);
    if (!e) return toast({ title: "Pick the employee", variant: "destructive" });
    const to: any = {};
    for (const k of ["designation_id", "department_id", "location_id", "manager_id", "basic_salary", "house_allowance", "employment_type"]) if (edit[k] !== "" && edit[k] !== undefined && String(edit[k]) !== String((e as any)[k] ?? "")) to[k] = edit[k];
    if (!Object.keys(to).length && edit.kind !== "confirmation") return toast({ title: "Change at least one thing", variant: "destructive" });
    const from = Object.fromEntries(["designation_id", "department_id", "location_id", "manager_id", "basic_salary", "house_allowance", "employment_type"].map((k) => [k, (e as any)[k]]));
    const { error } = await sb.from("hr_movements").insert({ tenant_id: tenantId, employee_id: e.id, kind: edit.kind, effective_date: edit.effective_date, reason: edit.reason || null, from_data: from, to_data: to });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Movement recorded", description: "Approve it to apply the change." }); setEdit(null); qc.invalidateQueries({ queryKey: ["hr-movements"] });
  };
  const decide = async (m: any, ok: boolean) => {
    const { error } = await sb.rpc("hr_apply_movement", { p_id: m.id, p_approve: ok });
    if (error) return toast({ title: "Not done", description: error.message, variant: "destructive" });
    toast({ title: ok ? "Applied to the employee" : "Rejected" }); qc.invalidateQueries({ queryKey: ["hr-movements"] }); qc.invalidateQueries({ queryKey: ["hr-employees"] });
  };
  const pick = (id: string) => { const e = byId.get(id); setEdit({ ...edit, employee_id: id, designation_id: e?.designation_id || "", department_id: e?.department_id || "", location_id: (e as any)?.location_id || "", manager_id: e?.manager_id || "", basic_salary: e?.basic_salary ?? "", house_allowance: e?.house_allowance ?? "", employment_type: e?.employment_type || "" }); };
  if (isLoading) return <OrbLoader label="Loading…" />;
  const pending = (data as any[]).filter((m) => m.status === "pending");
  return (
    <div className="space-y-5">
      <PageHeader title="Movements" icon={ArrowRightLeft} actions={<Button onClick={() => setEdit({ kind: "promotion", effective_date: ymd(), employee_id: "", reason: "" })}><Plus /> New movement</Button>} />
      <Panel flush>
        {(data as any[]).length === 0 ? <EmptyState icon={ArrowRightLeft} title="No promotions, transfers or pay changes yet" /> : (
          <TableWrap><table className="dt"><thead><tr><th>Employee</th><th>Change</th><th>From</th><th>To</th><th>Effective</th><th>Status</th></tr></thead>
            <tbody><PagedRows rows={(data as any[])} colSpan={6}>{(pageRows) => pageRows.map((m) => (
              <tr key={m.id}>
                <td className="font-medium">{fullName(byId.get(m.employee_id))}</td>
                <td>{MOVE_KINDS.find((k) => k[0] === m.kind)?.[1] || m.kind}{m.reason && <span className="block text-xs text-muted-foreground">{m.reason}</span>}</td>
                <td className="text-muted-foreground">{describe(Object.fromEntries(Object.keys(m.to_data || {}).map((k) => [k, m.from_data?.[k]])))}</td>
                <td className="font-medium">{describe(m.to_data || {})}</td>
                <td>{fmtDate(m.effective_date)}</td>
                <td>{m.status === "pending" ? <span className="flex gap-1"><Button size="sm" onClick={() => decide(m, true)}><Check /> Approve</Button><Button size="sm" variant="ghost" onClick={() => decide(m, false)} aria-label="Reject"><X /></Button></span> : <Pill tone={m.status === "applied" ? "success" : "muted"}>{m.status}</Pill>}</td>
              </tr>))}</PagedRows></tbody></table></TableWrap>
        )}
      </Panel>
      {pending.length > 0 && <p className="text-xs text-muted-foreground">{pending.length} waiting for approval. Approving updates the employee record and the next payroll.</p>}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="New movement" icon={ArrowRightLeft} size="lg" footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {edit && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Employee" required className="sm:col-span-2"><EmpSelect value={edit.employee_id} onChange={pick} list={active} /></Field>
          <Field label="Change"><select className="fi" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{MOVE_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Effective"><input className="fi" type="date" value={edit.effective_date} onChange={(e) => setEdit({ ...edit, effective_date: e.target.value })} /></Field>
          {edit.employee_id && <>
            <Field label="Job title"><select className="fi" value={edit.designation_id} onChange={(e) => setEdit({ ...edit, designation_id: e.target.value })}><option value="">-</option>{(lk?.designations || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field label="Department"><select className="fi" value={edit.department_id} onChange={(e) => setEdit({ ...edit, department_id: e.target.value })}><option value="">-</option>{(lk?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field label="Branch"><select className="fi" value={edit.location_id} onChange={(e) => setEdit({ ...edit, location_id: e.target.value })}><option value="">-</option>{(locs as any[]).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field label="Reports to"><select className="fi" value={edit.manager_id} onChange={(e) => setEdit({ ...edit, manager_id: e.target.value })}><option value="">-</option>{active.filter((x) => x.id !== edit.employee_id).map((x) => <option key={x.id} value={x.id}>{fullName(x)}</option>)}</select></Field>
            <Field label="Basic salary"><input className="fi" type="number" value={edit.basic_salary} onChange={(e) => setEdit({ ...edit, basic_salary: e.target.value })} /></Field>
            <Field label="House allowance"><input className="fi" type="number" value={edit.house_allowance} onChange={(e) => setEdit({ ...edit, house_allowance: e.target.value })} /></Field>
            <Field label="Employment type"><select className="fi" value={edit.employment_type} onChange={(e) => setEdit({ ...edit, employment_type: e.target.value })}>{EMPLOYMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          </>}
          <Field label="Reason" className="sm:col-span-2"><input className="fi" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} placeholder="e.g. Annual review 2026" /></Field>
        </div>}
      </Modal>
    </div>
  );
}

/* ─────────────────────── Onboarding & offboarding ─────────────────────── */

const ONBOARD = ["Signed contract of employment", "Copy of national ID / passport", "KRA PIN certificate", "NSSF number", "SHA (SHIF) number", "Bank or M-Pesa details", "Next of kin details", "Login created in JMSURF Garage", "Equipment, uniform and keys issued", "Policies read and acknowledged", "Introduced to the team"];
const OFFBOARD = ["Resignation or termination letter on file", "Handover done", "Company property returned", "Loans and advances cleared", "Login disabled", "Final dues worked out and paid", "Certificate of service issued (s.51)", "Exit interview"];

export function Onboarding() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { emps, byId } = useActive();
  const [kind, setKind] = useState<"onboarding" | "offboarding">("onboarding");
  const [start, setStart] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const { data = [], isLoading } = useQuery({ queryKey: ["hr-tasks", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("hr_tasks").select("*").eq("tenant_id", tenantId).order("sort")).data || [] });
  const mine = (data as any[]).filter((t) => t.kind === kind);
  const people = [...new Set(mine.map((t) => t.employee_id))];
  const begin = async () => {
    if (!start) return;
    if (mine.some((t) => t.employee_id === start)) return toast({ title: "A checklist is already open for this person" });
    const list = kind === "onboarding" ? ONBOARD : OFFBOARD;
    const { error } = await sb.from("hr_tasks").insert(list.map((title, i) => ({ tenant_id: tenantId, employee_id: start, kind, title, sort: i })));
    if (error) return toast({ title: "Not started", description: error.message, variant: "destructive" });
    setStart(""); qc.invalidateQueries({ queryKey: ["hr-tasks"] });
  };
  const toggle = async (t: any) => { await sb.from("hr_tasks").update({ done_at: t.done_at ? null : new Date().toISOString() }).eq("id", t.id); qc.invalidateQueries({ queryKey: ["hr-tasks"] }); };
  const add = async (empId: string) => {
    const title = (extra[empId] || "").trim(); if (!title) return;
    await sb.from("hr_tasks").insert({ tenant_id: tenantId, employee_id: empId, kind, title, sort: 99 });
    setExtra({ ...extra, [empId]: "" }); qc.invalidateQueries({ queryKey: ["hr-tasks"] });
  };
  const remove = async (empId: string) => {
    if (!(await confirmAction({ title: "Remove this checklist?", danger: true, confirmLabel: "Remove" }))) return;
    await sb.from("hr_tasks").delete().eq("employee_id", empId).eq("kind", kind); qc.invalidateQueries({ queryKey: ["hr-tasks"] });
  };
  if (isLoading) return <OrbLoader label="Loading…" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Onboarding & exits" icon={ListChecks} />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={kind} onChange={(v) => setKind(v as typeof kind)} options={[{ value: "onboarding", label: "Onboarding" }, { value: "offboarding", label: "Offboarding" }]} />
        <div className="flex w-full gap-2 sm:ml-auto sm:w-auto"><div className="min-w-0 flex-1 sm:w-64 sm:flex-none"><EmpSelect value={start} onChange={setStart} list={emps} /></div><Button onClick={begin} disabled={!start}><Plus /> Start checklist</Button></div>
      </div>
      {people.length === 0 ? <Panel><EmptyState icon={ListChecks} title={`No ${kind} checklists open`} description="Pick a person and start one." /></Panel> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {people.map((pid) => {
            const tasks = mine.filter((t) => t.employee_id === pid);
            const done = tasks.filter((t) => t.done_at).length;
            return (
              <Panel key={pid} title={fullName(byId.get(pid))} icon={ListChecks} actions={<><Pill tone={done === tasks.length ? "success" : "warning"}>{done}/{tasks.length}</Pill><button className="icon-btn-danger" onClick={() => remove(pid)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button></>}>
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-success transition-all" style={{ width: `${(done / Math.max(1, tasks.length)) * 100}%` }} /></div>
                <ul className="space-y-1">{tasks.map((t) => (
                  <li key={t.id}><label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-muted/50">
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={!!t.done_at} onChange={() => toggle(t)} />
                    <span className={cn("flex-1", t.done_at && "text-muted-foreground line-through")}>{t.title}</span>
                    {t.done_at && <span className="text-[11px] text-muted-foreground">{fmtDate(t.done_at)}</span>}
                  </label></li>))}</ul>
                <div className="mt-2 flex gap-2"><input className="fi h-8" placeholder="Add a step…" value={extra[pid] || ""} onChange={(e) => setExtra({ ...extra, [pid]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add(pid)} /><Button size="sm" variant="outline" onClick={() => add(pid)}><Plus /></Button></div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Separations ───────────────────────────── */

const SEP_KINDS: [string, string][] = [["resignation", "Resignation"], ["termination", "Termination"], ["summary_dismissal", "Summary dismissal"], ["redundancy", "Redundancy"], ["end_of_contract", "End of contract"], ["retirement", "Retirement"], ["death", "Death in service"], ["desertion", "Desertion"]];

/** Employment Act, 2007 final dues: salary to the last day, leave not taken, notice (s.35/36), severance on redundancy (s.40: 15 days a completed year). */
function finalDues(e: Employee, s: { kind: string; last_day: string; notice_days: number; notice_served: boolean; leave_days_due: number; gratuity: number; other: number; loans: number }, workingDays: number) {
  const basic = Number(e.basic_salary) || 0, house = Number(e.house_allowance) || 0;
  const daily = basic / 30;
  const last = new Date(`${s.last_day}T00:00:00`);
  const daysWorked = last.getDate();
  const salary = Math.round(((basic + house) / new Date(last.getFullYear(), last.getMonth() + 1, 0).getDate()) * daysWorked);
  const leave = Math.round((basic / workingDays) * s.leave_days_due);
  const employerEnds = ["termination", "redundancy", "end_of_contract", "retirement"].includes(s.kind);
  const noticePay = !s.notice_served && employerEnds && s.kind !== "end_of_contract" ? Math.round(((basic + house) / 30) * s.notice_days) : 0;
  const noticeOwed = !s.notice_served && s.kind === "resignation" ? Math.round(((basic + house) / 30) * s.notice_days) : 0;
  const years = Math.floor(days(e.hire_date, s.last_day) / 365.25);
  const severance = s.kind === "redundancy" ? Math.round(daily * 15 * years) : 0;
  const gross = salary + leave + noticePay + severance + s.gratuity + s.other;
  return { salary, daysWorked, leave, noticePay, severance, gratuity: s.gratuity, other: s.other, gross, noticeOwed, loans: s.loans, years };
}

export function Separations() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: biz } = useBusinessSettings();
  const { rates } = useHrSettings();
  const { active, byId } = useActive();
  const { data: lk } = useHrLookups();
  const [edit, setEdit] = useState<any | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ["hr-separations", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("hr_separations").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false })).data || [] });
  const { data: loans = [] } = useQuery({ queryKey: ["hr-loans", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("hr_loans").select("*").eq("tenant_id", tenantId)).data || [] });
  const loanBal = (id: string) => (loans as any[]).filter((l) => l.employee_id === id && l.status === "active").reduce((a, l) => a + Number(l.balance), 0);
  const emp = edit ? byId.get(edit.employee_id) : undefined;
  const dues = emp && edit?.last_day ? finalDues(emp, { ...edit, notice_days: Number(edit.notice_days) || 0, leave_days_due: Number(edit.leave_days_due) || 0, gratuity: Number(edit.gratuity) || 0, other: Number(edit.other) || 0, loans: loanBal(emp.id) }, rates.working_days || 26) : null;
  const tax = dues && emp ? computePayslip({ basic: dues.gross, allowances: [], deductions: [], loanDeduction: 0, disability: emp.disability_exempt }, rates) : null;
  const net = dues && tax ? Math.max(0, tax.net_pay - dues.noticeOwed - dues.loans) : 0;
  const save = async () => {
    if (!emp || !edit.last_day) return toast({ title: "Pick the person and the last day", variant: "destructive" });
    const row = { tenant_id: tenantId, employee_id: emp.id, kind: edit.kind, notice_date: edit.notice_date, last_day: edit.last_day, reason: edit.reason || null, notice_days: Number(edit.notice_days) || 0, notice_served: edit.notice_served, leave_days_due: Number(edit.leave_days_due) || 0,
      final_dues: { ...dues, gratuity: Number(edit.gratuity) || 0, other: Number(edit.other) || 0, paye: tax?.paye, nssf: tax?.nssf, shif: tax?.shif, housing_levy: tax?.housing_levy, net } };
    const { error } = edit.id ? await sb.from("hr_separations").update(row).eq("id", edit.id) : await sb.from("hr_separations").insert(row);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Exit recorded" }); setEdit(null); qc.invalidateQueries({ queryKey: ["hr-separations"] });
  };
  const close = async (s: any) => {
    if (!(await confirmAction({ title: "Close this exit?", message: "The employee is marked as left on the last day and is no longer included in payroll.", confirmLabel: "Close exit" }))) return;
    await sb.from("hr_separations").update({ status: "closed" }).eq("id", s.id);
    await sb.from("hr_employees").update({ status: s.kind === "resignation" ? "resigned" : "terminated", exit_date: s.last_day, exit_reason: SEP_KINDS.find((k) => k[0] === s.kind)?.[1] }).eq("id", s.employee_id);
    toast({ title: "Exit closed" }); qc.invalidateQueries({ queryKey: ["hr-separations"] }); qc.invalidateQueries({ queryKey: ["hr-employees"] });
  };
  const certificate = (s: any) => {
    const e = byId.get(s.employee_id);
    const title = lk?.designations.find((d) => d.id === e?.designation_id)?.name || "";
    printPage("Certificate of service", `<h1>Certificate of service</h1><p class="muted">Issued under section 51 of the Employment Act, 2007</p>
      <p>This is to certify that <b>${esc(fullName(e))}</b>, ID ${esc(e?.national_id || "-")}, was employed by <b>${esc(biz?.business_name)}</b>${title ? ` as <b>${esc(title)}</b>` : ""} from <b>${esc(fmtDate(e?.hire_date))}</b> to <b>${esc(fmtDate(s.last_day))}</b>.</p>
      <p>We wish ${esc(e?.first_name)} the very best.</p><div class="sig"><div>For ${esc(biz?.business_name)}</div><div>Date</div></div>`);
    void sb.from("hr_separations").update({ certificate_issued_on: ymd() }).eq("id", s.id);
  };
  const statement = (s: any) => {
    const e = byId.get(s.employee_id); const d = s.final_dues || {};
    const line = (l: string, v: unknown) => (Number(v) ? `<tr><td>${l}</td><td class="n">${esc(formatKES(Number(v)))}</td></tr>` : "");
    printPage("Final dues", `<h1>Final dues</h1><p class="muted">${esc(biz?.business_name)} · ${esc(fullName(e))} · last day ${esc(fmtDate(s.last_day))}</p>
      <table>${line(`Salary for ${d.daysWorked || 0} days`, d.salary)}${line(`Leave not taken (${s.leave_days_due} days)`, d.leave)}${line("Pay in lieu of notice", d.noticePay)}${line(`Severance (${d.years || 0} years x 15 days)`, d.severance)}${line("Gratuity", d.gratuity)}${line("Other", d.other)}
      <tr><th>Gross</th><th class="n">${esc(formatKES(Number(d.gross || 0)))}</th></tr>${line("PAYE", d.paye)}${line("NSSF", d.nssf)}${line("SHIF", d.shif)}${line("Housing Levy", d.housing_levy)}${line("Notice not served", d.noticeOwed)}${line("Loans and advances", d.loans)}
      <tr><th>Net payable</th><th class="n">${esc(formatKES(Number(d.net || 0)))}</th></tr></table><div class="sig"><div>Prepared by</div><div>Received by</div></div>`);
  };
  if (isLoading) return <OrbLoader label="Loading…" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Exits" icon={DoorOpen} actions={<Button onClick={() => setEdit({ employee_id: "", kind: "resignation", notice_date: ymd(), last_day: "", notice_days: 30, notice_served: true, leave_days_due: 0, gratuity: "", other: "", reason: "" })}><Plus /> Record an exit</Button>} />
      <Panel flush>
        {(data as any[]).length === 0 ? <EmptyState icon={DoorOpen} title="No exits recorded" /> : (
          <TableWrap><table className="dt"><thead><tr><th>Employee</th><th>Reason</th><th>Notice</th><th>Last day</th><th className="num">Net dues</th><th>Status</th><th /></tr></thead>
            <tbody><PagedRows rows={(data as any[])} colSpan={7}>{(pageRows) => pageRows.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{fullName(byId.get(s.employee_id))}</td>
                <td>{SEP_KINDS.find((k) => k[0] === s.kind)?.[1]}{s.reason && <span className="block text-xs text-muted-foreground">{s.reason}</span>}</td>
                <td>{fmtDate(s.notice_date)}</td><td>{s.last_day ? fmtDate(s.last_day) : "-"}</td>
                <td className="num font-semibold">{formatKES(Number(s.final_dues?.net || 0))}</td>
                <td><Pill tone={s.status === "closed" ? "muted" : "warning"}>{s.status}</Pill></td>
                <td><span className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" onClick={() => statement(s)}><Wallet /> Dues</Button>
                  <Button size="sm" variant="outline" onClick={() => certificate(s)}><Printer /> Certificate</Button>
                  {s.status !== "closed" && <Button size="sm" onClick={() => close(s)}><CheckCircle2 /> Close</Button>}
                </span></td>
              </tr>))}</PagedRows></tbody></table></TableWrap>
        )}
      </Panel>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Record an exit" icon={DoorOpen} size="xl" footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {edit && <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Employee" required className="sm:col-span-2"><EmpSelect value={edit.employee_id} onChange={(v) => setEdit({ ...edit, employee_id: v })} list={active} /></Field>
            <Field label="Reason"><select className="fi" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{SEP_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Notice given on"><input className="fi" type="date" value={edit.notice_date} onChange={(e) => setEdit({ ...edit, notice_date: e.target.value })} /></Field>
            <Field label="Last working day" required><input className="fi" type="date" value={edit.last_day} onChange={(e) => setEdit({ ...edit, last_day: e.target.value })} /></Field>
            <Field label="Notice period (days)"><input className="fi" type="number" value={edit.notice_days} onChange={(e) => setEdit({ ...edit, notice_days: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={edit.notice_served} onChange={(e) => setEdit({ ...edit, notice_served: e.target.checked })} /> Notice served in full</label>
            <Field label="Leave days not taken"><input className="fi" type="number" placeholder="0" value={edit.leave_days_due || ""} onChange={(e) => setEdit({ ...edit, leave_days_due: e.target.value })} /></Field>
            <Field label="Gratuity"><input className="fi" type="number" placeholder="0" value={edit.gratuity} onChange={(e) => setEdit({ ...edit, gratuity: e.target.value })} /></Field>
            <Field label="Other payments"><input className="fi" type="number" placeholder="0" value={edit.other} onChange={(e) => setEdit({ ...edit, other: e.target.value })} /></Field>
            <Field label="Notes"><input className="fi" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} /></Field>
          </div>
          <div className="rounded-2xl bg-muted/50 p-4 text-sm">
            <p className="mb-2 font-semibold">Final dues</p>
            {!dues ? <p className="text-muted-foreground">Pick the person and the last day.</p> : <div className="space-y-1">
              {([["Salary to last day", dues.salary], ["Leave not taken", dues.leave], ["Pay in lieu of notice", dues.noticePay], [`Severance (${dues.years} yrs)`, dues.severance], ["Gratuity", dues.gratuity], ["Other", dues.other]] as [string, number][]).filter(([, v]) => v).map(([l, v]) => <div key={l} className="flex justify-between"><span>{l}</span><span className="tabular-nums">{formatKES(v)}</span></div>)}
              <div className="flex justify-between border-t border-border pt-1 font-semibold"><span>Gross</span><span className="tabular-nums">{formatKES(dues.gross)}</span></div>
              {tax && ([["PAYE", tax.paye], ["NSSF", tax.nssf], ["SHIF", tax.shif], ["Housing Levy", tax.housing_levy], ["Notice not served", dues.noticeOwed], ["Loans", dues.loans]] as [string, number][]).filter(([, v]) => v).map(([l, v]) => <div key={l} className="flex justify-between text-muted-foreground"><span>{l}</span><span className="tabular-nums">-{formatKES(v)}</span></div>)}
              <div className="flex justify-between border-t border-border pt-1 text-base font-bold"><span>Net payable</span><span className="tabular-nums">{formatKES(net)}</span></div>
            </div>}
          </div>
        </div>}
      </Modal>
    </div>
  );
}

/* ───────────────────────────── Memos ───────────────────────────── */

export function Memos() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { active } = useActive();
  const { data: lk } = useHrLookups();
  const [edit, setEdit] = useState<any | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ["hr-memos", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("hr_memos").select("*, hr_memo_reads(employee_id, acked_at)").eq("tenant_id", tenantId).order("published_at", { ascending: false })).data || [] });
  const save = async () => {
    if (!edit.title.trim()) return toast({ title: "Give it a title", variant: "destructive" });
    const row = { tenant_id: tenantId, title: edit.title.trim(), body: edit.body, audience: edit.department_id ? "department" : "all", department_id: edit.department_id || null, requires_ack: edit.requires_ack };
    const { error } = edit.id ? await sb.from("hr_memos").update(row).eq("id", edit.id) : await sb.from("hr_memos").insert(row);
    if (error) return toast({ title: "Not sent", description: error.message, variant: "destructive" });
    toast({ title: edit.id ? "Memo updated" : "Memo published", description: "Staff see it in My Space." }); setEdit(null); qc.invalidateQueries({ queryKey: ["hr-memos"] });
  };
  const del = async (m: any) => { if (!(await confirmAction({ title: "Delete this memo?", danger: true, confirmLabel: "Delete" }))) return; await sb.from("hr_memos").delete().eq("id", m.id); qc.invalidateQueries({ queryKey: ["hr-memos"] }); };
  if (isLoading) return <OrbLoader label="Loading…" />;
  const audience = (m: any) => (m.department_id ? active.filter((e) => e.department_id === m.department_id).length : active.length);
  return (
    <div className="space-y-5">
      <PageHeader title="Memos" icon={Megaphone} actions={<Button onClick={() => setEdit({ title: "", body: "", department_id: "", requires_ack: false })}><Plus /> New memo</Button>} />
      {(data as any[]).length === 0 ? <Panel><EmptyState icon={Megaphone} title="No memos yet" description="Announcements to all staff or one department." /></Panel> : (
        <div className="grid gap-3 lg:grid-cols-2"><PagedRows rows={(data as any[])} gridSpan>{(pageRows) => pageRows.map((m) => {
          const reads = (m.hr_memo_reads || []).length, acks = (m.hr_memo_reads || []).filter((r: any) => r.acked_at).length;
          return (
            <Panel key={m.id} title={m.title} icon={Megaphone} actions={<><button className="icon-btn" onClick={() => setEdit({ ...m, department_id: m.department_id || "" })} aria-label="Edit"><Pencil className="h-4 w-4" /></button><button className="icon-btn-danger" onClick={() => del(m)} aria-label="Delete"><Trash2 className="h-4 w-4" /></button></>}>
              <p className="line-clamp-4 whitespace-pre-line text-sm">{m.body}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{fmtDate(m.published_at)}</span><span>·</span><span>{m.department_id ? lk?.departments.find((d) => d.id === m.department_id)?.name : "All staff"}</span>
                <Pill tone="info">Read {reads}/{audience(m)}</Pill>{m.requires_ack && <Pill tone={acks >= audience(m) ? "success" : "warning"}>Acknowledged {acks}</Pill>}
              </div>
            </Panel>);
        })}</PagedRows></div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit memo" : "New memo"} icon={Megaphone} size="lg" footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>{edit?.id ? "Save" : "Publish"}</Button></>}>
        {edit && <div className="space-y-3">
          <Field label="Title" required><input className="fi" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <Field label="Message"><textarea className="fi min-h-[160px]" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Send to"><select className="fi" value={edit.department_id} onChange={(e) => setEdit({ ...edit, department_id: e.target.value })}><option value="">All staff</option>{(lk?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={edit.requires_ack} onChange={(e) => setEdit({ ...edit, requires_ack: e.target.checked })} /> Staff must acknowledge</label>
          </div>
        </div>}
      </Modal>
    </div>
  );
}

/* ───────────────────────────── Policies ───────────────────────────── */

const POLICY_STARTERS = ["Code of conduct", "Leave policy", "Sexual harassment policy (Employment Act s.6)", "Health and safety (OSHA 2007)", "Data protection (Data Protection Act 2019)", "Anti-bribery and corruption", "Disciplinary procedure", "ICT and acceptable use"];

export function Policies() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { active, byId } = useActive();
  const [edit, setEdit] = useState<any | null>(null);
  const [who, setWho] = useState<any | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ["hr-policies", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("hr_policies").select("*, hr_policy_acks(employee_id, version, acked_at)").eq("tenant_id", tenantId).order("title")).data || [] });
  const save = async () => {
    if (!edit.title.trim()) return toast({ title: "Give it a title", variant: "destructive" });
    const prev = (data as any[]).find((p) => p.id === edit.id);
    const changed = prev && (prev.body !== edit.body || prev.title !== edit.title);
    const row = { tenant_id: tenantId, title: edit.title.trim(), category: edit.category || "General", body: edit.body, requires_ack: edit.requires_ack, status: edit.status, effective_date: edit.effective_date || null, version: prev ? prev.version + (changed && edit.reack ? 1 : 0) : 1, updated_at: new Date().toISOString() };
    const { error } = edit.id ? await sb.from("hr_policies").update(row).eq("id", edit.id) : await sb.from("hr_policies").insert(row);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Policy saved" }); setEdit(null); qc.invalidateQueries({ queryKey: ["hr-policies"] });
  };
  if (isLoading) return <OrbLoader label="Loading…" />;
  const acked = (p: any) => new Set((p.hr_policy_acks || []).filter((a: any) => a.version === p.version).map((a: any) => a.employee_id));
  return (
    <div className="space-y-5">
      <PageHeader title="Policies" icon={BookOpenCheck} actions={<Button onClick={() => setEdit({ title: "", category: "General", body: "", requires_ack: true, status: "published", effective_date: ymd(), reack: true })}><Plus /> New policy</Button>} />
      {(data as any[]).length === 0 && <Panel title="Start with the usual Kenyan policies" icon={BookOpenCheck}>
        <div className="flex flex-wrap gap-2">{POLICY_STARTERS.map((t) => <Button key={t} size="sm" variant="outline" onClick={() => setEdit({ title: t, category: "General", body: "", requires_ack: true, status: "published", effective_date: ymd(), reack: true })}><Plus /> {t}</Button>)}</div>
      </Panel>}
      {(data as any[]).length > 0 && <Panel flush>
        <TableWrap><table className="dt"><thead><tr><th>Policy</th><th>Version</th><th>Effective</th><th>Acknowledged</th><th>Status</th><th /></tr></thead>
          <tbody><PagedRows rows={(data as any[])} colSpan={6}>{(pageRows) => pageRows.map((p) => { const a = acked(p); return (
            <tr key={p.id}>
              <td className="font-medium">{p.title}<span className="block text-xs font-normal text-muted-foreground">{p.category}</span></td>
              <td>v{p.version}</td><td>{p.effective_date ? fmtDate(p.effective_date) : "-"}</td>
              <td>{p.requires_ack ? <button className="text-primary hover:underline" onClick={() => setWho(p)}>{active.filter((e) => a.has(e.id)).length}/{active.length}</button> : "Not needed"}</td>
              <td><Pill tone={p.status === "published" ? "success" : "muted"}>{p.status}</Pill></td>
              <td className="text-right"><button className="icon-btn" onClick={() => setEdit({ ...p, effective_date: p.effective_date || "", reack: true })} aria-label="Edit"><Pencil className="h-4 w-4" /></button></td>
            </tr>); })}</PagedRows></tbody></table></TableWrap>
      </Panel>}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit policy" : "New policy"} icon={BookOpenCheck} size="xl" footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {edit && <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Title" required className="sm:col-span-2"><input className="fi" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <Field label="Category"><input className="fi" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></Field>
          <Field label="Policy text" className="sm:col-span-3"><textarea className="fi min-h-[220px]" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
          <Field label="Effective"><input className="fi" type="date" value={edit.effective_date} onChange={(e) => setEdit({ ...edit, effective_date: e.target.value })} /></Field>
          <Field label="Status"><select className="fi" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option></select></Field>
          <div className="space-y-1 self-end pb-1 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={edit.requires_ack} onChange={(e) => setEdit({ ...edit, requires_ack: e.target.checked })} /> Staff must acknowledge</label>
            {edit.id && <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={edit.reack} onChange={(e) => setEdit({ ...edit, reack: e.target.checked })} /> Ask everyone again if changed</label>}
          </div>
        </div>}
      </Modal>
      <Modal open={!!who} onClose={() => setWho(null)} title={who ? `${who.title} · v${who.version}` : ""} icon={BookOpenCheck}>
        {who && (() => { const a = new Map((who.hr_policy_acks || []).filter((x: any) => x.version === who.version).map((x: any) => [x.employee_id, x.acked_at])); return (
          <ul className="divide-y divide-border text-sm">{active.map((e) => <li key={e.id} className="flex items-center justify-between py-2"><span>{fullName(byId.get(e.id))}</span>{a.has(e.id) ? <span className="text-xs text-success">{fmtDate(a.get(e.id) as string)}</span> : <Pill tone="warning">Not yet</Pill>}</li>)}</ul>); })()}
      </Modal>
    </div>
  );
}

/* ───────────────────────────── Casual workers ───────────────────────────── */

export function Casuals() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [edit, setEdit] = useState<any | null>(null);
  const [log, setLog] = useState<{ date: string; task: string; picked: Record<string, string> } | null>(null);
  const [pay, setPay] = useState<{ id: string; ref: string } | null>(null);
  const { data: people = [], isLoading } = useQuery({ queryKey: ["hr-casuals", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("hr_casuals").select("*").eq("tenant_id", tenantId).order("name")).data || [] });
  const { data: work = [] } = useQuery({ queryKey: ["hr-casual-days", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("hr_casual_days").select("*").eq("tenant_id", tenantId).order("work_date", { ascending: false }).limit(2000)).data || [] });
  const unpaid = (id: string) => (work as any[]).filter((w) => w.casual_id === id && !w.paid_on);
  // Employment Act s.37: a casual paid daily for a continuous month or more is treated as on monthly terms.
  const longRunning = (id: string) => { const ds = [...new Set((work as any[]).filter((w) => w.casual_id === id).map((w) => w.work_date.slice(0, 7)))]; return ds.length >= 3; };
  const saveP = async () => {
    if (!edit.name.trim()) return;
    const row = { tenant_id: tenantId, name: edit.name.trim(), national_id: edit.national_id || null, kra_pin: edit.kra_pin || null, phone: edit.phone || null, mpesa_phone: edit.mpesa_phone || edit.phone || null, daily_rate: Number(edit.daily_rate) || 0, skill: edit.skill || null, active: edit.active };
    const { error } = edit.id ? await sb.from("hr_casuals").update(row).eq("id", edit.id) : await sb.from("hr_casuals").insert(row);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    setEdit(null); qc.invalidateQueries({ queryKey: ["hr-casuals"] });
  };
  const saveLog = async () => {
    const rows = Object.entries(log!.picked).filter(([, d]) => Number(d) > 0).map(([id, d]) => { const p = (people as any[]).find((x) => x.id === id); return { tenant_id: tenantId, casual_id: id, work_date: log!.date, days: Number(d), rate: Number(p.daily_rate), amount: Number(d) * Number(p.daily_rate), task: log!.task || null }; });
    if (!rows.length) return toast({ title: "Tick at least one person", variant: "destructive" });
    const { error } = await sb.from("hr_casual_days").insert(rows);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: `${rows.length} recorded` }); setLog(null); qc.invalidateQueries({ queryKey: ["hr-casual-days"] });
  };
  const markPaid = async () => {
    const ids = unpaid(pay!.id).map((w) => w.id);
    await sb.from("hr_casual_days").update({ paid_on: ymd(), paid_ref: pay!.ref || null }).in("id", ids);
    toast({ title: "Marked paid" }); setPay(null); qc.invalidateQueries({ queryKey: ["hr-casual-days"] });
  };
  const exportList = () => downloadCsv(`casuals-to-pay-${ymd()}.csv`, [["Name", "ID", "M-Pesa", "Days", "Amount"], ...(people as any[]).map((p) => { const u = unpaid(p.id); return [p.name, p.national_id, p.mpesa_phone, u.reduce((a, w) => a + Number(w.days), 0), u.reduce((a, w) => a + Number(w.amount), 0)]; }).filter((r) => Number(r[4]) > 0)]);
  if (isLoading) return <OrbLoader label="Loading…" />;
  const owed = (people as any[]).reduce((a, p) => a + unpaid(p.id).reduce((s, w) => s + Number(w.amount), 0), 0);
  return (
    <div className="space-y-5">
      <PageHeader title="Casual workers" icon={HardHat} actions={<><Button variant="outline" onClick={exportList}><Download /> M-Pesa list</Button><Button variant="outline" onClick={() => setLog({ date: ymd(), task: "", picked: {} })} disabled={!(people as any[]).length}><CalendarCheck /> Record days</Button><Button onClick={() => setEdit({ name: "", daily_rate: "", active: true })}><Plus /> Add worker</Button></>} />
      <StatGrid>
        <StatTile label="Workers" value={(people as any[]).filter((p) => p.active).length} icon={HardHat} tone="primary" />
        <StatTile label="To pay" value={formatKES(owed)} icon={Wallet} tone={owed ? "warning" : "muted"} />
        <StatTile label="Paid this month" value={formatKES((work as any[]).filter((w) => w.paid_on?.startsWith(ymd().slice(0, 7))).reduce((a, w) => a + Number(w.amount), 0))} icon={CheckCircle2} tone="success" />
      </StatGrid>
      <Panel flush>
        {(people as any[]).length === 0 ? <EmptyState icon={HardHat} title="No casual workers" description="Day workers paid by the day, usually on M-Pesa." /> : (
          <TableWrap><table className="dt"><thead><tr><th>Name</th><th>Phone / M-Pesa</th><th className="num">Daily rate</th><th className="num">Days unpaid</th><th className="num">To pay</th><th /></tr></thead>
            <tbody><PagedRows rows={(people as any[])} colSpan={6}>{(pageRows) => pageRows.map((p) => { const u = unpaid(p.id); const amt = u.reduce((a, w) => a + Number(w.amount), 0); return (
              <tr key={p.id} className={cn(!p.active && "opacity-50")}>
                <td className="font-medium">{p.name}{p.skill && <span className="block text-xs font-normal text-muted-foreground">{p.skill}</span>}{longRunning(p.id) && <span className="block text-xs font-normal text-[hsl(32_90%_38%)]">3+ months: consider a contract (s.37)</span>}</td>
                <td>{p.mpesa_phone || p.phone || "-"}</td><td className="num">{formatKES(Number(p.daily_rate))}</td>
                <td className="num">{u.reduce((a, w) => a + Number(w.days), 0)}</td><td className="num font-semibold">{formatKES(amt)}</td>
                <td><span className="flex justify-end gap-1">{amt > 0 && <Button size="sm" variant="outline" onClick={() => setPay({ id: p.id, ref: "" })}><Check /> Paid</Button>}<button className="icon-btn" onClick={() => setEdit({ ...p })} aria-label="Edit"><Pencil className="h-4 w-4" /></button></span></td>
              </tr>); })}</PagedRows></tbody></table></TableWrap>
        )}
      </Panel>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit worker" : "Add casual worker"} icon={HardHat} footer={<Button onClick={saveP}>Save</Button>}>
        {edit && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" required className="sm:col-span-2"><input className="fi" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="ID number"><input className="fi" value={edit.national_id || ""} onChange={(e) => setEdit({ ...edit, national_id: e.target.value })} /></Field>
          <Field label="KRA PIN"><input className="fi" value={edit.kra_pin || ""} onChange={(e) => setEdit({ ...edit, kra_pin: e.target.value.toUpperCase() })} /></Field>
          <Field label="Phone"><input className="fi" value={edit.phone || ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <Field label="M-Pesa number"><input className="fi" value={edit.mpesa_phone || ""} onChange={(e) => setEdit({ ...edit, mpesa_phone: e.target.value })} placeholder="Same as phone" /></Field>
          <Field label="Daily rate"><input className="fi" type="number" placeholder="0" value={edit.daily_rate} onChange={(e) => setEdit({ ...edit, daily_rate: e.target.value })} /></Field>
          <Field label="Skill / role"><input className="fi" value={edit.skill || ""} onChange={(e) => setEdit({ ...edit, skill: e.target.value })} placeholder="e.g. Loader, mason" /></Field>
          {edit.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>}
        </div>}
      </Modal>
      <Modal open={!!log} onClose={() => setLog(null)} title="Record days worked" icon={HardHat} size="lg" footer={<Button onClick={saveLog}>Save</Button>}>
        {log && <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Date"><input className="fi" type="date" value={log.date} onChange={(e) => setLog({ ...log, date: e.target.value })} /></Field><Field label="Work done"><input className="fi" value={log.task} onChange={(e) => setLog({ ...log, task: e.target.value })} /></Field></div>
          <ul className="divide-y divide-border rounded-xl border border-border">{(people as any[]).filter((p) => p.active).map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={!!log.picked[p.id]} onChange={(e) => setLog({ ...log, picked: { ...log.picked, [p.id]: e.target.checked ? "1" : "" } })} />
              <span className="flex-1">{p.name}<span className="ml-2 text-xs text-muted-foreground">{formatKES(Number(p.daily_rate))}/day</span></span>
              {log.picked[p.id] && <input className="fi h-8 w-20 text-right" type="number" step="0.5" value={log.picked[p.id]} onChange={(e) => setLog({ ...log, picked: { ...log.picked, [p.id]: e.target.value } })} aria-label="Days" />}
            </li>))}</ul>
        </div>}
      </Modal>
      <Modal open={!!pay} onClose={() => setPay(null)} title="Mark as paid" icon={Wallet} footer={<Button onClick={markPaid}>Mark paid</Button>}>
        {pay && <Field label="M-Pesa or bank reference"><input className="fi" value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value.toUpperCase() })} placeholder="e.g. TJK3XXXXXX" /></Field>}
      </Modal>
    </div>
  );
}


/* ───────────────────────────── Timesheets ───────────────────────────── */

export function Timesheets() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { byId } = useActive();
  const [tab, setTab] = useState<"submitted" | "approved" | "all">("submitted");
  const { data = [], isLoading } = useQuery({ queryKey: ["hr-timesheets", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("hr_timesheets").select("*").eq("tenant_id", tenantId).order("work_date", { ascending: false }).limit(1000)).data || [] });
  const rows = (data as any[]).filter((t) => tab === "all" || t.status === tab);
  const decide = async (ids: string[], status: string) => {
    await sb.from("hr_timesheets").update({ status, decided_at: new Date().toISOString() }).in("id", ids);
    toast({ title: status === "approved" ? "Approved" : "Sent back" }); qc.invalidateQueries({ queryKey: ["hr-timesheets"] });
  };
  const byPerson = useMemo(() => { const m = new Map<string, number>(); for (const t of rows) m.set(t.employee_id, (m.get(t.employee_id) || 0) + Number(t.hours)); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [rows]);
  if (isLoading) return <OrbLoader label="Loading…" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Timesheets" icon={Timer} actions={<>
        <Button variant="outline" onClick={() => downloadCsv(`timesheets-${ymd()}.csv`, [["Date", "Employee", "Project", "Task", "Hours", "Billable", "Status"], ...rows.map((t) => [t.work_date, fullName(byId.get(t.employee_id)), t.project, t.task, t.hours, t.billable ? "Yes" : "No", t.status])])}><Download /> Export</Button>
        {tab === "submitted" && rows.length > 0 && <Button onClick={() => decide(rows.map((t) => t.id), "approved")}><Check /> Approve all</Button>}
      </>} />
      <div className="flex flex-wrap gap-2">{byPerson.slice(0, 8).map(([id, h]) => <Pill key={id} tone="info">{fullName(byId.get(id))} · {h} h</Pill>)}</div>
      <Segmented value={tab} onChange={(v) => setTab(v as typeof tab)} options={[{ value: "submitted", label: "To approve", count: (data as any[]).filter((t) => t.status === "submitted").length }, { value: "approved", label: "Approved" }, { value: "all", label: "All" }]} />
      <Panel flush>
        {rows.length === 0 ? <EmptyState icon={Timer} title="Nothing here" description="Staff fill in their hours in My Space." /> : (
          <TableWrap><table className="dt"><thead><tr><th>Date</th><th>Employee</th><th>Project / task</th><th className="num">Hours</th><th>Status</th><th /></tr></thead>
            <tbody><PagedRows rows={rows} colSpan={6}>{(pageRows) => pageRows.map((t) => (
              <tr key={t.id}><td>{fmtDate(t.work_date)}</td><td className="font-medium">{fullName(byId.get(t.employee_id))}</td>
                <td>{t.project && <b className="mr-1">{t.project}</b>}{t.task}{t.billable && <Pill tone="primary" className="ml-2">Billable</Pill>}</td>
                <td className="num">{Number(t.hours)}</td><td><Pill tone={t.status === "approved" ? "success" : t.status === "rejected" ? "danger" : "warning"}>{t.status}</Pill></td>
                <td>{t.status === "submitted" && <span className="flex justify-end gap-1"><Button size="sm" variant="outline" onClick={() => decide([t.id], "approved")}><Check /></Button><Button size="sm" variant="ghost" onClick={() => decide([t.id], "rejected")}><X /></Button></span>}</td></tr>))}</PagedRows></tbody></table></TableWrap>
        )}
      </Panel>
    </div>
  );
}
