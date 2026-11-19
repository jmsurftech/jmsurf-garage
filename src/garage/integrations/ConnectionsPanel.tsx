import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Smartphone, MessageSquare, MessageCircle, ShieldCheck, Headset, Copy, Loader2, CheckCircle2, AlertTriangle, PlugZap, ExternalLink, KeyRound, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel, Field, Pill, Segmented } from "@/components/kit";
import { toast } from "sonner";
import { garageI, openCallCentre, type ConnectionStatus } from "./api";

const sb = supabase as any;
const copy = (v: string) => { void navigator.clipboard?.writeText(v); toast.success("Copied"); };
function State({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return ok ? <Pill tone="success"><CheckCircle2 className="h-3 w-3" /> {on}</Pill> : <Pill tone="warning">{off}</Pill>;
}
function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
      <span className="shrink-0 font-semibold">{label}</span>
      <code className="min-w-0 flex-1 truncate">{value}</code>
      <button type="button" onClick={() => copy(value)} className="rounded p-1 hover:bg-muted" aria-label={`Copy ${label}`}><Copy className="h-3.5 w-3.5" /></button>
    </div>
  );
}
const Btn = ({ onClick, busy, children, primary, disabled }: { onClick: () => void; busy?: boolean; children: ReactNode; primary?: boolean; disabled?: boolean }) => (
  <button type="button" onClick={onClick} disabled={busy || disabled}
    className={primary ? "inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      : "inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"}>
    {busy && <Loader2 className="h-4 w-4 animate-spin" />}{children}
  </button>
);

/**
 * System → Connections: every outside service the company uses, each with its state.
 * M-Pesa (JMSURF PAY or the company's own Daraja app), SMS, WhatsApp, KRA eTIMS, Call Centre.
 */
export default function ConnectionsPanel({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["garage-connections"], staleTime: 30_000, queryFn: () => garageI<ConnectionStatus>("status") });
  const s = status.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["garage-connections"] });
  if (status.isLoading) return <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!s || (s as any).ok === false) return <p className="text-sm text-destructive">{(s as any)?.error || "Could not load the connections."}</p>;
  return (
    <div className="space-y-4">
      <MpesaSection s={s} canManage={canManage} refresh={refresh} />
      <SmsSection s={s} />
      <WhatsAppSection s={s} canManage={canManage} refresh={refresh} />
      <EtimsSection s={s} />
      <CallCentreSection s={s} canManage={canManage} refresh={refresh} />
    </div>
  );
}

// ---------------------------------------------------------------- M-Pesa

