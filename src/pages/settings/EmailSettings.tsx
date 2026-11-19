/**
 * System → Email: how the company's email goes out (JMSURF's mail server, or
 * its own provider with ready presets), who replies reach, copies, and a test.
 */
import { BrandLogo } from "@/components/BrandLogo";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Send, Save, Server, Sparkles, Reply, Info, CheckCircle2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessSettings } from "@/hooks/useData";
import { useErpSettings } from "@/pages/settings/ErpSettingsTabs";
import { Panel, Field, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Enc = "tls" | "ssl" | "none";
type Preset = { key: string; name: string; host: string; port: string; enc: Enc; user?: string; tip: string };
const PRESETS: Preset[] = [
  { key: "google", name: "Google Workspace / Gmail", host: "smtp.gmail.com", port: "587", enc: "tls", user: "Your full email address", tip: "Turn on 2-step verification, then create an App password (Google Account → Security → App passwords) and use it as the password." },
  { key: "microsoft", name: "Microsoft 365 / Outlook", host: "smtp.office365.com", port: "587", enc: "tls", user: "Your full email address", tip: "Your admin may need to allow \"Authenticated SMTP\" for this mailbox in the Microsoft 365 admin centre." },
  { key: "cpanel", name: "My website host (cPanel)", host: "mail.yourdomain.co.ke", port: "465", enc: "ssl", user: "Your full email address", tip: "Use the mailbox you created in cPanel → Email Accounts. The host is usually mail.<your domain>." },
  { key: "yahoo", name: "Yahoo Mail", host: "smtp.mail.yahoo.com", port: "465", enc: "ssl", user: "Your full email address", tip: "Create an app password in Yahoo Account Security and use it here." },
  { key: "ses", name: "Amazon SES", host: "email-smtp.eu-west-1.amazonaws.com", port: "587", enc: "tls", user: "SMTP username from SES", tip: "Verify your domain in SES, then create SMTP credentials. Change the region in the host to yours." },
  { key: "sendgrid", name: "SendGrid", host: "smtp.sendgrid.net", port: "587", enc: "tls", user: "apikey", tip: "The username is literally \"apikey\"; the password is your SendGrid API key." },
  { key: "mailgun", name: "Mailgun", host: "smtp.mailgun.org", port: "587", enc: "tls", user: "postmaster@your-domain", tip: "Use the SMTP credentials of your Mailgun sending domain." },
  { key: "brevo", name: "Brevo", host: "smtp-relay.brevo.com", port: "587", enc: "tls", user: "Your Brevo login", tip: "Use the SMTP key from Brevo → SMTP & API as the password." },
  { key: "postmark", name: "Postmark", host: "smtp.postmarkapp.com", port: "587", enc: "tls", user: "Server API token", tip: "Username and password are both your Postmark server API token." },
  { key: "mailjet", name: "Mailjet", host: "in-v3.mailjet.com", port: "587", enc: "tls", user: "API key", tip: "Username is the API key, password is the secret key." },
  { key: "custom", name: "Other server", host: "", port: "587", enc: "tls", tip: "Any mail server that accepts SMTP sign-in." },
];

/** Kinds of email a company sends, each with its own sender (System → Email → Who sends what). */
const SENDERS: [string, string, string, string][] = [
  ["quotes", "Quotes and sales orders", "Quotations, estimates, sales orders", "sales@yourdomain.co.ke"],
  ["invoices", "Invoices and receipts", "Invoices, credit notes, payment receipts", "accounts@yourdomain.co.ke"],
  ["statements", "Customer statements", "Monthly and on-request statements", "accounts@yourdomain.co.ke"],
  ["reminders", "Payment reminders", "Overdue and due-soon reminders", "accounts@yourdomain.co.ke"],
  ["purchasing", "Purchasing", "Purchase orders, requests for quotation, requisitions", "procurement@yourdomain.co.ke"],
  ["payroll", "Payslips", "Payslips to staff", "hr@yourdomain.co.ke"],
  ["other", "Everything else", "Alerts, notices and all other emails", "info@yourdomain.co.ke"],
];

export default function EmailSettings({ canManage }: { canManage: boolean }) {
  const { profile } = useAuth() as any;
  const qc = useQueryClient();
  const { data: settings } = useBusinessSettings();
  const { settings: erp, save: saveErp } = useErpSettings();
  const s = settings as any;
  const [mode, setMode] = useState<"jmsurf" | "own">("jmsurf");
  const [preset, setPreset] = useState("custom");
  const [f, setF] = useState({ host: "", port: "587", username: "", password: "", from_email: "", from_name: "", enc: "tls" as Enc });
  const [extra, setExtra] = useState({ reply_to: "", bcc: "", from_name: "" });
  const [senders, setSenders] = useState<Record<string, { email: string; name: string }>>({});
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!s) return;
    setMode(s.use_platform_smtp || !s.smtp_host ? "jmsurf" : "own");
    setF({ host: s.smtp_host || "", port: String(s.smtp_port || "587"), username: s.smtp_username || "", password: "", from_email: s.smtp_from_email || "", from_name: s.smtp_from_name || "", enc: (s.smtp_encryption || "tls") as Enc });
    setPreset(PRESETS.find((p) => p.host && p.host === s.smtp_host)?.key || (s.smtp_host ? "custom" : "google"));
  }, [s]);
  useEffect(() => { const e = erp.email || {}; setExtra({ reply_to: e.reply_to || "", bcc: e.bcc || "", from_name: e.from_name || "" }); setSenders(e.senders || {}); }, [erp.email]);
  useEffect(() => { if (!testTo && profile?.email) setTestTo(profile.email); }, [profile?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = PRESETS.find((x) => x.key === preset) || PRESETS[PRESETS.length - 1];
  const pick = (k: string) => {
    const x = PRESETS.find((y) => y.key === k)!;
    setPreset(k);
    if (x.key !== "custom") setF((v) => ({ ...v, host: x.host, port: x.port, enc: x.enc }));
  };

  const save = async () => {
    if (!s?.id) return toast.error("Save the business details first (System → Business settings)");
    setSaving(true);
    const payload: any = { use_platform_smtp: mode === "jmsurf" };
    if (mode === "own") {
      Object.assign(payload, { smtp_host: f.host.trim(), smtp_port: f.port.trim(), smtp_username: f.username.trim(), smtp_from_email: (f.from_email || f.username).trim(), smtp_from_name: f.from_name.trim(), smtp_encryption: f.enc });
      if (f.password.trim()) payload.smtp_password = f.password;
    }
    const { error } = await (supabase as any).from("business_settings").update(payload).eq("id", s.id);
    const bad = Object.entries(senders).find(([, v]) => v?.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()));
    if (bad) { setSaving(false); return toast.error(`Check the address for ${SENDERS.find((x) => x[0] === bad[0])?.[1] || bad[0]}`); }
    const cleanSenders = Object.fromEntries(Object.entries(senders).map(([k, v]) => [k, { email: (v?.email || "").trim(), name: (v?.name || "").trim() }]).filter(([, v]: any) => v.email || v.name));
    const r2 = await saveErp("email", { reply_to: extra.reply_to.trim(), bcc: extra.bcc.trim(), from_name: extra.from_name.trim(), senders: cleanSenders });
    setSaving(false);
    if (error || r2.error) return toast.error((error || r2.error).message);
    setF((v) => ({ ...v, password: "" }));
    qc.invalidateQueries({ queryKey: ["business-settings"] });
    toast.success("Email settings saved");
  };

  const test = async () => {
    if (!testTo.trim()) return toast.error("Enter an address to send the test to");
    setTesting(true); setLast(null);
    const { data: { session } } = await supabase.auth.getSession();
    let data: any;
    try {
      const res = await fetch("/api/email/tenant-test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ to: testTo.trim(), use_platform: mode === "jmsurf", smtp: mode === "jmsurf" ? null : { host: f.host, port: f.port, username: f.username, password: f.password, from_email: f.from_email || f.username, from_name: f.from_name, encryption: f.enc } }),
      });
      data = await res.json().catch(() => ({ ok: false, error: `Server replied ${res.status}` }));
    } catch (e: any) { data = { ok: false, error: e?.message || "Could not reach the mail service" }; }
    setTesting(false);
    setLast(data?.ok ? { ok: true, text: `Sent to ${testTo} through ${data.via === "shop" ? "your mail server" : "JMSURF's mail server"}. Check the inbox (and spam).` } : { ok: false, text: data?.error || "The email was not sent" });
  };

  const choice = (on: boolean) => cn("flex flex-1 items-start gap-3 rounded-2xl border-2 p-4 text-left transition-all", on ? "border-primary bg-primary/5" : "border-border hover:border-primary/40");
  return (
    <div className="space-y-5">
      <Panel title="How email is sent" icon={Mail} description="Invoices, quotes, statements, receipts, reminders and alerts all use this.">
        <div className="flex flex-col gap-3 md:flex-row">
          <button type="button" disabled={!canManage} onClick={() => setMode("jmsurf")} className={choice(mode === "jmsurf")}>
            <Sparkles className={cn("mt-0.5 h-5 w-5 shrink-0", mode === "jmsurf" ? "text-primary" : "text-muted-foreground")} />
            <span><span className="block font-semibold">JMSURF mail server</span><span className="block text-sm text-muted-foreground">No setup. Emails carry your company name, and replies come to your reply-to address below.</span></span>
          </button>
          <button type="button" disabled={!canManage} onClick={() => setMode("own")} className={choice(mode === "own")}>
            <Server className={cn("mt-0.5 h-5 w-5 shrink-0", mode === "own" ? "text-primary" : "text-muted-foreground")} />
            <span><span className="block font-semibold">My own email provider</span><span className="block text-sm text-muted-foreground">Send from your own domain (Google, Microsoft, your host or a sending service). Best delivery and branding.</span></span>
          </button>
        </div>
      </Panel>

      {mode === "own" && (
        <Panel title="Your email provider" icon={Server} actions={s?.smtp_host && !s?.use_platform_smtp ? <Pill tone="success"><CheckCircle2 className="h-3 w-3" /> Saved</Pill> : undefined}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((x) => (
                <button key={x.key} type="button" disabled={!canManage} onClick={() => pick(x.key)}
                  className={cn("inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm font-medium transition-colors", preset === x.key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}><BrandLogo id={x.key} name={x.name} className="h-7 w-7 rounded-full" />{x.name}</button>
              ))}
            </div>
            <p className="flex gap-2 rounded-xl bg-info/10 px-3 py-2.5 text-sm"><Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />{p.tip}</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Server (host)" className="lg:col-span-2"><input className="fi font-mono" value={f.host} placeholder="Enter SMTP server" onChange={(e) => setF({ ...f, host: e.target.value })} disabled={!canManage} /></Field>
              <Field label="Port"><input className="fi" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} disabled={!canManage} /></Field>
              <Field label="Security"><select className="fi" value={f.enc} onChange={(e) => setF({ ...f, enc: e.target.value as Enc })} disabled={!canManage}><option value="tls">STARTTLS (587)</option><option value="ssl">SSL/TLS (465)</option><option value="none">None (not recommended)</option></select></Field>
              <Field label="Username" hint={p.user} className="lg:col-span-2"><input className="fi" autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} disabled={!canManage} /></Field>
              <Field label="Password" hint={s?.has_smtp_password ? "Saved. Leave empty to keep it." : "Stored on the server, never shown again."} className="lg:col-span-2"><input className="fi" type="password" autoComplete="new-password" value={f.password} placeholder={s?.has_smtp_password ? "••••••••" : ""} onChange={(e) => setF({ ...f, password: e.target.value })} disabled={!canManage} /></Field>
              <Field label="Send from address" hint="Must be allowed by your provider" className="lg:col-span-2"><input className="fi" type="email" value={f.from_email} placeholder={f.username || "invoices@yourdomain.co.ke"} onChange={(e) => setF({ ...f, from_email: e.target.value })} disabled={!canManage} /></Field>
              <Field label="Sender name" className="lg:col-span-2"><input className="fi" value={f.from_name} placeholder={s?.business_name || "Your company"} onChange={(e) => setF({ ...f, from_name: e.target.value })} disabled={!canManage} /></Field>
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />For the best inbox placement, add your provider's SPF and DKIM records to your domain's DNS.</p>
          </div>
        </Panel>
      )}

      <Panel title="Who sends what" icon={Mail} description={mode === "own" ? "The address each kind of email is sent from. Your provider must allow sending from these addresses (e.g. aliases on the same mailbox). Leave empty to use the default above." : "With the JMSURF mail server, emails come from JMSURF's address with your company name, and replies go to the address set here for that kind of email. To send from your own addresses (for example accounts@yourcompany.com), choose \"My own email provider\" above and sign in with that mailbox."}>
        <div className="overflow-x-auto">
          <table className="dt-phone dt-stack w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Emails</th><th className="py-2 pr-3">{mode === "own" ? "Send from address" : "Replies go to"}</th><th className="py-2">Sender name</th></tr></thead>
            <tbody>{SENDERS.map(([k, label, hint, ph]) => (
              <tr key={k} className="border-t border-border">
                <td className="py-2 pr-3"><span className="font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></td>
                <td className="py-2 pr-3"><input className="fi" type="email" value={senders[k]?.email || ""} placeholder={ph} disabled={!canManage} onChange={(e) => setSenders({ ...senders, [k]: { email: e.target.value, name: senders[k]?.name || "" } })} /></td>
                <td className="py-2"><input className="fi" value={senders[k]?.name || ""} placeholder={(mode === "own" ? f.from_name : extra.from_name) || s?.business_name || "Your company"} disabled={!canManage} onChange={(e) => setSenders({ ...senders, [k]: { email: senders[k]?.email || "", name: e.target.value } })} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Replies and copies" icon={Reply}>
        <div className="grid gap-4 sm:grid-cols-3">
          {mode === "jmsurf" && <Field label="Sender name" hint="Shown as who the email is from"><input className="fi" value={extra.from_name} placeholder={s?.business_name || "Your company"} onChange={(e) => setExtra({ ...extra, from_name: e.target.value })} disabled={!canManage} /></Field>}
          <Field label="Replies go to" hint={`Default: ${s?.business_email || "your business email"}`}><input className="fi" type="email" value={extra.reply_to} placeholder={s?.business_email || "accounts@yourdomain.co.ke"} onChange={(e) => setExtra({ ...extra, reply_to: e.target.value })} disabled={!canManage} /></Field>
          <Field label="Send a copy of every email to" hint="Up to 3 addresses, separated by commas"><input className="fi" value={extra.bcc} placeholder="Enter email address" onChange={(e) => setExtra({ ...extra, bcc: e.target.value })} disabled={!canManage} /></Field>
        </div>
      </Panel>

      <Panel title="Send a test" icon={Send} description="Uses the settings on this screen, saved or not.">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="fi flex-1" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Enter email address" />
          <Button variant="outline" onClick={() => void test()} disabled={testing}><Send /> {testing ? "Sending…" : "Send test"}</Button>
        </div>
        {last && <p className={cn("mt-3 rounded-xl px-3 py-2 text-sm", last.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>{last.text}</p>}
      </Panel>

      {canManage && <div className="sticky bottom-3 z-10 flex justify-end"><Button onClick={() => void save()} disabled={saving} className="shadow-lg"><Save /> {saving ? "Saving…" : "Save email settings"}</Button></div>}
    </div>
  );
}
