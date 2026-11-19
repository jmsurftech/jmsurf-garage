import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Mail, MessageSquare, Megaphone, KeyRound, Copy, Link2, Share2, Activity, CheckCircle2, AlertTriangle, BarChart3, Paperclip } from "lucide-react";
import DocumentsPanel from "@/components/DocumentsPanel";
import { supabase } from "@/integrations/supabase/client";
import { erpApi } from "@/lib/erpApi";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AppRecord } from "./data";

const sb = supabase as any;
/** Files usually asked of a candidate; copied onto the employee when hired. */
const APPLICANT_DOCS = ["CV", "Cover letter", "Academic certificates", "ID copy", "Reference letters"];

/** Messages on a record (email thread or website chat), live. */
function useMessages(recordId: string) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["record-messages", recordId],
    queryFn: async () => ((await sb.from("app_record_events").select("id,body,data,created_at").eq("record_id", recordId).eq("kind", "message").order("created_at").limit(500)).data || []) as any[],
  });
  useEffect(() => {
    const ch = supabase.channel(`rec-msg-${recordId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "app_record_events", filter: `record_id=eq.${recordId}` }, () => void qc.invalidateQueries({ queryKey: ["record-messages", recordId] }))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [recordId, qc]);
  return q;
}

function Thread({ recordId, mine }: { recordId: string; mine: (m: any) => boolean }) {
  const { data = [] } = useMessages(recordId);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [data.length]);
  return (
    <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl bg-muted/40 p-3">
      {data.map((m) => (
        <div key={m.id} className={cn("flex", mine(m) ? "justify-end" : "justify-start")}>
          <div className={cn("max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm", mine(m) ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border border-border bg-card")}>
            {m.body}
            <p className={cn("mt-1 text-[10px]", mine(m) ? "text-primary-foreground/70" : "text-muted-foreground")}>{m.data?.name || m.data?.email || (mine(m) ? "You" : "Customer")} · {new Date(m.created_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}</p>
          </div>
        </div>
      ))}
      {!data.length && <p className="py-6 text-center text-sm text-muted-foreground">No messages yet.</p>}
      <div ref={end} />
    </div>
  );
}

function Reply({ onSend, placeholder, stageChoices }: { onSend: (text: string, stage?: string) => Promise<void>; placeholder: string; stageChoices?: [string, string][] }) {
  const [text, setText] = useState("");
  const [stage, setStage] = useState(stageChoices?.[0]?.[0] || "");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await onSend(text.trim(), stage || undefined); setText(""); } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={placeholder} className="fi min-h-[84px]"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void go(); } }} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {stageChoices && (
          <select value={stage} onChange={(e) => setStage(e.target.value)} className="fi h-9 w-auto text-sm">
            {stageChoices.map(([k, l]) => <option key={k} value={k}>Then: {l}</option>)}
          </select>
        )}
        <button disabled={busy || !text.trim()} onClick={() => void go()} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Send className="h-4 w-4" /> {busy ? "Sending…" : "Send"}</button>
      </div>
    </div>
  );
}

function Box({ title, icon: Icon, children, actions }: { title: string; icon: any; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-primary" />{title}</p>{actions}</div>
      {children}
    </section>
  );
}

function CampaignBox({ rec, onChange }: { rec: AppRecord; onChange: () => void }) {
  const [busy, setBusy] = useState("");
  const { data: stats, refetch } = useQuery({ queryKey: ["campaign-stats", rec.id], queryFn: () => erpApi("engage/campaign-stats", { id: rec.id }), refetchInterval: rec.stage === "scheduled" ? 10_000 : false });
  const act = async (k: string, fn: () => Promise<any>) => { setBusy(k); try { await fn(); await refetch(); onChange(); } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(""); } };
  return (
    <Box title="Send" icon={Megaphone}>
      <p className="text-xs text-muted-foreground">Write the email in Content (blank lines make paragraphs, **bold**, links work, {"{name}"} becomes each person's name). An unsubscribe link and open tracking are added automatically.</p>
      <div className="flex flex-wrap gap-2">
        <button disabled={!!busy} onClick={() => act("test", async () => { const r = await erpApi("engage/campaign-test", { id: rec.id }); toast.success(`Test sent to ${r.to}`); })} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium"><Mail className="h-4 w-4" /> Send me a test</button>
        {rec.stage !== "sent" && <button disabled={!!busy} onClick={() => act("send", async () => { const r = await erpApi("engage/campaign-send", { id: rec.id }); toast.success(`Queued for ${r.recipients} people`, { description: rec.starts_at && Date.parse(rec.starts_at) > Date.now() ? "It goes out at the time set in Send at." : "Sending now, about 60 a minute." }); })} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"><Send className="h-4 w-4" /> {rec.starts_at && Date.parse(rec.starts_at) > Date.now() ? "Schedule" : "Send now"}</button>}
      </div>
      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[["Recipients", stats.total], ["Sent", stats.sent], ["Opened", `${stats.opened}${stats.sent ? ` (${Math.round((stats.opened / stats.sent) * 100)}%)` : ""}`], ["Failed", stats.failed]].map(([l, v]) => (
            <div key={String(l)} className="rounded-xl bg-muted/50 p-2.5"><p className="text-[11px] text-muted-foreground">{l}</p><p className="font-display text-lg font-bold tabular-nums">{v}</p></div>
          ))}
        </div>
      )}
    </Box>
  );
}

function SocialBox({ rec, onChange }: { rec: AppRecord; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const log = (rec.data?.publish_log || {}) as Record<string, { ok: boolean; error?: string }>;
  return (
    <Box title="Publish" icon={Share2} actions={
      <button disabled={busy} onClick={async () => { setBusy(true); try { const r = await erpApi("engage/social-publish", { id: rec.id }); const bad = Object.values(r.log || {}).filter((x: any) => !x.ok).length; bad ? toast.error(`${bad} channel(s) not published`) : toast.success("Published"); onChange(); } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); } }}
        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"><Send className="h-4 w-4" /> {busy ? "Publishing…" : "Publish now"}</button>}>
      <p className="text-xs text-muted-foreground">Set the stage to Scheduled with a Publish at time and it goes out by itself. Facebook, Instagram, LinkedIn and X publish directly once connected in System → Service & Marketing; Instagram needs an Image URL.</p>
      {Object.keys(log).length > 0 && (
        <ul className="space-y-1 text-sm">
          {Object.entries(log).map(([ch, v]) => <li key={ch} className="flex items-start gap-2">{v.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />}<span><b>{ch}</b>{v.error ? `: ${v.error}` : " published"}</span></li>)}
        </ul>
      )}
    </Box>
  );
}

function IotBox({ rec }: { rec: AppRecord }) {
  const [key, setKey] = useState<{ key: string; endpoint: string } | null>(null);
  const { data } = useQuery({ queryKey: ["iot-readings", rec.id], queryFn: () => erpApi("engage/iot-readings", { id: rec.id }), refetchInterval: 15_000 });
  const rows = ((data?.readings || []) as any[]).slice().reverse();
  const vals = rows.map((r) => Number(r.value)).filter((v) => Number.isFinite(v));
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return (
    <Box title="Device connection" icon={Activity} actions={
      <button onClick={async () => { try { setKey(await erpApi("engage/iot-key", { id: rec.id })); } catch (e) { toast.error(friendlyError(e)); } }} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium"><KeyRound className="h-4 w-4" /> {rec.data?.key_hint ? "New key" : "Create device key"}</button>}>
      {key ? (
        <div className="space-y-2 rounded-xl bg-warning/10 p-3 text-sm">
          <p className="font-semibold">Copy this key now: it is shown only once.</p>
          <code className="block break-all rounded-lg bg-card p-2 text-xs">{key.key}</code>
          <p className="text-xs text-muted-foreground">Devices send readings with <code>POST {key.endpoint}</code>, header <code>X-Device-Key</code>, body <code>{`{"value": 21.5, "unit": "°C", "metric": "temperature"}`}</code>.</p>
          <button onClick={() => { void navigator.clipboard.writeText(key.key); toast.success("Key copied"); }} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium"><Copy className="h-3.5 w-3.5" /> Copy key</button>
        </div>
      ) : rec.data?.key_hint ? <p className="text-xs text-muted-foreground">Key {rec.data.key_hint} · last reading {rec.data?.last_seen ? new Date(rec.data.last_seen).toLocaleString("en-KE") : "never"}</p> : <p className="text-xs text-muted-foreground">Create a key, then point the device (or its gateway) at the endpoint shown.</p>}
      {rows.length > 0 && (
        <>
          <svg viewBox="0 0 300 60" className="h-16 w-full" preserveAspectRatio="none" aria-label="Readings">
            <polyline fill="none" stroke="hsl(var(--primary))" strokeWidth="2" points={vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * 300},${hi === lo ? 30 : 56 - ((v - lo) / (hi - lo)) * 52}`).join(" ")} />
          </svg>
          <p className="text-xs text-muted-foreground">Last {rows.length} readings · now <b className="text-foreground">{rows[rows.length - 1]?.value} {rows[rows.length - 1]?.unit || ""}</b> · min {lo} · max {hi}</p>
        </>
      )}
    </Box>
  );
}

