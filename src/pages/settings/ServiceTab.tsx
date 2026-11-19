import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, MessagesSquare, CalendarClock, Ticket, Share2, Copy, Plug, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel, Field, Pill } from "@/components/kit";
import { useErpSettings, Toggle } from "@/pages/settings/ErpSettingsTabs";
import { useModules } from "@/hooks/useModules";
import { useTenant } from "@/hooks/useTenant";
import { erpApi } from "@/lib/erpApi";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";

const sb = supabase as any;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** System → Service & Marketing: helpdesk mailbox, website chat, online booking, event page and social accounts. */
export default function ServiceTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { settings, save } = useErpSettings();
  const { has } = useModules();
  const tenant = useTenant() as any;
  const [e, setE] = useState<any>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  useEffect(() => { setE(settings.engage || {}); }, [settings.engage]);
  const { data: saved = [] } = useQuery({ queryKey: ["engage-secrets"], queryFn: async () => (await sb.rpc("integration_secret_status")).data || [] });
  const isSet = (n: string) => (saved as any[]).some((s) => s.name === n);
  const sec = (k: string) => (e[k] || {}) as any;
  const upd = (k: string, patch: any) => setE({ ...e, [k]: { ...sec(k), ...patch } });
  const slug = tenant?.slug || window.location.hostname.split(".")[0] || "yourcompany";
  const base = `https://${slug}.garage.jmsurf.co.ke`;

  const persist = async () => {
    setBusy("save");
    try {
      const { error } = await save("engage", e);
      if (error) throw error;
      for (const [name, value] of Object.entries(secrets)) if (value.trim()) await erpApi("engage/settings-secret", { name, value });
      setSecrets({}); void qc.invalidateQueries({ queryKey: ["engage-secrets"] });
      toast.success("Saved");
    } catch (err) { toast.error(friendlyError(err)); } finally { setBusy(""); }
  };
  const secretInput = (name: string, label: string) => (
    <Field label={<>{label} {isSet(name) && <Pill tone="success">saved</Pill>}</>}>
      <input className="fi" type="password" autoComplete="off" disabled={!canManage} value={secrets[name] || ""} onChange={(x) => setSecrets({ ...secrets, [name]: x.target.value })} placeholder={isSet(name) ? "•••••• (leave empty to keep)" : ""} />
    </Field>
  );
  const copy = (t: string) => { void navigator.clipboard.writeText(t); toast.success("Copied"); };
  const off = (key: string, name: string) => !has(key) && <p className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">Switch on {name} in System → Modules to use this.</p>;

  const b = sec("booking");
  const days: number[] = Array.isArray(b.days) && b.days.length ? b.days : [1, 2, 3, 4, 5, 6];
  const snippet = `<script src="${base}/chat.js" async></script>`;

  return (
    <div className="space-y-5">
      <Panel title="Helpdesk mailbox" icon={Mail} description="Emails to your support address become tickets; replies from JMSURF Garage thread back onto them.">
        {off("helpdesk", "JMSURF SERVICE")}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mail server (IMAP)"><input className="fi" disabled={!canManage} value={sec("helpdesk").imap_host || ""} onChange={(x) => upd("helpdesk", { imap_host: x.target.value.trim() })} placeholder="mail.yourcompany.co.ke" /></Field>
          <Field label="Port"><input className="fi" disabled={!canManage} value={sec("helpdesk").imap_port || "993"} onChange={(x) => upd("helpdesk", { imap_port: x.target.value })} /></Field>
          <Field label="Support address (login)"><input className="fi" disabled={!canManage} value={sec("helpdesk").imap_user || ""} onChange={(x) => upd("helpdesk", { imap_user: x.target.value.trim() })} placeholder="Enter email address" /></Field>
          {secretInput("helpdesk_imap_password", "Mailbox password")}
          <Field label="Reply within (hours)" hint="Sets the SLA deadline on new tickets"><input className="fi" type="number" disabled={!canManage} value={sec("helpdesk").sla_hours || 24} onChange={(x) => upd("helpdesk", { sla_hours: Number(x.target.value) })} /></Field>
        </div>
        <div className="mt-3 grid gap-2">
          <Toggle label="Read this mailbox every 2 minutes" checked={!!sec("helpdesk").enabled} disabled={!canManage} onChange={(v) => upd("helpdesk", { enabled: v })} />
          <Toggle label="Send an automatic acknowledgement" hint="Tells the customer their ticket number." checked={sec("helpdesk").auto_ack !== false} disabled={!canManage} onChange={(v) => upd("helpdesk", { auto_ack: v })} />
        </div>
        {sec("helpdesk").last_error && <p className="mt-3 rounded-xl bg-warning/10 p-3 text-xs">Last problem: {sec("helpdesk").last_error}</p>}
        <button disabled={!canManage || !!busy} onClick={async () => { setBusy("test"); try { await persist(); const r = await erpApi("engage/helpdesk-test"); toast.success(`Mailbox read: ${r.created} new ticket(s), ${r.threaded} reply(ies)`); } catch (err) { toast.error(friendlyError(err)); } finally { setBusy(""); } }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium"><Plug className="h-4 w-4" /> {busy === "test" ? "Checking…" : "Save and check now"}</button>
      </Panel>

      <Panel title="Website live chat" icon={MessagesSquare} description="A chat bubble for any website. Chats arrive in Live Chat and are answered from JMSURF Garage.">
        {off("live_chat", "JMSURF SERVICE")}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title"><input className="fi" disabled={!canManage} value={sec("chat").title || ""} onChange={(x) => upd("chat", { title: x.target.value })} placeholder="Chat with us" /></Field>
          <Field label="Colour"><input className="fi h-10" type="color" disabled={!canManage} value={sec("chat").color || "#a8121b"} onChange={(x) => upd("chat", { color: x.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Greeting"><input className="fi" disabled={!canManage} value={sec("chat").greeting || ""} onChange={(x) => upd("chat", { greeting: x.target.value })} placeholder="Hi! Leave your name and question and we'll answer right here." /></Field></div>
        </div>
        <div className="mt-3"><Toggle label="Show the chat bubble" checked={!!sec("chat").enabled} disabled={!canManage} onChange={(v) => upd("chat", { enabled: v })} /></div>
        <p className="mt-3 text-xs text-muted-foreground">Paste this before &lt;/body&gt; on any website (your JMSURF Garage website shows it automatically):</p>
        <div className="mt-1 flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-2"><code className="min-w-0 flex-1 truncate text-xs">{snippet}</code><button onClick={() => copy(snippet)} className="icon-btn" aria-label="Copy"><Copy className="h-4 w-4" /></button></div>
      </Panel>

      <Panel title="Online booking" icon={CalendarClock} description="Customers book appointments on your booking page and get an SMS confirmation and reminder.">
        {off("appointments", "JMSURF SERVICE")}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Open from"><input className="fi" type="time" disabled={!canManage} value={b.open_from || "08:00"} onChange={(x) => upd("booking", { open_from: x.target.value })} /></Field>
          <Field label="Until"><input className="fi" type="time" disabled={!canManage} value={b.open_to || "17:00"} onChange={(x) => upd("booking", { open_to: x.target.value })} /></Field>
          <Field label="Book at least (hours ahead)"><input className="fi" type="number" disabled={!canManage} value={b.min_notice_hours ?? 2} onChange={(x) => upd("booking", { min_notice_hours: Number(x.target.value) })} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => <button key={d} disabled={!canManage} onClick={() => upd("booking", { days: days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort() })} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${days.includes(i) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{d}</button>)}
        </div>
        <div className="mt-3 grid gap-2">
          <Toggle label="Open the booking page" hint="Services come from Appointments → Appointment types." checked={!!b.enabled} disabled={!canManage} onChange={(v) => upd("booking", { enabled: v })} />
          <Toggle label="SMS confirmations and reminders" checked={b.sms_confirm !== false} disabled={!canManage} onChange={(v) => upd("booking", { sms_confirm: v })} />
        </div>
        <a href={`${base}/book`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">{base}/book <ExternalLink className="h-3.5 w-3.5" /></a>
      </Panel>

      <Panel title="Events page" icon={Ticket} description="Published events with online registration; paid tickets are invoiced and paid by M-Pesa.">
        {off("events", "JMSURF MARKETING")}
        <Toggle label="Open the events page" checked={!!sec("events").enabled} disabled={!canManage} onChange={(v) => upd("events", { enabled: v })} />
        <a href={`${base}/events`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">{base}/events <ExternalLink className="h-3.5 w-3.5" /></a>
      </Panel>

      <Panel title="Social media accounts" icon={Share2} description="Scheduled posts in Social Media publish here automatically.">
        {off("social", "JMSURF MARKETING")}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Facebook Page ID"><input className="fi" disabled={!canManage} value={sec("social").fb_page_id || ""} onChange={(x) => upd("social", { fb_page_id: x.target.value.trim() })} /></Field>
          {secretInput("social_fb_page_token", "Page access token (Facebook & Instagram)")}
          <Field label="Instagram business account ID"><input className="fi" disabled={!canManage} value={sec("social").ig_user_id || ""} onChange={(x) => upd("social", { ig_user_id: x.target.value.trim() })} /></Field>
          <Field label="LinkedIn organisation ID"><input className="fi" disabled={!canManage} value={sec("social").linkedin_org || ""} onChange={(x) => upd("social", { linkedin_org: x.target.value.trim() })} /></Field>
          {secretInput("social_linkedin_token", "LinkedIn access token")}
          {secretInput("social_x_token", "X (Twitter) user access token")}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Get a long-lived Page token from Meta's Graph API tools (pages_manage_posts, instagram_content_publish), and a LinkedIn token with w_organization_social. Tokens are stored write-only.</p>
      </Panel>

      <div className="flex justify-end"><button disabled={!canManage || !!busy} onClick={() => void persist()} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy === "save" ? "Saving…" : "Save"}</button></div>
    </div>
  );
}
