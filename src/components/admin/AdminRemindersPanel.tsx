import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Save, Send, Mail, MessageSquare, MessageCircle, RefreshCw } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Field, Pill, EmptyState, StatusPill, Panel } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OrbSpinner } from "@/components/orbs";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;

const STAGES: { id: string; label: string }[] = [
  { id: "-3", label: "3 days before" }, { id: "-2", label: "2 days before" }, { id: "-1", label: "1 day before" },
  { id: "0", label: "Expired (same day)" }, { id: "1", label: "1 day after" }, { id: "2", label: "2 days after" },
  { id: "3", label: "3 days after" }, { id: "7", label: "1 week after" }, { id: "14", label: "2 weeks after" },
  { id: "weekly", label: "Every week after that (to 12 weeks)" },
];

/** Label for a sent stage, including the weekly ones ("21" → "3 weeks after"). */
const stageLabel = (stage: string) => {
  const known = STAGES.find((s) => s.id === stage)?.label;
  if (known) return known;
  if (stage.startsWith("manual")) return "Sent by hand";
  const n = Number(stage);
  return n > 14 && n % 7 === 0 ? `${n / 7} weeks after` : stage;
};

const DEFAULTS = {
  enabled: false, email: true, sms: true, whatsapp: true, send_hour: 9,
  stages: ["-3", "-2", "-1", "0", "1", "2", "3", "7", "14", "weekly"],
  templates: {
    before: "Hi {name}, your JMSURF Garage {kind} for {company} ends in {days} {dayword} ({date}). Renew now to keep working without interruption: {link}",
    today: "Hi {name}, your JMSURF Garage {kind} for {company} has expired today. Renew now to get back to work: {link}",
    after: "Hi {name}, your JMSURF Garage {kind} for {company} expired {days} {dayword} ago and the company is locked until you renew. Your records are safe. Renew here: {link}. Need help? {support}",
  },
};

