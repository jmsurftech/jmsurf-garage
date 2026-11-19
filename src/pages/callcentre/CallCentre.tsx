import { useEffect } from "react";
import { callNumber } from "@/components/PhoneDock";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Headset, PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, ExternalLink, Settings, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, StatGrid, StatTile, EmptyState, Pill } from "@/components/kit";
import { useModules } from "@/hooks/useModules";
import { useTenantId } from "@/hooks/useTenantId";
import { erpApi } from "@/lib/erpApi";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";

import { PagedRows } from "@/components/Pager";
const sb = supabase as any;
export const CALLCENTRE_ORIGIN = "https://app.jmsurfcallcentre.co.ke";
const dur = (s?: number | null) => { const n = Math.round(Number(s || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`; };

/** Opens JMSURF CALL CENTRE already signed in (its own session), optionally dialling a number. */
export async function openCallCentre(next = "/", dial?: string) {
  // Dialling happens right here in JMSURF Garage, on the phone in the corner.
  if (dial) { callNumber(dial); return; }
  const win = window.open("", "jmsurf-callcentre");
  try {
    const r = await erpApi("callcentre/handoff", { next: dial ? `/?dial=${encodeURIComponent(dial)}` : next });
    if (win) win.location.href = r.url; else window.location.href = r.url;
  } catch (e) { win?.close(); toast.error(friendlyError(e)); }
}

/** A customer's calls (with recordings), for the customer page. */
export function CustomerCalls({ customerId }: { customerId: string }) {
  const { data = [] } = useQuery({ queryKey: ["cust-calls", customerId], queryFn: async () => ((await sb.from("cc_calls").select("*, cc_agents(display_name)").eq("customer_id", customerId).order("started_at", { ascending: false }).limit(100)).data || []) as any[] });
  if (!data.length) return <EmptyState icon={Headset} title="No calls yet" description="Calls to and from this customer through JMSURF CALL CENTRE appear here with their recordings." />;
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
      <PagedRows rows={data} list>{(pageRows) => pageRows.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          {c.direction === "inbound" ? <PhoneIncoming className="h-4 w-4 text-info" /> : <PhoneOutgoing className="h-4 w-4 text-success" />}
          <span className="min-w-0 flex-1">{new Date(c.started_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}{c.cc_agents?.display_name && <span className="text-muted-foreground"> · {c.cc_agents.display_name}</span>}{c.notes && <span className="block text-xs text-muted-foreground">{c.disposition ? `${c.disposition}: ` : ""}{c.notes}</span>}</span>
          <span className="tabular-nums text-muted-foreground">{dur(c.duration_seconds)}</span>
          <Pill tone={c.status === "completed" ? "success" : c.status === "missed" ? "danger" : c.status === "voicemail" ? "warning" : "muted"}>{c.status}</Pill>
          {c.recording_url && <audio controls preload="none" src={c.recording_url} className="h-8 w-56" />}
        </li>
      ))}</PagedRows>
    </ul>
  );
}

/** JMSURF Garage → JMSURF CALL CENTRE: today's calls, callbacks and the way into the call centre app. */
export default function CallCentre() {
  const { has } = useModules();
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const on = has("callcentre");
  const { data: calls = [] } = useQuery({ queryKey: ["cc-calls-dash", tenantId], enabled: on && !!tenantId, queryFn: async () => ((await sb.from("cc_calls").select("*, cc_agents(display_name)").gte("started_at", new Date(Date.now() - 7 * 86400_000).toISOString()).order("started_at", { ascending: false }).limit(500)).data || []) as any[] });
  const { data: callbacks = [] } = useQuery({ queryKey: ["cc-cb-dash", tenantId], enabled: on && !!tenantId, queryFn: async () => ((await sb.from("cc_callbacks").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(50)).data || []) as any[] });
  const { data: line } = useQuery({ queryKey: ["cc-line", tenantId], enabled: on && !!tenantId, queryFn: async () => (await sb.from("cc_settings").select("at_number,enabled").maybeSingle()).data });
  useEffect(() => {
    if (!on || !tenantId) return;
    const ch = supabase.channel(`cc-dash-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cc_calls", filter: `tenant_id=eq.${tenantId}` }, () => void qc.invalidateQueries({ queryKey: ["cc-calls-dash"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "cc_callbacks", filter: `tenant_id=eq.${tenantId}` }, () => void qc.invalidateQueries({ queryKey: ["cc-cb-dash"] }))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [on, tenantId, qc]);

  if (!on) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#be123c] text-white shadow-lg"><Headset className="h-8 w-8" /></span>
        <h1 className="mt-4 font-display text-2xl font-bold">JMSURF CALL CENTRE</h1>
        <p className="mt-2 text-muted-foreground">IVR menus, queues and browser phones, with every call, recording and missed call on the customer's record.</p>
        <Link to="/modules?app=callcentre" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground"><Lock className="h-4 w-4" /> Switch on: 14 days free</Link>
      </div>
    );
  }
  const today = calls.filter((c) => Date.parse(c.started_at) >= since.getTime());
  const answered = today.filter((c) => c.status === "completed").length;
  return (
    <div className="space-y-6">
      <PageHeader title="Call Centre" icon={Headset} description={line?.at_number ? `Line ${line.at_number}${line.enabled ? "" : " (switched off)"}` : "Connect your phone line in the Call Centre settings to start taking calls."}
        actions={<div className="flex gap-2">
          <button onClick={() => void openCallCentre("/settings")} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted"><Settings className="h-4 w-4" /> Set up</button>
          <button onClick={() => void openCallCentre("/")} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><ExternalLink className="h-4 w-4" /> Open Call Centre</button>
        </div>} />
      <StatGrid>
        <StatTile label="Calls today" value={today.length} icon={Phone} />
        <StatTile label="Answered" value={answered} tone="success" icon={PhoneIncoming} hint={today.length ? `${Math.round((answered / today.length) * 100)}% answer rate` : undefined} />
        <StatTile label="Missed today" value={today.filter((c) => c.status === "missed" || c.status === "voicemail").length} tone="danger" icon={PhoneMissed} />
        <StatTile label="Waiting for a call back" value={callbacks.length} tone="warning" icon={PhoneMissed} />
      </StatGrid>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Panel title="Call back" icon={PhoneMissed} flush>
          {!callbacks.length ? <EmptyState icon={PhoneMissed} title="No one waiting" /> : (
            <ul className="divide-y divide-border"><PagedRows rows={callbacks} list>{(pageRows) => pageRows.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1"><b>{c.customer_name || c.phone}</b><span className="block text-xs text-muted-foreground">{c.notes} · {new Date(c.created_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}</span></span>
                <button onClick={() => void openCallCentre("/", c.phone)} className="inline-flex items-center gap-1 rounded-lg bg-success px-2.5 py-1.5 text-xs font-semibold text-white"><Phone className="h-3.5 w-3.5" /> Call</button>
              </li>
            ))}</PagedRows></ul>
          )}
        </Panel>
        <Panel title="Recent calls (7 days)" icon={Headset} flush>
          {!calls.length ? <EmptyState icon={Headset} title="No calls yet" /> : (
            <ul className="divide-y divide-border">{calls.slice(0, 40).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                {c.direction === "inbound" ? <PhoneIncoming className="h-4 w-4 text-info" /> : <PhoneOutgoing className="h-4 w-4 text-success" />}
                <span className="min-w-0 flex-1">{c.customer_id ? <Link to={`/customers/${c.customer_id}`} className="font-semibold hover:underline">{c.customer_name}</Link> : <b>{c.direction === "inbound" ? c.from_number : c.to_number}</b>}<span className="block text-xs text-muted-foreground">{new Date(c.started_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}{c.cc_agents?.display_name ? ` · ${c.cc_agents.display_name}` : ""}</span></span>
                <span className="tabular-nums text-muted-foreground">{dur(c.duration_seconds)}</span>
                <Pill tone={c.status === "completed" ? "success" : c.status === "missed" ? "danger" : c.status === "voicemail" ? "warning" : "muted"}>{c.status}</Pill>
                {c.recording_url && <audio controls preload="none" src={c.recording_url} className="h-8 w-48" />}
              </li>
            ))}</ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
