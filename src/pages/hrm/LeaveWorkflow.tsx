import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Home, Plus, Check, X, Ban, Pencil, RotateCcw, ChevronLeft, ChevronRight, CalendarDays, UserCheck, Send } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Panel, EmptyState, Modal, Field, Pill, TableWrap } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import Pager, { usePaged } from "@/components/Pager";
import { confirmAction } from "@/components/books/confirm";
import { fmtDate } from "@/lib/doc-pdf";
import { cn } from "@/lib/utils";
import { useErpSettings } from "@/pages/settings/ErpSettingsTabs";
import { sb, useHrLookups, fullName, ymd, type Employee } from "./hrData";

/* ───────────────────────────── Shared helpers ───────────────────────────── */

export const LEAVE_STATUS: Record<string, { label: string; tone: "warning" | "success" | "danger" | "muted" | "info" }> = {
  pending_manager: { label: "With manager", tone: "info" },
  pending: { label: "With HR", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "muted" },
};
export const WAITING = ["pending_manager", "pending"];

/** Colleague names in the company (names only, safe for every employee). */
export function useColleagues() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["hr-colleagues", tenantId], enabled: !!tenantId, staleTime: 60_000,
    queryFn: async () => ((await sb.rpc("hr_colleagues")).data || []) as { id: string; name: string; department: string | null }[],
  });
}

/** The company's working days of the week (0 = Sunday). Mon–Sat when not set, as on the server. */
export function useWorkdays() {
  const { settings } = useErpSettings();
  const w = settings.hr?.workdays;
  return useMemo(() => new Set<number>(Array.isArray(w) && w.length ? w.map(Number) : [1, 2, 3, 4, 5, 6]), [w]);
}

/** Working days from one date to another (inclusive), without public holidays. The server counts the same way. */
export function countWorkDays(from: string, to: string, holidays: Set<string>, workdays: Set<number>) {
  if (!from || !to || to < from) return 0;
  let n = 0;
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    if (workdays.has(d.getUTCDay()) && !holidays.has(d.toISOString().slice(0, 10))) n++;
  }
  return n;
}

const span = (a: string, b: string) => (a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);

/* ───────────────────────────── Cover notice ───────────────────────────── */

