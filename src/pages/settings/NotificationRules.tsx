/**
 * System → Notifications: which events alert people, and on which channels
 * (bell, email, SMS, WhatsApp). Sent by the server (events.js) to the person the
 * thing is for: the approver, the lead's salesperson, the task's assignee...
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bell, Mail, MessageSquare, Moon, Save, Smartphone, CalendarClock, History, BellRing } from "lucide-react";
import { Panel, Field, Pill, TableWrap, EmptyState } from "@/components/kit";
import { supabase } from "@/integrations/supabase/client";
import { useErpSettings, Toggle } from "@/pages/settings/ErpSettingsTabs";
import { OrbLoader } from "@/components/Orb";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { PagedRows } from "@/components/Pager";
const sb = supabase as any;
type Channel = "inapp" | "email" | "sms" | "whatsapp";
const CHANNELS: { key: Channel; label: string; icon: any }[] = [
  { key: "inapp", label: "Bell", icon: Bell },
  { key: "email", label: "Email", icon: Mail },
  { key: "sms", label: "SMS", icon: Smartphone },
  { key: "whatsapp", label: "WhatsApp", icon: MessageSquare },
];

/** Same list as events.js on the server (keys, groups and default channels). */
const EVENTS: { key: string; group: string; label: string; on: Channel[] }[] = [
  { key: "approval_requested", group: "Approvals", label: "Something needs my approval", on: ["inapp", "email"] },
  { key: "approval_progress", group: "Approvals", label: "My request passed a stage and moved on", on: ["inapp", "email"] },
  { key: "approval_decided", group: "Approvals", label: "My request was approved or rejected", on: ["inapp", "email"] },
  { key: "quote_accepted", group: "Sales", label: "A quote was accepted", on: ["inapp", "email"] },
  { key: "quote_declined", group: "Sales", label: "A quote was declined", on: ["inapp", "email"] },
  { key: "quote_expired", group: "Sales", label: "A quote expired", on: ["inapp"] },
  { key: "quote_invoiced", group: "Sales", label: "A quote became an invoice", on: ["inapp"] },
  { key: "payment_received", group: "Sales", label: "A customer paid (owners and managers)", on: ["inapp"] },
  { key: "lead_assigned", group: "CRM", label: "A lead or opportunity was given to me", on: ["inapp", "email"] },
  { key: "lead_tagged", group: "CRM", label: "A tag was added to my lead", on: ["inapp"] },
  { key: "lead_won", group: "CRM", label: "A deal was won", on: ["inapp", "email"] },
  { key: "lead_lost", group: "CRM", label: "A deal was lost", on: ["inapp"] },
  { key: "activity_assigned", group: "CRM", label: "A follow-up was given to me", on: ["inapp", "email"] },
  { key: "activity_due", group: "CRM", label: "My follow-ups due today (each morning)", on: ["inapp", "email"] },
  { key: "task_assigned", group: "Projects", label: "A task was given to me", on: ["inapp", "email"] },
  { key: "task_due", group: "Projects", label: "My tasks due today (each morning)", on: ["inapp", "email"] },
  { key: "record_assigned", group: "Projects", label: "Any other record was given to me", on: ["inapp"] },
  { key: "meeting_invited", group: "Calendar", label: "I was invited to a meeting", on: ["inapp", "email"] },
  { key: "meeting_reminder", group: "Calendar", label: "A meeting is about to start", on: ["inapp", "email"] },
  { key: "ticket_assigned", group: "Service", label: "A ticket was given to me", on: ["inapp", "email"] },
  { key: "leave_requested", group: "People", label: "Someone asked for leave (owners and managers)", on: ["inapp", "email"] },
  { key: "leave_decided", group: "People", label: "My leave was approved or declined", on: ["inapp", "email"] },
];

type Rules = { events: Record<string, Record<Channel, boolean>>; quiet: boolean; meeting_minutes: number; morning_hour: number };

const defaults = (): Rules => ({
  events: Object.fromEntries(EVENTS.map((e) => [e.key, Object.fromEntries(CHANNELS.map((c) => [c.key, e.on.includes(c.key)])) as Record<Channel, boolean>])),
  quiet: true, meeting_minutes: 30, morning_hour: 8,
});

