import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, AlertTriangle, Copy, Server, Save, FlaskConical } from "lucide-react";
import { Pill } from "@/components/kit";
import { toast } from "sonner";
import { garageI } from "./api";

type Cred = { name: string; label: string; issuer: string; secret: boolean; source: "env" | "saved" | "missing"; value: string | null };
type Status = {
  credentials: Cred[]; encryption: string; saved_at: string | null;
  pay_platform: { linked: boolean; destination_type?: string; account_number?: string; business_number?: string };
  urls: Record<string, string>;
};

/** Credentials grouped by system, each with its Test. */
const GROUPS: { title: string; test?: string; testTo?: "phone" | "email"; names: string[]; note?: string }[] = [
  { title: "JMSURF PAY", test: "pay", names: ["JMSURFPAY_API_KEY", "SENDMONEY_WEBHOOK_SECRET"], note: "The JMSURF TECHNOLOGIES key. Companies only enter their Till / Paybill / bank; this key provisions them (externalId = company id, source jmsurf-garage). The platform's own fees use externalId jmsurf-garage-platform: link it under Payments." },
  { title: "Safaricom Daraja (platform app)", test: "daraja", names: ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_PASSKEY", "MPESA_SHORTCODE", "MPESA_ENVIRONMENT"], note: "Only used when package fees are collected by Daraja (Payments tab). Companies connect their own Daraja apps in their System → Connections." },
  { title: "JMSURF SMS", test: "sms", testTo: "phone", names: ["JMSURF_SMS_API_KEY", "JMSURF_SMS_SENDER"], note: "Platform SMS (renewal reminders, sign-up codes). Companies use their own prepaid units and sender ID." },
  { title: "JMSURF MAIL", test: "mail", testTo: "email", names: ["JMSURF_MAIL_KEY"], note: "Every platform email goes through JMSURF MAIL first (api.jmsurfmail.co.ke), then the Email tab's SMTP. The mail key is read from the server env at start-up; one saved here is used by this Test." },
  { title: "WhatsApp (platform number)", test: "whatsapp", testTo: "phone", names: ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_WABA_ID", "WHATSAPP_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"], note: "JMSURF's own WhatsApp Cloud API number for platform notices (APIWAP stays the first route when saved under SMS & WhatsApp)." },
  { title: "JMSURF TAX (KRA eTIMS hub)", test: "etims", names: ["ETIMS_PARTNER_KEY"], note: "Partner code \"garage\" at the eTIMS hub. Companies connect their own KRA PIN in System → KRA eTIMS." },
  { title: "JMSURF CALL CENTRE", test: "callcentre", names: ["CALLCENTRE_DB_URL", "CALLCENTRE_SERVICE_KEY", "CALLCENTRE_LOOKUP_KEY"], note: "The Call Centre keeps its data in DASH's database: its URL and service key let Garage mirror each company (marked as a Garage company) and sign staff in." },
];

/** Super admin → Settings → Integrations: every platform credential in one place, with Test buttons. */
export default function PlatformIntegrations() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["garage-platform-integrations"], queryFn: () => garageI<Status>("platform/status") });
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [to, setTo] = useState<Record<string, string>>({});
  const s = status.data;
  if (status.isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!s || (s as any).ok === false) return <p className="text-sm text-destructive">{(s as any)?.error || "Could not load the integrations."}</p>;
  const byName = new Map(s.credentials.map((c) => [c.name, c]));

  const save = async (names: string[], key: string) => {
    const body: Record<string, string> = {};
    for (const n of names) if (values[n] !== undefined) body[n] = values[n];
    if (!Object.keys(body).length) { toast.message("Nothing changed"); return; }
    setBusy(key);
    const r = await garageI<Status>("platform/save", { values: body });
    setBusy("");
    if ((r as any).ok === false) { toast.error(r.error || "Not saved"); return; }
    setValues((v) => { const x = { ...v }; names.forEach((n) => delete x[n]); return x; });
    qc.setQueryData(["garage-platform-integrations"], r);
    toast.success("Saved (encrypted)");
  };
  const test = async (what: string, key: string) => {
    setBusy(`t-${key}`);
    const r = await garageI<{ message?: string }>("platform/test", { what, to: to[key] || "" });
    setBusy("");
    if (r.ok) toast.success(r.message || "Working"); else toast.error(r.error || "The test failed");
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">A value set in the server environment always wins and cannot be changed here. Values saved here are encrypted ({s.encryption}) and never shown again.</p>
      {GROUPS.map((g) => (
        <section key={g.title} className="space-y-3 rounded-2xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{g.title}</h3>
            {g.names.every((n) => byName.get(n)?.source !== "missing")
              ? <Pill tone="success"><CheckCircle2 className="h-3 w-3" /> Set</Pill>
              : g.names.some((n) => byName.get(n)?.source !== "missing") ? <Pill tone="warning">Partly set</Pill> : <Pill tone="muted">Not set</Pill>}
          </div>
          {g.note && <p className="text-xs text-muted-foreground">{g.note}</p>}
          {g.title === "JMSURF PAY" && (
            <p className="text-xs">{s.pay_platform.linked ? <>Platform settlement: <b>{s.pay_platform.destination_type === "till" ? `Till ${s.pay_platform.account_number}` : `${s.pay_platform.business_number} / ${s.pay_platform.account_number}`}</b></> : <span className="text-[hsl(32_90%_38%)]">Platform settlement account not linked yet (Payments tab).</span>}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {g.names.map((n) => {
              const c = byName.get(n);
              if (!c) return null;
              const env = c.source === "env";
              return (
                <label key={n} className="block space-y-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium">{c.label}
                    {env ? <Pill tone="info"><Server className="h-3 w-3" /> server env</Pill> : c.source === "saved" ? <Pill tone="success">saved</Pill> : <Pill tone="warning"><AlertTriangle className="h-3 w-3" /> missing</Pill>}
                  </span>
                  <input className="fi" type={c.secret ? "password" : "text"} autoComplete="off" disabled={env}
                    value={values[n] ?? (c.secret ? "" : c.value || "")}
                    onChange={(e) => setValues((v) => ({ ...v, [n]: e.target.value }))}
                    placeholder={env ? "Set in the server environment" : c.source === "saved" && c.secret ? "Saved (type to replace, clear the field and save to remove)" : `Enter the ${c.label.toLowerCase()}`} />
                  <span className="block text-[11px] text-muted-foreground">Issued by {c.issuer} · env {n}</span>
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void save(g.names, g.title)} disabled={busy === g.title} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {busy === g.title ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </button>
            {g.test && <>
              {g.testTo && <input className="fi h-9 w-56" value={to[g.title] || ""} onChange={(e) => setTo((x) => ({ ...x, [g.title]: e.target.value }))} placeholder={g.testTo === "email" ? "Enter an email for the test" : "Enter a phone for the test (optional)"} />}
              <button type="button" onClick={() => void test(g.test!, g.title)} disabled={busy === `t-${g.title}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">
                {busy === `t-${g.title}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />} Test
              </button>
            </>}
          </div>
        </section>
      ))}
      <section className="space-y-2 rounded-2xl border border-border p-4">
        <h3 className="font-semibold">Addresses to register</h3>
        {Object.entries(s.urls).map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
            <span className="w-40 shrink-0 font-semibold">{k.replace(/_/g, " ")}</span>
            <code className="min-w-0 flex-1 truncate">{v}</code>
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(v); toast.success("Copied"); }} className="rounded p-1 hover:bg-muted" aria-label="Copy"><Copy className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </section>
    </div>
  );
}
