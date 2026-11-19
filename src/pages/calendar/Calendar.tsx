import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Save, Trash2, Clock, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader, Modal, Field } from "@/components/kit";
import { OrbSpinner } from "@/components/orbs";
import { CustomerPicker, type PickedCustomer } from "@/components/books/CustomerPicker";
import { confirmAction } from "@/components/books/confirm";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

const sb: any = supabase;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** What can appear on the calendar, with its colour and where a click goes. */
const SOURCES = {
  event: { label: "My events", dot: "bg-primary", chip: "bg-primary/12 text-primary" },
  visit: { label: "Visits", dot: "bg-emerald-500", chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  reminder: { label: "Customer reminders", dot: "bg-teal-500", chip: "bg-teal-500/12 text-teal-700 dark:text-teal-300" },
  invoice: { label: "Invoices due", dot: "bg-rose-500", chip: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  bill: { label: "Bills due", dot: "bg-orange-500", chip: "bg-orange-500/12 text-orange-700 dark:text-orange-300" },
  po: { label: "Deliveries expected", dot: "bg-amber-500", chip: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  leave: { label: "Staff on leave", dot: "bg-violet-500", chip: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
  holiday: { label: "Holidays", dot: "bg-sky-500", chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  activity: { label: "CRM activities", dot: "bg-indigo-500", chip: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300" },
  deal: { label: "Deals closing", dot: "bg-fuchsia-500", chip: "bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300" },
} as const;
type Src = keyof typeof SOURCES;
type Item = { id: string; src: Src; date: string; end?: string; title: string; sub?: string; time?: string; link?: string; raw?: any };

/** Everything with a date in the ERP on one calendar, plus the shop's own events. */
export default function CalendarPage() {
  const tenantId = useTenantId();
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [view, setView] = useState<"month" | "agenda">(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "agenda" : "month"));
  const [hidden, setHidden] = useState<Set<Src>>(new Set());
  const [edit, setEdit] = useState<any | null | undefined>(undefined);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() + 6) % 7));
  const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 41);
  const from = iso(gridStart), to = iso(gridEnd);

  const { data: items = [], isFetching } = useQuery({
    queryKey: ["calendar", tenantId, from, to], enabled: !!tenantId,
    queryFn: async (): Promise<Item[]> => {
      const t = tenantId;
      const [ev, rem, inv, bills, po, leave, hol, act, deals] = await Promise.all([
        sb.from("calendar_events").select("*").eq("tenant_id", t).gte("start_at", `${from}T00:00:00`).lte("start_at", `${to}T23:59:59`),
        sb.from("customer_reminders").select("id,kind,due_date,title,product_name,status,customer_id,customers(name),customer_pets(name)").eq("tenant_id", t).gte("due_date", from).lte("due_date", to).neq("status", "dismissed"),
        sb.from("invoices").select("id,invoice_number,customer_name,due_date,total,amount_paid,status").eq("tenant_id", t).gte("due_date", from).lte("due_date", to).not("status", "in", "(void,draft,paid)"),
        sb.from("bills").select("id,bill_number,name,due_date,amount,amount_paid,status").eq("tenant_id", t).gte("due_date", from).lte("due_date", to).not("status", "in", "(void,draft,paid)"),
        sb.from("purchases").select("id,po_number,supplier_name,expected_date,status").eq("tenant_id", t).gte("expected_date", from).lte("expected_date", to).in("status", ["pending", "partially_received"]),
        sb.from("hr_leave_requests").select("id,start_date,end_date,status,employee_id,hr_employees(first_name,last_name),hr_leave_types(name)").eq("tenant_id", t).lte("start_date", to).gte("end_date", from).in("status", ["approved", "pending"]),
        sb.from("hr_holidays").select("id,date,name").eq("tenant_id", t).gte("date", from).lte("date", to),
        sb.from("crm_activities").select("id,due_date,summary,lead_id,done,start_at,related_type,related_id").eq("tenant_id", t).gte("due_date", from).lte("due_date", to).eq("done", false),
        sb.from("crm_deals").select("id,name,closing_date,amount,stage").eq("tenant_id", t).gte("closing_date", from).lte("closing_date", to).not("stage", "in", "(won,lost)"),
      ]);
      const out: Item[] = [];
      for (const e of ev.data || []) out.push({ id: `ev-${e.id}`, src: "event", date: String(e.start_at).slice(0, 10), end: e.end_at ? String(e.end_at).slice(0, 10) : undefined, title: e.title, sub: e.location || e.description || undefined, time: e.all_day ? undefined : new Date(e.start_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), raw: e });
      for (const r of rem.data || []) out.push({ id: `rm-${r.id}`, src: r.kind === "visit" ? "visit" : "reminder", date: r.due_date, title: `${r.customers?.name || "Customer"}${r.customer_pets?.name ? ` · ${r.customer_pets.name}` : ""}`, sub: r.title || r.product_name, link: `/customers/${r.customer_id}` });
      for (const i of inv.data || []) out.push({ id: `in-${i.id}`, src: "invoice", date: i.due_date, title: `${i.invoice_number} · ${i.customer_name || ""}`, sub: formatKES(Number(i.total) - Number(i.amount_paid || 0)), link: `/sales/invoices/${i.id}` });
      for (const b of bills.data || []) out.push({ id: `bl-${b.id}`, src: "bill", date: b.due_date, title: b.bill_number || b.name, sub: formatKES(Number(b.amount) - Number(b.amount_paid || 0)), link: `/purchases/bills/${b.id}` });
      for (const p of po.data || []) out.push({ id: `po-${p.id}`, src: "po", date: p.expected_date, title: `${p.po_number || "PO"} · ${p.supplier_name || ""}`, sub: "Delivery expected", link: `/purchases/orders/${p.id}` });
      for (const l of leave.data || []) out.push({ id: `lv-${l.id}`, src: "leave", date: l.start_date, end: l.end_date, title: `${l.hr_employees?.first_name || ""} ${l.hr_employees?.last_name || ""}`.trim() || "Employee", sub: `${l.hr_leave_types?.name || "Leave"}${l.status === "pending" ? " (pending)" : ""}`, link: "/hrm/leave" });
      for (const h of hol.data || []) out.push({ id: `ho-${h.id}`, src: "holiday", date: h.date, title: h.name, link: "/hrm/holidays" });
      for (const a of act.data || []) out.push({ id: `ac-${a.id}`, src: "activity", date: a.due_date, title: a.summary || "CRM activity", time: a.start_at ? new Date(a.start_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : undefined, link: a.related_type && a.related_id ? `/crm/${({ lead: "leads", contact: "contacts", account: "accounts", deal: "deals" } as Record<string, string>)[a.related_type] || "leads"}/${a.related_id}` : "/crm/activities" });
      for (const d of deals.data || []) out.push({ id: `dl-${d.id}`, src: "deal", date: d.closing_date, title: d.name, sub: formatKES(Number(d.amount || 0)), link: `/crm/deals/${d.id}` });
      return out;
    },
  });

  const visible = items.filter((i) => !hidden.has(i.src));
  const onDay = (k: string) => visible.filter((i) => i.date === k || (i.end && i.date <= k && i.end >= k)).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const today = iso(new Date());
  const agenda = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const d of days) { if (d.getMonth() !== month.getMonth()) continue; const k = iso(d); const list = onDay(k); if (list.length) m.set(k, list); }
    return [...m.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, month]);
  const openItem = (i: Item) => (i.src === "event" ? setEdit(i.raw) : i.link && navigate(i.link));
  const toggle = (s: Src) => setHidden((h) => { const n = new Set(h); n.has(s) ? n.delete(s) : n.add(s); return n; });

  return (
    <div className="space-y-4">
      <PageHeader title="Calendar" icon={CalendarDays} description="Your events with visits, reminders, money due in and out, deliveries, leave, holidays and CRM follow-ups."
        actions={<Button onClick={() => setEdit({ start_at: `${today}T09:00` })}><Plus /> New event</Button>} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="outline" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft /></Button>
        <p className="min-w-[11rem] text-center font-display text-lg font-bold">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</p>
        <Button size="icon" variant="outline" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight /></Button>
        <Button size="sm" variant="ghost" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</Button>
        {isFetching && <OrbSpinner className="h-5 w-5" state="working" />}
        <span className="flex-1" />
        <div className="flex rounded-full border border-border bg-card p-0.5">
          {(["month", "agenda"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={cn("rounded-full px-3 py-1.5 text-sm font-medium capitalize", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{v}</button>)}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(SOURCES) as Src[]).map((s) => (
          <button key={s} onClick={() => toggle(s)} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-opacity", hidden.has(s) ? "border-border opacity-45" : "border-border bg-card")}>
            <span className={cn("h-2.5 w-2.5 rounded-full", SOURCES[s].dot)} />{SOURCES[s].label}
          </button>
        ))}
      </div>

      {view === "month" ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="grid grid-cols-7 border-b border-border text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const k = iso(d), list = onDay(k), inMonth = d.getMonth() === month.getMonth();
              return (
                <div key={k} onDoubleClick={() => setEdit({ start_at: `${k}T09:00` })} className={cn("group min-h-[108px] border-b border-r border-border p-1.5 text-xs", !inMonth && "bg-muted/30 text-muted-foreground/60")}>
                  <div className="mb-1 flex items-center justify-between">
                    <button onClick={() => setDayOpen(k)} className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-muted", k === today && "bg-primary font-bold text-primary-foreground hover:bg-primary")}>{d.getDate()}</button>
                    <button onClick={() => setEdit({ start_at: `${k}T09:00` })} className="hidden rounded p-0.5 text-muted-foreground hover:bg-muted group-hover:block" aria-label="Add event"><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="space-y-0.5">
                    {list.slice(0, 3).map((i) => (
                      <button key={i.id} onClick={() => openItem(i)} title={`${SOURCES[i.src].label}: ${i.title}${i.sub ? ` · ${i.sub}` : ""}`} className={cn("block w-full truncate rounded px-1 py-0.5 text-left text-[11px] font-medium", SOURCES[i.src].chip)}>
                        {i.time ? `${i.time} ` : ""}{i.title}
                      </button>
                    ))}
                    {list.length > 3 && <button onClick={() => setDayOpen(k)} className="text-[11px] font-semibold text-primary">+{list.length - 3} more</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {agenda.length === 0 && <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Nothing this month.</p>}
          {agenda.map(([k, list]) => (
            <section key={k} className="overflow-hidden rounded-2xl border border-border bg-card">
              <p className={cn("border-b border-border px-4 py-2 text-sm font-semibold", k === today && "text-primary")}>{new Date(`${k}T00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
              <ul className="divide-y divide-border">{list.map((i) => <AgendaRow key={i.id} i={i} onOpen={() => openItem(i)} />)}</ul>
            </section>
          ))}
        </div>
      )}

      {dayOpen && (
        <Modal open onClose={() => setDayOpen(null)} title={new Date(`${dayOpen}T00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} icon={CalendarDays}
          footer={<Button onClick={() => { setEdit({ start_at: `${dayOpen}T09:00` }); setDayOpen(null); }}><Plus /> Add event this day</Button>}>
          {onDay(dayOpen).length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing on this day.</p> : <ul className="divide-y divide-border">{onDay(dayOpen).map((i) => <AgendaRow key={i.id} i={i} onOpen={() => { setDayOpen(null); openItem(i); }} />)}</ul>}
        </Modal>
      )}
      {edit !== undefined && <EventForm ev={edit} onClose={() => setEdit(undefined)} />}
    </div>
  );
}

function AgendaRow({ i, onOpen }: { i: Item; onOpen: () => void }) {
  return (
    <li><button onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40">
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", SOURCES[i.src].dot)} />
      <span className="w-14 shrink-0 text-xs text-muted-foreground">{i.time || "All day"}</span>
      <span className="min-w-0 flex-1"><span className="block truncate font-medium">{i.title}</span>{i.sub && <span className="block truncate text-xs text-muted-foreground">{i.sub}</span>}</span>
      <span className="hidden text-xs text-muted-foreground sm:block">{SOURCES[i.src].label}</span>
    </button></li>
  );
}

const COLORS = ["#A8121B", "#15171C", "#2a78d6", "#8b5cf6", "#f59e0b", "#10b981", "#e11d48"];

function EventForm({ ev, onClose }: { ev: any; onClose: () => void }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const local = (v?: string | null) => (v ? (v.length > 16 ? new Date(v).toISOString().slice(0, 16) : v) : "");
  const [cust, setCust] = useState<PickedCustomer | null>(null);
  const [f, setF] = useState({
    title: ev.title || "", description: ev.description || "", location: ev.location || "", all_day: !!ev.all_day,
    start: ev.id ? new Date(new Date(ev.start_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : local(ev.start_at),
    end: ev.end_at ? new Date(new Date(ev.end_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "",
    color: ev.color || COLORS[0], kind: ev.kind || "event",
  });
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.title.trim() || !f.start) return toast({ title: "Give the event a title and start", variant: "destructive" });
    const body = { tenant_id: tenantId, title: f.title.trim(), description: f.description.trim() || null, location: f.location.trim() || null, all_day: f.all_day, start_at: new Date(f.start).toISOString(), end_at: f.end ? new Date(f.end).toISOString() : null, color: f.color, kind: f.kind, customer_id: cust?.id || ev.customer_id || null };
    const { error } = ev.id ? await sb.from("calendar_events").update(body).eq("id", ev.id) : await sb.from("calendar_events").insert(body);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["calendar"] }); toast({ title: ev.id ? "Event updated" : "Event added" }); onClose();
  };
  const remove = async () => {
    if (!(await confirmAction({ title: `Delete "${ev.title}"?`, danger: true, confirmLabel: "Delete" }))) return;
    await sb.from("calendar_events").delete().eq("id", ev.id); qc.invalidateQueries({ queryKey: ["calendar"] }); onClose();
  };
  return (
    <Modal open onClose={onClose} title={ev.id ? "Edit event" : "New event"} icon={CalendarDays}
      footer={<div className="flex w-full gap-2"><Button onClick={save}><Save /> Save</Button><Button variant="outline" onClick={onClose}>Cancel</Button>{ev.id && <Button variant="ghost" className="ml-auto text-destructive" onClick={remove}><Trash2 /> Delete</Button>}</div>}>
      <div className="space-y-3">
        <Field label="Title" required><input className="fi" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Board meeting, supplier visit, stock-take" /></Field>
        <Field label="Type"><select className="fi" value={f.kind} onChange={(e) => set("kind", e.target.value)}><option value="event">Event</option><option value="appointment">Appointment</option><option value="meeting">Meeting</option><option value="task">Task</option><option value="promotion">Promotion</option></select></Field>
        <label className="flex items-center justify-between text-sm font-medium">All day<Switch checked={f.all_day} onCheckedChange={(v) => set("all_day", v)} /></label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts" required><input className="fi" type={f.all_day ? "date" : "datetime-local"} value={f.all_day ? f.start.slice(0, 10) : f.start} onChange={(e) => set("start", f.all_day ? `${e.target.value}T00:00` : e.target.value)} /></Field>
          <Field label="Ends"><input className="fi" type={f.all_day ? "date" : "datetime-local"} value={f.all_day ? f.end.slice(0, 10) : f.end} onChange={(e) => set("end", f.all_day ? `${e.target.value}T23:59` : e.target.value)} /></Field>
        </div>
        <Field label="Customer (optional)"><CustomerPicker value={cust} onChange={setCust} /></Field>
        <Field label="Location"><div className="relative"><MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" value={f.location} onChange={(e) => set("location", e.target.value)} /></div></Field>
        <Field label="Notes"><textarea className="fi min-h-[70px]" value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label="Colour"><div className="flex gap-2">{COLORS.map((c) => <button key={c} type="button" onClick={() => set("color", c)} className={cn("h-7 w-7 rounded-full", f.color === c && "ring-2 ring-offset-2 ring-offset-background")} style={{ background: c }} aria-label={c} />)}</div></Field>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Double-click a day on the calendar to add an event there.</p>
      </div>
    </Modal>
  );
}