function MpesaSection({ s, canManage, refresh }: { s: ConnectionStatus; canManage: boolean; refresh: () => void }) {
  const d = s.mpesa.daraja;
  const [mode, setMode] = useState<"jmsurf" | "daraja">(s.mpesa.provider === "daraja" ? "daraja" : "jmsurf");
  const [f, setF] = useState({ type: d.type, shortcode: d.shortcode || "", till_number: d.till_number || "", environment: d.environment, account_reference: d.account_reference || "", consumer_key: "", consumer_secret: "", passkey: "" });
  const [busy, setBusy] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const run = async (key: string, path: string, body: Record<string, unknown> = {}) => {
    setBusy(key);
    const r = await garageI(path, body);
    setBusy("");
    if (r.ok === false || r.error) toast.error(r.error || "That did not work");
    refresh();
    return r;
  };
  const save = async () => {
    const r = await run("save", "daraja/save", f);
    if (r.ok) {
      setF((x) => ({ ...x, consumer_key: "", consumer_secret: "", passkey: "" }));
      if ((r as any).keys_ok) toast.success("Saved. Safaricom accepted your keys and M-Pesa prompts now use your own Daraja app.");
      else toast.warning(`Saved, but Safaricom did not accept the keys: ${(r as any).check_error || "check them"}`);
    }
  };
  const active = s.mpesa.provider;
  return (
    <Panel title="M-Pesa" icon={Smartphone} description="How customers pay invoices, job cards and the till by M-Pesa."
      actions={<State ok={active === "daraja" ? d.connected : s.mpesa.jmsurf.connected} on={active === "daraja" ? "Own Daraja app" : "JMSURF PAY"} off="Not set up" />}>
      <div className="space-y-4">
        <Segmented value={mode} onChange={setMode} options={[{ value: "jmsurf", label: "JMSURF PAY (recommended)" }, { value: "daraja", label: "My own Daraja app" }]} />
        {mode === "jmsurf" ? (
          <div className="space-y-2 text-sm">
            {s.mpesa.jmsurf.connected
              ? <p className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" /> Payments go to {s.mpesa.jmsurf.destination_type === "till" ? `Till ${s.mpesa.jmsurf.account_number}` : `${s.mpesa.jmsurf.destination_type === "bank" ? "bank paybill" : "Paybill"} ${s.mpesa.jmsurf.business_number}, account ${s.mpesa.jmsurf.account_number}`} ({s.mpesa.jmsurf.account_name}).</p>
              : <p className="text-muted-foreground">Enter your Till, Paybill or bank account once. No keys or codes are needed: JMSURF PAY sets everything up.</p>}
            <Link to="/settings?tab=payments" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"><PlugZap className="h-4 w-4" /> {s.mpesa.jmsurf.connected ? "Change where money goes" : "Connect JMSURF PAY"}</Link>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Use your own Safaricom Daraja app (developer.safaricom.co.ke): the M-Pesa prompt shows your business, money goes straight to your paybill or till, and payments customers make themselves with the invoice number as the account are marked paid automatically.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Type">
                <select className="fi" value={f.type} disabled={!canManage} onChange={(e) => setF((x) => ({ ...x, type: e.target.value as "paybill" | "till" }))}>
                  <option value="paybill">Paybill</option><option value="till">Till (Buy Goods)</option>
                </select>
              </Field>
              <Field label="Environment">
                <select className="fi" value={f.environment} disabled={!canManage} onChange={(e) => setF((x) => ({ ...x, environment: e.target.value as "live" | "sandbox" }))}>
                  <option value="live">Live (production)</option><option value="sandbox">Sandbox (testing)</option>
                </select>
              </Field>
              {f.type === "paybill" ? <>
                <Field label="Paybill number"><input className="fi font-mono" inputMode="numeric" maxLength={7} value={f.shortcode} onChange={set("shortcode")} disabled={!canManage} placeholder="Enter your paybill number" /></Field>
                <Field label="Account on the prompt (optional)" hint="Leave empty to use the invoice number."><input className="fi" maxLength={12} value={f.account_reference} onChange={set("account_reference")} disabled={!canManage} placeholder="Enter a fixed account name" /></Field>
              </> : <>
                <Field label="Till number"><input className="fi font-mono" inputMode="numeric" maxLength={7} value={f.till_number} onChange={set("till_number")} disabled={!canManage} placeholder="Enter your till number" /></Field>
                <Field label="Store number (optional)" hint="The head office number your passkey belongs to, if it differs from the till."><input className="fi font-mono" inputMode="numeric" maxLength={7} value={f.shortcode} onChange={set("shortcode")} disabled={!canManage} placeholder="Enter the store number" /></Field>
              </>}
              <Field label="Consumer key"><input className="fi" type="password" autoComplete="off" value={f.consumer_key} onChange={set("consumer_key")} disabled={!canManage} placeholder={d.keys_saved ? "Saved (leave empty to keep)" : "Enter the consumer key"} /></Field>
              <Field label="Consumer secret"><input className="fi" type="password" autoComplete="off" value={f.consumer_secret} onChange={set("consumer_secret")} disabled={!canManage} placeholder={d.keys_saved ? "Saved (leave empty to keep)" : "Enter the consumer secret"} /></Field>
              <Field label="Lipa na M-Pesa passkey" className="sm:col-span-2"><input className="fi" type="password" autoComplete="off" value={f.passkey} onChange={set("passkey")} disabled={!canManage} placeholder={d.keys_saved ? "Saved (leave empty to keep)" : "Enter the passkey"} /></Field>
            </div>
            <p className="text-xs text-muted-foreground">Keys are encrypted on the server and never shown again. Payouts (B2C) stay off.</p>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Btn primary busy={busy === "save"} onClick={() => void save()}>{d.connected ? "Save" : "Save and use my Daraja app"}</Btn>
                <Btn busy={busy === "test"} disabled={!d.keys_saved} onClick={async () => { const r = await run("test", "daraja/test"); if (r.ok) toast.success("Safaricom accepted your keys"); }}>Check keys</Btn>
              </div>
            )}
            <div className="space-y-2 rounded-2xl border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b className="text-sm">Payments customers make themselves (C2B)</b>
                <State ok={!!d.c2b_registered_at} on="Registered" off="Not registered" />
              </div>
              <p className="text-xs text-muted-foreground">Register once so Safaricom tells JMSURF Garage about every payment to your {d.type === "till" ? "till" : "paybill (customers enter the invoice number as the account)"}.</p>
              {d.c2b_note && <p className="flex items-start gap-1.5 text-xs text-[hsl(32_90%_38%)]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {d.c2b_note}</p>}
              {d.c2b_urls && <><CopyRow label="Confirmation" value={d.c2b_urls.confirm} /><CopyRow label="Validation" value={d.c2b_urls.validate} /></>}
              {canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  <Btn busy={busy === "c2b"} disabled={!d.connected} onClick={async () => { const r = await run("c2b", "daraja/register-c2b", { validation: d.c2b_validation }); if (r.ok) toast.success("Registered with Safaricom"); }}>Register with Safaricom</Btn>
                  {d.type === "paybill" && (
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={d.c2b_validation === "strict"} onChange={(e) => void run("c2b", "daraja/register-c2b", { validation: e.target.checked ? "strict" : "all" })} />
                      Refuse payments whose account is not an open invoice (needs External Validation switched on by Safaricom)
                    </label>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        {s.mpesa.unmatched_payments > 0 && <UnmatchedPayments canManage={canManage} refresh={refresh} />}
      </div>
    </Panel>
  );
}

function UnmatchedPayments({ canManage, refresh }: { canManage: boolean; refresh: () => void }) {
  const list = useQuery({
    queryKey: ["garage-c2b-unmatched"],
    queryFn: async () => (await sb.from("garage_mpesa_c2b").select("id,trans_id,amount,account_ref,msisdn,payer_name,trans_time,status,note").in("status", ["unmatched", "review"]).order("created_at", { ascending: false }).limit(50)).data || [],
  });
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const apply = async (id: string) => {
    const num = (numbers[id] || "").trim();
    const { data: inv } = await sb.from("invoices").select("id").eq("invoice_number", num).maybeSingle();
    if (!inv) { toast.error("No invoice with that number"); return; }
    const r = await garageI("c2b/apply", { id, invoice_id: inv.id });
    if (r.ok === false) toast.error(r.error || "Not applied"); else toast.success("Payment applied");
    void list.refetch(); refresh();
  };
  return (
    <div className="space-y-2 rounded-2xl border border-warning/30 bg-warning/5 p-3">
      <b className="text-sm">Payments to match</b>
      {(list.data || []).map((p: any) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 flex-1">{p.payer_name || "Customer"} · KES {Number(p.amount).toLocaleString("en-KE")} · {p.trans_id}{p.account_ref ? ` · account "${p.account_ref}"` : ""}<span className="block text-xs text-muted-foreground">{p.note}</span></span>
          {canManage && <>
            <input className="fi h-8 w-36" value={numbers[p.id] || ""} onChange={(e) => setNumbers((x) => ({ ...x, [p.id]: e.target.value }))} placeholder="Enter invoice number" />
            <Btn onClick={() => void apply(p.id)} disabled={!(numbers[p.id] || "").trim()}>Apply</Btn>
          </>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- SMS

function SmsSection({ s }: { s: ConnectionStatus }) {
  const ok = s.sms.jmsurf_key_saved || s.sms.mode !== "off";
  return (
    <Panel title="SMS" icon={MessageSquare} description="Job updates, reminders, payment links and receipts by SMS."
      actions={<State ok={ok} on={s.sms.jmsurf_key_saved ? "JMSURF SMS" : "Own gateway"} off="Not set up" />}>
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">Sender ID: <b className="text-foreground">{s.sms.sender_id || "JMSURF default"}</b>. Automatic messages are kept to one SMS each.</p>
        <Link to="/settings?tab=sms" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"><PlugZap className="h-4 w-4" /> Balance, top-up, sender ID and what uses SMS</Link>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- WhatsApp

function WhatsAppSection({ s, canManage, refresh }: { s: ConnectionStatus; canManage: boolean; refresh: () => void }) {
  const c = s.whatsapp.cloud;
  const [f, setF] = useState({ phone_number_id: c.phone_number_id || "", waba_id: c.waba_id || "", token: "", app_secret: "", default_template: c.default_template || "", template_lang: c.template_lang || "en" });
  useEffect(() => { setF((x) => ({ ...x, phone_number_id: c.phone_number_id || x.phone_number_id, waba_id: c.waba_id || x.waba_id })); }, [c.phone_number_id, c.waba_id]);
  const [busy, setBusy] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const connect = async () => {
    setBusy("connect");
    const r = await garageI("whatsapp/connect", f);
    setBusy("");
    if (r.ok === false || r.error) { toast.error(r.error || "Not connected"); return; }
    toast.success(`Connected ${(r as any).display_phone || ""}`.trim());
    setF((x) => ({ ...x, token: "", app_secret: "" }));
    refresh();
  };
  const disconnect = async () => {
    setBusy("off");
    await garageI("whatsapp/disconnect");
    setBusy("");
    refresh();
  };
  return (
    <Panel title="WhatsApp" icon={MessageCircle} description="Chat with customers in the WhatsApp inbox and send job updates, estimates and payment links."
      actions={<State ok={c.connected || s.whatsapp.apiwap_mode !== "off"} on={c.connected ? `Cloud API ${c.display_phone || ""}`.trim() : "APIWAP"} off="Not connected" />}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Connect your WhatsApp Business number through Meta's WhatsApp Cloud API (developers.facebook.com → your app → WhatsApp → API setup). Messages from customers then appear in <Link to="/garage/whatsapp" className="font-medium text-primary hover:underline">WhatsApp</Link>. Without it, WhatsApp messages go out through APIWAP when it is set up under SMS & WhatsApp.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone number ID"><input className="fi font-mono" value={f.phone_number_id} onChange={set("phone_number_id")} disabled={!canManage} placeholder="Enter the phone number ID" /></Field>
          <Field label="WhatsApp business account ID"><input className="fi font-mono" value={f.waba_id} onChange={set("waba_id")} disabled={!canManage} placeholder="Enter the WABA ID" /></Field>
          <Field label="Permanent access token"><input className="fi" type="password" autoComplete="off" value={f.token} onChange={set("token")} disabled={!canManage} placeholder={c.token_saved ? "Saved (leave empty to keep)" : "Enter the system user token"} /></Field>
          <Field label="App secret" hint="Checks that messages really come from Meta."><input className="fi" type="password" autoComplete="off" value={f.app_secret} onChange={set("app_secret")} disabled={!canManage} placeholder={c.app_secret_saved ? "Saved (leave empty to keep)" : "Enter the app secret"} /></Field>
          <Field label="Template for customers who have not written in 24 hours" hint="An approved utility template whose body is just {{1}}. Leave empty to only reply inside 24 hours."><input className="fi" value={f.default_template} onChange={set("default_template")} disabled={!canManage} placeholder="Enter the template name" /></Field>
          <Field label="Template language"><input className="fi" value={f.template_lang} onChange={set("template_lang")} disabled={!canManage} placeholder="Enter the language code, e.g. en" /></Field>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">Webhook for your Meta app (WhatsApp → Configuration), subscribe to "messages":</p>
          <CopyRow label="Callback URL" value={c.webhook_url} />
          {c.verify_token && <CopyRow label="Verify token" value={c.verify_token} />}
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Btn primary busy={busy === "connect"} onClick={() => void connect()}>{c.connected ? "Save" : "Connect WhatsApp"}</Btn>
            {c.connected && <Btn busy={busy === "off"} onClick={() => void disconnect()}>Disconnect</Btn>}
          </div>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- eTIMS

function EtimsSection({ s }: { s: ConnectionStatus }) {
  const e = s.etims;
  return (
    <Panel title="KRA eTIMS (JMSURF TAX)" icon={ShieldCheck} description="Every invoice and credit note, job cards included, is signed with KRA."
      actions={<State ok={!!e.connected} on={e.environment === "prod" ? "Live" : "Test mode"} off="Not connected" />}>
      <div className="space-y-2 text-sm">
        {e.connected
          ? <p className="text-muted-foreground">KRA PIN {e.tin}, branch {e.branch}. Automatic signing is <b className="text-foreground">{e.auto_sign === false ? "off" : "on"}</b>; receipts carry the KRA QR code.</p>
          : <p className="text-muted-foreground">Enter your KRA PIN, branch and device serial to start signing invoices.</p>}
        <Link to="/settings?tab=etims" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"><PlugZap className="h-4 w-4" /> {e.connected ? "eTIMS settings and activity" : "Connect to KRA eTIMS"}</Link>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- Call Centre

function CallCentreSection({ s, canManage, refresh }: { s: ConnectionStatus; canManage: boolean; refresh: () => void }) {
  const c = s.callcentre;
  const [text, setText] = useState(c.missed_text || "");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState("");
  const save = async (body: Record<string, unknown>, k: string) => {
    setBusy(k);
    const r = await garageI<{ lookup_key?: string | null }>("callcentre/settings", body);
    setBusy("");
    if (r.ok === false) { toast.error(r.error || "Not saved"); return; }
    if (r.lookup_key) setKey(r.lookup_key);
    toast.success("Saved");
    refresh();
  };
  const open = async () => {
    setBusy("open");
    const r = await openCallCentre("/");
    setBusy("");
    if (!r.url) toast.error(r.error || "Could not open the Call Centre");
    refresh();
  };
  return (
    <Panel title="JMSURF CALL CENTRE" icon={Headset} description="Cloud call centre at jmsurfcallcentre.co.ke: IVR, queues, agents in the browser."
      actions={<State ok={c.linked} on="Linked" off={c.available ? "Not opened yet" : "Not available"} />}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <Btn primary busy={busy === "open"} disabled={!c.available} onClick={() => void open()}><ExternalLink className="h-4 w-4" /> Open the Call Centre</Btn>
          <Link to="/garage/callcentre" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"><Link2 className="h-4 w-4" /> Callbacks ({c.open_callbacks})</Link>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={c.missed_sms} disabled={!canManage} onChange={(e) => void save({ missed_sms: e.target.checked }, "sms")} />
          Text callers we missed (one SMS)
        </label>
        <Field label="Missed-call SMS" hint="Leave empty for the standard text with your business name.">
          <div className="flex gap-2">
            <input className="fi" maxLength={160} value={text} onChange={(e) => setText(e.target.value)} disabled={!canManage} placeholder="Enter the text callers receive" />
            {canManage && <Btn busy={busy === "text"} onClick={() => void save({ missed_text: text }, "text")}>Save</Btn>}
          </div>
        </Field>
        {canManage && (
          <div className="space-y-1.5 rounded-2xl border border-border p-3">
            <b className="flex items-center gap-1.5"><KeyRound className="h-4 w-4" /> Screen-pop key</b>
            <p className="text-xs text-muted-foreground">Lets the Call Centre (or another phone system) show the caller's customer, vehicles and open jobs. {c.lookup_key_set ? "A key is set." : "No key yet."}</p>
            <CopyRow label="Lookup" value={c.lookup_url} />
            <CopyRow label="Missed call" value={c.missed_url} />
            {key && <CopyRow label="New key (shown once)" value={key} />}
            <Btn busy={busy === "key"} onClick={() => void save({ rotate_key: true }, "key")}>{c.lookup_key_set ? "Make a new key" : "Make a key"}</Btn>
          </div>
        )}
      </div>
    </Panel>
  );
}
