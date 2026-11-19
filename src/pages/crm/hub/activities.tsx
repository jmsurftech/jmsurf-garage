import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Circle, ClipboardList, Phone, Save, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Modal } from "@/components/kit";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenantId";
import { friendlyError } from "@/lib/friendlyError";
import { cn } from "@/lib/utils";
import { useCrmRefresh, useLookups } from "./fields";
import { MODULE_OF, sb, type RelatedType } from "./modules";

export type Kind = "task" | "meeting" | "call";
export const KIND_LABEL: Record<Kind, string> = { task: "Task", meeting: "Meeting", call: "Call" };
export const KIND_ICON = { task: ClipboardList, meeting: Users, call: Phone } as const;
export const TASK_STATUSES = [["not_started", "Not started"], ["in_progress", "In progress"], ["waiting", "Waiting on someone"], ["deferred", "Deferred"], ["completed", "Completed"]] as const;
export const PRIORITIES = [["high", "High"], ["normal", "Normal"], ["low", "Low"]] as const;
export const CALL_TYPES = ["Outbound", "Inbound", "Missed"];
export const CALL_RESULTS = ["Interested", "Not interested", "Call back later", "No answer", "Wrong number", "Left a message", "Sale made"];

/** Activities of one record (or all of them when no record is given). */
export function useActivities(relatedType?: RelatedType, relatedId?: string) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["crm-hub-activities", tenantId, relatedType || "all", relatedId || "all"],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = sb.from("crm_activities").select("*").eq("tenant_id", tenantId).order("due_date", { ascending: true }).limit(3000);
      if (relatedType && relatedId) q = q.eq("related_type", relatedType).eq("related_id", relatedId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

/** Name of the record an activity belongs to, for lists of activities across records. */
export function useRelatedNames(rows: any[]) {
  const tenantId = useTenantId();
  const key = rows.map((r) => `${r.related_type}:${r.related_id}`).filter((k) => !k.includes("null")).sort().join(",");
  return useQuery({
    queryKey: ["crm-hub-related-names", tenantId, key], enabled: !!tenantId && !!key, staleTime: 60_000,
    queryFn: async () => {
      const out = new Map<string, string>();
      const by: Record<string, string[]> = {};
      for (const r of rows) if (r.related_type && r.related_id) (by[r.related_type] ||= []).push(r.related_id);
      await Promise.all(Object.entries(by).map(async ([t, ids]) => {
        const m = MODULE_OF[t as RelatedType];
        if (!m) return;
        const { data } = await sb.from(m.table).select("*").in("id", [...new Set(ids)].slice(0, 300));
        for (const x of data || []) out.set(`${t}:${x.id}`, m.title(x));
      }));
      return out;
    },
  }).data || new Map<string, string>();
}

export const activityWhen = (a: any) => (a.kind === "task" ? a.due_date : a.start_at || a.due_date);
export const isOverdue = (a: any) => !a.done && String(activityWhen(a) || "").slice(0, 10) < new Date().toISOString().slice(0, 10);
export const fmtWhen = (a: any) => {
  const w = activityWhen(a);
  if (!w) return "";
  const d = new Date(String(w).length <= 10 ? `${w}T00:00:00` : w);
  return a.kind === "task" ? d.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : d.toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** One activity row: tick to complete, what, when, who, and the record it belongs to. */
export function ActivityRow({ a, related, onChanged, onOpen }: { a: any; related?: string; onChanged: () => void; onOpen: (a: any) => void }) {
  const lk = useLookups();
  const Icon = KIND_ICON[a.kind as Kind] || ClipboardList;
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { error } = await sb.from("crm_activities").update({ done: !a.done, done_at: a.done ? null : new Date().toISOString(), status: a.done ? "not_started" : "completed" }).eq("id", a.id);
    if (error) return toast.error(friendlyError(error));
    onChanged();
  };
  const m = a.related_type ? MODULE_OF[a.related_type as RelatedType] : null;
  return (
    <li className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted/40" onClick={() => onOpen(a)}>
      <button onClick={toggle} title={a.done ? "Mark as open" : "Mark as done"} className="mt-0.5 shrink-0 text-muted-foreground hover:text-success">
        {a.done ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Circle className="h-5 w-5" />}
      </button>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", a.done && "text-muted-foreground line-through")}>{a.summary || KIND_LABEL[a.kind as Kind]}</p>
        <p className="truncate text-xs text-muted-foreground">
          <span className={cn(isOverdue(a) && "font-semibold text-destructive")}>{fmtWhen(a)}</span>
          {a.assigned_to && ` · ${lk.userName.get(a.assigned_to) || ""}`}
          {a.priority === "high" && " · High priority"}
          {a.kind === "call" && a.call_result && ` · ${a.call_result}`}
          {related && m && <> · <Link className="text-primary hover:underline" to={`/crm/${m.key}/${a.related_id}`} onClick={(e) => e.stopPropagation()}>{related}</Link></>}
        </p>
      </div>
    </li>
  );
}

/** Add or edit a task, meeting or call (optionally on a record). */
export function ActivityForm({ open, onClose, activity, kind = "task", relatedType, relatedId }: {
  open: boolean; onClose: () => void; activity?: any; kind?: Kind; relatedType?: RelatedType; relatedId?: string;
}) {
  const tenantId = useTenantId();
  const { user } = useAuth();
  const lk = useLookups();
  const refresh = useCrmRefresh();
  const [d, setD] = useState<any>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const now = new Date(); now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 1);
    const local = (x: Date) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setD(activity ? { ...activity, start_at: activity.start_at ? local(new Date(activity.start_at)) : "", end_at: activity.end_at ? local(new Date(activity.end_at)) : "" }
      : { kind, summary: "", due_date: new Date().toISOString().slice(0, 10), start_at: local(now), end_at: local(new Date(now.getTime() + 3600e3)), assigned_to: user?.id, priority: "normal", status: "not_started", call_type: "Outbound", duration_min: 5, related_type: relatedType || null, related_id: relatedId || null });
  }, [open, activity?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: any) => setD((x: any) => ({ ...x, [k]: v }));

  const save = async () => {
    if (!String(d.summary || "").trim()) return toast.error("Give it a subject");
    setBusy(true);
    const start = d.kind !== "task" && d.start_at ? new Date(d.start_at).toISOString() : null;
    const body: any = {
      kind: d.kind, summary: d.summary.trim(), note: d.note || null, assigned_to: d.assigned_to || null, priority: d.priority || "normal",
      status: d.status || "not_started", done: d.status === "completed" || !!d.done, done_at: d.status === "completed" || d.done ? (d.done_at || new Date().toISOString()) : null,
      due_date: d.kind === "task" ? (d.due_date || new Date().toISOString().slice(0, 10)) : (start || new Date().toISOString()).slice(0, 10),
      start_at: start, end_at: d.kind === "meeting" && d.end_at ? new Date(d.end_at).toISOString() : null, location: d.kind === "meeting" ? d.location || null : null,
      call_type: d.kind === "call" ? d.call_type || null : null, call_result: d.kind === "call" ? d.call_result || null : null, duration_min: d.kind === "call" ? Number(d.duration_min || 0) || null : null,
      related_type: d.related_type || null, related_id: d.related_id || null, lead_id: d.related_type === "lead" ? d.related_id : null,
    };
    const q = activity?.id ? sb.from("crm_activities").update(body).eq("id", activity.id) : sb.from("crm_activities").insert({ ...body, tenant_id: tenantId });
    const { error } = await q;
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(activity?.id ? "Saved" : `${KIND_LABEL[d.kind as Kind]} added`);
    refresh(); onClose();
  };
  const remove = async () => {
    const { error } = await sb.from("crm_activities").delete().eq("id", activity.id);
    if (error) return toast.error(friendlyError(error));
    refresh(); onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="md" icon={CalendarClock} title={activity?.id ? `Edit ${KIND_LABEL[d.kind as Kind]?.toLowerCase() || "activity"}` : `New ${KIND_LABEL[d.kind as Kind]?.toLowerCase() || "activity"}`}
      footer={<>{activity?.id && <Button variant="ghost" className="mr-auto text-destructive" onClick={remove}>Delete</Button>}<Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}><Save /> Save</Button></>}>
      <div className="space-y-4">
        {!activity?.id && (
          <div className="inline-flex rounded-xl border border-border p-0.5">
            {(["task", "meeting", "call"] as Kind[]).map((k) => { const I = KIND_ICON[k]; return <button key={k} onClick={() => set("kind", k)} className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm", d.kind === k && "bg-primary text-primary-foreground")}><I className="h-4 w-4" />{KIND_LABEL[k]}</button>; })}
          </div>
        )}
        <Field label="Subject" required><input className="fi" autoFocus value={d.summary || ""} onChange={(e) => set("summary", e.target.value)} placeholder={d.kind === "call" ? "e.g. Follow-up call on the quotation" : d.kind === "meeting" ? "e.g. Product demo at the clinic" : "e.g. Send the price list"} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {d.kind === "task" ? (
            <>
              <Field label="Due date"><input className="fi" type="date" value={d.due_date || ""} onChange={(e) => set("due_date", e.target.value)} /></Field>
              <Field label="Status"><select className="fi" value={d.status} onChange={(e) => set("status", e.target.value)}>{TASK_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
              <Field label="Priority"><select className="fi" value={d.priority} onChange={(e) => set("priority", e.target.value)}>{PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            </>
          ) : (
            <>
              <Field label={d.kind === "call" ? "Call time" : "Starts"}><input className="fi" type="datetime-local" value={d.start_at || ""} onChange={(e) => set("start_at", e.target.value)} /></Field>
              {d.kind === "meeting" && <Field label="Ends"><input className="fi" type="datetime-local" value={d.end_at || ""} onChange={(e) => set("end_at", e.target.value)} /></Field>}
              {d.kind === "meeting" && <Field label="Location" className="sm:col-span-2"><input className="fi" value={d.location || ""} onChange={(e) => set("location", e.target.value)} placeholder="Office, site or video link" /></Field>}
              {d.kind === "call" && <>
                <Field label="Call type"><select className="fi" value={d.call_type || ""} onChange={(e) => set("call_type", e.target.value)}>{CALL_TYPES.map((x) => <option key={x}>{x}</option>)}</select></Field>
                <Field label="Duration (minutes)"><input className="fi" inputMode="numeric" value={d.duration_min ?? ""} onChange={(e) => set("duration_min", e.target.value.replace(/\D/g, ""))} /></Field>
                <Field label="Result"><select className="fi" value={d.call_result || ""} onChange={(e) => set("call_result", e.target.value)}><option value="">—</option>{CALL_RESULTS.map((x) => <option key={x}>{x}</option>)}</select></Field>
              </>}
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={!!d.done || d.status === "completed"} onChange={(e) => setD((x: any) => ({ ...x, done: e.target.checked, status: e.target.checked ? "completed" : "not_started" }))} /> {d.kind === "call" ? "Call made" : "Meeting held"}</label>
            </>
          )}
          <Field label="Assigned to"><select className="fi" value={d.assigned_to || ""} onChange={(e) => set("assigned_to", e.target.value || null)}><option value="">— Nobody —</option>{lk.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        </div>
        {!relatedId && !activity?.related_id && <RelatedPicker type={d.related_type} id={d.related_id} onChange={(t, i) => setD((x: any) => ({ ...x, related_type: t, related_id: i }))} />}
        <Field label="Description"><textarea className="fi min-h-[80px]" value={d.note || ""} onChange={(e) => set("note", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/** Choose the lead, contact, account or deal an activity belongs to. */
function RelatedPicker({ type, id, onChange }: { type: RelatedType | null; id: string | null; onChange: (t: RelatedType | null, id: string | null) => void }) {
  const tenantId = useTenantId();
  const [q, setQ] = useState("");
  const t = type || "contact";
  const m = MODULE_OF[t];
  const { data: found = [] } = useQuery({
    queryKey: ["crm-hub-related-search", tenantId, t, q], enabled: !!tenantId,
    queryFn: async () => {
      let qq = sb.from(m.table).select("*").eq("tenant_id", tenantId).limit(20);
      if (m.scope) qq = m.scope(qq);
      if (q.trim()) qq = qq.or(m.search.map((k) => `${k}.ilike.*${q.trim().replace(/[*,()]/g, "")}*`).join(","));
      return ((await qq).data || []) as any[];
    },
  });
  return (
    <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
      <Field label="Related to"><select className="fi" value={type || ""} onChange={(e) => onChange((e.target.value || null) as RelatedType | null, null)}><option value="">Nothing</option><option value="lead">Lead</option><option value="contact">Contact</option><option value="account">Account</option><option value="deal">Deal</option></select></Field>
      {type && (
        <Field label={m.singular}>
          <input className="fi mb-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${m.plural.toLowerCase()}…`} />
          <select className="fi" value={id || ""} onChange={(e) => onChange(type, e.target.value || null)}><option value="">Choose…</option>{found.map((r: any) => <option key={r.id} value={r.id}>{m.title(r)}</option>)}</select>
        </Field>
      )}
    </div>
  );
}
