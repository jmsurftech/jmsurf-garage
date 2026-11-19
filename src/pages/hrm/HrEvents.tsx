import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarHeart, Plus, Pencil, Trash2, MapPin, Users, GraduationCap, PartyPopper, Handshake, CalendarClock, Sparkles } from "lucide-react";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, Pill, Segmented, StatGrid, StatTile } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";
import { cn } from "@/lib/utils";
import { sb, useHrLookups } from "./hrData";

export type HrEvent = {
  id: string; tenant_id: string; title: string; kind: string; starts_at: string; ends_at: string | null; all_day: boolean; venue: string | null;
  audience: "all" | "department"; department_id: string | null; notes: string | null;
};

export const EVENT_KINDS: [string, string, typeof Users][] = [
  ["training", "Training", GraduationCap], ["team_building", "Team building", Sparkles], ["meeting", "Meeting", Handshake], ["celebration", "Celebration", PartyPopper], ["other", "Other", CalendarClock],
];
const kindOf = (k: string) => EVENT_KINDS.find((x) => x[0] === k) || EVENT_KINDS[4];

/** "Thu 20 Nov, 14:00" (or the date alone for all-day events). */
export function whenText(e: Pick<HrEvent, "starts_at" | "ends_at" | "all_day">) {
  const s = new Date(e.starts_at);
  const day = s.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" });
  if (e.all_day) return day;
  const t = (d: Date) => d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false });
  const end = e.ends_at ? new Date(e.ends_at) : null;
  return `${day}, ${t(s)}${end ? ` to ${end.toDateString() === s.toDateString() ? t(end) : `${end.toLocaleDateString("en-KE", { day: "numeric", month: "short" })} ${t(end)}`}` : ""}`;
}

/** Upcoming HR events (RLS gives HR all of them and staff the ones meant for them). */
export function useUpcomingHrEvents(days = 60) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["hr-events-upcoming", tenantId, days],
    enabled: !!tenantId,
    queryFn: async () => {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(from.getTime() + days * 86400000);
      const { data, error } = await sb.from("hr_events").select("*").eq("tenant_id", tenantId).gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString()).order("starts_at").limit(50);
      if (error) throw error;
      return (data || []) as HrEvent[];
    },
  });
}