async function api(path: string, body: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`/api/reminders/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify(body),
  }).catch(() => null);
  return res ? res.json().catch(() => ({ ok: false, error: `Server replied ${res.status}` })) : { ok: false, error: "Could not reach the server" };
}

/** Renewal reminders to shops by email, SMS and WhatsApp. */
export default function AdminRemindersPanel() {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<any>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState("");

  useEffect(() => {
    sb.from("platform_settings").select("value").eq("key", "renewal_reminders").maybeSingle().then(({ data }: any) => {
      const v = data?.value || {};
      setCfg({ ...DEFAULTS, ...v, templates: { ...DEFAULTS.templates, ...(v.templates || {}) } });
    });
  }, []);

  const due = useQuery({ queryKey: ["reminders-preview"], queryFn: async () => (await api("preview"))?.rows || [] });
  const log = useQuery({
    queryKey: ["reminders-log"],
    queryFn: async () => {
      const { data } = await sb.from("subscription_reminders").select("id, tenant_id, stage, channel, recipient, status, detail, created_at").order("created_at", { ascending: false }).limit(40);
      const ids = [...new Set((data || []).map((r: any) => r.tenant_id))];
      const { data: t } = ids.length ? await sb.from("tenants").select("id, business_name").in("id", ids) : { data: [] };
      const names = new Map((t || []).map((x: any) => [x.id, x.business_name]));
      return (data || []).map((r: any) => ({ ...r, shop: names.get(r.tenant_id) || "—" }));
    },
  });

  const set = (k: string, v: any) => setCfg((c: any) => ({ ...c, [k]: v }));
  const setTpl = (k: string, v: string) => setCfg((c: any) => ({ ...c, templates: { ...c.templates, [k]: v } }));
  const toggleStage = (id: string) => set("stages", cfg.stages.includes(id) ? cfg.stages.filter((s: string) => s !== id) : [...cfg.stages, id]);

  const save = async () => {
    setSaving(true);
    const value = { ...cfg, send_hour: Math.max(0, Math.min(23, Number(cfg.send_hour) || 9)) };
    const { data: existing } = await sb.from("platform_settings").select("id").eq("key", "renewal_reminders").maybeSingle();
    const { error } = existing
      ? await sb.from("platform_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", "renewal_reminders")
      : await sb.from("platform_settings").insert({ key: "renewal_reminders", value });
    setSaving(false);
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" });
    else toast({ title: "Reminders saved", description: cfg.enabled ? "They go out automatically." : "Automatic sending is off." });
  };

  const sendNow = async (row: any) => {
    setSending(row.tenant_id);
    const channels = ["email", "sms", "whatsapp"].filter((c) => cfg[c]);
    const r = await api("send", { tenant_id: row.tenant_id, channels });
    setSending("");
    log.refetch();
    const parts = Object.entries(r?.results || {}).map(([c, v]: any) => `${c}: ${v.ok ? "sent" : v.error || "failed"}`).join(" · ");
    toast({ title: r?.ok ? `Reminder sent to ${row.shop}` : "Reminder not sent", description: parts || r?.error, variant: r?.ok ? undefined : "destructive" });
  };

  const channelIcon = (c: string) => (c === "email" ? <Mail className="h-3.5 w-3.5" /> : c === "sms" ? <MessageSquare className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Schedule" icon={BellRing} bodyClassName="space-y-4">
          <label className="flex items-center justify-between gap-3">
            <span className="min-w-0"><span className="block font-semibold">Send automatically</span><span className="text-xs text-muted-foreground">To the company's email and phone</span></span>
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={!!cfg.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          </label>
          <div>
            <p className="mb-2 text-sm font-medium">Channels</p>
            <div className="flex flex-wrap gap-2">
              {[["email", "Email", Mail], ["sms", "SMS", MessageSquare], ["whatsapp", "WhatsApp", MessageCircle]].map(([k, l, Icon]: any) => (
                <button key={k} type="button" onClick={() => set(k, !cfg[k])}
                  className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold", cfg[k] ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}>
                  <Icon className="h-3.5 w-3.5" /> {l}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Uses the SMS & WhatsApp keys. SMS: Kenyan numbers only.</p>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">When</p>
            <div className="flex flex-wrap gap-2">
              {STAGES.map((s) => (
                <button key={s.id} type="button" onClick={() => toggleStage(s.id)}
                  className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold", cfg.stages.includes(s.id) ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground")}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <Field label="Send at hour (Nairobi, 24h)" hint="The 'expired' message goes out when the package ends">
            <input className="fi w-28" type="number" min={0} max={23} value={cfg.send_hour} onChange={(e) => set("send_hour", e.target.value)} />
          </Field>
        </Panel>

        <Panel title="Message wording" icon={MessageSquare} bodyClassName="space-y-3">
          <p className="break-words text-[11px] text-muted-foreground">Placeholders: {"{name} {company} {kind} {plan} {days} {dayword} {date} {link} {support}"}</p>
          <Field label="Before it ends"><textarea className="fi" rows={3} value={cfg.templates.before} onChange={(e) => setTpl("before", e.target.value)} /></Field>
          <Field label="On the day it expires"><textarea className="fi" rows={2} value={cfg.templates.today} onChange={(e) => setTpl("today", e.target.value)} /></Field>
          <Field label="After it expired"><textarea className="fi" rows={3} value={cfg.templates.after} onChange={(e) => setTpl("after", e.target.value)} /></Field>
        </Panel>
      </div>
      <Button onClick={save} disabled={saving}>{saving ? <OrbSpinner /> : <Save />} Save reminders</Button>

      <Panel title="Ending soon" icon={BellRing} description="Next 7 days and the last 14." flush
        actions={<Button size="sm" variant="outline" onClick={() => due.refetch()} aria-label="Refresh"><RefreshCw className={due.isFetching ? "animate-spin" : ""} /><span className="hidden sm:inline">Refresh</span></Button>}>
        {due.isLoading ? <p className="p-6 text-sm text-muted-foreground">Loading…</p> : !(due.data || []).length ? <EmptyState icon={BellRing} title="No packages ending around now" className="py-10" /> : (
          <div className="max-h-[420px] overflow-auto">
            <table className="dt">
              <thead><tr><th>Company</th><th>Package</th><th>Ends</th><th>Contact</th><th /></tr></thead>
              <tbody>
                <PagedRows rows={(due.data || [])} colSpan={5}>{(pageRows) => pageRows.map((r: any) => (
                  <tr key={r.tenant_id}>
                    <td><p className="font-medium">{r.shop}</p><p className="font-mono text-[11px] text-muted-foreground">{r.slug}</p></td>
                    <td><span className="text-sm">{r.plan || "—"}</span> <StatusPill status={r.status} /></td>
                    <td className={cn("whitespace-nowrap text-sm", r.days < 0 ? "text-destructive" : r.days <= 3 ? "text-warning" : "")}>
                      {r.days === 0 ? "Today" : r.days > 0 ? `in ${r.days} day${r.days === 1 ? "" : "s"}` : `${-r.days} day${r.days === -1 ? "" : "s"} ago`}
                    </td>
                    <td className="text-xs text-muted-foreground">{r.email ? "Email" : ""}{r.email && r.phone ? " · " : ""}{r.phone ? "Phone" : ""}{!r.email && !r.phone ? "None" : ""}</td>
                    <td className="text-right"><Button size="sm" variant="outline" disabled={!!sending} onClick={() => sendNow(r)}>{sending === r.tenant_id ? <OrbSpinner /> : <Send />} Send now</Button></td>
                  </tr>
                ))}</PagedRows>
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Recently sent" icon={Send} flush>
        {!(log.data || []).length ? <EmptyState title="Nothing sent yet" className="py-8" /> : (
          <div className="max-h-[360px] overflow-auto">
            <table className="dt">
              <thead><tr><th>When</th><th>Company</th><th>Stage</th><th>Channel</th><th>Result</th></tr></thead>
              <tbody>
                <PagedRows rows={(log.data || [])} colSpan={5}>{(pageRows) => pageRows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">{formatDistanceToNowStrict(new Date(r.created_at))} ago</td>
                    <td className="text-sm">{r.shop}</td>
                    <td className="text-xs">{stageLabel(String(r.stage))}</td>
                    <td><span className="inline-flex items-center gap-1 text-xs">{channelIcon(r.channel)} {r.channel}</span></td>
                    <td>{r.status === "sent" ? <Pill tone="success">Sent</Pill> : <span className="text-xs text-destructive" title={r.detail || ""}>{r.detail || r.status}</span>}</td>
                  </tr>
                ))}</PagedRows>
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
