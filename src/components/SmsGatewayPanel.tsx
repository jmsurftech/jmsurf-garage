/**
 * Another SMS gateway with the company's own account (SendBulkSMS, Africa's
 * Talking, Twilio, Infobip, Advanta, Celcom Africa), and which gateway sends.
 * JMSURF SMS is the default whenever it is connected.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Radio, Save, ExternalLink, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel, Field, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useMessagingSettings } from "@/lib/messaging";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/BrandLogo";
import { toast } from "sonner";

type Provider = "sendbulksms" | "africastalking" | "twilio" | "infobip" | "advanta" | "celcom";
const PROVIDERS: { key: Provider; name: string; where: string; account?: string; accountHint?: string; key_label: string; sender: string; url: string }[] = [
  { key: "sendbulksms", name: "SendBulkSMS", where: "Kenya", key_label: "API key (bsms_live_…)", sender: "Sender ID (optional)", url: "https://sendbulksms.co.ke" },
  { key: "africastalking", name: "Africa's Talking", where: "Kenya and across Africa", account: "Username", accountHint: "Your app's username (\"sandbox\" for testing)", key_label: "API key", sender: "Sender ID or short code (optional)", url: "https://africastalking.com" },
  { key: "twilio", name: "Twilio", where: "Worldwide", account: "Account SID", accountHint: "Starts with AC", key_label: "Auth Token", sender: "From number or Messaging Service SID (MG…)", url: "https://www.twilio.com" },
  { key: "infobip", name: "Infobip", where: "Worldwide", account: "Base URL", accountHint: "e.g. xxxxx.api.infobip.com", key_label: "API key", sender: "Sender (optional)", url: "https://www.infobip.com" },
  { key: "advanta", name: "Advanta", where: "Kenya", account: "Partner ID", key_label: "API key", sender: "Sender ID (short code)", url: "https://www.advantasms.com" },
  { key: "celcom", name: "Celcom Africa", where: "Kenya", account: "Partner ID", key_label: "API key", sender: "Sender ID (short code)", url: "https://celcomafrica.com" },
];

export default function SmsGatewayPanel({ canManage }: { canManage: boolean }) {
  const { data: m } = useMessagingSettings() as { data: any };
  const qc = useQueryClient();
  const [provider, setProvider] = useState<Provider>("sendbulksms");
  const [account, setAccount] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [sender, setSender] = useState("");
  const [preferred, setPreferred] = useState<"jmsurf" | "own">("jmsurf");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!m) return;
    setProvider((m.sms_provider || "sendbulksms") as Provider); setAccount(m.sms_account || ""); setSender(m.sms_sender_id || "");
    setPreferred(m.sms_preferred === "own" ? "own" : "jmsurf"); setEnabled(m.sms_mode === "own");
  }, [m]);
  const p = PROVIDERS.find((x) => x.key === provider)!;
  const sameProvider = (m?.sms_provider || "sendbulksms") === provider;
  const keySaved = !!m?.has_sms_key && sameProvider && m?.sms_mode === "own";
  const save = async () => {
    setBusy(true);
    const { error } = await (supabase as any).rpc("save_sms_gateway", { p_provider: provider, p_account: account, p_api_key: apiKey.trim() || null, p_sender_id: sender, p_preferred: preferred, p_enabled: true });
    setBusy(false);
    if (error) return toast.error(error.message);
    setApiKey("");
    ["messaging-settings", "messaging-settings-mode"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    toast.success("SMS gateway saved");
  };
  const sending = !m?.has_jmsurf_sms ? (keySaved ? p.name : "JMSURF SMS (prepaid credit)") : preferred === "own" && keySaved ? p.name : "JMSURF SMS";

  return (
    <Panel title="Other SMS gateway" icon={Radio} description="Use your own account with another provider. JMSURF SMS stays the default; switch to your gateway only if you prefer it."
      actions={keySaved ? <Pill tone="success"><CheckCircle2 className="h-3 w-3" /> {p.name}</Pill> : <Pill>Not in use</Pill>}>
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {PROVIDERS.map((x) => (
            <button key={x.key} type="button" disabled={!canManage} onClick={() => setProvider(x.key)}
              className={cn("rounded-xl border-2 p-3 text-left transition-all", provider === x.key ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
              <span className="flex items-center gap-2.5"><BrandLogo id={x.key} name={x.name} className="h-9 w-9" />
                <span className="min-w-0"><span className="block text-sm font-semibold">{x.name}</span><span className="block text-xs text-muted-foreground">{x.where}</span></span></span>
            </button>
          ))}
        </div>
        {(
          <div className="grid gap-4 sm:grid-cols-2">
            {p.account && <Field label={p.account} hint={p.accountHint}><input className="fi font-mono" value={account} onChange={(e) => setAccount(e.target.value)} disabled={!canManage} /></Field>}
            <Field label={p.key_label} hint={keySaved ? "Saved. Leave empty to keep it." : "Stored on the server, never shown again."}>
              <input className="fi font-mono" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={keySaved ? "••••••••••" : ""} disabled={!canManage} />
            </Field>
            <Field label={p.sender}><input className="fi" maxLength={15} value={sender} onChange={(e) => setSender(e.target.value)} disabled={!canManage} /></Field>
            <div className="flex items-end"><a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 pb-2 text-xs font-medium text-primary hover:underline">Open {p.name} <ExternalLink className="h-3 w-3" /></a></div>
          </div>
        )}
        {m?.has_jmsurf_sms && (
          <Field label="Which gateway sends">
            <div className="flex flex-wrap gap-2">
              {([["jmsurf", "JMSURF SMS (default)"], ["own", p.name]] as const).map(([v, l]) => (
                <button key={v} type="button" disabled={!canManage} onClick={() => setPreferred(v)} className={cn("rounded-full border px-3 py-1.5 text-sm font-medium", preferred === v ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>{l}</button>
              ))}
            </div>
          </Field>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-sm text-muted-foreground">SMS now goes out through <b className="text-foreground">{sending}</b>.</p>
          <span className="flex gap-2">
            {canManage && keySaved && <Button variant="ghost" className="text-destructive" disabled={busy} onClick={async () => { setBusy(true); const { error } = await (supabase as any).rpc("save_sms_gateway", { p_provider: provider, p_account: account, p_api_key: null, p_sender_id: sender, p_preferred: "jmsurf", p_enabled: false }); setBusy(false); if (error) toast.error(error.message); else { ["messaging-settings", "messaging-settings-mode"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success("Gateway disconnected"); } }}>Disconnect</Button>}
            {canManage && <Button onClick={() => void save()} disabled={busy || (!sameProvider || !keySaved ? !apiKey.trim() : false)}><Save /> {keySaved ? "Save" : "Connect"}</Button>}
          </span>
        </div>
      </div>
    </Panel>
  );
}
