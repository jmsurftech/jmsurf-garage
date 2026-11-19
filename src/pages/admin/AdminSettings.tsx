import { getAuthUser } from "@/lib/authUser";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Save, RefreshCw, Check, Settings as SettingsIcon, Building2, Mail, MessageSquare, CreditCard, Clock, ShieldCheck, BellRing, LineChart } from "lucide-react";
import { PageHeader, Panel, Field } from "@/components/kit";
import SessionSettingsTab from "@/components/SessionSettingsTab";
import AdminMessagingPanel from "@/components/admin/AdminMessagingPanel";
import AdminRemindersPanel from "@/components/admin/AdminRemindersPanel";
import GatewaysPanel from "@/components/GatewaysPanel";
import { cn } from "@/lib/utils";
import { sendSmtpTest } from "@/lib/platformEmail";
import { listPayoutBanks } from "@/lib/serverPayments";
import PlatformSettlement from "@/components/admin/PlatformSettlement";
import AdminMfaPanel from "@/components/admin/AdminMfaPanel";
import { KENYA_BANK_PAYBILLS } from "@/lib/kenyaBanks";

type PayheroBank = { id: string; name: string; paybill: string };

type Tab = "general" | "tracking" | "smtp" | "messaging" | "reminders" | "payment" | "session" | "security";

const TABS: { id: Tab; label: string; icon: any; description: string }[] = [
  { id: "general", label: "General", icon: Building2, description: "Platform name and where alerts go." },
  { id: "tracking", label: "Tracking & SEO", icon: LineChart, description: "Meta Pixel and Google Analytics for garage.jmsurf.co.ke, sign-up and sign-in pages." },
  { id: "smtp", label: "Email", icon: Mail, description: "The mail account that sends sign-up, password, receipt and alert emails." },
  { id: "messaging", label: "SMS & WhatsApp", icon: MessageSquare, description: "Platform SMS and WhatsApp accounts, and companies' prepaid SMS units." },
  { id: "reminders", label: "Renewal reminders", icon: BellRing, description: "Email, SMS and WhatsApp reminders before and after a company's package ends." },
  { id: "payment", label: "Payments", icon: CreditCard, description: "How companies pay you for packages and upgrades." },
  { id: "session", label: "Admin sign-in", icon: Clock, description: "When the admin portal signs you out." },
  { id: "security", label: "Two-step sign-in", icon: ShieldCheck, description: "Protect the admin account with an authenticator app." },
];

