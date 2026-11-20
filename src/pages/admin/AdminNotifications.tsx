/** Super admin → Notifications: what the platform owner is told about, and how. */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Mail, Smartphone, MessageSquare, Save, Send, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, Field, Pill, EmptyState, TableWrap, MoreMenu, btnPrimaryCls } from "@/components/kit";
import { OrbSpinner } from "@/components/orbs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { PagedRows } from "@/components/Pager";
const sb = supabase as any;
const EVENTS = [
  { key: "signup", label: "A new company signs up" },
  { key: "payment", label: "A company pays (subscription or SMS)" },
  { key: "inquiry", label: "Someone sends the website contact form" },
  { key: "lead", label: "A lead is added or changes stage" },
];
const CHANNELS = [{ key: "email", label: "Email", icon: Mail }, { key: "sms", label: "SMS", icon: Smartphone }, { key: "whatsapp", label: "WhatsApp", icon: MessageSquare }] as const;

/** How JMSURF ISP, SMS, RMS and other products send their sign-ups (with "how did you hear about us") to Leads & CRM. */
function IntakePanel() {
  const { data: key } = useQuery({ queryKey: ["lead-intake-key"], queryFn: async () => ((await sb.from("platform_settings").select("value").eq("key", "lead_intake").maybeSingle()).data?.value?.key as string) || "" });
  const [show, setShow] = useState(false);
  return (
    <Panel title="Sign-ups from other products" icon={Send} description="Other JMSURF products post new sign-ups here; they appear in Leads & CRM.">
      <div className="min-w-0 space-y-2 text-sm">
        <p className="break-all">Address: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">POST https://garage.jmsurf.co.ke/api/public/lead</code></p>
        <p className="break-all">Header <code className="rounded bg-muted px-1.5 py-0.5 text-xs">x-lead-key</code>: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{show ? key : "••••••••••••"}</code> <button className="text-xs font-semibold text-primary" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button></p>
        <p className="text-xs text-muted-foreground">JSON body: product (isp, sms, rms…), name, company, email, phone, country, heard_from, heard_detail, details {"{…}"}.</p>
      </div>
    </Panel>
  );
}

export default function AdminNotifications() {
  const [v, setV] = useState<any>({ events: { signup: { email: true }, payment: { email: true }, inquiry: { email: true }, lead: {} }, emails: [], phones: [] });
  const [emails, setEmails] = useState("");
  const [phones, setPhones] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    void sb.from("platform_settings").select("value").eq("key", "owner_alerts").maybeSingle().then(({ data }: any) => {
      if (data?.value) { setV({ ...v, ...data.value }); setEmails((data.value.emails || []).join(", ")); setPhones((data.value.phones || []).join(", ")); }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: log = [], refetch } = useQuery({ queryKey: ["owner-alert-log"], queryFn: async () => ((await sb.from("platform_alert_queue").select("*").order("created_at", { ascending: false }).limit(30)).data || []) as any[] });
  const flip = (e: string, c: string) => setV({ ...v, events: { ...v.events, [e]: { ...(v.events[e] || {}), [c]: !v.events[e]?.[c] } } });
  const save = async () => {
    setBusy("save");
    const value = { ...v, emails: emails.split(/[,;\s]+/).filter((x) => /@/.test(x)), phones: phones.split(/[,;\s]+/).filter(Boolean) };
    const { error } = await sb.from("platform_settings").upsert({ key: "owner_alerts", value }, { onConflict: "key" });
    setBusy("");
    if (error) toast.error(error.message); else toast.success("Notification settings saved");
  };
  const test = async () => {
    setBusy("test");
    try {
      await save();
      const { data } = await supabase.auth.getSession();
      const r = await fetch("/api/admin/alerts/test", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` }, body: "{}" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Test failed");
      toast.success(`Sent: ${j.email} email, ${j.sms} SMS, ${j.whatsapp} WhatsApp`, { description: j.errors?.length ? j.errors.join("; ") : undefined });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(""); refetch(); }
  };
  return (
    <div className="space-y-3">
      <PageHeader title="Notifications" icon={Bell}
        actions={<>
          <MoreMenu items={[{ label: "Send test", icon: Send, disabled: !!busy, onSelect: () => void test() }]} />
          <button type="button" className={btnPrimaryCls} onClick={() => void save()} disabled={!!busy}>{busy === "save" ? <OrbSpinner /> : <Save className="h-4 w-4" />} Save</button>
        </>} />
      <Panel title="Events" icon={Bell} flush>
        <TableWrap><table className="dt">
          <thead><tr><th>When</th>{CHANNELS.map((c) => <th key={c.key} className="w-16 text-center sm:w-24"><span className="inline-flex flex-col items-center gap-1"><c.icon className="h-4 w-4 text-primary" />{c.label}</span></th>)}</tr></thead>
          <tbody><PagedRows rows={EVENTS} colSpan={CHANNELS.length + 1}>{(pageRows) => pageRows.map((e) => (
            <tr key={e.key}><td className="text-sm">{e.label}</td>{CHANNELS.map((c) => {
              const on = !!v.events?.[e.key]?.[c.key];
              return <td key={c.key} className="text-center"><button type="button" onClick={() => flip(e.key, c.key)} aria-pressed={on} className={cn("inline-flex h-7 w-7 items-center justify-center rounded-lg border", on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground/50")}><c.icon className="h-3.5 w-3.5" /></button></td>;
            })}</tr>
          ))}</PagedRows></tbody>
        </table></TableWrap>
      </Panel>
      <Panel title="Send to" icon={Mail}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Emails" hint="Separate with commas"><input className="fi" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="Enter emails" /></Field>
          <Field label="Phones (SMS / WhatsApp)" hint="Separate with commas"><input className="fi" value={phones} onChange={(e) => setPhones(e.target.value)} placeholder="Enter phone numbers" /></Field>
        </div>
        {busy === "test" && <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground"><OrbSpinner /> Sending test…</p>}
      </Panel>
      <IntakePanel />
      <Panel title="Recent alerts" icon={History} flush>
        {!log.length ? <EmptyState icon={Bell} title="No alerts yet" /> : (
          <TableWrap><table className="dt"><thead><tr><th>When</th><th>Alert</th><th>Status</th></tr></thead><tbody>
            <PagedRows rows={log} colSpan={3}>{(pageRows) => pageRows.map((a) => <tr key={a.id}><td className="whitespace-nowrap text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString("en-GB")}</td><td><b className="text-sm">{a.title}</b><span className="block text-xs text-muted-foreground">{a.body}</span></td><td><Pill tone={a.status === "done" && !a.detail ? "success" : a.detail ? "warning" : "info"}>{a.status === "done" ? (a.detail ? "partly sent" : "sent") : "waiting"}</Pill>{a.detail && <span className="block max-w-xs truncate text-[11px] text-muted-foreground" title={a.detail}>{a.detail}</span>}</td></tr>)}</PagedRows>
          </tbody></table></TableWrap>
        )}
      </Panel>
    </div>
  );
}
