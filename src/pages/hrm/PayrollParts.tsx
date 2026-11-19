/** Payroll run pieces: line editor, who is in, add person, adjustments, payments and reports. */
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Banknote, CheckCircle2, Download, FileSpreadsheet, FileUp, ListPlus, Pencil, Plus, Search, Smartphone, Trash2, UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Field, Modal, Panel, Pill, Segmented, TableWrap } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { PagedRows } from "@/components/Pager";
import { confirmAction } from "@/components/books/confirm";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenantId";
import { formatKES } from "@/lib/format";
import { saveFile } from "@/lib/erpApi";
import { cn } from "@/lib/utils";
import { sb, csvOf, fullName, useHrLookups, useHrSettings, type Employee } from "./hrData";
import {
  ADJ_KINDS, PAY_METHOD, buildLine, eligibleStaff, loadRunInputs, msisdn, payProblem, periodLabel, refreshTotals,
  type AdjKind, type Adjustment, type LineEdits, type ProrateMode,
} from "./payrollEngine";

export type Cell = string | number | null | undefined;
export type Rows = Cell[][];
export type PreviewFn = (title: string, name: string, rows: Rows) => void;

export const money = (n: unknown) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;
const numOrNull = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/* ───────────────────────────── Edit one line ───────────────────────────── */

type Pair = { name: string; amount: string; taxable?: boolean };