/** Tells the signed-in person whose work they cover (now or soon). Shows nothing when there is none. */
export function CoverNotice() {
  const tenantId = useTenantId();
  const { data = [] } = useQuery({
    queryKey: ["hr-my-cover", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.rpc("hr_leave_my_cover")).data || []) as { id: string; employee_name: string; start_date: string; end_date: string; status: string }[],
  });
  if (!data.length) return null;
  const today = ymd();
  return (
    <div className="space-y-2">
      {data.map((c) => {
        const now = c.status === "approved" && c.start_date <= today;
        return (
          <div key={c.id} className={cn("flex items-start gap-3 rounded-xl border p-3 text-sm", now ? "border-primary/30 bg-primary/10" : "border-border bg-muted/50")}>
            <UserCheck className={cn("mt-0.5 h-4 w-4 shrink-0", now ? "text-primary" : "text-muted-foreground")} />
            <p>
              {now ? <>You are covering for <b>{c.employee_name}</b> until {fmtDate(c.end_date)}.</>
                : c.status === "approved" ? <>You will cover for <b>{c.employee_name}</b> from {span(c.start_date, c.end_date)}.</>
                : <><b>{c.employee_name}</b> named you as cover for {span(c.start_date, c.end_date)}. The leave is not approved yet.</>}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── Return early ───────────────────────────── */

export function ReturnEarlyModal({ r, onClose }: { r: any; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return ymd(d); })();
  const dayBefore = (() => { const d = new Date(`${r.end_date}T00:00:00`); d.setDate(d.getDate() - 1); return ymd(d); })();
  const [last, setLast] = useState(() => [yesterday, dayBefore].sort()[0] < r.start_date ? r.start_date : [yesterday, dayBefore].sort()[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { data, error } = await sb.rpc("hr_leave_return_early", { p_id: r.id, p_last_day: last, p_note: note.trim() || null });
    setBusy(false);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Leave ended early", description: `${Number(data) || 0} day${Number(data) === 1 ? "" : "s"} back to the balance.` });
    qc.invalidateQueries({ queryKey: ["hr-leave"] }); qc.invalidateQueries({ queryKey: ["hr-leave-board"] });
    onClose();
  };
  return (
    <Modal open onClose={onClose} center title="Return early" description={`Booked ${span(r.start_date, r.end_date)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy && <OrbSpinner />} End leave</Button></>}>
      <div className="space-y-3">
        <Field label="Last day off" hint="The unused working days go back to the leave balance."><input className="fi" type="date" min={r.start_date} max={dayBefore} value={last} onChange={(e) => setLast(e.target.value)} /></Field>
        <Field label="Note (optional)"><input className="fi" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/* ───────────────────────────── Leave calendar ───────────────────────────── */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A month of who is off. Approved leave is solid; requests still waiting are outlined. */
export function LeaveCalendar() {
  const tenantId = useTenantId();
  const { data: lk } = useHrLookups();
  const workdays = useWorkdays();
  const [month, setMonth] = useState(() => ymd().slice(0, 7));
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = ymd(new Date(y, m, 0));
  const { data = [], isLoading } = useQuery({
    queryKey: ["hr-leave-board", tenantId, month], enabled: !!tenantId,
    queryFn: async () => ((await sb.rpc("hr_leave_board", { p_from: first, p_to: last })).data || []) as { id: string; employee_name: string; leave_type: string | null; start_date: string; end_date: string; half_day: boolean; status: string }[],
  });
  const holidays = new Map((lk?.holidays || []).map((h) => [h.date, h.name]));
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const shift = (n: number) => { const d = new Date(y, m - 1 + n, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  const today = ymd();
  return (
    <Panel title={new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })} icon={CalendarDays}
      actions={<div className="flex items-center gap-1">
        <Button size="icon" variant="outline" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft /></Button>
        <Button size="sm" variant="ghost" onClick={() => setMonth(today.slice(0, 7))}>Today</Button>
        <Button size="icon" variant="outline" onClick={() => shift(1)} aria-label="Next month"><ChevronRight /></Button>
      </div>}>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-success/70" /> Approved</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-dashed border-warning bg-warning/10" /> Waiting for approval</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-accent/30" /> Public holiday</span>
      </div>
      {isLoading ? <OrbLoader label="Loading…" /> : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => <div key={d} className="px-1 pb-1 text-xs font-semibold text-muted-foreground">{d}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const off = data.filter((r) => r.start_date <= d && r.end_date >= d);
              const hol = holidays.get(d);
              const working = workdays.has(new Date(`${d}T00:00:00Z`).getUTCDay()) && !hol;
              return (
                <div key={d} className={cn("min-h-[92px] rounded-lg border p-1.5", d === today ? "border-primary" : "border-border", !working && "bg-muted/40", hol && "bg-accent/10")}>
                  <div className="flex items-center justify-between text-xs"><span className={cn("font-semibold", d === today && "text-primary")}>{Number(d.slice(8))}</span>{hol && <span className="truncate pl-1 text-[10px] text-muted-foreground" title={hol}>{hol}</span>}</div>
                  {working && <div className="mt-1 space-y-0.5">
                    {off.slice(0, 3).map((r) => (
                      <div key={r.id} title={`${r.employee_name}${r.leave_type ? ` · ${r.leave_type}` : ""}${r.half_day ? " · half day" : ""} · ${LEAVE_STATUS[r.status]?.label || r.status}`}
                        className={cn("truncate rounded px-1 py-0.5 text-[11px]", r.status === "approved" ? "bg-success/15 text-success" : "border border-dashed border-warning/60 text-[hsl(32_90%_38%)]")}>
                        {r.employee_name}{r.half_day ? " (½)" : ""}
                      </div>
                    ))}
                    {off.length > 3 && <div className="px-1 text-[11px] text-muted-foreground" title={off.slice(3).map((r) => r.employee_name).join(", ")}>+{off.length - 3} more</div>}
                  </div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ───────────────────────────── Work from home ───────────────────────────── */

const WFH_TONE: Record<string, "warning" | "success" | "danger" | "muted"> = { pending: "warning", approved: "success", rejected: "danger", cancelled: "muted" };

/** Work-from-home requests: staff ask, the line manager or HR decides. */
export function WfhPanel({ hr, me, emps }: { hr: boolean; me: Employee | null; emps: Employee[] }) {
  const tenantId = useTenantId();
  const { user } = useAuth() as any;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: colleagues = [] } = useColleagues();
  const [form, setForm] = useState<{ existing?: any } | null>(null);
  const [decide, setDecide] = useState<{ r: any; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [view, setView] = useState<"open" | "all">("open");
  const { data = [], isLoading } = useQuery({
    queryKey: ["hr-wfh", tenantId, hr, me?.id], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("hr_wfh_requests").select("*").eq("tenant_id", tenantId).order("start_date", { ascending: false }).limit(1000)).data || []) as any[],
  });
  const names = new Map<string, string>([...colleagues.map((c) => [c.id, c.name] as [string, string]), ...emps.map((e) => [e.id, fullName(e)] as [string, string])]);
  const canDecide = (r: any) => r.status === "pending" && (hr || r.manager_user_id === user?.id) && r.employee_id !== me?.id;
  const today = ymd();
  const rows = data.filter((r) => view === "all" || r.status === "pending" || (r.status === "approved" && r.end_date >= today));
  const paged = usePaged(rows, 20);
  const showWho = hr || data.some((r) => r.employee_id !== me?.id);
  const doDecide = async () => {
    if (!decide) return;
    if (!decide.approve && !note.trim()) return toast({ title: "Say why it is rejected", variant: "destructive" });
    const { error } = await sb.rpc("hr_wfh_decide", { p_id: decide.r.id, p_approve: decide.approve, p_note: note.trim() || null });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: decide.approve ? "Approved" : "Rejected" });
    setDecide(null); setNote(""); qc.invalidateQueries({ queryKey: ["hr-wfh"] });
  };
  const cancel = async (r: any) => {
    if (!(await confirmAction({ title: "Close this request?", confirmLabel: "Close request", danger: true }))) return;
    const { error } = await sb.rpc("hr_wfh_cancel", { p_id: r.id });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Request closed" }); qc.invalidateQueries({ queryKey: ["hr-wfh"] });
  };
  if (isLoading) return <OrbLoader label="Loading…" />;
  return (
    <>
      <Panel flush title="Work from home" icon={Home}
        actions={<div className="flex items-center gap-2">
          <select className="fi h-9 w-auto" value={view} onChange={(e) => setView(e.target.value as "open" | "all")}><option value="open">Waiting and coming up</option><option value="all">All</option></select>
          <Button size="sm" onClick={() => setForm({})} disabled={!me && !hr}><Plus /> Ask to work from home</Button>
        </div>}>
        {rows.length === 0 ? <EmptyState icon={Home} title="No work-from-home requests here" /> : <>
          <TableWrap><table className="dt">
            <thead><tr>{showWho && <th>Employee</th>}<th>Dates</th><th className="num">Days</th><th className="hidden md:table-cell">Reason</th><th>Status</th><th /></tr></thead>
            <tbody>{paged.rows.map((r: any) => (
              <tr key={r.id}>
                {showWho && <td className="font-medium">{names.get(r.employee_id) || "—"}</td>}
                <td className="whitespace-nowrap">{span(r.start_date, r.end_date)}</td>
                <td className="num">{Number(r.days)}</td>
                <td className="hidden max-w-[240px] md:table-cell"><span className="line-clamp-2 text-muted-foreground">{r.reason || "—"}</span>{r.decision_note && <span className="block text-xs text-muted-foreground">Note: {r.decision_note}</span>}</td>
                <td><Pill tone={WFH_TONE[r.status]}>{r.status === "pending" ? "Waiting" : r.status}</Pill></td>
                <td><span className="flex justify-end gap-1">
                  {canDecide(r) && <><Button size="sm" onClick={() => { setDecide({ r, approve: true }); setNote(""); }}><Check /> Approve</Button><Button size="sm" variant="outline" onClick={() => { setDecide({ r, approve: false }); setNote(""); }}><X /> Reject</Button></>}
                  {r.employee_id === me?.id && ["pending", "rejected"].includes(r.status) && <Button size="sm" variant="outline" onClick={() => setForm({ existing: r })}>{r.status === "rejected" ? <><RotateCcw /> Change and send again</> : <><Pencil /> Edit</>}</Button>}
                  {(r.employee_id === me?.id || hr) && (["pending", "rejected"].includes(r.status) || (r.status === "approved" && r.end_date >= today)) && <Button size="sm" variant="ghost" onClick={() => cancel(r)}><Ban /> Close</Button>}
                </span></td>
              </tr>
            ))}</tbody>
          </table></TableWrap>
          <Pager {...paged.pager} />
        </>}
      </Panel>
      {form && <WfhForm existing={form.existing} me={me} hr={hr} emps={emps} onClose={() => setForm(null)} />}
      <Modal open={!!decide} onClose={() => setDecide(null)} center title={decide?.approve ? "Approve work from home" : "Reject work from home"}
        description={decide ? `${names.get(decide.r.employee_id) || ""} · ${span(decide.r.start_date, decide.r.end_date)}` : ""}
        footer={<><Button variant="ghost" onClick={() => setDecide(null)}>Cancel</Button><Button variant={decide?.approve ? "default" : "destructive"} onClick={doDecide}>{decide?.approve ? "Approve" : "Reject"}</Button></>}>
        <Field label={decide?.approve ? "Note (optional)" : "Reason"}><textarea className="fi" autoFocus value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Modal>
    </>
  );
}

function WfhForm({ existing, me, hr, emps, onClose }: { existing?: any; me: Employee | null; hr: boolean; emps: Employee[]; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: lk } = useHrLookups();
  const workdays = useWorkdays();
  const [forOther, setForOther] = useState(!!existing && existing.employee_id !== me?.id);
  const [f, setF] = useState({ employee_id: existing?.employee_id || "", start_date: existing?.start_date || ymd(), end_date: existing?.end_date || ymd(), reason: existing?.reason || "" });
  const [busy, setBusy] = useState(false);
  const holidays = useMemo(() => new Set((lk?.holidays || []).map((h) => h.date)), [lk]);
  const days = countWorkDays(f.start_date, f.end_date, holidays, workdays);
  const save = async () => {
    if (forOther && !f.employee_id) return toast({ title: "Choose the employee", variant: "destructive" });
    if (days <= 0) return toast({ title: "Those dates have no working days", variant: "destructive" });
    setBusy(true);
    const { error } = await sb.rpc("hr_wfh_save", { p_id: existing?.id || null, p_employee: forOther ? f.employee_id : existing?.employee_id || null, p_start: f.start_date, p_end: f.end_date, p_reason: f.reason.trim() || null });
    setBusy(false);
    if (error) return toast({ title: "Not sent", description: error.message, variant: "destructive" });
    toast({ title: existing ? "Request updated" : "Request sent" });
    qc.invalidateQueries({ queryKey: ["hr-wfh"] }); onClose();
  };
  return (
    <Modal open onClose={onClose} title={existing ? "Change work-from-home request" : "Ask to work from home"} icon={Home}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? <OrbSpinner /> : <Send />} Send</Button></>}>
      <div className="space-y-4">
        {existing?.decision_note && existing.status === "rejected" && <p className="rounded-xl bg-destructive/10 p-3 text-sm"><b>Reason given:</b> {existing.decision_note}</p>}
        {hr && !existing && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={forOther} onChange={(e) => setForOther(e.target.checked)} /> For another employee</label>}
        {forOther && !existing && <Field label="Employee"><select className="fi" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}><option value="">Select…</option>{emps.filter((e) => !["terminated", "resigned"].includes(e.status)).map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}</select></Field>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From"><input className="fi" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: e.target.value > f.end_date ? e.target.value : f.end_date })} /></Field>
          <Field label="To"><input className="fi" type="date" min={f.start_date} value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
        </div>
        <p className="rounded-xl bg-muted/60 p-3 text-sm"><b>{days}</b> working day{days === 1 ? "" : "s"}.</p>
        <Field label="Reason (optional)"><textarea className="fi" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. waiting for a delivery at home" /></Field>
      </div>
    </Modal>
  );
}
