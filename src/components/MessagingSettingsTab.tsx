import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, MessageCircle, Send, Save, Wallet, ExternalLink, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Panel, Field, Segmented, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useMessagingSettings, messagingApi, smsReady, whatsappReady } from "@/lib/messaging";
import { OrbSpinner } from "@/components/orbs";

type Mode = "off" | "platform" | "own";

/** hideSms: JMSURF SMS is in use, so only WhatsApp (and the test) is shown here. */
export default function MessagingSettingsTab({ canManage, hideSms }: { canManage: boolean; hideSms?: boolean }) {
  const { data: m, isLoading } = useMessagingSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [smsMode, setSmsMode] = useState<Mode>("off");
  const [waMode, setWaMode] = useState<Mode>("off");
  const [smsKey, setSmsKey] = useState("");
  const [waKey, setWaKey] = useState("");
  const [sender, setSender] = useState("");
  const [autoSms, setAutoSms] = useState(false);
  const [autoWa, setAutoWa] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState<"" | "sms" | "whatsapp">("");
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!m) return;
    setSmsMode(m.sms_mode); setWaMode(m.wa_mode); setSender(m.sms_sender_id || "");
    setAutoSms(m.auto_receipt_sms); setAutoWa(m.auto_receipt_whatsapp);
  }, [m]);

  const save = async () => {
    setSaving(true);
    const { error } = await (supabase as any).rpc("save_messaging_settings", {
      p_sms_mode: smsMode, p_sms_api_key: smsKey.trim() ? smsKey.trim() : null, p_sms_sender_id: sender,
      p_wa_mode: waMode, p_wa_api_key: waKey.trim() ? waKey.trim() : null,
      p_auto_receipt_sms: autoSms, p_auto_receipt_whatsapp: autoWa,
    });
    setSaving(false);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    setSmsKey(""); setWaKey("");
    qc.invalidateQueries({ queryKey: ["messaging-settings"] });
    toast({ title: "Messaging saved" });
  };

  const test = async (channel: "sms" | "whatsapp") => {
    if (!testTo.trim()) { toast({ title: "Enter a phone number to test with", variant: "destructive" }); return; }
    setTesting(channel);
    const r = await messagingApi("test", { channel, to: testTo });
    setTesting("");
    qc.invalidateQueries({ queryKey: ["messaging-settings"] });
    if (r?.ok) toast({ title: "Test sent", description: `${channel === "sms" ? "SMS" : "WhatsApp"} sent to ${r.to}.${r.sandbox ? " Test key: the provider accepted it but won't deliver it." : ""}` });
    else toast({ title: "Test failed", description: r?.error || "Not sent", variant: "destructive" });
  };

  const checkBalance = async () => {
    setBalance("…");
    const r = await messagingApi("balance", {});
    setBalance(r?.ok ? `${Number(r.balance).toLocaleString()} units${r.sandbox ? " (test key)" : ""}` : r?.error || "Unavailable");
  };

  if (isLoading) return <Panel title="Messaging"><p className="text-sm text-muted-foreground">Loading…</p></Panel>;

  const modeOptions = (platformOk: boolean) => [
    { value: "off", label: "Off" },
    ...(platformOk || (smsMode === "platform") ? [{ value: "platform", label: "JMSURF account" }] : []),
    { value: "own", label: "My own account" },
  ];

  return (
    <div className="space-y-6">
      {!hideSms && <Panel icon={MessageSquare} title="SendBulkSMS" description="Send receipts, statements and reminders by SMS through your own SendBulkSMS account (Kenyan numbers)."
        actions={smsReady(m) ? <Pill tone="success">Ready</Pill> : <Pill>Not set up</Pill>}>
        <div className="space-y-4">
          <Segmented value={smsMode} onChange={(v) => setSmsMode(v as Mode)} options={modeOptions(!!m?.platform_sms_available) as any} />
          {smsMode === "platform" && (
            <div className="rounded-xl bg-muted/60 p-4 text-sm">
              <p>Messages go out through JMSURF's SMS account. Each SMS part uses one prepaid unit.</p>
              <p className="mt-2 flex items-center gap-2 font-semibold"><Wallet className="h-4 w-4 text-primary" /> {Number(m?.sms_units || 0).toLocaleString()} units left</p>
              <p className="mt-1 text-xs text-muted-foreground">To buy more units, contact JMSURF support.</p>
            </div>
          )}
          {smsMode === "own" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SendBulkSMS API key" hint={m?.has_sms_key ? "A key is saved. Leave empty to keep it." : "Starts with bsms_live_"}>
                <input className="fi font-mono" type="password" autoComplete="off" value={smsKey} onChange={(e) => setSmsKey(e.target.value)} placeholder={m?.has_sms_key ? "••••••••••" : "bsms_live_…"} disabled={!canManage} />
              </Field>
              <Field label="Sender ID (optional)" hint="Your approved sender name, up to 11 characters">
                <input className="fi" maxLength={11} value={sender} onChange={(e) => setSender(e.target.value)} placeholder="MYSHOP" disabled={!canManage} />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <a href="https://sendbulksms.co.ke" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Get a SendBulkSMS account <ExternalLink className="h-3 w-3" /></a>
                {m?.has_sms_key && <button type="button" onClick={checkBalance} className="text-xs font-medium text-primary hover:underline">Check balance</button>}
                {balance && <span className="text-xs text-muted-foreground">{balance}</span>}
              </div>
            </div>
          )}
          {smsMode !== "off" && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={autoSms} onChange={(e) => setAutoSms(e.target.checked)} disabled={!canManage} /> Send the receipt by SMS automatically after each sale (when the customer has a phone number)</label>
          )}
        </div>
      </Panel>}

      <Panel icon={MessageCircle} title="WhatsApp" description="Send receipts and statements from a WhatsApp number through APIWAP. Works for any country."
        actions={whatsappReady(m) ? <Pill tone="success">Ready</Pill> : <Pill>Not set up</Pill>}>
        <div className="space-y-4">
          <Segmented value={waMode} onChange={(v) => setWaMode(v as Mode)} options={modeOptions(!!m?.platform_wa_available) as any} />
          {waMode === "platform" && <p className="rounded-xl bg-muted/60 p-4 text-sm">Messages go out from JMSURF's WhatsApp number.</p>}
          {waMode === "own" && (
            <div className="space-y-3">
              <Field label="APIWAP API key" hint={m?.has_wa_key ? "A key is saved. Leave empty to keep it." : "From your APIWAP dashboard, after linking your company's WhatsApp number"}>
                <input className="fi font-mono" type="password" autoComplete="off" value={waKey} onChange={(e) => setWaKey(e.target.value)} placeholder={m?.has_wa_key ? "••••••••••" : "Paste your API key"} disabled={!canManage} />
              </Field>
              <a href="https://apiwap.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Get an APIWAP account <ExternalLink className="h-3 w-3" /></a>
            </div>
          )}
          {waMode !== "off" && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={autoWa} onChange={(e) => setAutoWa(e.target.checked)} disabled={!canManage} /> Send the receipt on WhatsApp automatically after each sale (when the customer has a phone number)</label>
          )}
          <p className="text-xs text-muted-foreground">When WhatsApp or SMS is off, the WhatsApp and SMS buttons on receipts still work: they open the message on your device for you to send.</p>
        </div>
      </Panel>

      {canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={saving}>{saving ? <OrbSpinner /> : <Save />} Save messaging</Button>
        </div>
      )}

      {canManage && (smsReady(m) || whatsappReady(m)) && (
        <Panel icon={CheckCircle2} title="Send a test" description="Save first, then send a test to your own phone.">
          <div className="flex flex-wrap gap-2">
            <input className="fi min-w-[180px] flex-1" inputMode="tel" placeholder="07XX XXX XXX or +234…" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            {smsReady(m) && <Button variant="outline" onClick={() => test("sms")} disabled={!!testing}>{testing === "sms" ? <OrbSpinner /> : <Send />} Test SMS</Button>}
            {whatsappReady(m) && <Button variant="outline" onClick={() => test("whatsapp")} disabled={!!testing}>{testing === "whatsapp" ? <OrbSpinner /> : <MessageCircle />} Test WhatsApp</Button>}
          </div>
        </Panel>
      )}
    </div>
  );
}