function LearnerBox({ rec }: { rec: AppRecord }) {
  const [url, setUrl] = useState("");
  const make = async (sms: boolean) => {
    try { const r = await erpApi("engage/learn-link", { id: rec.id, sms }); setUrl(r.url); await navigator.clipboard.writeText(r.url).catch(() => {}); toast.success(sms ? "Link created and sent by SMS" : "Learner link copied"); } catch (e) { toast.error(friendlyError(e)); }
  };
  return (
    <Box title="Learner link" icon={Link2}>
      <p className="text-xs text-muted-foreground">The learner opens the course with this private link: lessons, videos, quiz questions and progress, no login needed. A new link replaces the old one.</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void make(false)} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium"><Copy className="h-4 w-4" /> Copy link</button>
        {rec.data?.phone && <button onClick={() => void make(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"><MessageSquare className="h-4 w-4" /> Send by SMS</button>}
      </div>
      {url && <code className="block break-all rounded-lg bg-muted p-2 text-xs">{url}</code>}
    </Box>
  );
}

/** Extra panels on a record for apps that talk to the outside world. */
export function RecordExtras({ app, kind, rec, onChange }: { app: string; kind: string; rec: AppRecord; onChange: () => void }) {
  if (app === "helpdesk" && kind === "ticket") {
    return (
      <Box title="Conversation" icon={Mail}>
        <Thread recordId={rec.id} mine={(m) => m.data?.from === "agent"} />
        <Reply placeholder={rec.data?.from_email ? `Reply to ${rec.data.from_email}…` : "Reply by email to the customer…"}
          stageChoices={[["waiting", "Waiting on customer"], ["in_progress", "In progress"], ["resolved", "Resolved"]]}
          onSend={async (text, stage) => { await erpApi("engage/ticket-reply", { id: rec.id, body: text, stage }); toast.success("Reply sent"); onChange(); }} />
      </Box>
    );
  }
  if (app === "live_chat" && kind === "conversation") {
    return (
      <Box title="Chat" icon={MessageSquare}>
        <Thread recordId={rec.id} mine={(m) => m.data?.from === "agent"} />
        <Reply placeholder="Type your answer… (Ctrl+Enter sends)" onSend={async (text) => { await erpApi("engage/chat-reply", { id: rec.id, body: text }); onChange(); }} />
      </Box>
    );
  }
  if (app === "email_marketing" && kind === "campaign") return <CampaignBox rec={rec} onChange={onChange} />;
  if (app === "social" && kind === "post") return <SocialBox rec={rec} onChange={onChange} />;
  if (app === "iot" && kind === "device") return <IotBox rec={rec} />;
  if (app === "elearning" && kind === "enrollment") return <LearnerBox rec={rec} />;
  if (app === "marketing_automation" && kind === "journey") return <JourneyStats rec={rec} />;
  if (app === "recruitment" && kind === "applicant") return <Box title="Candidate files" icon={Paperclip}><DocumentsPanel entityType="applicant" entityId={rec.id} entityName={rec.title} checklist={APPLICANT_DOCS} /></Box>;
  return null;
}

function JourneyStats({ rec }: { rec: AppRecord }) {
  const { data = [] } = useQuery({ queryKey: ["journey-enrol", rec.id], queryFn: async () => ((await sb.from("journey_enrollments").select("done,step").eq("journey_id", rec.id).limit(10000)).data || []) as any[] });
  return (
    <Box title="Journey" icon={BarChart3}>
      <p className="text-xs text-muted-foreground">Set the stage to Running to start. Each step waits its days, then sends its message by SMS, Email or WhatsApp (write the channel name). Use {"{name}"}, {"{company}"}, {"{invoice}"} and {"{amount}"} in messages.</p>
      <div className="grid grid-cols-3 gap-2">
        {[["Enrolled", data.length], ["In progress", data.filter((d) => !d.done).length], ["Finished", data.filter((d) => d.done).length]].map(([l, v]) => (
          <div key={String(l)} className="rounded-xl bg-muted/50 p-2.5"><p className="text-[11px] text-muted-foreground">{l}</p><p className="font-display text-lg font-bold tabular-nums">{v}</p></div>
        ))}
      </div>
    </Box>
  );
}