export default function AdminSettings() {
  const [tab, setTab] = useState<Tab>("general");
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [banks, setBanks] = useState<PayheroBank[]>([]);
  const [banksLoading, setBanksLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    supabase.from("platform_settings").select("*").then(({ data }) => {
      if (data) {
        const map: Record<string, any> = {};
        (data as any[]).forEach(s => { map[s.key] = s.value; });
        setSettings(map);
      }
    });
  }, []);

  // Lazy-load PayHero bank list (cached) when payment tab opens
  useEffect(() => {
    if (tab !== "payment" || banks.length > 0) return;
    const CACHE_KEY = "payhero_banks_v1";
    const TTL_MS = 24 * 60 * 60 * 1000;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.ts && Date.now() - parsed.ts < TTL_MS && Array.isArray(parsed.banks)) {
          setBanks(parsed.banks);
          return;
        }
      }
    } catch {}
    setBanks(KENYA_BANK_PAYBILLS);
    setBanksLoading(true);
    listPayoutBanks()
      .then(({ data }: any) => {
        const list: PayheroBank[] = Array.isArray(data?.banks) ? data.banks : [];
        if (!list.length) return;
        setBanks(list);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), banks: list })); } catch {}
      })
      .catch(() => {})
      .finally(() => setBanksLoading(false));
  }, [tab]);

  const save = async (key: string, override?: any) => {
    const value = override !== undefined ? override : settings[key];
    setLoading(true);
    // Upsert: try update first, if no rows affected then insert
    const { data: existing } = await supabase.from("platform_settings").select("id").eq("key", key).maybeSingle();
    let error;
    if (existing) {
      ({ error } = await supabase.from("platform_settings").update({ value, updated_at: new Date().toISOString() } as any).eq("key", key));
    } else {
      ({ error } = await supabase.from("platform_settings").insert({ key, value } as any));
    }
    setLoading(false);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Saved" });
  };

  const testSmtp = async () => {
    const smtp = settings.smtp || {};
    const usingResend = (smtp.provider || "smtp") === "resend";
    const requiredFields = usingResend
      ? ["resend_api_key", "from_email"]
      : ["host", "port", "username", "password", "from_email"];
    const missing = requiredFields.filter(f => !smtp[f]);
    if (missing.length > 0) {
      toast({ title: "Incomplete settings", description: `Still missing: ${missing.join(", ")}`, variant: "destructive" });
      return;
    }

    // Default to the signed-in owner's own inbox, not the sending address,
    // so the test lands somewhere that is actually checked.
    const { data: { user } } = await getAuthUser();
    const to = window.prompt(
      "Send a test email to which address?\n(Use an inbox you actually read, then check the spam folder.)",
      user?.email || "",
    );
    if (!to) return;


    setTestingSmtp(true);
    try {
      // The mail service built into the app server sends a real message and
      // reports the exact reply from the mail server.
      let payload: any = await sendSmtpTest(to, smtp);

      if (payload?.unavailable) {
        // Older hosting without the built-in mail service: use the backend function.
        const { data, error } = await supabase.functions.invoke("smtp-test", { body: { to } });
        payload = data;
        if (error) {
          try { payload = await (error as any)?.context?.json?.(); } catch { payload = null; }
        }
      }

      if (payload?.ok) {
        toast({
          title: `Test email accepted for ${to}`,
          description: `${payload.server || smtp.host} replied: ${payload.response || "accepted"}. If it is not in the inbox, check the spam folder.`,
          duration: 12000,
        });
        return;
      }

      toast({
        title: "Email test failed",
        description: payload?.error || "The mail service could not be reached. Save the settings and try again.",
        variant: "destructive",
      });
    } finally {
      setTestingSmtp(false);
    }
  };

  const updateField = (section: string, path: string, value: any) => {
    setSettings(prev => {
      const updated = { ...prev };
      const obj = JSON.parse(JSON.stringify(updated[section] || {}));
      const parts = path.split(".");
      let ref: any = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!ref[parts[i]]) ref[parts[i]] = {};
        ref = ref[parts[i]];
      }
      ref[parts[parts.length - 1]] = value;
      updated[section] = obj;
      return updated;
    });
  };

  const provider = String(settings.smtp?.provider || "smtp");
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader title="Settings" description="How the platform sends email and messages, collects payments and keeps the admin safe." icon={SettingsIcon} />

      <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)] lg:items-start">
        <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1.5 lg:sticky lg:top-4 lg:flex-col">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn("flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-left text-sm transition-colors",
                tab === t.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </nav>

        <Panel title={current.label} description={current.description} icon={current.icon}>
          {tab === "general" && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Platform name" hint="Shown in the admin portal">
                  <input className="fi" value={settings.general?.business_name || ""} onChange={(e) => updateField("general", "business_name", e.target.value)} placeholder="JMSURF Garage" />
                </Field>
                <Field label="Alert email" hint="Uptime alerts and error reports go here">
                  <input className="fi" type="email" value={settings.general?.support_email || ""} onChange={(e) => updateField("general", "support_email", e.target.value)} placeholder="support@jmsurf.co.ke" />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">Trial length and prices are set per package under Packages. Support contacts shown to companies come from Website content.</p>
              <Button onClick={() => save("general")} disabled={loading}><Save /> {loading ? "Saving…" : "Save"}</Button>
            </div>
          )}

          {tab === "tracking" && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Meta Pixel ID" hint="Events Manager → Data sources → your pixel. Numbers only.">
                  <input className="fi" inputMode="numeric" value={settings.tracking?.meta_pixel_id || ""} onChange={(e) => updateField("tracking", "meta_pixel_id", e.target.value.replace(/D/g, ""))} placeholder="123456789012345" />
                </Field>
                <Field label="Google Analytics 4 ID" hint="Admin → Data streams → Measurement ID.">
                  <input className="fi" value={settings.tracking?.ga4_id || ""} onChange={(e) => updateField("tracking", "ga4_id", e.target.value.trim().toUpperCase())} placeholder="G-XXXXXXXXXX" />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">Changes go live within 5 minutes.</p>
              <Button onClick={() => save("tracking")} disabled={loading}><Save /> {loading ? "Saving…" : "Save"}</Button>
            </div>
          )}

          {tab === "smtp" && (
            <div className="space-y-5">
              <Field label="Send with">
                <div className="grid gap-2 sm:grid-cols-2">
                  {[{ id: "resend", name: "Resend", sub: "Recommended. Just an API key." }, { id: "smtp", name: "Mail server (SMTP)", sub: "Any mailbox with SMTP access." }].map((p) => (
                    <button key={p.id} type="button" onClick={() => updateField("smtp", "provider", p.id)}
                      className={cn("rounded-xl border p-4 text-left transition-colors", provider === p.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50")}>
                      <span className="flex items-center justify-between text-sm font-semibold">{p.name}{provider === p.id && <Check className="h-4 w-4 text-primary" />}</span>
                      <span className="text-xs text-muted-foreground">{p.sub}</span>
                    </button>
                  ))}
                </div>
              </Field>
              {provider === "resend" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Resend API key" className="sm:col-span-2"><input className="fi font-mono" type="password" autoComplete="off" value={settings.smtp?.resend_api_key || ""} onChange={(e) => updateField("smtp", "resend_api_key", e.target.value)} placeholder="re_…" /></Field>
                  <Field label="From email" hint="Must be on a domain verified in Resend"><input className="fi" value={settings.smtp?.from_email || ""} onChange={(e) => updateField("smtp", "from_email", e.target.value)} placeholder="noreply@jmsurf.co.ke" /></Field>
                  <Field label="From name"><input className="fi" value={settings.smtp?.from_name || ""} onChange={(e) => updateField("smtp", "from_name", e.target.value)} placeholder="JMSURF Garage" /></Field>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Server"><input className="fi" value={settings.smtp?.host || ""} onChange={(e) => updateField("smtp", "host", e.target.value)} placeholder="Enter SMTP server" /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Port"><input className="fi" type="number" value={settings.smtp?.port || 587} onChange={(e) => updateField("smtp", "port", Number(e.target.value))} /></Field>
                    <Field label="Security">
                      <select className="fi" value={settings.smtp?.encryption || (Number(settings.smtp?.port) === 465 ? "ssl" : "starttls")} onChange={(e) => updateField("smtp", "encryption", e.target.value)}>
                        <option value="ssl">SSL (465)</option><option value="starttls">STARTTLS (587)</option><option value="none">None</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="Username"><input className="fi" autoComplete="off" value={settings.smtp?.username || ""} onChange={(e) => updateField("smtp", "username", e.target.value)} /></Field>
                  <Field label="Password"><input className="fi" type="password" autoComplete="new-password" value={settings.smtp?.password || ""} onChange={(e) => updateField("smtp", "password", e.target.value)} /></Field>
                  <Field label="From email"><input className="fi" value={settings.smtp?.from_email || ""} onChange={(e) => updateField("smtp", "from_email", e.target.value)} placeholder="Enter email address" /></Field>
                  <Field label="From name"><input className="fi" value={settings.smtp?.from_name || ""} onChange={(e) => updateField("smtp", "from_name", e.target.value)} placeholder="JMSURF Garage" /></Field>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => save("smtp")} disabled={loading}><Save /> {loading ? "Saving…" : "Save"}</Button>
                <Button variant="outline" onClick={testSmtp} disabled={testingSmtp}>
                  <RefreshCw className={testingSmtp ? "animate-spin" : ""} /> {testingSmtp ? "Sending test…" : "Send a test email"}
                </Button>
              </div>
            </div>
          )}

          {tab === "messaging" && <AdminMessagingPanel />}
          {tab === "reminders" && <AdminRemindersPanel />}

          {tab === "payment" && (() => {
            const rawProvider = String(settings.subscription_billing?.provider || "daraja");
            const provider: "jmsurf" | "payhero" | "daraja" | "paystack" =
              rawProvider === "mpesa" || rawProvider === "bank" ? "payhero" : (rawProvider as any);
            const savedProvider = provider;
            const setProvider = (p: string) => updateField("subscription_billing", "provider", p);
  
            const mpesa = settings.payment?.mpesa || {};
            const daraja = settings.payment?.daraja || {};
            const bank = settings.payment?.bank || {};
            const paystack = settings.payment?.paystack || {};
  
            const jmsurfConfigured = !!settings.subscription_billing?.jmsurf?.tenant_code;
            const payheroConfigured = !!settings.subscription_billing?.payhero?.channel_id;
            const darajaConfigured = !!(daraja.shortcode && daraja.passkey && daraja.consumer_key && daraja.consumer_secret);
            const bankConfigured = !!(bank.bank_paybill_id && bank.account_number && bank.account_name);
            const paystackConfigured = !!(paystack.public_key && paystack.secret_key);
  
            const ProviderTile = ({ id, name, subtitle, configured }: { id: string; name: string; subtitle: string; configured: boolean }) => {
              const active = provider === id;
              return (
                <button
                  type="button"
                  onClick={() => setProvider(id)}
                  className={`text-left rounded-xl border p-4 transition ${
                    active ? "bg-orange-500/10 border-orange-500" : "bg-muted/40 border-border hover:border-border"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground">{name}</span>
                        {configured && savedProvider === id && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-300">
                            <Check className="w-3 h-3" /> In use
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${active ? "border-orange-500 bg-orange-500" : "border-border"}`}>
                      {active && <div className="w-full h-full rounded-full bg-white scale-50" />}
                    </div>
                  </div>
                </button>
              );
            };
  
            const sectionHeader = (title: string, subtitle: string, configured: boolean, onRemove?: () => void) => (
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border mb-4">
                <div>
                  <h2 className="font-semibold text-foreground">{title}</h2>
                  <p className="text-[11px] text-muted-foreground">{subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                  {configured && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-300">
                      <Check className="w-3 h-3" /> Active
                    </span>
                  )}
                  {configured && onRemove && (
                    <button onClick={onRemove} className="text-[11px] font-medium px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground">
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
  
            return (
              <div className="space-y-5">
                {/* Provider selector — mirrors POS Payment Mode */}
                <section className="bg-muted/30 border border-border rounded-2xl p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <h2 className="font-semibold flex items-center gap-2 text-base">Collect with</h2>
                      <p className="text-xs text-muted-foreground mt-1">
                        Choose how shops pay you for packages, domains and upgrades. Only one gateway is active at a time.
                      </p>
                    </div>
                    <span className="text-[11px] px-2 py-1 rounded-md bg-muted/40 text-muted-foreground font-medium">
                      Active: <span className="text-foreground capitalize">{provider}</span>
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <ProviderTile id="jmsurf" name="JMSURF Pay" subtitle="Till, Paybill or bank via JMSURF PAY" configured={jmsurfConfigured} />
                    <ProviderTile id="payhero" name="PayHero" subtitle="Till, Paybill or bank" configured={payheroConfigured} />
                    <ProviderTile id="paystack" name="Paystack" subtitle="Cards + M-Pesa" configured={paystackConfigured} />
                    <ProviderTile id="daraja" name="Daraja" subtitle="Your Safaricom Daraja app" configured={darajaConfigured} />
                  </div>
                  {(provider === "paystack" || provider === "daraja") && (
                    <p className="text-[11px] text-muted-foreground">Fill in the keys below, then press <strong className="text-foreground">Save</strong> at the bottom to make this gateway active.</p>
                  )}
                </section>
  
                {(provider === "jmsurf" || provider === "payhero") && (
                  <PlatformSettlement
                    provider={provider}
                    onLinked={() => supabase.from("platform_settings").select("*").then(({ data }) => {
                      if (!data) return;
                      const map: Record<string, any> = {};
                      (data as any[]).forEach((row) => { map[row.key] = row.value; });
                      setSettings(map);
                    })}
                  />
                )}
  
                {/* Direct Daraja STK */}
                {provider === "daraja" && (
                  <section className="bg-muted/30 border border-border rounded-2xl p-5">
                    {sectionHeader("Direct Daraja STK", "Tenant subscription payments via your own Safaricom Daraja app credentials.", darajaConfigured, () => updateField("payment", "daraja", {}))}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Shortcode (Paybill / Till)</label>
                        <input className="fi font-mono" placeholder="e.g. 174379" maxLength={10}
                          value={daraja.shortcode || ""}
                          onChange={e => updateField("payment", "daraja.shortcode", e.target.value.replace(/\D/g, "").slice(0, 10))} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Shortcode Type</label>
                        <select className="fi"
                          value={daraja.shortcode_type || "paybill"}
                          onChange={e => updateField("payment", "daraja.shortcode_type", e.target.value)}>
                          <option value="paybill">Paybill (CustomerPayBillOnline)</option>
                          <option value="till">Till (CustomerBuyGoodsOnline)</option>
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-xs text-muted-foreground block mb-1">Passkey</label>
                        <input type="password" className="fi font-mono" placeholder="Lipa Na M-Pesa Online Passkey"
                          value={daraja.passkey || ""}
                          onChange={e => updateField("payment", "daraja.passkey", e.target.value)} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Consumer Key</label>
                        <input className="fi font-mono" placeholder="Daraja App Consumer Key"
                          value={daraja.consumer_key || ""}
                          onChange={e => updateField("payment", "daraja.consumer_key", e.target.value)} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Consumer Secret</label>
                        <input type="password" className="fi font-mono" placeholder="Daraja App Consumer Secret"
                          value={daraja.consumer_secret || ""}
                          onChange={e => updateField("payment", "daraja.consumer_secret", e.target.value)} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Account Reference</label>
                        <input className="fi" maxLength={20} placeholder="e.g. JMSURF-SUB"
                          value={daraja.account_reference || ""}
                          onChange={e => updateField("payment", "daraja.account_reference", e.target.value.slice(0, 20))} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Environment</label>
                        <select className="fi"
                          value={daraja.environment || "production"}
                          onChange={e => updateField("payment", "daraja.environment", e.target.value)}>
                          <option value="production">Production</option>
                          <option value="sandbox">Sandbox</option>
                        </select>
                      </div>
                    </div>
                  </section>
                )}
  
                {/* Paystack */}
                {provider === "paystack" && (
                  <section className="bg-muted/30 border border-border rounded-2xl p-5">
                    {sectionHeader("Paystack Credentials", "Cards & mobile money via Paystack hosted checkout.", paystackConfigured, () => updateField("payment", "paystack", {}))}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Public Key</label>
                        <input className="fi" placeholder="pk_live_…" value={paystack.public_key || ""}
                          onChange={e => updateField("payment", "paystack.public_key", e.target.value)} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Secret Key</label>
                        <input type="password" className="fi" placeholder="sk_live_…" value={paystack.secret_key || ""}
                          onChange={e => updateField("payment", "paystack.secret_key", e.target.value)} />
                      </div>
                    </div>
                  </section>
                )}
  
                {/* PayHero platform credentials — shared by shop M-Pesa prompts and payouts */}
                <section className="bg-muted/30 border border-border rounded-2xl p-5">
                  {sectionHeader(
                    "PayHero Platform Credentials",
                    "Used for company M-Pesa prompts, payout channels and the bank list. Kept separate from the provider above.",
                    !!(settings.payment?.payhero?.api_username && settings.payment?.payhero?.api_password),
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">API Username</label>
                      <input className="fi" placeholder="PayHero API username"
                        value={settings.payment?.payhero?.api_username || ""}
                        onChange={e => updateField("payment", "payhero.api_username", e.target.value.trim())} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">API Password</label>
                      <input type="password" className="fi" placeholder="PayHero API password"
                        value={settings.payment?.payhero?.api_password || ""}
                        onChange={e => updateField("payment", "payhero.api_password", e.target.value.trim())} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Account ID</label>
                      <input className="fi" placeholder="e.g. 1234"
                        value={settings.payment?.payhero?.account_id || ""}
                        onChange={e => updateField("payment", "payhero.account_id", e.target.value.replace(/\D/g, ""))} />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="text-xs text-muted-foreground block mb-1">Basic Auth Token (optional)</label>
                      <input className="fi" placeholder="Paste only if PayHero gave you a single token instead of a username and password"
                        value={settings.payment?.payhero?.basic_auth_token || ""}
                        onChange={e => updateField("payment", "payhero.basic_auth_token", e.target.value.trim())} />
                    </div>
                  </div>
  
                </section>
  
  
  
                <section className="bg-muted/30 border border-border rounded-2xl p-5 space-y-4">
                <div>
                  <h2 className="font-semibold text-foreground">More ways for companies to pay</h2>
                  <p className="text-[11px] text-muted-foreground">Shown on the Billing page next to M-Pesa, for companies in other countries or paying by card. Each gateway saves on its own.</p>
                </div>
                <GatewaysPanel scope="platform" baseCurrency="KES" />
              </section>

              <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                  Only one provider can be active. Saving will clear credentials for the other providers so they can't be used by mistake.
                </div>
  
                <Button
                  onClick={async () => {
                    // Only one gateway is active: clear the keys of the others,
                    // and save exactly what is on screen.
                    const pay = { ...(settings.payment || {}) };
                    ["mpesa", "daraja", "bank", "paystack"].forEach((k) => { if (k !== provider) pay[k] = k === "mpesa" ? pay[k] : {}; });
                    setSettings((prev) => ({ ...prev, payment: pay }));
                    await save("subscription_billing");
                    await save("payment", pay);
                  }}
                  disabled={loading}
                >
                  <Save /> {loading ? "Saving…" : "Save payment settings"}
                </Button>
              </div>
            );
          })()}
  
  
          {tab === "session" && <SessionSettingsTab scope="admin" canManage={true} />}
          {tab === "security" && <AdminMfaPanel />}
        </Panel>
      </div>
    </div>
  );
}
