import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plane, Plus, Check, X, Paperclip, Pencil, Ban, CalendarCheck, LogIn, LogOut, ChevronLeft, ChevronRight, Users, Clock, CalendarDays, Search, RotateCcw, Eye,
} from "lucide-react";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, Pill, TableWrap } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import Pager, { usePaged, PagedRows } from "@/components/Pager";
import ImportExport from "@/components/ImportExport";
import { confirmAction } from "@/components/books/confirm";
import { uploadDocument, openDocument } from "@/components/DocumentsPanel";
import { fmtDate } from "@/lib/doc-pdf";
import { workingDays } from "@/lib/kenyaPayroll";
import { cn } from "@/lib/utils";
import { sb, useHrLookups, fullName, ymd, csvOf, type Employee } from "./hrData";
import { LEAVE_STATUS, WAITING, useColleagues, useWorkdays, countWorkDays, CoverNotice, ReturnEarlyModal, LeaveCalendar, WfhPanel } from "./LeaveWorkflow";

/** First day of the month after a "YYYY-MM" month (months have 28–31 days, so never filter on -31). */
const nextMonthStart = (month: string) => { const [y, m] = month.split("-").map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`; };
/** The signed-in person's employee record (if HR linked their login). */
function useMyEmployee() {
  const { user } = useAuth() as any;
  return useQuery({
    queryKey: ["hr-me", user?.id],
    enabled: !!user?.id,
    queryFn: async () => (await sb.from("hr_employees").select("*").eq("user_id", user.id).maybeSingle()).data as Employee | null,
  });
}
function useCanHr() {
  const { role } = useAuth() as any;
  const { data } = useQuery({ queryKey: ["can-hr", role], queryFn: async () => ((await sb.rpc("hr_can")).data as boolean) ?? false });
  return role === "admin" || role === "manager" || role === "super_admin" || !!data;
}

/* ───────────────────────────── Leave ───────────────────────────── */

type LeaveTab = "mine" | "review" | "all" | "calendar" | "wfh";

export function Leave() {
  const tenantId = useTenantId();
  const { user, role } = useAuth() as any;
  const { toast } = useToast();
  const qc = useQueryClient();
  const hr = useCanHr();
  const { data: me } = useMyEmployee();
  const { data: lk } = useHrLookups();
  const { data: colleagues = [] } = useColleagues();
  const [tab, setTab] = useState<LeaveTab>(hr ? "review" : "mine");
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState<{ existing?: any } | null>(null);
  const [decide, setDecide] = useState<{ r: any; approve: boolean } | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [returning, setReturning] = useState<any | null>(null);
  const [note, setNote] = useState("");
  const { data: emps = [] } = useQuery({
    queryKey: ["hr-employees-lite", tenantId, hr], enabled: !!tenantId && hr,
    queryFn: async () => ((await sb.from("hr_employees").select("id,first_name,last_name,other_names,gender,status,user_id").eq("tenant_id", tenantId).order("first_name")).data || []) as Employee[],
  });
  // HR reads every request; others read their own and the ones waiting for them as line manager (RLS decides).
  const { data = [], isLoading } = useQuery({
    queryKey: ["hr-leave", tenantId, me?.id, hr], enabled: !!tenantId,
    queryFn: async () => (await sb.from("hr_leave_requests").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(2000)).data || [],
  });
  const all = data as any[];
  const names = new Map<string, string>([...colleagues.map((c) => [c.id, c.name] as [string, string]), ...emps.map((e) => [e.id, fullName(e)] as [string, string]), ...(me ? [[me.id, fullName(me)] as [string, string]] : [])]);
  const nameOf = (id: string | null | undefined) => (id ? names.get(id) || "—" : "—");
  const typeName = new Map((lk?.leaveTypes || []).map((t) => [t.id, t.name]));
  const isAdmin = role === "admin" || role === "super_admin";
  const canDecide = (r: any) => (r.employee_id !== me?.id || isAdmin) && ((r.status === "pending_manager" && (hr || r.manager_user_id === user?.id)) || (r.status === "pending" && hr));
  const managesSomeone = all.some((r) => r.manager_user_id === user?.id && r.employee_id !== me?.id);
  const toReview = all.filter(canDecide);
  const rows = useMemo(() => {
    const list = tab === "mine" ? all.filter((r) => r.employee_id === me?.id) : tab === "review" ? toReview : all;
    const s = q.trim().toLowerCase();
    return list.filter((r) => !s || `${nameOf(r.employee_id)} ${typeName.get(r.leave_type_id)} ${r.reason || ""}`.toLowerCase().includes(s));
  }, [all, tab, q, me?.id, toReview.length, names.size]); // eslint-disable-line react-hooks/exhaustive-deps
  const paged = usePaged(rows, 20);
  const year = String(new Date().getFullYear());
  const today = ymd();
  const balanceFor = (empId: string | undefined, typeId: string) => {
    const t = (lk?.leaveTypes || []).find((x) => x.id === typeId);
    if (!t || !empId) return null;
    const mine = all.filter((r) => r.employee_id === empId && r.leave_type_id === typeId && String(r.start_date).startsWith(year));
    const used = mine.filter((r) => r.status === "approved").reduce((a, r) => a + Number(r.days), 0);
    const pending = mine.filter((r) => WAITING.includes(r.status)).reduce((a, r) => a + Number(r.days), 0);
    return { entitled: Number(t.days_per_year), used, pending, left: Math.max(0, Number(t.days_per_year) - used - pending), limited: Number(t.days_per_year) > 0 };
  };
  const refresh = () => { qc.invalidateQueries({ queryKey: ["hr-leave"] }); qc.invalidateQueries({ queryKey: ["hr-leave-board"] }); qc.invalidateQueries({ queryKey: ["hr-my-cover"] }); };
  const doDecide = async () => {
    if (!decide) return;
    if (!decide.approve && !note.trim()) return toast({ title: "Say why it is rejected", variant: "destructive" });
    const { data: res, error } = await sb.rpc("hr_leave_decide", { p_id: decide.r.id, p_approve: decide.approve, p_note: note.trim() || null });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: res === "pending" ? "Approved and sent to HR" : res === "approved" ? "Leave approved" : "Leave rejected" });
    setDecide(null); setNote(""); refresh();
  };
  const cancel = async (r: any) => {
    if (!(await confirmAction({ title: "Close this request?", message: "It is cancelled and no longer counts against the balance.", confirmLabel: "Close request", danger: true }))) return;
    const { error } = await sb.rpc("hr_leave_cancel", { p_id: r.id, p_note: null });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Request closed" }); refresh();
  };
  const mineOrHr = (r: any) => r.employee_id === me?.id || hr;
  const canClose = (r: any) => mineOrHr(r) && ([...WAITING, "rejected"].includes(r.status) || (r.status === "approved" && r.start_date > today));
  const canReturn = (r: any) => mineOrHr(r) && r.status === "approved" && !r.half_day && r.start_date <= today && r.end_date > r.start_date && r.end_date >= today;
  const openDoc = async (id: string) => { const { data: d } = await sb.from("documents").select("path,url,name,mime_type").eq("id", id).maybeSingle(); if (d) await openDocument(d).catch(() => {}); };
  const statusPill = (s: string) => <Pill tone={LEAVE_STATUS[s]?.tone || "muted"}>{LEAVE_STATUS[s]?.label || s}</Pill>;
  if (isLoading) return <OrbLoader label="Loading leave…" />;
  const tabs: [LeaveTab, string, boolean][] = [
    ["mine", "My leave", !!me],
    ["review", `To approve${toReview.length ? ` (${toReview.length})` : ""}`, hr || managesSomeone],
    ["all", "All requests", hr],
    ["calendar", "Calendar", hr || !!me],
    ["wfh", "Work from home", hr || !!me],
  ];
  const current = tabs.find(([v, , show]) => v === tab && show) ? tab : (tabs.find(([, , show]) => show)?.[0] || "mine");
  return (
    <div className="space-y-5">
      <PageHeader title="Leave" icon={Plane} description="Request leave, see your balance and follow the approval: line manager first, then HR."
        actions={<>{hr && <ImportExport entity="leave" rows={all.map((r) => ({ employee: nameOf(r.employee_id), type: typeName.get(r.leave_type_id), from: r.start_date, to: r.end_date, days: r.days, status: r.status, reason: r.reason, decision: r.decision_note, cover: r.cover_employee_id ? nameOf(r.cover_employee_id) : "" }))} />}
          <Button onClick={() => setSheet({})} disabled={!me && !hr}><Plus /> Request leave</Button></>} />
      {!me && !hr && <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">Your login is not linked to an employee record yet, so you cannot request leave. Ask HR to link it under HRM → Employees.</p>}
      <CoverNotice />
      {me && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {(lk?.leaveTypes || []).filter((t) => t.active && t.days_per_year > 0 && (!t.gender || t.gender === me.gender)).slice(0, 4).map((t, i) => {
            const b = balanceFor(me.id, t.id)!;
            return <StatTile key={t.id} label={t.name} value={`${b.left} days left`} hint={`${b.used} used · ${b.pending} waiting · ${b.entitled} a year`} icon={Plane} tone={(["primary", "info", "success", "warning"] as const)[i % 4]} />;
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">
          {tabs.filter(([, , show]) => show).map(([v, l]) => <button key={v} onClick={() => setTab(v)} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-sm", current === v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{l}</button>)}
        </div>
        {["mine", "review", "all"].includes(current) && <div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
      </div>
      {current === "calendar" ? <LeaveCalendar /> : current === "wfh" ? <WfhPanel hr={hr} me={me || null} emps={emps} /> : (
        <Panel flush>
          {rows.length === 0 ? <EmptyState icon={Plane} title={current === "review" ? "Nothing waiting for you" : "No leave requests here"} /> : <>
            <TableWrap><table className="dt">
              <thead><tr>{current !== "mine" && <th>Employee</th>}<th>Type</th><th>Dates</th><th className="num">Days</th><th className="hidden md:table-cell">Reason</th><th>Status</th><th /></tr></thead>
              <tbody>{paged.rows.map((r: any) => (
                <tr key={r.id} className="cursor-pointer" onClick={() => setViewing(r)}>
                  {current !== "mine" && <td className="font-medium">{nameOf(r.employee_id)}</td>}
                  <td>{typeName.get(r.leave_type_id) || "Leave"}</td>
                  <td className="whitespace-nowrap">{fmtDate(r.start_date)} – {fmtDate(r.end_date)}{r.planned_end_date && <span className="block text-xs text-muted-foreground">Back early (booked to {fmtDate(r.planned_end_date)})</span>}</td>
                  <td className="num">{Number(r.days)}{r.half_day ? " (half)" : ""}</td>
                  <td className="hidden max-w-[240px] md:table-cell"><span className="line-clamp-2 text-muted-foreground">{r.reason || "—"}</span>{r.cover_employee_id && <span className="block text-xs text-muted-foreground">Cover: {nameOf(r.cover_employee_id)}</span>}{r.decision_note && <span className="block text-xs text-destructive">Note: {r.decision_note}</span>}</td>
                  <td>{statusPill(r.status)}</td>
                  <td onClick={(e) => e.stopPropagation()}><span className="flex justify-end gap-1">
                    <button className="icon-btn" title="View" onClick={() => setViewing(r)}><Eye className="h-4 w-4" /></button>
                    {r.document_id && <button className="icon-btn" title="Attachment" onClick={() => openDoc(r.document_id)}><Paperclip className="h-4 w-4" /></button>}
                    {canDecide(r) && <><Button size="sm" onClick={() => { setDecide({ r, approve: true }); setNote(""); }}><Check /> Approve</Button><Button size="sm" variant="outline" onClick={() => { setDecide({ r, approve: false }); setNote(""); }}><X /> Reject</Button></>}
                    {r.employee_id === me?.id && [...WAITING, "rejected"].includes(r.status) && <Button size="sm" variant="outline" onClick={() => setSheet({ existing: r })}>{r.status === "rejected" ? <><RotateCcw /> Amend & resubmit</> : <><Pencil /> Edit</>}</Button>}
                    {canReturn(r) && <Button size="sm" variant="outline" onClick={() => setReturning(r)}><LogIn /> Return early</Button>}
                    {canClose(r) && <Button size="sm" variant="ghost" onClick={() => cancel(r)}><Ban /> Close</Button>}
                  </span></td>
                </tr>
              ))}</tbody>
            </table></TableWrap>
            <Pager {...paged.pager} />
          </>}
        </Panel>
      )}
      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={`${typeName.get(viewing.leave_type_id) || "Leave"} · ${nameOf(viewing.employee_id)}`} icon={Plane}
          description={`${fmtDate(viewing.start_date)} – ${fmtDate(viewing.end_date)} · ${Number(viewing.days)} working day${Number(viewing.days) === 1 ? "" : "s"}`}
          footer={<div className="flex w-full flex-wrap gap-2">
            {canDecide(viewing) && <><Button onClick={() => { setDecide({ r: viewing, approve: true }); setNote(""); setViewing(null); }}><Check /> Approve</Button><Button variant="outline" onClick={() => { setDecide({ r: viewing, approve: false }); setNote(""); setViewing(null); }}><X /> Reject</Button></>}
            {viewing.employee_id === me?.id && [...WAITING, "rejected"].includes(viewing.status) && <Button variant="outline" onClick={() => { setSheet({ existing: viewing }); setViewing(null); }}>{viewing.status === "rejected" ? <><RotateCcw /> Amend & resubmit</> : <><Pencil /> Edit</>}</Button>}
            {canReturn(viewing) && <Button variant="outline" onClick={() => { setReturning(viewing); setViewing(null); }}><LogIn /> Return early</Button>}
            {viewing.document_id && <Button variant="outline" onClick={() => openDoc(viewing.document_id)}><Paperclip /> Attachment</Button>}
            <Button variant="ghost" className="ml-auto" onClick={() => setViewing(null)}>Close</Button>
          </div>}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">{statusPill(viewing.status)}{(() => { const b = balanceFor(viewing.employee_id, viewing.leave_type_id); return b?.limited ? <Pill tone="info">{b.left} of {b.entitled} days left this year</Pill> : null; })()}</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {([["Employee", nameOf(viewing.employee_id)], ["Type", typeName.get(viewing.leave_type_id) || "Leave"], ["From", fmtDate(viewing.start_date)], ["To", fmtDate(viewing.end_date)],
                ["Working days", `${Number(viewing.days)}${viewing.half_day ? " (half day)" : ""}`], ["Cover", viewing.cover_employee_id ? nameOf(viewing.cover_employee_id) : "None"],
                ...(viewing.planned_end_date ? [["Booked to", fmtDate(viewing.planned_end_date)]] : []),
                ["Requested", fmtDate(viewing.created_at)], ["Manager", viewing.manager_decided_at ? fmtDate(viewing.manager_decided_at) : viewing.manager_user_id ? "Waiting" : "Not needed"], ["Decided", viewing.decided_at ? fmtDate(viewing.decided_at) : "—"]] as [string, string][]).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>
              ))}
            </dl>
            <div><p className="text-xs text-muted-foreground">Reason</p><p className="mt-1 rounded-xl bg-muted/50 p-3 text-sm">{viewing.reason || "No reason given"}</p></div>
            {viewing.manager_note && viewing.manager_note !== viewing.decision_note && <div><p className="text-xs text-muted-foreground">Manager's note</p><p className="mt-1 rounded-xl bg-primary/5 p-3 text-sm">{viewing.manager_note}</p></div>}
            {viewing.decision_note && <div><p className="text-xs text-muted-foreground">Decision note</p><p className="mt-1 rounded-xl bg-primary/5 p-3 text-sm">{viewing.decision_note}</p></div>}
            {(viewing.history || []).length > 0 && <div><p className="mb-2 text-xs font-semibold text-muted-foreground">History</p><ol className="space-y-2 border-l-2 border-border pl-4 text-sm">{viewing.history.map((h: any, i: number) => <li key={i}><span className="font-medium first-letter:uppercase">{h.action}</span>{h.by ? ` by ${h.by}` : ""}<span className="block text-xs text-muted-foreground">{new Date(h.at).toLocaleString("en-GB")}{h.note ? ` · ${h.note}` : ""}</span></li>)}</ol></div>}
          </div>
        </Modal>
      )}
      {sheet && <LeaveSheet existing={sheet.existing} me={me || null} hr={hr} emps={emps} all={all} balanceFor={balanceFor} onClose={() => setSheet(null)} onSaved={refresh} />}
      {returning && <ReturnEarlyModal r={returning} onClose={() => setReturning(null)} />}
      <Modal open={!!decide} onClose={() => setDecide(null)} center title={decide?.approve ? "Approve leave" : "Reject leave"}
        description={decide ? `${nameOf(decide.r.employee_id)} · ${Number(decide.r.days)} days from ${fmtDate(decide.r.start_date)}${decide.approve && decide.r.status === "pending_manager" && !hr ? " · HR approves next" : ""}` : ""}
        footer={<><Button variant="ghost" onClick={() => setDecide(null)}>Cancel</Button><Button variant={decide?.approve ? "default" : "destructive"} onClick={doDecide}>{decide?.approve ? "Approve" : "Reject"}</Button></>}>
        <Field label={decide?.approve ? "Note (optional)" : "Reason (they can amend and resubmit)"}><textarea className="fi" autoFocus value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}

function LeaveSheet({ existing, me, hr, emps, all, balanceFor, onClose, onSaved }: {
  existing?: any; me: Employee | null; hr: boolean; emps: Employee[]; all: any[];
  balanceFor: (empId: string | undefined, typeId: string) => { entitled: number; used: number; pending: number; left: number; limited: boolean } | null; onClose: () => void; onSaved: () => void;
}) {
  const tenantId = useTenantId();
  const { profile } = useAuth() as any;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: lk } = useHrLookups();
  const { data: colleagues = [] } = useColleagues();
  const workdays = useWorkdays();
  const [forOther, setForOther] = useState(!!existing && existing.employee_id !== me?.id);
  const [f, setF] = useState({ employee_id: existing?.employee_id || me?.id || "", leave_type_id: existing?.leave_type_id || "", start_date: existing?.start_date || ymd(), end_date: existing?.end_date || ymd(), reason: existing?.reason || "", half_day: !!existing?.half_day, cover_employee_id: existing?.cover_employee_id || "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const empId = forOther ? f.employee_id : me?.id;
  const emp = forOther ? emps.find((e) => e.id === f.employee_id) : me;
  const holidays = useMemo(() => new Set((lk?.holidays || []).map((h) => h.date)), [lk]);
  const oneDay = f.start_date === f.end_date;
  const fullDays = countWorkDays(f.start_date, f.end_date, holidays, workdays);
  const days = f.half_day && oneDay && fullDays > 0 ? 0.5 : fullDays;
  const types = (lk?.leaveTypes || []).filter((t) => t.active && (!t.gender || !emp?.gender || t.gender === emp.gender));
  const type = types.find((t) => t.id === f.leave_type_id);
  const bal = f.leave_type_id ? balanceFor(empId, f.leave_type_id) : null;
  const leftAfterEdit = bal ? bal.left + (existing && existing.leave_type_id === f.leave_type_id && WAITING.includes(existing.status) ? Number(existing.days) : 0) : 0;
  const overlaps = all.some((r) => r.employee_id === empId && r.id !== existing?.id && [...WAITING, "approved"].includes(r.status) && r.start_date <= f.end_date && r.end_date >= f.start_date);
  const save = async () => {
    if (!empId) return toast({ title: "Choose the employee", variant: "destructive" });
    if (!type) return toast({ title: "Choose the type of leave", variant: "destructive" });
    if (days <= 0) return toast({ title: "Those dates have no working days", variant: "destructive" });
    if (bal?.limited && days > leftAfterEdit) return toast({ title: "Not enough leave days", description: `Only ${leftAfterEdit} ${type.name.toLowerCase()} days are available.`, variant: "destructive" });
    if (overlaps) return toast({ title: "Those dates overlap another request", variant: "destructive" });
    if (type.requires_document && !file && !existing?.document_id) return toast({ title: `${type.name} needs a supporting document`, description: "e.g. a doctor's note. Attach it below.", variant: "destructive" });
    setBusy(true);
    try {
      let document_id = existing?.document_id || null;
      if (file && tenantId) document_id = (await uploadDocument(tenantId, file, { entity_type: "leave", entity_id: empId, entity_name: fullName(emp), category: `${type.name} attachment`, name: file.name, uploaded_by_name: profile?.display_name })).id;
      const { error } = await sb.rpc("hr_leave_save", {
        p_id: existing?.id || null, p_employee: empId, p_type: f.leave_type_id, p_start: f.start_date, p_end: f.end_date,
        p_half_day: f.half_day && oneDay, p_reason: f.reason.trim() || null, p_cover: f.cover_employee_id || null, p_document: document_id,
      });
      if (error) throw error;
      toast({ title: existing ? "Request updated and sent again" : "Leave requested", description: "You will get a notification when it is decided." });
      onSaved(); qc.invalidateQueries({ queryKey: ["documents"] });
      onClose();
    } catch (e: any) { toast({ title: "Not saved", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={existing ? (existing.status === "rejected" ? "Amend & resubmit" : "Edit leave request") : "Request leave"} description={emp ? fullName(emp) : undefined} icon={Plane} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy && <OrbSpinner />} {existing ? "Submit again" : "Submit request"}</Button></>}>
      <div className="space-y-4">
        {existing?.decision_note && existing.status === "rejected" && <p className="rounded-xl bg-destructive/10 p-3 text-sm"><b>Reason given:</b> {existing.decision_note}</p>}
        {hr && !existing && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={forOther} onChange={(e) => setForOther(e.target.checked)} /> Apply on behalf of another employee</label>
        )}
        {forOther && <Field label="Employee"><select className="fi" value={f.employee_id} disabled={!!existing} onChange={(e) => setF({ ...f, employee_id: e.target.value })}><option value="">Select…</option>{emps.filter((e) => !["terminated", "resigned"].includes(e.status)).map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}</select></Field>}
        <Field label="Type of leave">
          <div className="grid gap-2 sm:grid-cols-2">{types.map((t) => {
            const b = balanceFor(empId, t.id);
            return (
              <button key={t.id} type="button" onClick={() => setF({ ...f, leave_type_id: t.id })}
                className={cn("rounded-xl border-2 p-3 text-left transition-all", f.leave_type_id === t.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
                <span className="block text-sm font-semibold">{t.name}</span>
                <span className="block text-xs text-muted-foreground">{b?.limited ? `${b.left} of ${b.entitled} days available` : t.paid ? "Paid" : "Unpaid"}{t.requires_document ? " · document needed" : ""}</span>
              </button>
            );
          })}</div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From"><input className="fi" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: e.target.value > f.end_date ? e.target.value : f.end_date })} /></Field>
          <Field label="To (last day of leave)"><input className="fi" type="date" min={f.start_date} value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
        </div>
        {oneDay && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.half_day} onChange={(e) => setF({ ...f, half_day: e.target.checked })} /> Half day only</label>}
        <div className={cn("rounded-xl p-3 text-sm", bal?.limited && days > leftAfterEdit ? "bg-destructive/10" : "bg-muted/60")}>
          <b>{days}</b> working day{days === 1 ? "" : "s"} (days off and public holidays are not counted).
          {type && bal?.limited && <> You have <b>{leftAfterEdit}</b> {type.name.toLowerCase()} day{leftAfterEdit === 1 ? "" : "s"} available; <b>{Math.max(0, leftAfterEdit - days)}</b> left after this.</>}
          {overlaps && <span className="block font-semibold text-destructive">These dates overlap another leave request.</span>}
        </div>
        <Field label="Cover (optional)" hint="A colleague who stands in while you are away. They are told when the leave is approved.">
          <select className="fi" value={f.cover_employee_id} onChange={(e) => setF({ ...f, cover_employee_id: e.target.value })}>
            <option value="">No one</option>
            {colleagues.filter((c) => c.id !== empId).map((c) => <option key={c.id} value={c.id}>{c.name}{c.department ? ` · ${c.department}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Reason (optional)"><textarea className="fi" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. family function, medical appointment" /></Field>
        <Field label={`Attachment${type?.requires_document ? " (required)" : " (optional)"}`} hint="A doctor's note, letter or any supporting document. Kept in Documents.">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border px-3 py-3 text-sm hover:border-primary">
            <Paperclip className="h-4 w-4 text-muted-foreground" /><span className="flex-1 truncate">{file ? file.name : existing?.document_id ? "A file is attached (choose to replace it)" : "Choose a file"}</span>
            <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
        </Field>
        {(existing?.history || []).length > 0 && <div><p className="mb-1 text-xs font-semibold text-muted-foreground">History</p><ul className="space-y-1 text-xs text-muted-foreground">{existing.history.map((h: any, i: number) => <li key={i}>{new Date(h.at).toLocaleString("en-GB")} · {h.action}{h.by ? ` by ${h.by}` : ""}{h.note ? ` · ${h.note}` : ""}</li>)}</ul></div>}
      </div>
    </Modal>
  );
}