export function LineEditor({ run, slip, emp, onClose, onSaved }: { run: any; slip: any; emp: Employee; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth() as any;
  const { data: lk } = useHrLookups();
  const { rates, payroll: opts } = useHrSettings();
  const { data: inp, isLoading } = useQuery({
    queryKey: ["hr-line-inputs", run.id, emp.id],
    queryFn: () => loadRunInputs([emp.id], run.period, run.id, lk),
  });
  const ed: LineEdits = slip.data?.edits || {};
  const [mode, setMode] = useState<ProrateMode>(ed.mode || "auto");
  const [days, setDays] = useState(ed.days != null ? String(ed.days) : "");
  const [daysPeriod, setDaysPeriod] = useState(ed.days_period != null ? String(ed.days_period) : "");
  const [fixed, setFixed] = useState(ed.fixed != null ? String(ed.fixed) : "");
  const [ot, setOt] = useState(ed.overtime_hours != null ? String(ed.overtime_hours) : "");
  const [unpaid, setUnpaid] = useState(ed.unpaid_days != null ? String(ed.unpaid_days) : "");
  const [allow, setAllow] = useState<Pair[] | null>(ed.allowances ? ed.allowances.map((a) => ({ name: a.name, amount: String(a.amount), taxable: a.taxable })) : null);
  const [ded, setDed] = useState<Pair[] | null>(ed.deductions ? ed.deductions.map((a) => ({ name: a.name, amount: String(a.amount) })) : null);
  const [saving, setSaving] = useState(false);

  // The line as worked out with no edits: placeholders and the starting allowance / deduction lists.
  const base = useMemo(() => (inp ? buildLine(emp, { ...inp, adjustments: [] }, rates, opts, null) : null), [inp, emp, rates, opts]);
  const allowRows = allow ?? (base?.p.allowances || []).map((a) => ({ name: a.name, amount: String(a.amount), taxable: a.taxable }));
  const dedRows = ded ?? (base?.p.other_deductions || []).map((a) => ({ name: a.name, amount: String(a.amount) }));

  const edits: LineEdits = {};
  if (mode !== "auto") edits.mode = mode;
  if (mode === "prorate") { const d = numOrNull(days), dp = numOrNull(daysPeriod); if (d != null) edits.days = d; if (dp != null) edits.days_period = dp; }
  if (mode === "fixed") edits.fixed = numOrNull(fixed) ?? Number(emp.basic_salary) ?? 0;
  if (numOrNull(ot) != null) edits.overtime_hours = numOrNull(ot);
  if (numOrNull(unpaid) != null) edits.unpaid_days = numOrNull(unpaid);
  if (allow) edits.allowances = allow.filter((a) => a.name.trim() && Number(a.amount) > 0).map((a) => ({ name: a.name.trim(), amount: Number(a.amount), taxable: a.taxable !== false }));
  if (ded) edits.deductions = ded.filter((a) => a.name.trim() && Number(a.amount) > 0).map((a) => ({ name: a.name.trim(), amount: Number(a.amount) }));
  const live = inp ? buildLine(emp, inp, rates, opts, edits) : null;
  const bd = base?.row.data || {};

  const save = async (clear = false) => {
    if (!inp) return;
    setSaving(true);
    const built = buildLine(emp, inp, rates, opts, clear ? null : { ...edits, edited_by: user?.id || null, edited_at: new Date().toISOString() });
    const { error } = await sb.from("hr_payslips").update({ ...built.row, edited_by: clear ? null : user?.id || null, edited_at: clear ? null : new Date().toISOString() }).eq("id", slip.id);
    if (!error) await refreshTotals(run.id);
    setSaving(false);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: clear ? "Back to the worked-out pay" : "Line saved" });
    onSaved(); onClose();
  };

  const pairs = (rows: Pair[], set: (r: Pair[]) => void, withTax: boolean) => (
    <div className="space-y-2">
      {rows.length === 0 && <p className="rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">None.</p>}
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,7rem)_auto] items-center gap-2">
          <input className="fi" placeholder="Name" value={r.name} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input className="fi text-right tabular-nums" inputMode="decimal" placeholder="0.00" value={r.amount} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          <span className="flex items-center gap-1">
            {withTax && <label className="flex items-center gap-1 text-xs" title="Taxed"><input type="checkbox" className="accent-primary" checked={r.taxable !== false} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, taxable: e.target.checked } : x)))} /> Tax</label>}
            <button className="icon-btn-danger" aria-label="Remove" onClick={() => set(rows.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>
          </span>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => set([...rows, { name: "", amount: "", taxable: true }])}><Plus /> Add</Button>
    </div>
  );

  const preview: [string, number, boolean?][] = live ? [
    ["Basic", live.p.basic], ["Allowances", live.p.allowances.reduce((a, x) => a + x.amount, 0)], ["Overtime", live.p.overtime], ["Unpaid days", -live.p.unpaid_leave],
    ["Gross", live.p.gross, true], ["NSSF", -live.p.nssf], ["SHIF", -live.p.shif], ["Housing Levy", -live.p.housing_levy], ["Taxable pay", live.p.taxable_pay],
    ["PAYE", -live.p.paye], ["Loans & advances", -live.p.loan_deductions], ["Other deductions", -(live.row.other_deductions as number)], ["Net pay", live.p.net_pay, true],
  ] : [];

  return (
    <Modal open onClose={onClose} title={`Edit line · ${fullName(emp)}`} icon={Pencil} size="xl" locked={saving}
      description="Change pay, days or overtime for this month only. The figures update as you type."
      footer={<>
        <Button onClick={() => save(false)} disabled={saving || !inp}>{saving && <OrbSpinner />} Save line</Button>
        {slip.data?.edits && <Button variant="ghost" onClick={() => save(true)} disabled={saving}>Use worked-out pay</Button>}
      </>}>
      {isLoading || !inp ? <OrbLoader label="Loading…" /> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-semibold">Basic pay</p>
              <Segmented<ProrateMode> value={mode} onChange={setMode} options={[{ value: "auto", label: "Automatic" }, { value: "full", label: "Full month" }, { value: "prorate", label: "Prorate" }, { value: "fixed", label: "Fixed amount" }]} />
              <p className="text-xs text-muted-foreground">
                {mode === "auto" ? (bd.mid_period ? `Joined or left this month: paid ${bd.prorate_days} of ${bd.prorate_days_period} ${opts.prorate_basis === "calendar" ? "calendar" : "working"} days.` : "Full month.") :
                  mode === "full" ? "Pay the whole month even though they joined or left during it." : mode === "prorate" ? "Days worked ÷ days in the month × basic and allowances." : "Type the basic pay for this month."}
              </p>
              {mode === "prorate" && <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Days worked"><input className="fi" type="number" min={0} value={days} placeholder={String(bd.prorate_days ?? bd.prorate_days_period ?? "")} onChange={(e) => setDays(e.target.value)} /></Field>
                <Field label="Days in the month"><input className="fi" type="number" min={1} value={daysPeriod} placeholder={String(bd.prorate_days_period ?? "")} onChange={(e) => setDaysPeriod(e.target.value)} /></Field>
              </div>}
              {mode === "fixed" && <Field label="Basic pay for this month (KES)"><input className="fi" type="number" min={0} value={fixed} placeholder={String(emp.basic_salary)} onChange={(e) => setFixed(e.target.value)} /></Field>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Overtime hours" hint="Empty: from Attendance"><input className="fi" type="number" min={0} step="0.5" value={ot} placeholder={String(bd.overtime_hours ?? 0)} onChange={(e) => setOt(e.target.value)} /></Field>
              <Field label="Unpaid days" hint="Empty: absences and unpaid leave"><input className="fi" type="number" min={0} step="0.5" value={unpaid} placeholder={String(Number(bd.unpaid_leave_days || 0) + Number(bd.absent_days || 0))} onChange={(e) => setUnpaid(e.target.value)} /></Field>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Allowances this month</p>
              {pairs(allowRows, (r) => setAllow(r), true)}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Other deductions this month</p>
              {pairs(dedRows, (r) => setDed(r), false)}
              <p className="text-xs text-muted-foreground">Loans, HELB, pension and statutory deductions are added for you. One-off items for this run go under Adjustments.</p>
            </div>
          </div>
          <div className="h-fit rounded-2xl border border-border bg-muted/30 p-3 lg:sticky lg:top-0">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">This month</p>
            <table className="w-full text-sm"><tbody>{preview.filter(([, v, strong]) => strong || v !== 0).map(([l, v, strong]) => (
              <tr key={l} className={cn(strong && "font-bold")}><td className="py-0.5">{l}</td><td className="py-0.5 text-right tabular-nums">{money(v)}</td></tr>
            ))}</tbody></table>
            {live && Number(live.p.net_pay) < Number(live.p.gross) / 3 && <p className="mt-2 flex gap-1 text-xs text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" /> Deductions are more than two thirds of pay.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────────── Who is in ───────────────────────────── */

export function WhoIsIn({ run, emps, onClose, onSaved }: { run: any; emps: Employee[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const pool = useMemo(() => eligibleStaff(emps, run.period), [emps, run.period]);
  const [out, setOut] = useState<Set<string>>(new Set(run.excluded_employee_ids || []));
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const shown = pool.filter((e) => !q.trim() || `${fullName(e)} ${e.employee_no || ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const save = async () => {
    setSaving(true);
    const { error } = await sb.from("hr_payroll_runs").update({ excluded_employee_ids: [...out].filter((id) => pool.some((e) => e.id === id)) }).eq("id", run.id);
    setSaving(false);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    onSaved();
  };
  return (
    <Modal open onClose={onClose} title="Who is in this payroll" icon={Users} size="lg" locked={saving}
      description={`${pool.length - [...out].filter((id) => pool.some((e) => e.id === id)).length} of ${pool.length} people. People left out stay out when you re-compute.`}
      footer={<Button onClick={save} disabled={saving}>{saving && <OrbSpinner />} Save and re-compute</Button>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Find a person" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Button size="sm" variant="outline" onClick={() => setOut((o) => { const n = new Set(o); shown.forEach((e) => n.delete(e.id)); return n; })}>All in</Button>
        <Button size="sm" variant="outline" onClick={() => setOut((o) => { const n = new Set(o); shown.forEach((e) => n.add(e.id)); return n; })}>All out</Button>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {shown.length === 0 && <li className="p-3 text-sm text-muted-foreground">Nobody matches.</li>}
        <PagedRows rows={shown} list pageSize={50}>{(rows) => rows.map((e) => (
          <li key={e.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
              <input type="checkbox" className="accent-primary" checked={!out.has(e.id)} onChange={() => setOut((o) => { const n = new Set(o); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n; })} />
              <span className="min-w-0 flex-1 truncate">{fullName(e)}{e.employee_no ? <span className="text-muted-foreground"> · {e.employee_no}</span> : null}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{formatKES(Number(e.basic_salary))}</span>
            </label>
          </li>
        ))}</PagedRows>
      </ul>
    </Modal>
  );
}

/* ───────────────────────────── Add one person ───────────────────────────── */

export function AddPerson({ run, emps, inRun, onClose, onAdded }: { run: any; emps: Employee[]; inRun: Set<string>; onClose: () => void; onAdded: () => void }) {
  const { toast } = useToast();
  const tenantId = useTenantId();
  const { data: lk } = useHrLookups();
  const { rates, payroll: opts } = useHrSettings();
  const candidates = eligibleStaff(emps, run.period).filter((e) => !inRun.has(e.id));
  const [id, setId] = useState("");
  const [saving, setSaving] = useState(false);
  const add = async () => {
    const e = candidates.find((x) => x.id === id);
    if (!e) return toast({ title: "Pick a person", variant: "destructive" });
    setSaving(true);
    try {
      const inp = await loadRunInputs([e.id], run.period, run.id, lk);
      const { row } = buildLine(e, inp, rates, opts, null);
      const { error } = await sb.from("hr_payslips").insert({ ...row, tenant_id: tenantId, run_id: run.id });
      if (error) throw error;
      await sb.from("hr_payroll_runs").update({ excluded_employee_ids: (run.excluded_employee_ids || []).filter((x: string) => x !== e.id) }).eq("id", run.id);
      await refreshTotals(run.id);
      toast({ title: `${fullName(e)} added` });
      onAdded(); onClose();
    } catch (err: any) { toast({ title: "Not added", description: err.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="Add a person to this payroll" icon={UserPlus} locked={saving}
      description="Adds one line worked out as usual. The other lines stay as they are."
      footer={<Button onClick={add} disabled={saving || !id}>{saving && <OrbSpinner />} Add</Button>}>
      {candidates.length === 0 ? <p className="text-sm text-muted-foreground">Everyone who can be paid this month is already in the payroll.</p> :
        <Field label="Employee"><select className="fi" value={id} onChange={(e) => setId(e.target.value)}><option value="">Select…</option>{candidates.map((e) => <option key={e.id} value={e.id}>{fullName(e)}{e.employee_no ? ` · ${e.employee_no}` : ""}</option>)}</select></Field>}
    </Modal>
  );
}

/* ───────────────────────────── Adjustments ───────────────────────────── */

const KIND_ALIASES: Record<string, AdjKind> = {
  earning: "earning", allowance: "earning", bonus: "earning", commission: "earning", arrears: "earning", overtime: "earning", taxable: "earning",
  nontaxable: "nontaxable", "non-taxable": "nontaxable", "not taxed": "nontaxable", reimbursement: "nontaxable",
  benefit: "benefit", "non-cash": "benefit", noncash: "benefit",
  deduction: "deduction", fine: "deduction", sacco: "deduction", welfare: "deduction", recovery: "deduction",
};
const normKey = (k: string) => k.toLowerCase().replace(/[^a-z]/g, "");
const NO_WORDS = new Set(["no", "n", "false", "0", "nontaxable", "not taxed", "exempt", "tax free"]);

/** One row of an uploaded sheet: who it matched (if anyone) and the adjustment it becomes. */
type UploadRow = { row: number; ref: string; employee?: Employee; kind: AdjKind; name: string; amount: number; problem?: string };

export function Adjustments({ run, emps, onRecompute }: { run: any; emps: Employee[]; onRecompute: () => void }) {
  const { toast } = useToast();
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const draft = run.status === "draft";
  const { data: adjs = [], isLoading } = useQuery({
    queryKey: ["hr-adjustments", run.id],
    queryFn: async () => ((await sb.from("hr_payroll_adjustments").select("*").eq("run_id", run.id).order("created_at")).data || []) as Adjustment[],
  });
  const byId = useMemo(() => new Map(emps.map((e) => [e.id, e])), [emps]);
  const [f, setF] = useState<{ id?: string; employee_id: string; kind: AdjKind; name: string; amount: string } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["hr-adjustments", run.id] });
  const pool = eligibleStaff(emps, run.period);

  const save = async () => {
    if (!f) return;
    const amount = Number(f.amount);
    if (!f.employee_id || !f.name.trim() || !(amount > 0)) return toast({ title: "Pick the person and enter a name and amount", variant: "destructive" });
    const row = { employee_id: f.employee_id, kind: f.kind, name: f.name.trim(), amount };
    const { error } = f.id ? await sb.from("hr_payroll_adjustments").update(row).eq("id", f.id) : await sb.from("hr_payroll_adjustments").insert({ ...row, tenant_id: tenantId, run_id: run.id });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    setF(null); refresh(); toast({ title: "Saved", description: "Re-compute to update the lines." });
  };
  const remove = async (ids: string[]) => {
    if (!ids.length || !(await confirmAction({ title: `Remove ${ids.length} adjustment${ids.length === 1 ? "" : "s"}?`, danger: true, confirmLabel: "Remove" }))) return;
    const { error } = await sb.from("hr_payroll_adjustments").delete().in("id", ids);
    if (error) return toast({ title: "Not removed", description: error.message, variant: "destructive" });
    setPicked(new Set()); refresh();
  };
  const [preview, setPreview] = useState<{ file: string; rows: UploadRow[] } | null>(null);
  const template = () => saveFile("payroll-upload-template.csv", csvOf([["Staff no", "ID number", "Item", "Amount", "Type", "Taxable"], ["EMP001", "", "Performance bonus", 5000, "earning", "yes"], ["", "12345678", "Mileage refund", 2400, "earning", "no"], ["EMP002", "", "Sacco", 1500, "deduction", ""]]), "text/csv");

  /** Reads the sheet and shows what matched before anything is added. */
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const XLSX = await import("@e965/xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const pick = (r: Record<string, unknown>, keys: string[]) => { for (const [k, v] of Object.entries(r)) if (keys.includes(normKey(k))) return String(v ?? "").trim(); return ""; };
      const byNo = new Map(pool.filter((e) => e.employee_no).map((e) => [String(e.employee_no).trim().toLowerCase(), e]));
      const byId = new Map(pool.filter((e) => e.national_id).map((e) => [String(e.national_id).replace(/\s/g, "").toLowerCase(), e]));
      const byName = new Map(pool.map((e) => [fullName(e).toLowerCase(), e]));
      const rows: UploadRow[] = [];
      raw.forEach((r, i) => {
        const no = pick(r, ["staffno", "employeeno", "empno", "payrollno", "payrollnumber", "staffnumber", "employeenumber"]);
        const idNo = pick(r, ["idnumber", "idno", "nationalid", "id", "nationalidnumber", "passport"]);
        const nm = pick(r, ["employee", "name", "employeename", "fullname"]);
        const amountText = pick(r, ["amount", "amountkes", "value"]);
        if (!no && !idNo && !nm && !amountText) return;
        const e = (no && byNo.get(no.toLowerCase())) || (idNo && byId.get(idNo.replace(/\s/g, "").toLowerCase())) || (nm && byName.get(nm.toLowerCase())) || undefined;
        const amount = Number(amountText.replace(/,/g, ""));
        const typed = KIND_ALIASES[pick(r, ["type", "kind", "earningordeduction"]).toLowerCase()] || "earning";
        const taxText = pick(r, ["taxable", "taxed", "tax"]).toLowerCase();
        const kind: AdjKind = typed === "earning" && taxText && NO_WORDS.has(taxText) ? "nontaxable" : typed;
        const name = pick(r, ["item", "itemname", "description", "narration", "details", "payitem"]) || (kind === "deduction" ? "Deduction" : "Allowance");
        const problem = !e ? (no || idNo || nm ? "No employee with that staff no or ID" : "No staff no or ID") : !(amount > 0) ? "No amount" : undefined;
        rows.push({ row: i + 2, ref: no || idNo || nm, employee: e, kind, name, amount: amount > 0 ? amount : 0, problem });
      });
      if (!rows.length) return toast({ title: "Nothing found in the file", description: "Use the template: Staff no or ID number, Item, Amount, Type, Taxable.", variant: "destructive" });
      setPreview({ file: file.name, rows });
    } catch (e: any) { toast({ title: "File not read", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const apply = async () => {
    if (!preview) return;
    const ok = preview.rows.filter((r) => !r.problem && r.employee);
    if (!ok.length) return;
    setBusy(true);
    const { error } = await sb.from("hr_payroll_adjustments").insert(ok.map((r) => ({ tenant_id: tenantId, run_id: run.id, employee_id: r.employee!.id, kind: r.kind, name: r.name, amount: r.amount })));
    setBusy(false);
    if (error) return toast({ title: "Not added", description: error.message, variant: "destructive" });
    setPreview(null); refresh();
    toast({ title: `${ok.length} line${ok.length === 1 ? "" : "s"} added`, description: "Re-compute to update the payslips." });
  };

  if (isLoading) return <OrbLoader label="Loading…" />;
  return (
    <Panel flush title="One-off adjustments" icon={ListPlus} description="This month only: bonuses, commissions, arrears, reimbursements, fines, sacco. Regular allowances belong on the employee."
      actions={draft && <div className="flex flex-wrap gap-2">
        {picked.size > 0 && <Button size="sm" variant="outline" className="text-destructive" onClick={() => remove([...picked])}><Trash2 /> Remove {picked.size}</Button>}
        <Button size="sm" variant="outline" onClick={template}><Download /> Template</Button>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? <OrbSpinner /> : <FileUp />} Upload sheet</Button>
        <Button size="sm" onClick={() => setF({ employee_id: "", kind: "earning", name: "", amount: "" })}><Plus /> Add</Button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      </div>}>
      {adjs.length > 0 && draft && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-info/5 px-4 py-2 text-sm"><span>Changes show on the lines after a re-compute.</span><Button size="sm" variant="outline" onClick={onRecompute}>Re-compute now</Button></div>}
      {adjs.length === 0 ? <EmptyState icon={ListPlus} title="No adjustments this month" description={draft ? "Add them one by one, or upload a CSV or Excel sheet with Staff no or ID number, Item, Amount, Type (earning or deduction) and Taxable." : undefined} /> : (
        <TableWrap><table className="dt"><thead><tr>{draft && <th className="w-10" />}<th>Employee</th><th>Item</th><th>Type</th><th className="num">Amount</th>{draft && <th />}</tr></thead>
          <tbody><PagedRows rows={adjs} colSpan={draft ? 6 : 4}>{(rows) => rows.map((a) => (
            <tr key={a.id} className={cn(picked.has(a.id) && "bg-primary/5")}>
              {draft && <td data-label=""><input type="checkbox" className="accent-primary" checked={picked.has(a.id)} onChange={() => setPicked((p) => { const n = new Set(p); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })} /></td>}
              <td className="font-medium">{fullName(byId.get(a.employee_id))}</td><td>{a.name}</td><td>{ADJ_KINDS[a.kind]}</td>
              <td className={cn("num font-semibold", a.kind === "deduction" ? "text-destructive" : "text-success")}>{a.kind === "deduction" ? "−" : "+"}{money(a.amount)}</td>
              {draft && <td><span className="flex gap-1"><button className="icon-btn" aria-label="Edit" onClick={() => setF({ id: a.id, employee_id: a.employee_id, kind: a.kind, name: a.name, amount: String(a.amount) })}><Pencil className="h-4 w-4" /></button><button className="icon-btn-danger" aria-label="Remove" onClick={() => remove([a.id])}><Trash2 className="h-4 w-4" /></button></span></td>}
            </tr>
          ))}</PagedRows></tbody></table></TableWrap>
      )}
      {preview && (() => {
        const ok = preview.rows.filter((r) => !r.problem), bad = preview.rows.filter((r) => r.problem);
        const total = (k: (r: UploadRow) => boolean) => ok.filter(k).reduce((a, r) => a + r.amount, 0);
        return (
          <Modal open onClose={() => setPreview(null)} title="Check the upload" icon={FileUp} size="2xl" locked={busy}
            description={`${preview.file}: ${ok.length} matched, ${bad.length} not matched. Only matched lines are added.`}
            footer={<><Button onClick={apply} disabled={busy || !ok.length}>{busy && <OrbSpinner />} Add {ok.length} line{ok.length === 1 ? "" : "s"}</Button><Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button></>}>
            <div className="mb-3 flex flex-wrap gap-2 text-sm">
              <Pill tone="success">{ok.length} matched</Pill>{bad.length > 0 && <Pill tone="danger">{bad.length} not matched</Pill>}
              <span className="text-muted-foreground">Earnings {formatKES(total((r) => r.kind !== "deduction"))} · Deductions {formatKES(total((r) => r.kind === "deduction"))}</span>
            </div>
            <TableWrap><table className="dt"><thead><tr><th>Row</th><th>Staff no / ID</th><th>Employee</th><th>Item</th><th>Type</th><th className="num">Amount</th></tr></thead>
              <tbody><PagedRows rows={[...bad, ...ok]} colSpan={6} pageSize={50}>{(rows) => rows.map((r) => (
                <tr key={r.row} className={cn(r.problem && "bg-destructive/5")}>
                  <td>{r.row}</td><td>{r.ref || "—"}</td>
                  <td>{r.employee ? <span className="font-medium">{fullName(r.employee)}</span> : <span className="flex items-center gap-1 text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" />{r.problem}</span>}{r.employee && r.problem && <span className="block text-xs text-destructive">{r.problem}</span>}</td>
                  <td>{r.name}</td><td>{ADJ_KINDS[r.kind]}</td>
                  <td className={cn("num", r.kind === "deduction" ? "text-destructive" : "text-success")}>{r.kind === "deduction" ? "−" : "+"}{money(r.amount)}</td>
                </tr>
              ))}</PagedRows></tbody></table></TableWrap>
          </Modal>
        );
      })()}
      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? "Edit adjustment" : "Add adjustment"} icon={ListPlus} footer={<Button onClick={save}>{f?.id ? "Save" : "Add"}</Button>}>
        {f && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Employee" className="sm:col-span-2"><select className="fi" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}><option value="">Select…</option>{pool.map((e) => <option key={e.id} value={e.id}>{fullName(e)}{e.employee_no ? ` · ${e.employee_no}` : ""}</option>)}</select></Field>
          <Field label="Type"><select className="fi" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AdjKind })}>{(Object.keys(ADJ_KINDS) as AdjKind[]).map((k) => <option key={k} value={k}>{ADJ_KINDS[k]}</option>)}</select></Field>
          <Field label="Amount (KES)"><input className="fi" type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Description" className="sm:col-span-2"><input className="fi" placeholder="e.g. Performance bonus, Arrears for May" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <p className="text-xs text-muted-foreground sm:col-span-2">{f.kind === "benefit" ? "Not paid out. Non-cash benefits are taxed when they total more than the exempt amount a month." : f.kind === "nontaxable" ? "Paid with the salary without tax, e.g. a mileage or expense refund." : f.kind === "deduction" ? "Taken off net pay after tax." : "Added to pay and taxed."}</p>
        </div>}
      </Modal>
    </Panel>
  );
}

/* ───────────────────────────── Payments ───────────────────────────── */

export function Payments({ run, slips, empById, onChanged, onSend, onPreview }: {
  run: any; slips: any[]; empById: Map<string, Employee>; onChanged: () => void;
  onSend: (ids: string[], ch: { email: boolean; sms: boolean }) => void; onPreview: PreviewFn;
}) {
  const { toast } = useToast();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ref, setRef] = useState("");
  const [emailSlips, setEmailSlips] = useState(true);
  const [q, setQ] = useState("");
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const draft = run.status === "draft";
  const label = `Salary ${periodLabel(run.period)}`;
  const emp = (s: any) => empById.get(s.employee_id);
  const visible = slips.filter((s) => (!onlyUnpaid || s.pay_status !== "paid") && (!q.trim() || String(s.employee_name).toLowerCase().includes(q.trim().toLowerCase())));
  const groupMap = new Map<string, any[]>();
  for (const s of visible) { const m = emp(s)?.payment_method || "bank"; groupMap.set(m, [...(groupMap.get(m) || []), s]); }
  const groups = [...groupMap.entries()];
  const problems = slips.map((s) => ({ s, why: payProblem(emp(s)) })).filter((x) => x.why);
  const noCodes = slips.filter((s) => (emp(s)?.payment_method || "bank") === "bank" && emp(s)?.bank_account && (!emp(s)?.bank_code || !emp(s)?.branch_code));
  const paid = slips.filter((s) => s.pay_status === "paid").length;
  const pick = (ids: string[], on: boolean) => setSel((p) => { const n = new Set(p); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });

  const mark = async (status: "paid" | "failed" | "pending") => {
    const ids = [...sel];
    const { error } = await sb.from("hr_payslips").update({ pay_status: status, pay_reference: status === "pending" ? null : ref.trim() || null, paid_at: status === "paid" ? new Date().toISOString() : null }).in("id", ids);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: `${ids.length} marked ${status === "pending" ? "not paid" : status}` });
    if (status === "paid" && emailSlips) onSend(ids, { email: true, sms: false });
    const left = slips.filter((s) => !ids.includes(s.id) && s.pay_status !== "paid").length;
    if (status === "paid" && left === 0 && run.status === "approved") toast({ title: "Everyone is paid", description: "Mark the payroll as paid at the top to close it." });
    setSel(new Set()); setRef(""); onChanged();
  };

  const mpesaFile = () => onPreview(`M-Pesa bulk payment · ${run.period}`, `mpesa-salaries-${run.period}.csv`, [
    ["Name", "Phone", "Amount", "Reference"],
    ...slips.filter((s) => emp(s)?.payment_method === "mpesa").map((s) => [s.employee_name, msisdn(emp(s)?.mpesa_phone || emp(s)?.phone) || "", Number(s.net_pay), label]),
  ]);
  const bankFile = () => {
    const b = slips.filter((s) => (emp(s)?.payment_method || "bank") === "bank");
    onPreview(`Bank payment list · ${run.period}`, `bank-salaries-${run.period}.csv`, [
      ["Employee", "Staff no", "Bank", "Bank code", "Branch", "Branch code", "Sort code", "Account", "Amount", "Reference"],
      ...b.map((s) => {
        const e = emp(s), bc = String(e?.bank_code || "").trim(), br = String(e?.branch_code || "").trim();
        return [s.employee_name, e?.employee_no, e?.bank_name, bc, e?.bank_branch, br, bc && br ? `${bc}${br}` : "", e?.bank_account, Number(s.net_pay), label];
      }),
      ["TOTAL", "", "", "", "", "", "", "", b.reduce((a, s) => a + Number(s.net_pay), 0), ""],
    ]);
  };
  const cashFile = () => onPreview(`Cash and cheque list · ${run.period}`, `cash-salaries-${run.period}.csv`, [
    ["Employee", "Staff no", "Method", "Amount", "Signature"],
    ...slips.filter((s) => ["cash", "cheque"].includes(emp(s)?.payment_method || "")).map((s) => [s.employee_name, emp(s)?.employee_no, PAY_METHOD[emp(s)?.payment_method || ""], Number(s.net_pay), ""]),
  ]);
  const perBank = [...slips.filter((s) => (emp(s)?.payment_method || "bank") === "bank").reduce((m, s) => {
    const k = emp(s)?.bank_name || "Bank not set"; const c = m.get(k) || { n: 0, amt: 0 };
    return m.set(k, { n: c.n + 1, amt: c.amt + Number(s.net_pay) });
  }, new Map<string, { n: number; amt: number }>())].sort((a, b) => b[1].amt - a[1].amt);
  const count = (m: string) => slips.filter((s) => (emp(s)?.payment_method || "bank") === m).length;

  if (!slips.length) return <Panel><EmptyState icon={Banknote} title="Nothing to pay yet" description="Prepare the payroll first." /></Panel>;
  return (
    <div className="space-y-4">
      <Panel title="Payment files" icon={FileSpreadsheet} description={draft ? "Check the files now; record payments once the payroll is approved." : "Download the file for your bank or M-Pesa, then record who was paid below."}>
        <div className="grid gap-2 sm:grid-cols-3">
          <Button variant="outline" className="justify-start" onClick={bankFile} disabled={!count("bank")}><Banknote /> Bank list ({count("bank")})</Button>
          <Button variant="outline" className="justify-start" onClick={mpesaFile} disabled={!count("mpesa")}><Smartphone /> M-Pesa bulk file ({count("mpesa")})</Button>
          <Button variant="outline" className="justify-start" onClick={cashFile} disabled={!count("cash") && !count("cheque")}><Banknote /> Cash / cheque ({count("cash") + count("cheque")})</Button>
        </div>
        {problems.length > 0 && <p className="mt-3 flex gap-2 rounded-xl bg-warning/10 p-3 text-sm"><AlertTriangle className="h-4 w-4 shrink-0 text-warning" /><span>Missing payment details: <b>{problems.map((x) => `${x.s.employee_name} (${x.why})`).join(", ")}</b>. Fix them on the employee record.</span></p>}
        {noCodes.length > 0 && <p className="mt-3 flex gap-2 rounded-xl bg-muted/50 p-3 text-sm"><AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground" /><span>No bank or branch code: <b>{noCodes.map((s) => s.employee_name).join(", ")}</b>. Pick the bank and branch from the list on the employee's Pay & bank tab so the bank file carries the codes.</span></p>}
        {perBank.length > 0 && <div className="mt-3 overflow-x-auto rounded-xl border border-border"><table className="dt dt-keep text-sm"><thead><tr><th>Bank</th><th className="num">People</th><th className="num">Amount</th></tr></thead>
          <tbody>{perBank.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v.n}</td><td className="num">{money(v.amt)}</td></tr>)}</tbody></table></div>}
      </Panel>

      <Panel flush title="Who has been paid" icon={CheckCircle2} description={`${paid} of ${slips.length} paid`}
        actions={<div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-52"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi h-9 pl-9" placeholder="Find a person" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-primary" checked={onlyUnpaid} onChange={(e) => setOnlyUnpaid(e.target.checked)} /> Only not paid</label>
        </div>}>
        {sel.size > 0 && !draft && (
          <div className="sticky top-0 z-[5] flex flex-wrap items-center gap-2 border-b border-primary/30 bg-primary/10 px-4 py-2 backdrop-blur">
            <span className="text-sm font-semibold">{sel.size} selected · {formatKES(slips.filter((s) => sel.has(s.id)).reduce((a, s) => a + Number(s.net_pay), 0))}</span>
            <input className="fi h-9 w-full sm:w-56" placeholder="Payment reference (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-primary" checked={emailSlips} onChange={(e) => setEmailSlips(e.target.checked)} /> Email their payslips</label>
            <span className="flex flex-wrap gap-2 sm:ml-auto">
              <Button size="sm" onClick={() => mark("paid")}><CheckCircle2 /> Mark paid</Button>
              <Button size="sm" variant="outline" onClick={() => mark("failed")}>Failed</Button>
              <Button size="sm" variant="ghost" onClick={() => mark("pending")}>Not paid</Button>
              <Button size="sm" variant="ghost" onClick={() => setSel(new Set())} aria-label="Clear"><X /></Button>
            </span>
          </div>
        )}
        {groups.map(([method, list]) => {
          const ids = list.map((s) => s.id); const on = ids.every((id) => sel.has(id));
          return (
            <section key={method} className="border-b border-border last:border-b-0">
              <header className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 px-4 py-2 text-sm font-semibold">
                <span className="flex items-center gap-2">{!draft && <input type="checkbox" className="accent-primary" checked={on} onChange={() => pick(ids, !on)} aria-label={`Select all ${PAY_METHOD[method] || method}`} />}{PAY_METHOD[method] || method}
                  <Pill>{list.filter((s) => s.pay_status === "paid").length}/{list.length} paid</Pill></span>
                <span className="tabular-nums">{formatKES(list.reduce((a, s) => a + Number(s.net_pay), 0))}</span>
              </header>
              <ul className="divide-y divide-border">
                <PagedRows rows={list} list pageSize={50}>{(rows) => rows.map((s) => (
                  <li key={s.id}>
                    <label className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm", !draft && "cursor-pointer hover:bg-muted/30", sel.has(s.id) && "bg-primary/5")}>
                      {!draft && <input type="checkbox" className="accent-primary" checked={sel.has(s.id)} onChange={() => pick([s.id], !sel.has(s.id))} />}
                      <span className="min-w-0 flex-1 basis-40"><span className="block font-medium">{s.employee_name}</span>
                        <span className="block break-words text-xs text-muted-foreground">{method === "mpesa" ? emp(s)?.mpesa_phone || emp(s)?.phone || "No number" : method === "bank" ? [emp(s)?.bank_name, emp(s)?.bank_account].filter(Boolean).join(" · ") || "No bank details" : PAY_METHOD[method]}{s.pay_reference ? ` · ref ${s.pay_reference}` : ""}</span></span>
                      <span className="ml-auto flex items-center gap-2"><b className="tabular-nums">{money(s.net_pay)}</b>
                        <Pill tone={s.pay_status === "paid" ? "success" : s.pay_status === "failed" ? "danger" : "muted"}>{s.pay_status === "paid" ? "Paid" : s.pay_status === "failed" ? "Failed" : "Not paid"}</Pill></span>
                    </label>
                  </li>
                ))}</PagedRows>
              </ul>
            </section>
          );
        })}
      </Panel>
    </div>
  );
}

/* ───────────────────────────── Reports ───────────────────────────── */

type ReportKey = "variance" | "department" | "items" | "checks" | "year";

export function PayrollReports({ run, slips, runs, empById, onPreview }: { run: any; slips: any[]; runs: any[]; empById: Map<string, Employee>; onPreview: PreviewFn }) {
  const [key, setKey] = useState<ReportKey>("variance");
  const { data: lk } = useHrLookups();
  const prevRun = runs.filter((r) => r.period < run.period).sort((a, b) => b.period.localeCompare(a.period))[0] || null;
  const { data: prev = [] } = useQuery({
    queryKey: ["hr-slips", prevRun?.id], enabled: !!prevRun?.id,
    queryFn: async () => (await sb.from("hr_payslips").select("*").eq("run_id", prevRun.id)).data || [],
  });
  const dept = (id: string) => (lk?.departments || []).find((d) => d.id === empById.get(id)?.department_id)?.name || "No department";

  const report = useMemo((): { title: string; rows: Rows; note?: string } => {
    if (key === "variance") {
      const before = new Map((prev as any[]).map((s) => [s.employee_id, s]));
      const now = new Map(slips.map((s) => [s.employee_id, s]));
      const ids = [...new Set([...now.keys(), ...before.keys()])];
      const rows: Rows = ids.map((id) => {
        const a = before.get(id), b = now.get(id);
        const g0 = Number(a?.gross || 0), g1 = Number(b?.gross || 0), n0 = Number(a?.net_pay || 0), n1 = Number(b?.net_pay || 0);
        return [b?.employee_name || a?.employee_name, !a ? "Joined" : !b ? "Left" : Math.abs(g1 - g0) >= 0.01 ? "Changed" : "Same", g0, g1, r2(g1 - g0), n0, n1, r2(n1 - n0)];
      }).sort((x, y) => Math.abs(Number(y[4])) - Math.abs(Number(x[4])));
      const sum = (i: number) => r2(rows.reduce((t, r) => t + Number(r[i] || 0), 0));
      return { title: `Payroll variance · ${prevRun?.period || "no earlier payroll"} to ${run.period}`, note: prevRun ? undefined : "There is no earlier payroll to compare with.",
        rows: [["Employee", "Change", `Gross ${prevRun?.period || ""}`, `Gross ${run.period}`, "Gross change", `Net ${prevRun?.period || ""}`, `Net ${run.period}`, "Net change"], ...rows, ["TOTAL", "", sum(2), sum(3), sum(4), sum(5), sum(6), sum(7)]] };
    }
    if (key === "department") {
      const m = new Map<string, number[]>();
      for (const s of slips) {
        const k = dept(s.employee_id); const c = m.get(k) || [0, 0, 0, 0, 0];
        const er = Number(s.employer_nssf) + Number(s.employer_housing) + Number(s.nita);
        m.set(k, [c[0] + 1, c[1] + Number(s.gross), c[2] + er, c[3] + Number(s.gross) + er, c[4] + Number(s.net_pay)]);
      }
      const rows: Rows = [...m.entries()].sort((a, b) => b[1][3] - a[1][3]).map(([k, v]) => [k, v[0], r2(v[1]), r2(v[2]), r2(v[3]), r2(v[4])]);
      const sum = (i: number) => r2(rows.reduce((t, r) => t + Number(r[i] || 0), 0));
      return { title: `Payroll cost by department · ${run.period}`, rows: [["Department", "People", "Gross pay", "Employer costs", "Total cost", "Net pay"], ...rows, ["TOTAL", sum(1), sum(2), sum(3), sum(4), sum(5)]] };
    }
    if (key === "items") {
      const m = new Map<string, { kind: string; n: number; amt: number }>();
      const add = (kind: string, name: string, amt: number) => { if (!(amt > 0)) return; const k = `${kind}|${name}`; const c = m.get(k) || { kind, n: 0, amt: 0 }; m.set(k, { kind, n: c.n + 1, amt: c.amt + amt }); };
      for (const s of slips) {
        const d = s.data || {};
        for (const a of d.allowances || []) add(a.taxable === false ? "Allowance (not taxed)" : "Allowance", a.name, Number(a.amount));
        add("Earning", "Overtime", Number(d.overtime || 0));
        for (const b of d.benefit_items || []) add("Non-cash benefit", b.name, Number(b.amount));
        for (const x of d.other_deductions || []) add("Deduction", x.name, Number(x.amount));
        add("Deduction", "Insurance premium", Number(d.insurance || 0)); add("Deduction", "HELB", Number(d.helb || 0)); add("Deduction", "Pension", Number(d.pension || 0)); add("Deduction", "PRMF", Number(d.prmf || 0));
        add("Deduction", "Loans & advances", Number(s.loan_deductions || 0));
      }
      const rows: Rows = [...m.entries()].sort((a, b) => a[1].kind.localeCompare(b[1].kind) || b[1].amt - a[1].amt).map(([k, v]) => [v.kind, k.split("|")[1], v.n, r2(v.amt)]);
      return { title: `Allowances and deductions · ${run.period}`, rows: [["Type", "Item", "People", "Amount"], ...rows] };
    }
    if (key === "checks") {
      const before = new Map((prev as any[]).map((s) => [s.employee_id, s]));
      const rows: Rows = [];
      for (const s of slips) {
        const e = empById.get(s.employee_id); const g = Number(s.gross), n = Number(s.net_pay);
        const flag = (issue: string) => rows.push([s.employee_name, issue, g, n]);
        if (g <= 0) flag("No pay this month");
        if (n < 0) flag("Net pay below zero");
        else if (g > 0 && n < g / 3) flag("Deductions more than two thirds of pay");
        if (!e?.kra_pin) flag("No KRA PIN");
        if (!e?.nssf_no) flag("No NSSF number");
        if (!e?.shif_no) flag("No SHA number");
        if (!e?.national_id) flag("No ID number");
        const why = payProblem(e); if (why) flag(`Cannot be paid: ${why}`);
        const p = before.get(s.employee_id); if (p && Number(p.gross) > 0 && Math.abs(g - Number(p.gross)) / Number(p.gross) > 0.25) flag(`Gross changed ${Math.round(((g - Number(p.gross)) / Number(p.gross)) * 100)}% from last month`);
        if (s.data?.edits) flag("Pay edited by hand");
      }
      return { title: `Payroll checks · ${run.period}`, note: rows.length ? undefined : "Nothing to check: every line looks right.", rows: [["Employee", "Check", "Gross", "Net"], ...rows] };
    }
    const year = run.period.slice(0, 4);
    const yr = runs.filter((r) => r.period.startsWith(year)).sort((a, b) => a.period.localeCompare(b.period));
    const rows: Rows = yr.map((r) => { const t = r.totals || {}; return [periodLabel(r.period), r.status, Number(t.count || 0) || "", Number(t.gross || 0), Number(t.paye || 0), Number(t.nssf || 0) + Number(t.employer_nssf || t.nssf || 0), Number(t.shif || 0), Number(t.housing || 0) + Number(t.employer_housing || t.housing || 0), Number(t.net || 0), Number(t.employer_cost || 0)]; });
    const sum = (i: number) => r2(rows.reduce((t, r) => t + Number(r[i] || 0), 0));
    return { title: `Annual payroll schedule · ${year}`, rows: [["Month", "Status", "People", "Gross", "PAYE", "NSSF (both)", "SHIF", "Housing Levy (both)", "Net pay", "Employer cost"], ...rows, ["TOTAL", "", "", sum(3), sum(4), sum(5), sum(6), sum(7), sum(8), sum(9)]] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, slips, prev, runs, run, lk, empById]);

  const name = `${key}-${run.period}.csv`;
  return (
    <Panel flush title="Payroll reports" icon={FileSpreadsheet}
      actions={<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onPreview(report.title, name, report.rows)}><Download /> Download or print</Button></div>}>
      <div className="overflow-x-auto border-b border-border px-4 py-3">
        <Segmented<ReportKey> value={key} onChange={setKey} options={[{ value: "variance", label: "Variance" }, { value: "department", label: "By department" }, { value: "items", label: "Allowances & deductions" }, { value: "checks", label: "Checks" }, { value: "year", label: "Year" }]} />
      </div>
      <p className="px-4 pt-3 text-sm font-semibold">{report.title}</p>
      {report.note && <p className="px-4 pt-1 text-sm text-muted-foreground">{report.note}</p>}
      <div className="overflow-x-auto p-4"><ReportTable rows={report.rows} /></div>
    </Panel>
  );
}

export function ReportTable({ rows }: { rows: Rows }) {
  if (rows.length <= 1) return <p className="text-sm text-muted-foreground">Nothing to show.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border"><table className="dt dt-keep text-xs"><thead><tr>{rows[0].map((h, i) => <th key={i} className="whitespace-nowrap">{h}</th>)}</tr></thead>
      <tbody>{rows.slice(1).map((r, i) => <tr key={i} className={cn(r[0] === "TOTAL" && "font-bold")}>{r.map((c, j) => <td key={j} className={cn("whitespace-nowrap", typeof c === "number" && "num")}>{typeof c === "number" ? money(c) : c ?? "—"}</td>)}</tr>)}</tbody></table></div>
  );
}

/** Opens a print window with one table. */
export function printTable(title: string, rows: Rows, shop?: string) {
  const w = window.open("", "_blank", "width=1000,height=800");
  if (!w) return;
  const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#222}h2{color:#A8121B;margin:0 0 4px}table{width:100%;border-collapse:collapse;font-size:11px;margin-top:12px}th,td{padding:5px;border:1px solid #ddd;text-align:left}th{background:#faf6f2}td.n{text-align:right}</style></head><body><h2>${esc(shop || "")}</h2><b>${esc(title)}</b><table><thead><tr>${rows[0].map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td class="${typeof c === "number" ? "n" : ""}">${typeof c === "number" ? money(c) : esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table><script>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}