export default function NotificationRules({ canManage }: { canManage: boolean }) {
  const { settings, save, isLoading } = useErpSettings();
  const [r, setR] = useState<Rules>(defaults);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const s = settings.notifications || {};
    const d = defaults();
    setR({ ...d, ...s, events: Object.fromEntries(EVENTS.map((e) => [e.key, { ...d.events[e.key], ...(s.events?.[e.key] || {}) }])) });
    setDirty(false);
  }, [settings.notifications]);
  const groups = useMemo(() => [...new Set(EVENTS.map((e) => e.group))], []);
  const { data: log = [] } = useQuery({
    queryKey: ["alert-log"], refetchInterval: 30_000,
    queryFn: async () => ((await sb.from("alert_log").select("id,event,channel,recipient,status,detail,created_at").order("created_at", { ascending: false }).limit(40)).data || []) as any[],
  });

  if (isLoading) return <OrbLoader label="Loading notifications…" />;
  const set = (p: Partial<Rules>) => { setR({ ...r, ...p }); setDirty(true); };
  const flip = (ev: string, c: Channel) => set({ events: { ...r.events, [ev]: { ...r.events[ev], [c]: !r.events[ev][c] } } });
  const column = (c: Channel, v: boolean) => set({ events: Object.fromEntries(Object.entries(r.events).map(([k, x]) => [k, { ...x, [c]: v }])) });
  const submit = async () => {
    const { error } = await save("notifications", r);
    if (error) toast.error(error.message); else { toast.success("Notification rules saved"); setDirty(false); }
  };
  const label = Object.fromEntries(EVENTS.map((e) => [e.key, e.label]));

  return (
    <div className="space-y-5">
      <Panel title="Who gets told, and how" icon={BellRing} flush
        description="Each alert goes to the person it is for. Pick the channels for each event.">
        <TableWrap>
          <table className="dt w-full">
            <thead>
              <tr>
                <th>Event</th>
                {CHANNELS.map((c) => (
                  <th key={c.key} className="w-24 text-center">
                    <span className="inline-flex flex-col items-center gap-1"><c.icon className="h-4 w-4 text-primary" />{c.label}
                      {canManage && <span className="flex gap-1 text-[10px] font-normal normal-case"><button type="button" className="underline-offset-2 hover:underline" onClick={() => column(c.key, true)}>all</button>·<button type="button" className="underline-offset-2 hover:underline" onClick={() => column(c.key, false)}>none</button></span>}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <PagedRows rows={groups} colSpan={CHANNELS.length + 1}>{(pageRows) => pageRows.map((g) => (
                <Fragment key={g}>
                  <tr className="bg-muted/40"><td colSpan={5} className="py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{g}</td></tr>
                  {EVENTS.filter((e) => e.group === g).map((e) => (
                    <tr key={e.key}>
                      <td className="text-sm">{e.label}</td>
                      {CHANNELS.map((c) => {
                        const on = !!r.events[e.key]?.[c.key];
                        return (
                          <td key={c.key} className="text-center">
                            <button type="button" disabled={!canManage} onClick={() => flip(e.key, c.key)} aria-pressed={on} aria-label={`${c.label}: ${e.label}`}
                              className={cn("inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground/50 hover:border-primary/50")}>
                              <c.icon className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}</PagedRows>
            </tbody>
          </table>
        </TableWrap>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Timing" icon={CalendarClock}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Remind before a meeting">
              <select className="fi" value={r.meeting_minutes} disabled={!canManage} onChange={(e) => set({ meeting_minutes: Number(e.target.value) })}>
                {[5, 10, 15, 30, 60, 120, 1440].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : m === 1440 ? "1 day" : `${m / 60} hour${m === 60 ? "" : "s"}`}</option>)}
              </select>
            </Field>
            <Field label="Morning summary at" hint="Tasks and follow-ups due today">
              <select className="fi" value={r.morning_hour} disabled={!canManage} onChange={(e) => set({ morning_hour: Number(e.target.value) })}>
                {[6, 7, 8, 9, 10].map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </Field>
          </div>
        </Panel>
        <Panel title="Quiet hours" icon={Moon}>
          <Toggle label="Hold SMS and WhatsApp from 8 pm to 7 am" hint="They go out at 7 am. The bell and email are never held." checked={r.quiet} disabled={!canManage} onChange={(v) => set({ quiet: v })} />
          <p className="mt-3 text-xs text-muted-foreground">Customer reminders for unpaid invoices and repeat purchases are under <Link to="/settings?tab=alerts" className="font-medium text-primary hover:underline">Debt & restock alerts</Link>. Which other messages use SMS, the balance and top-ups are under <Link to="/settings?tab=sms" className="font-medium text-primary hover:underline">SMS & WhatsApp</Link>.</p>
        </Panel>
      </div>

      {canManage && (
        <div className="sticky bottom-3 z-10 flex justify-end">
          <button onClick={() => void submit()} disabled={!dirty} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg disabled:opacity-50"><Save className="h-4 w-4" /> Save notification rules</button>
        </div>
      )}

      <Panel title="Recently sent" icon={History} flush>
        {!log.length ? <EmptyState icon={Bell} title="Nothing sent yet" description="Alerts appear here as they go out." /> : (
          <TableWrap><table className="dt w-full"><thead><tr><th>When</th><th>Event</th><th>Channel</th><th>To</th><th>Status</th></tr></thead><tbody>
            <PagedRows rows={log} colSpan={5}>{(pageRows) => pageRows.map((x) => (
              <tr key={x.id}>
                <td className="whitespace-nowrap text-xs text-muted-foreground">{new Date(x.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="text-sm">{label[x.event] || x.event}</td>
                <td className="text-sm">{CHANNELS.find((c) => c.key === x.channel)?.label || x.channel}</td>
                <td className="text-sm">{x.recipient || "Bell"}</td>
                <td><Pill tone={x.status === "sent" ? "success" : x.status === "failed" ? "danger" : "info"}>{x.status}</Pill>{x.detail && x.status === "failed" && <span className="ml-2 text-xs text-muted-foreground">{x.detail}</span>}</td>
              </tr>
            ))}</PagedRows>
          </tbody></table></TableWrap>
        )}
      </Panel>
    </div>
  );
}