/* ───────────────────────────── Attendance ───────────────────────────── */

const ATT = [["present", "Present", "bg-success text-white"], ["late", "Late", "bg-warning text-white"], ["half_day", "Half day", "bg-info text-white"], ["absent", "Absent", "bg-destructive text-white"], ["leave", "Leave", "bg-primary text-primary-foreground"], ["off", "Off", "bg-muted-foreground text-white"], ["holiday", "Holiday", "bg-accent text-accent-foreground"]] as const;
const ATT_DOT: Record<string, string> = { present: "bg-success", late: "bg-warning", half_day: "bg-info", absent: "bg-destructive", leave: "bg-primary", off: "bg-muted-foreground/50", holiday: "bg-accent" };
const shift = (d: string, n: number) => ymd(new Date(new Date(`${d}T00:00:00`).getTime() + n * 86400000));

export function Attendance() {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const hr = useCanHr();
  const { data: me } = useMyEmployee();
  const { data: lk } = useHrLookups();
  const [date, setDate] = useState(ymd());
  const [month, setMonth] = useState(ymd().slice(0, 7));
  const [view, setView] = useState<"day" | "month">("day");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [early, setEarly] = useState<{ msg: string } | null>(null);
  const [reason, setReason] = useState("");
  const { data: emps = [] } = useQuery({
    queryKey: ["hr-employees-lite", tenantId, hr], enabled: !!tenantId && hr,
    queryFn: async () => ((await sb.from("hr_employees").select("id,first_name,last_name,other_names,gender,status,user_id,department_id").eq("tenant_id", tenantId).order("first_name")).data || []) as Employee[],
  });
  const current = emps.filter((e) => !["terminated", "resigned"].includes(e.status) && (!q.trim() || fullName(e).toLowerCase().includes(q.trim().toLowerCase())));
  const { data: day = [] } = useQuery({ queryKey: ["hr-att-day", tenantId, date], enabled: !!tenantId && hr, queryFn: async () => (await sb.from("hr_attendance").select("*").eq("tenant_id", tenantId).eq("date", date)).data || [] });
  const { data: monthRows = [] } = useQuery({
    queryKey: ["hr-att-month", tenantId, month, hr, me?.id], enabled: !!tenantId,
    queryFn: async () => {
      let qy = sb.from("hr_attendance").select("employee_id,date,status,overtime_hours,hours,clock_in,clock_out,late_minutes,left_early,early_leave_reason").eq("tenant_id", tenantId).gte("date", `${month}-01`).lt("date", nextMonthStart(month));
      if (!hr) qy = qy.eq("employee_id", me?.id || "00000000-0000-0000-0000-000000000000");
      return (await qy).data || [];
    },
  });
  const { data: onLeave = [] } = useQuery({
    queryKey: ["hr-on-leave", tenantId, date], enabled: !!tenantId && hr,
    queryFn: async () => (await sb.from("hr_leave_requests").select("employee_id").eq("tenant_id", tenantId).eq("status", "approved").lte("start_date", date).gte("end_date", date)).data || [],
  });
  const leaveSet = new Set((onLeave as any[]).map((r) => r.employee_id));
  const holiday = (lk?.holidays || []).find((h) => h.date === date);
  const byEmp = new Map((day as any[]).map((a) => [a.employee_id, a]));
  const today = (monthRows as any[]).find((r) => r.employee_id === me?.id && r.date === ymd());
  const refresh = () => ["hr-att-day", "hr-att-month"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const clock = async (action: "in" | "out", why?: string) => {
    setBusy(action);
    const { data, error } = await sb.rpc("hr_clock", { p_action: action, p_reason: why || null });
    setBusy("");
    if (error && /^EARLY:/.test(error.message)) { setReason(""); setEarly({ msg: error.message.replace(/^EARLY:\s*/, "") }); return; }
    if (error) return toast({ title: "Not recorded", description: error.message, variant: "destructive" });
    setEarly(null);
    toast({ title: action === "in" ? (Number(data?.late_minutes) > 0 ? `Clocked in, ${data.late_minutes} min late` : "Clocked in on time") : data?.left_early ? "Clocked out early; reason recorded" : "Clocked out" });
    refresh(); qc.invalidateQueries({ queryKey: ["hr-clock-today"] });
  };
  const mark = async (empId: string, patch: any) => {
    const cur = byEmp.get(empId);
    const row: any = { tenant_id: tenantId, employee_id: empId, date, status: cur?.status || "present", clock_in: cur?.clock_in || null, clock_out: cur?.clock_out || null, overtime_hours: cur?.overtime_hours || 0, ...patch };
    if (row.clock_in && row.clock_out) { const [a, b] = [row.clock_in, row.clock_out].map((t: string) => Number(t.slice(0, 2)) + Number(t.slice(3, 5)) / 60); row.hours = Math.max(0, Math.round((b - a) * 100) / 100); }
    const { error } = await sb.from("hr_attendance").upsert(row, { onConflict: "employee_id,date" });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    refresh();
  };
  const markAll = async (status: string) => {
    const rows = current.filter((e) => !byEmp.has(e.id)).map((e) => ({ tenant_id: tenantId, employee_id: e.id, date, status: leaveSet.has(e.id) ? "leave" : holiday ? "holiday" : status }));
    if (!rows.length) return toast({ title: "Everyone is already marked" });
    const { error } = await sb.from("hr_attendance").upsert(rows, { onConflict: "employee_id,date" });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: `${rows.length} marked` }); refresh();
  };
  const counts = ATT.map(([k, l]) => [l, (day as any[]).filter((a) => a.status === k).length] as const);
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const mRows = monthRows as any[];
  return (
    <div className="space-y-5">
      <PageHeader title="Attendance" icon={CalendarCheck} description="Clock in and out, mark the daily register and see the month at a glance. Overtime and absences flow into payroll."
        actions={hr ? <ImportExport entity="attendance" rows={mRows.map((r) => ({ employee: fullName(emps.find((e) => e.id === r.employee_id)), date: r.date, status: r.status, clock_in: r.clock_in, clock_out: r.clock_out, hours: r.hours, overtime: r.overtime_hours }))} /> : undefined} />
      {me && (
        <div className="relative overflow-hidden rounded-3xl bg-[linear-gradient(120deg,hsl(var(--primary)),hsl(var(--primary)/0.8)_60%,hsl(var(--accent)))] p-5 text-primary-foreground sm:p-6">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20"><Clock className="h-6 w-6" /></span>
            <div className="flex-1"><p className="text-sm opacity-85">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
              <p className="font-display text-xl font-bold">{today?.clock_in ? `In at ${String(today.clock_in).slice(0, 5)}${today.clock_out ? ` · out at ${String(today.clock_out).slice(0, 5)} · ${today.hours} h` : ""}` : "You have not clocked in today"}</p>
              {today?.late_minutes > 0 && <p className="text-xs opacity-90">{today.late_minutes} minutes late</p>}{today?.left_early && <p className="text-xs opacity-90">Left early: {today.early_leave_reason}</p>}</div>
            {!today?.clock_in && <Button className="bg-white text-primary hover:bg-white/90" onClick={() => clock("in")} disabled={!!busy}>{busy === "in" ? <OrbSpinner /> : <LogIn />} Clock in</Button>}
            {today?.clock_in && !today?.clock_out && <Button className="bg-white text-primary hover:bg-white/90" onClick={() => clock("out")} disabled={!!busy}>{busy === "out" ? <OrbSpinner /> : <LogOut />} Clock out</Button>}
          </div>
        </div>
      )}
      <Modal open={!!early} onClose={() => setEarly(null)} center title="Leaving early?" description={early?.msg}
        footer={<><Button variant="ghost" onClick={() => setEarly(null)}>Stay</Button><Button onClick={() => reason.trim() ? clock("out", reason.trim()) : toast({ title: "Give a reason", variant: "destructive" })} disabled={!!busy}>{busy === "out" ? <OrbSpinner /> : <LogOut />} Clock out early</Button></>}>
        <Field label="Reason for leaving early" required><textarea className="fi" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. hospital appointment, family emergency, approved by manager" /></Field>
      </Modal>
      {hr ? <>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-xl bg-muted p-1">{([["day", "Daily register"], ["month", "Month view"]] as const).map(([v, l]) => <button key={v} onClick={() => setView(v)} className={cn("rounded-lg px-3 py-1.5 text-sm", view === v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{l}</button>)}</div>
          {view === "day" ? <div className="flex items-center gap-1"><Button size="icon" variant="outline" onClick={() => setDate(shift(date, -1))} aria-label="Previous day"><ChevronLeft /></Button><input type="date" className="fi w-auto" value={date} onChange={(e) => setDate(e.target.value)} /><Button size="icon" variant="outline" onClick={() => setDate(shift(date, 1))} aria-label="Next day"><ChevronRight /></Button><Button variant="ghost" size="sm" onClick={() => setDate(ymd())}>Today</Button></div>
            : <input type="month" className="fi w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />}
          <div className="relative ml-auto w-full sm:w-56"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Employee…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {view === "day" ? <>
          {holiday && <p className="rounded-xl bg-accent/10 px-4 py-2 text-sm"><CalendarDays className="mr-1 inline h-4 w-4" /> Public holiday: <b>{holiday.name}</b></p>}
          <div className="flex flex-wrap gap-2">{counts.map(([l, n]) => <span key={l} className="rounded-full border border-border bg-card px-3 py-1 text-xs"><b>{n}</b> {l}</span>)}<span className="rounded-full border border-border bg-card px-3 py-1 text-xs"><b>{current.length - (day as any[]).length}</b> Not marked</span>
            <span className="flex-1" /><Button size="sm" variant="outline" onClick={() => markAll("present")}><Check /> Mark the rest present</Button><Button size="sm" variant="outline" onClick={() => markAll("absent")}><X /> Mark the rest absent</Button></div>
          <Panel flush>
            {current.length === 0 ? <EmptyState icon={Users} title="Add employees first" /> : (
              <ul className="divide-y divide-border">{current.map((e) => {
                const a = byEmp.get(e.id);
                return (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
                    <span className="flex min-w-[160px] flex-1 flex-wrap items-center gap-2"><span className={cn("h-2.5 w-2.5 rounded-full", a ? ATT_DOT[a.status] : "bg-border")} /><span className="font-medium">{fullName(e)}</span>{leaveSet.has(e.id) && <Pill tone="info">On leave</Pill>}{a?.late_minutes > 0 && <Pill tone="warning">{a.late_minutes} min late</Pill>}{a?.left_early && <Pill tone="danger">Left early: {a.early_leave_reason}</Pill>}</span>
                    <div className="flex flex-wrap gap-1">{ATT.map(([v, l, c]) => <button key={v} onClick={() => mark(e.id, { status: v })} className={cn("rounded-full px-2.5 py-1 text-xs font-semibold transition-colors", a?.status === v ? c : "bg-muted text-muted-foreground hover:bg-muted/70")}>{l}</button>)}</div>
                    <input type="time" className="fi h-8 w-[104px] text-xs" value={a?.clock_in?.slice(0, 5) || ""} onChange={(ev) => mark(e.id, { clock_in: ev.target.value || null })} aria-label="Clock in" />
                    <input type="time" className="fi h-8 w-[104px] text-xs" value={a?.clock_out?.slice(0, 5) || ""} onChange={(ev) => mark(e.id, { clock_out: ev.target.value || null })} aria-label="Clock out" />
                    <input type="number" min={0} step="0.5" className="fi h-8 w-20 text-xs" placeholder="OT h" value={a?.overtime_hours || ""} onChange={(ev) => mark(e.id, { overtime_hours: Number(ev.target.value) || 0 })} aria-label="Overtime hours" />
                  </li>
                );
              })}</ul>
            )}
          </Panel>
        </> : (
          <Panel flush title={new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })} icon={CalendarDays}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-xs">
                <thead><tr className="border-b border-border"><th className="sticky left-0 bg-card px-3 py-2 text-left">Employee</th>{Array.from({ length: daysInMonth }, (_, i) => <th key={i} className="w-7 px-0.5 py-2 text-center font-medium text-muted-foreground">{i + 1}</th>)}<th className="px-2 text-right">P</th><th className="px-2 text-right">A</th><th className="px-2 text-right">OT</th></tr></thead>
                <tbody><PagedRows rows={current} colSpan={5}>{(pageRows) => pageRows.map((e) => {
                  const mine = mRows.filter((r) => r.employee_id === e.id);
                  return (
                    <tr key={e.id} className="border-b border-border">
                      <td className="sticky left-0 whitespace-nowrap bg-card px-3 py-2 font-medium">{fullName(e)}</td>
                      {Array.from({ length: daysInMonth }, (_, i) => { const d = `${month}-${String(i + 1).padStart(2, "0")}`; const r = mine.find((x) => x.date === d); return <td key={i} className="px-0.5 text-center" title={r ? `${d}: ${r.status}` : d}><span className={cn("mx-auto block h-4 w-4 rounded", r ? ATT_DOT[r.status] : "bg-muted")} /></td>; })}
                      <td className="px-2 text-right">{mine.filter((r) => ["present", "late", "half_day"].includes(r.status)).length}</td><td className="px-2 text-right text-destructive">{mine.filter((r) => r.status === "absent").length}</td><td className="px-2 text-right">{mine.reduce((a, r) => a + Number(r.overtime_hours || 0), 0)}</td>
                    </tr>
                  );
                })}</PagedRows></tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-3 border-t border-border px-4 py-2 text-xs">{ATT.map(([k, l]) => <span key={k} className="flex items-center gap-1"><span className={cn("h-3 w-3 rounded", ATT_DOT[k])} />{l}</span>)}</div>
          </Panel>
        )}
      </> : (
        <Panel flush title="My attendance" icon={CalendarCheck} actions={<input type="month" className="fi h-8 w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />}>
          {mRows.length === 0 ? <EmptyState icon={CalendarCheck} title="No attendance this month" /> : (
            <TableWrap><table className="dt"><thead><tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th className="num">Hours</th><th>Notes</th></tr></thead>
              <tbody><PagedRows rows={[...mRows].sort((a, b) => b.date.localeCompare(a.date))} colSpan={6}>{(pageRows) => pageRows.map((r) => <tr key={r.date}><td>{fmtDate(r.date)}</td><td className="capitalize">{String(r.status).replace("_", " ")}</td><td>{r.clock_in ? String(r.clock_in).slice(0, 5) : "—"}</td><td>{r.clock_out ? String(r.clock_out).slice(0, 5) : "—"}</td><td className="num">{r.hours || "—"}</td><td className="text-xs text-muted-foreground">{[r.late_minutes > 0 ? `${r.late_minutes} min late` : "", r.left_early ? `Left early: ${r.early_leave_reason}` : ""].filter(Boolean).join(" · ") || "—"}</td></tr>)}</PagedRows></tbody></table></TableWrap>
          )}
        </Panel>
      )}
    </div>
  );
}