/** Short list of upcoming events (HR overview and My Space). */
export function UpcomingEventsPanel({ manage, max = 5 }: { manage?: boolean; max?: number }) {
  const { data = [], error } = useUpcomingHrEvents();
  const { data: lk } = useHrLookups();
  const dept = new Map((lk?.departments || []).map((d) => [d.id, d.name]));
  return (
    <Panel title="Upcoming events" icon={CalendarHeart} actions={manage ? <Button size="sm" variant="outline" asChild><Link to="/hrm/events">Open</Link></Button> : undefined}>
      {error || data.length === 0 ? <p className="text-sm text-muted-foreground">{manage ? "Nothing planned. Add trainings, meetings and celebrations under Events." : "Nothing planned right now."}</p> : (
        <ul className="space-y-2 text-sm">
          {data.slice(0, max).map((e) => { const [, label, I] = kindOf(e.kind); return (
            <li key={e.id} className="flex items-start gap-2">
              <span className="g-tile xs mt-0.5"><I className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{e.title}</span>
                <span className="block text-xs text-muted-foreground">{whenText(e)}{e.venue ? ` · ${e.venue}` : ""}{e.audience === "department" && e.department_id ? ` · ${dept.get(e.department_id) || "One department"}` : ""}</span>
              </span>
              <Pill tone="muted">{label}</Pill>
            </li>); })}
        </ul>
      )}
    </Panel>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const blank = () => { const d = new Date(Date.now() + 86400000); d.setHours(9, 0, 0, 0); return { title: "", kind: "training", starts_at: localInput(d.toISOString()), ends_at: "", all_day: false, venue: "", audience: "all", department_id: "", notes: "" }; };

/** HRM → Events: trainings, team building, meetings and celebrations for everyone or one department. */
export function HrEvents() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: lk } = useHrLookups();
  const [view, setView] = useState<"upcoming" | "past">("upcoming");
  const [edit, setEdit] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const { data = [], isLoading } = useQuery({
    queryKey: ["hr-events", tenantId], enabled: !!tenantId,
    queryFn: async () => (((await sb.from("hr_events").select("*").eq("tenant_id", tenantId).order("starts_at", { ascending: false }).limit(1000)).data) || []) as HrEvent[],
  });
  const dept = new Map((lk?.departments || []).map((d) => [d.id, d.name]));
  const now = Date.now();
  const upcoming = data.filter((e) => Date.parse(e.ends_at || e.starts_at) >= now).reverse();
  const past = data.filter((e) => Date.parse(e.ends_at || e.starts_at) < now);
  const rows = view === "upcoming" ? upcoming : past;
  const in30 = upcoming.filter((e) => Date.parse(e.starts_at) < now + 30 * 86400000);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["hr-events"] }); qc.invalidateQueries({ queryKey: ["hr-events-upcoming"] }); };

  const save = async () => {
    if (!edit.title.trim()) return toast({ title: "Give the event a name", variant: "destructive" });
    if (!edit.starts_at) return toast({ title: "Pick when it starts", variant: "destructive" });
    if (edit.audience === "department" && !edit.department_id) return toast({ title: "Pick the department", variant: "destructive" });
    const starts = new Date(edit.starts_at), ends = edit.ends_at ? new Date(edit.ends_at) : null;
    if (ends && ends < starts) return toast({ title: "It ends before it starts", variant: "destructive" });
    const row = {
      tenant_id: tenantId, title: edit.title.trim(), kind: edit.kind, starts_at: starts.toISOString(), ends_at: ends ? ends.toISOString() : null, all_day: !!edit.all_day,
      venue: edit.venue.trim() || null, audience: edit.audience, department_id: edit.audience === "department" ? edit.department_id : null, notes: edit.notes.trim() || null, updated_at: new Date().toISOString(),
    };
    setSaving(true);
    const { error } = edit.id ? await sb.from("hr_events").update(row).eq("id", edit.id) : await sb.from("hr_events").insert(row);
    setSaving(false);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: edit.id ? "Event updated" : "Event added", description: "Staff see it in My Space." }); setEdit(null); refresh();
  };
  const remove = async (e: HrEvent) => {
    if (!(await confirmAction({ title: `Delete ${e.title}?`, message: "It disappears from My Space too.", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await sb.from("hr_events").delete().eq("id", e.id);
    if (error) return toast({ title: "Not deleted", description: error.message, variant: "destructive" });
    refresh();
  };
  if (isLoading) return <OrbLoader label="Loading events…" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Events" icon={CalendarHeart} actions={<Button onClick={() => setEdit(blank())}><Plus /> New event</Button>} />
      <StatGrid>
        <StatTile label="Coming up" value={upcoming.length} icon={CalendarHeart} tone="primary" />
        <StatTile label="In the next 30 days" value={in30.length} icon={CalendarClock} tone="info" />
        <StatTile label="Trainings planned" value={upcoming.filter((e) => e.kind === "training").length} icon={GraduationCap} tone="success" />
        <StatTile label="Held so far" value={past.length} icon={Users} tone="muted" />
      </StatGrid>
      <Segmented value={view} onChange={(v) => setView(v as typeof view)} options={[{ value: "upcoming", label: "Upcoming", count: upcoming.length }, { value: "past", label: "Past", count: past.length }]} />
      {rows.length === 0 ? <Panel><EmptyState icon={CalendarHeart} title={view === "upcoming" ? "Nothing planned" : "No past events"} description={view === "upcoming" ? "Plan a training, team building day, staff meeting or celebration." : undefined} /></Panel> : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((e) => { const [, label, I] = kindOf(e.kind); return (
            <Panel key={e.id} title={e.title} icon={I} actions={<>
              <button className="icon-btn" aria-label="Edit" onClick={() => setEdit({ ...blank(), ...e, starts_at: localInput(e.starts_at), ends_at: localInput(e.ends_at), venue: e.venue || "", department_id: e.department_id || "", notes: e.notes || "" })}><Pencil className="h-4 w-4" /></button>
              <button className="icon-btn-danger" aria-label="Delete" onClick={() => void remove(e)}><Trash2 className="h-4 w-4" /></button>
            </>}>
              <div className="space-y-1.5 text-sm">
                <p className="flex flex-wrap items-center gap-2"><Pill tone="primary">{label}</Pill><span className="text-muted-foreground">{whenText(e)}</span></p>
                {e.venue && <p className="flex items-center gap-1.5 text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{e.venue}</p>}
                <p className="flex items-center gap-1.5 text-muted-foreground"><Users className="h-3.5 w-3.5" />{e.audience === "all" ? "Everyone" : dept.get(e.department_id || "") || "One department"}</p>
                {e.notes && <p className="whitespace-pre-wrap">{e.notes}</p>}
              </div>
            </Panel>); })}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} locked={saving} title={edit?.id ? "Edit event" : "New event"} icon={CalendarHeart} size="lg"
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button></>}>
        {edit && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2"><input className="fi" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="e.g. Fire safety training" /></Field>
          <Field label="Kind"><select className="fi" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{EVENT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Venue"><input className="fi" value={edit.venue} onChange={(e) => setEdit({ ...edit, venue: e.target.value })} placeholder="Boardroom, online…" /></Field>
          <Field label="Starts" required><input className="fi" type="datetime-local" value={edit.starts_at} onChange={(e) => setEdit({ ...edit, starts_at: e.target.value })} /></Field>
          <Field label="Ends" hint="Optional"><input className="fi" type="datetime-local" value={edit.ends_at} onChange={(e) => setEdit({ ...edit, ends_at: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!edit.all_day} onChange={(e) => setEdit({ ...edit, all_day: e.target.checked })} /> All day</label>
          <Field label="Who it is for"><select className="fi" value={edit.audience} onChange={(e) => setEdit({ ...edit, audience: e.target.value })}><option value="all">Everyone</option><option value="department">One department</option></select></Field>
          {edit.audience === "department" && <Field label="Department" required><select className="fi" value={edit.department_id} onChange={(e) => setEdit({ ...edit, department_id: e.target.value })}><option value="">Select…</option>{(lk?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}
          <Field label="Notes" className={cn(edit.audience === "department" ? "sm:col-span-2" : "")}><textarea className="fi min-h-[90px]" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} placeholder="What to bring, who leads it…" /></Field>
        </div>}
      </Modal>
    </div>
  );
}
