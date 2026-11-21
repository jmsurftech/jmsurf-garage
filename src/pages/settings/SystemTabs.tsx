import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound, MessageSquare, CheckCircle2, Smartphone, Send, FileClock, Mail, Store, Palette, LayoutTemplate,
  Phone, Share2, Sparkles, Info, ShoppingBag, Megaphone, MapPin, Search as SearchIcon, Upload, X, Plus, Truck, Eye,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Panel, Field, Segmented, EmptyState } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { JmsurfSmsWallet } from "@/components/JmsurfSmsWallet";
import { SmsUsesPanel, SmsTopupHistory, SmsUsageLog, SmsMonthTiles, useSmsUses } from "@/components/SmsHub";
import { DEFAULT_LOW_BALANCE } from "@/lib/smsUses";
import MessagingSettingsTab from "@/components/MessagingSettingsTab";
import SmsGatewayPanel from "@/components/SmsGatewayPanel";
import { BrandLogo } from "@/components/BrandLogo";
import { confirmAction } from "@/components/books/confirm";
import { messagingApi, useMessagingSettings } from "@/lib/messaging";
import { mergeSiteConfig, DEFAULT_SITE, type SiteConfig, type SiteTemplate } from "@/lib/siteConfig";
import { useErpSettings, Toggle } from "./ErpSettingsTabs";
import { cn } from "@/lib/utils";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;

/** Same card look as Payment gateways. */
function ProviderCard({ name, subtitle, active, inUse, configured, onClick, icon: Icon }: { name: string; subtitle: string; active: boolean; inUse: boolean; configured: boolean; onClick: () => void; icon: any }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("relative flex items-start gap-3 rounded-2xl border-2 p-4 text-left transition-all", active ? "border-primary bg-primary/5 shadow-md" : "border-border bg-card hover:border-primary/40")}>
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{name}</span>
        <span className="block text-xs text-muted-foreground">{subtitle}</span>
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          {inUse && <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">In use</span>}
          {!inUse && configured && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Set up</span>}
        </span>
      </span>
    </button>
  );
}

/* ───────────────────────────── SMS gateways ───────────────────────────── */

export function SmsGatewaysTab({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: status = [], isLoading } = useQuery({
    queryKey: ["integration-secrets"],
    queryFn: async () => ((await sb.rpc("integration_secret_status")).data || []) as { name: string; updated_at: string }[],
  });
  const { data: m } = useMessagingSettings();
  const { uses } = useSmsUses();
  const jmsSaved = status.find((s) => s.name === "jmsurf_sms_key");
  const ownSms = m?.sms_mode === "own";
  const inUse: "jmsurf" | "sendbulk" | "none" = jmsSaved ? "jmsurf" : ownSms ? "sendbulk" : "none";
  const [choice, setChoice] = useState<"jmsurf" | "sendbulk">("jmsurf");
  useEffect(() => { if (inUse === "sendbulk") setChoice("sendbulk"); }, [inUse]);

  const saveKey = async (value: string) => {
    if (value && !/^jms_(live|test)_[A-Za-z0-9_-]{10,}$/.test(value.trim())) return toast({ title: "That is not a JMSURF SMS key", description: "It starts with jms_live_ (from JMSURF SMS → API keys).", variant: "destructive" });
    setBusy(true);
    const { error } = await sb.rpc("set_integration_secret", { p_name: "jmsurf_sms_key", p_value: value.trim() });
    if (!error && value) {
      const b: any = await messagingApi("jmsurf/balance", {});
      if (!b.ok) toast({ title: "Key saved, but JMSURF SMS refused it", description: b.error, variant: "destructive" });
      else toast({ title: "JMSURF SMS connected", description: `${Number(b.sms_remaining ?? 0).toLocaleString()} SMS available.` });
    }
    setBusy(false);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    if (!value) toast({ title: "JMSURF SMS disconnected" });
    setKey("");
    ["integration-secrets", "messaging-settings", "messaging-settings-mode", "jmsurf-sms-balance"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const lowAt = Number(uses.low_balance ?? DEFAULT_LOW_BALANCE);
  const [view, setView] = useState<"balance" | "uses" | "log" | "connect" | null>(null);
  const shown = view ?? "balance";

  if (isLoading) return <OrbLoader label="Loading SMS…" />;
  return (
    <div className="space-y-5">
      <Segmented value={shown} onChange={(v) => setView(v as typeof shown)} options={[
        { value: "balance", label: "Balance & top-ups" },
        { value: "uses", label: "What uses SMS" },
        { value: "log", label: "Usage log" },
        { value: "connect", label: "Connection" },
      ]} />

      {shown === "balance" && (
        // Built-in SMS is paid from this balance; a company's own JMSURF SMS key shows that account's balance instead.
        <div className="space-y-5">
          <JmsurfSmsWallet lowAt={lowAt} />
          <SmsMonthTiles hasJmsurf />
          <SmsTopupHistory />
        </div>
      )}
      {shown === "uses" && <SmsUsesPanel canManage={canManage} />}
      {shown === "log" && <div className="space-y-5"><SmsMonthTiles hasJmsurf /><SmsUsageLog /></div>}

      {shown === "connect" && (<>
        <Panel title={<span className="flex items-center gap-2.5"><BrandLogo id="jmsurfsms" name="JMSURF SMS" className="h-8 w-8" />JMSURF SMS <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">Default</span></span> as any} description="Create a key at jmsurfsms.co.ke → API keys (send, balance and top-up permissions)."
          actions={jmsSaved ? <span className="flex items-center gap-1 text-xs font-semibold text-success"><CheckCircle2 className="h-4 w-4" /> Connected</span> : null}>
          <div className="space-y-4">
            <Field label={jmsSaved ? "Replace the API key" : "API key"} hint="Stored on the server and never shown again.">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input className="fi font-mono" type="password" autoComplete="off" placeholder="jms_live_…" value={key} onChange={(e) => setKey(e.target.value)} disabled={!canManage} />
                <Button onClick={() => saveKey(key)} disabled={!canManage || busy || !key.trim()}><KeyRound /> Save</Button>
              </div>
            </Field>
            {jmsSaved && (
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">Saved {new Date(jmsSaved.updated_at).toLocaleString("en-GB")}
                <Button size="sm" variant="ghost" className="text-destructive" disabled={!canManage || busy} onClick={async () => { if (await confirmAction({ title: "Disconnect JMSURF SMS?", message: "SMS stops until a gateway is set up again.", danger: true, confirmLabel: "Disconnect" })) void saveKey(""); }}>Disconnect</Button>
                <Link to="/marketing/sms" className="text-primary hover:underline">Open Bulk SMS →</Link>
              </div>
            )}
          </div>
        </Panel>
        {!jmsSaved && <p className="rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm">After you save the API key, top up SMS from here with an M-Pesa prompt: there is no need to sign in to JMSURF SMS again. The key needs the send, balance and top-up permissions.</p>}
        <SmsGatewayPanel canManage={canManage} />
        <MessagingSettingsTab canManage={canManage} hideSms />
      </>)}
    </div>
  );
}

/* ─────────────────────────── Customer statements ─────────────────────────── */

const DEFAULT_STATEMENTS = { enabled: false, schedule: "month_end" as "month_end" | "days", days: [1] as number[], hour: 8, only_with_balance: true, email: true, sms: false, message: "" };

export function StatementsTab({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const { settings, save, isLoading } = useErpSettings();
  const [s, setS] = useState(DEFAULT_STATEMENTS);
  useEffect(() => setS({ ...DEFAULT_STATEMENTS, ...(settings.statements || {}) }), [settings.statements]);
  const tenantId = useTenantId();
  const { data: last = [] } = useQuery({
    queryKey: ["statement-runs", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await sb.from("email_logs").select("created_at,recipient,status,subject").eq("tenant_id", tenantId).ilike("subject", "%statement%").order("created_at", { ascending: false }).limit(8)).data || [],
  });
  if (isLoading) return <OrbLoader label="Loading…" />;
  const up = (p: Partial<typeof s>) => setS({ ...s, ...p });
  const submit = async () => {
    const days = [...new Set(s.days.map(Number).filter((d) => d >= 1 && d <= 28))].sort((a, b) => a - b);
    if (s.schedule === "days" && !days.length) return toast({ title: "Pick at least one day of the month", variant: "destructive" });
    const { error } = await save("statements", { ...s, days });
    toast(error ? { title: "Not saved", description: error.message, variant: "destructive" } : { title: "Statement schedule saved" });
  };
  return (
    <div className="space-y-5">
      <Panel title="Automatic customer statements" icon={FileClock} description="Customers also see their live statement any time in their online account."
        actions={<Switch checked={s.enabled} onCheckedChange={(v) => up({ enabled: v })} disabled={!canManage} />}>
        <div className={cn("space-y-5", !s.enabled && "pointer-events-none opacity-50")}>
          <Field label="When to send">
            <div className="grid gap-2 sm:grid-cols-2">
              {([["month_end", "Every month end", "Last day of each month"], ["days", "On chosen dates", "e.g. the 1st and 15th"]] as const).map(([v, l, h]) => (
                <button key={v} type="button" onClick={() => up({ schedule: v })} className={cn("rounded-xl border-2 p-3 text-left", s.schedule === v ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
                  <span className="block text-sm font-semibold">{l}</span><span className="block text-xs text-muted-foreground">{h}</span>
                </button>
              ))}
            </div>
          </Field>
          {s.schedule === "days" && (
            <Field label="Days of the month" hint="Up to the 28th so every month has them.">
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => {
                  const on = s.days.includes(d);
                  return <button key={d} type="button" onClick={() => up({ days: on ? s.days.filter((x) => x !== d) : [...s.days, d] })}
                    className={cn("h-9 w-9 rounded-lg border text-sm font-semibold", on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>{d}</button>;
                })}
              </div>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Send at (Nairobi time)">
              <select className="fi" value={s.hour} onChange={(e) => up({ hour: Number(e.target.value) })}>
                {[6, 7, 8, 9, 10, 12, 14, 16, 18].map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle label="Email the statement" hint="Needs Email & senders set up" checked={s.email} onChange={(v) => up({ email: v })} disabled={!canManage} />
            <Toggle label="SMS a short summary with the balance" checked={s.sms} onChange={(v) => up({ sms: v })} disabled={!canManage} />
            <Toggle label="Only customers who owe money" hint="Off: everyone with activity in the period" checked={s.only_with_balance} onChange={(v) => up({ only_with_balance: v })} disabled={!canManage} />
          </div>
          <Field label="Message (optional)" hint="Added above the statement, e.g. how to pay.">
            <textarea className="fi" maxLength={400} value={s.message} onChange={(e) => up({ message: e.target.value })} />
          </Field>
        </div>
      </Panel>
      {last.length > 0 && (
        <Panel title="Recently sent" icon={Mail} flush>
          <ul className="divide-y divide-border text-sm"><PagedRows rows={(last as any[])} list>{(pageRows) => pageRows.map((l, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5"><span className="truncate">{l.recipient}</span><span className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString("en-GB")} · {l.status}</span></li>
          ))}</PagedRows></ul>
        </Panel>
      )}
      {canManage && <div className="flex justify-end"><Button onClick={submit}>Save statement schedule</Button></div>}
    </div>
  );
}

/* ───────────────────────────── Online shop & website ───────────────────────────── */

const DEFAULT_SHOP = { pickup: true, delivery: true, pay_on_delivery: true, delivery_fee: 0, free_delivery_over: 0, min_order: 0, announcement: "", sell_out_of_stock: true, approve_signups: true };

function Section({ title, icon, description, children }: { title: string; icon: any; description?: ReactNode; children: ReactNode }) {
  return <Panel title={title} icon={icon} description={description}><div className="space-y-4">{children}</div></Panel>;
}

function ImageSlot({ url, onChange, label, disabled }: { url: string; onChange: (u: string) => void; label: string; disabled?: boolean }) {
  const tenantId = useTenantId();
  const ref = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const pick = async (f?: File) => {
    if (!f || !tenantId) return;
    if (!f.type.startsWith("image/") || f.size > 4 * 1024 * 1024) return toast({ title: "Use an image under 4 MB", variant: "destructive" });
    setBusy(true);
    const path = `${tenantId}/site/${Date.now()}-${f.name.replace(/[^a-z0-9.]+/gi, "-").toLowerCase()}`;
    const { error } = await supabase.storage.from("product-images").upload(path, f, { upsert: true, contentType: f.type });
    setBusy(false);
    if (error) return toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    onChange(supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl);
  };
  return (
    <div className="relative">
      <button type="button" disabled={disabled || busy} onClick={() => ref.current?.click()}
        className="group relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted/40 text-muted-foreground hover:border-primary">
        {url ? <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <span className="flex flex-col items-center gap-1 text-xs"><Upload className="h-5 w-5" />{busy ? "Uploading…" : label}</span>}
      </button>
      {url && !disabled && <button type="button" onClick={() => onChange("")} className="absolute right-1.5 top-1.5 rounded-full bg-background/90 p-1 shadow" aria-label="Remove image"><X className="h-3.5 w-3.5" /></button>}
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

export function OnlineShopTab({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const { settings, save, isLoading } = useErpSettings();
  const [s, setS] = useState<any>(DEFAULT_SHOP);
  const [site, setSite] = useState<SiteConfig>(DEFAULT_SITE);
  const [tab, setTab] = useState<"look" | "content" | "contact" | "checkout">("look");
  useEffect(() => { const v = settings.shop || {}; setS({ ...DEFAULT_SHOP, ...v }); setSite(mergeSiteConfig(v.site)); }, [settings.shop]);
  if (isLoading) return <OrbLoader label="Loading the website settings…" />;
  const up = (p: any) => setS({ ...s, ...p });
  const set = <K extends keyof SiteConfig>(k: K, p: Partial<SiteConfig[K]> | SiteConfig[K]) =>
    setSite((x) => ({ ...x, [k]: typeof p === "object" && !Array.isArray(p) ? { ...(x[k] as any), ...p } : p }));
  const dis = !canManage;
  const submit = async () => {
    const clean = { ...s, delivery_fee: Math.max(0, Number(s.delivery_fee) || 0), free_delivery_over: Math.max(0, Number(s.free_delivery_over) || 0), min_order: Math.max(0, Number(s.min_order) || 0), site };
    const { error } = await save("shop", clean);
    toast(error ? { title: "Not saved", description: error.message, variant: "destructive" } : { title: "Website saved", description: "Changes show on the website within a minute." });
  };
  const text = (label: string, value: string, onChange: (v: string) => void, opts: { area?: boolean; max?: number; hint?: string; placeholder?: string } = {}) => (
    <Field label={label} hint={opts.hint}>
      {opts.area ? <textarea className="fi min-h-20" maxLength={opts.max || 600} value={value} placeholder={opts.placeholder} onChange={(e) => onChange(e.target.value)} disabled={dis} />
        : <input className="fi" maxLength={opts.max || 200} value={value} placeholder={opts.placeholder} onChange={(e) => onChange(e.target.value)} disabled={dis} />}
    </Field>
  );
  const TEMPLATES: [SiteTemplate, string, string][] = [
    ["classic", "Classic", "Text left, product collage right"],
    ["split", "Split image", "Large photo beside the headline"],
    ["bold", "Bold banner", "Full-width colour banner, centred text"],
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-2">
        <div className="flex gap-1 overflow-x-auto">
          {([["look", "Look & layout", Palette], ["content", "Page content", LayoutTemplate], ["contact", "Contacts & social", Phone], ["checkout", "Checkout & delivery", Truck]] as const).map(([v, l, I]) => (
            <button key={v} type="button" onClick={() => setTab(v)} className={cn("flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm", tab === v ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-muted")}><I className="h-4 w-4" />{l}</button>
          ))}
        </div>
        <Button size="sm" variant="outline" asChild><a href="/" target="_blank" rel="noopener noreferrer"><Eye /> View website</a></Button>
      </div>

      {tab === "look" && <>
        <Section title="Layout template" icon={LayoutTemplate} description="How the top of the home page is laid out.">
          <div className="grid gap-3 sm:grid-cols-3">
            {TEMPLATES.map(([v, l, h]) => (
              <button key={v} type="button" disabled={dis} onClick={() => set("template", v)}
                className={cn("overflow-hidden rounded-2xl border-2 text-left transition-all", site.template === v ? "border-primary shadow-md" : "border-border hover:border-primary/40")}>
                <div className="flex h-20 items-center gap-2 bg-muted/60 p-3">
                  {v === "bold" ? <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-lg" style={{ background: site.colors.primary }}><span className="h-1.5 w-16 rounded bg-white/90" /><span className="h-1.5 w-10 rounded bg-white/60" /></div>
                    : <><div className="flex flex-1 flex-col gap-1"><span className="h-1.5 w-16 rounded" style={{ background: site.colors.dark }} /><span className="h-1.5 w-12 rounded bg-foreground/30" /><span className="mt-1 h-3 w-10 rounded-full" style={{ background: site.colors.primary }} /></div>
                      {v === "split" ? <div className="h-full w-1/2 rounded-lg bg-foreground/20" /> : <div className="grid h-full w-1/2 grid-cols-2 gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className="rounded bg-foreground/15" />)}</div>}</>}
                </div>
                <div className="p-3"><p className="text-sm font-semibold">{l}</p><p className="text-xs text-muted-foreground">{h}</p></div>
              </button>
            ))}
          </div>
        </Section>
        <Section title="Colours" icon={Palette} description="Website colours (the ERP has its own theme under Theme & appearance).">
          <div className="grid gap-4 sm:grid-cols-3">
            {([["primary", "Main colour"], ["accent", "Second colour"], ["dark", "Headings & footer"]] as const).map(([k, l]) => (
              <Field key={k} label={l}>
                <div className="flex items-center gap-2">
                  <input type="color" value={site.colors[k]} onChange={(e) => set("colors", { [k]: e.target.value } as any)} disabled={dis} className="h-10 w-12 cursor-pointer rounded-lg border border-border bg-transparent" />
                  <input className="fi font-mono" value={site.colors[k]} onChange={(e) => /^#[0-9a-f]{0,6}$/i.test(e.target.value) && set("colors", { [k]: e.target.value } as any)} disabled={dis} />
                </div>
              </Field>
            ))}
          </div>
        </Section>
        <Section title="Hero pictures" icon={Sparkles} description="Up to 4 pictures of your business or products for the top of the home page. Empty: your product photos are used.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <ImageSlot key={i} label="Add picture" url={site.hero.images[i] || ""} disabled={dis}
                onChange={(u) => { const imgs = [...site.hero.images]; imgs[i] = u; set("hero", { images: imgs.filter(Boolean) }); }} />
            ))}
          </div>
        </Section>
        <Section title="Search engines" icon={SearchIcon}>
          {text("Page title", site.seo.title, (v) => set("seo", { title: v }), { max: 70 })}
          {text("Description", site.seo.description, (v) => set("seo", { description: v }), { area: true, max: 160 })}
        </Section>
      </>}

      {tab === "content" && <>
        <Section title="Top bar & announcement" icon={Megaphone}>
          <Toggle label="Show the small bar above the menu (sign in, sign up, phone and email)" checked={site.topbar.show} onChange={(v) => set("topbar", { show: v })} disabled={dis} />
          {text("Announcement strip", s.announcement || "", (v) => up({ announcement: v }), { hint: "A short coloured line above everything, e.g. free delivery this weekend. Leave empty to hide." })}
        </Section>
        <Section title="Hero" icon={Sparkles}>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("Small label", site.hero.badge, (v) => set("hero", { badge: v }), { max: 60 })}
            {text("Headline", site.hero.title, (v) => set("hero", { title: v }), { max: 120 })}
          </div>
          {text("Text", site.hero.text, (v) => set("hero", { text: v }), { area: true, max: 300 })}
          <div className="grid gap-4 sm:grid-cols-2">
            {text("Main button", site.hero.cta, (v) => set("hero", { cta: v }), { max: 30 })}
            {text("Second button", site.hero.cta2, (v) => set("hero", { cta2: v }), { max: 30 })}
          </div>
        </Section>
        <Section title="About (below the hero)" icon={Info}>
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <div className="space-y-4">
              {text("Title", site.about.title, (v) => set("about", { title: v }), { max: 100 })}
              {text("Text", site.about.text, (v) => set("about", { text: v }), { area: true, max: 900 })}
            </div>
            <Field label="Picture"><ImageSlot label="Add picture" url={site.about.image} onChange={(u) => set("about", { image: u })} disabled={dis} /></Field>
          </div>
          <Field label="Highlights" hint="Short points shown with ticks.">
            <div className="space-y-2">
              {site.about.points.map((pt, i) => (
                <div key={i} className="flex gap-2">
                  <input className="fi" maxLength={90} value={pt} disabled={dis} onChange={(e) => set("about", { points: site.about.points.map((x, j) => (j === i ? e.target.value : x)) })} />
                  <Button type="button" size="icon" variant="ghost" disabled={dis} onClick={() => set("about", { points: site.about.points.filter((_, j) => j !== i) })} aria-label="Remove"><X /></Button>
                </div>
              ))}
              {site.about.points.length < 6 && <Button type="button" size="sm" variant="outline" disabled={dis} onClick={() => set("about", { points: [...site.about.points, ""] })}><Plus /> Add a point</Button>}
            </div>
          </Field>
        </Section>
        <Section title="Products & services" icon={ShoppingBag}>
          {text("Services heading", site.services.title, (v) => set("services", { title: v }), { max: 80 })}
          {text("Services statement", site.services.text, (v) => set("services", { text: v }), { area: true, max: 400 })}
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_140px]">
            {text("Products heading", site.products.title, (v) => set("products", { title: v }), { max: 60 })}
            {text("Products subtitle", site.products.text, (v) => set("products", { text: v }), { max: 140 })}
            <Field label="How many"><input className="fi" type="number" min={3} max={48} step={3} value={site.products.count} disabled={dis} onChange={(e) => set("products", { count: Number(e.target.value) })} /></Field>
          </div>
          <p className="text-xs text-muted-foreground">Products marked <b>Featured</b> on the item show first.</p>
        </Section>
        <Section title="Call to action" icon={Megaphone}>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("Title", site.cta.title, (v) => set("cta", { title: v }), { max: 80 })}
            {text("Button", site.cta.button, (v) => set("cta", { button: v }), { max: 30 })}
          </div>
          {text("Text", site.cta.text, (v) => set("cta", { text: v }), { area: true, max: 300 })}
          {text("Button opens", site.cta.link, (v) => set("cta", { link: v }), { hint: "A page on the site such as /shop or /contact, or a full web address." })}
        </Section>
        <Section title="Contact section & footer" icon={MapPin}>
          {text("Contact title", site.contact_section.title, (v) => set("contact_section", { title: v }), { max: 80 })}
          {text("Contact text", site.contact_section.text, (v) => set("contact_section", { text: v }), { area: true, max: 300 })}
          {text("Footer text", site.footer.text, (v) => set("footer", { text: v }), { area: true, max: 300 })}
        </Section>
      </>}

      {tab === "contact" && <>
        <Section title="Contacts" icon={Phone} description="Shown in the top bar, contact section and footer.">
          <div className="grid gap-4 sm:grid-cols-2">
            {text("Phone", site.contact.phone, (v) => set("contact", { phone: v }), { max: 30 })}
            {text("Second phone", site.contact.phone2, (v) => set("contact", { phone2: v }), { max: 30 })}
            {text("WhatsApp number", site.contact.whatsapp, (v) => set("contact", { whatsapp: v }), { max: 30, placeholder: "+2547…" })}
            {text("Email", site.contact.email, (v) => set("contact", { email: v }), { max: 120 })}
            {text("Address", site.contact.address, (v) => set("contact", { address: v }), { max: 200 })}
            {text("Opening hours", site.contact.hours, (v) => set("contact", { hours: v }), { max: 120 })}
          </div>
          {text("Google Maps link", site.contact.map_url, (v) => set("contact", { map_url: v }), { hint: "Paste the share link from Google Maps for the Directions button." })}
        </Section>
        <Section title="Social media" icon={Share2}>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["facebook", "instagram", "tiktok", "x", "youtube"] as const).map((k) => <div key={k}>{text(k === "x" ? "X (Twitter)" : k[0].toUpperCase() + k.slice(1), site.social[k], (v) => set("social", { [k]: v } as any), { placeholder: "https://…" })}</div>)}
          </div>
        </Section>
      </>}

      {tab === "checkout" && <>
        <Section title="Delivery & checkout" icon={Store}>
          <div className="grid gap-2 sm:grid-cols-3">
            <Toggle label="Pickup at the company" checked={s.pickup} onChange={(v) => up({ pickup: v })} disabled={dis} />
            <Toggle label="Delivery" checked={s.delivery} onChange={(v) => up({ delivery: v })} disabled={dis} />
            <Toggle label="Pay on delivery / pickup" checked={s.pay_on_delivery} onChange={(v) => up({ pay_on_delivery: v })} disabled={dis} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Delivery fee (KES)"><input className="fi" type="number" min={0} value={s.delivery_fee} onChange={(e) => up({ delivery_fee: e.target.value })} disabled={dis} /></Field>
            <Field label="Free delivery over (KES)" hint="0 = never free"><input className="fi" type="number" min={0} value={s.free_delivery_over} onChange={(e) => up({ free_delivery_over: e.target.value })} disabled={dis} /></Field>
            <Field label="Minimum order (KES)" hint="0 = no minimum"><input className="fi" type="number" min={0} value={s.min_order} onChange={(e) => up({ min_order: e.target.value })} disabled={dis} /></Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle label="Take orders for items not yet counted in stock" hint="Turn off after the first stock-take so only items in stock can be ordered." checked={s.sell_out_of_stock} onChange={(v) => up({ sell_out_of_stock: v })} disabled={dis} />
            <Toggle label="New website sign-ups wait for approval" hint="They appear under Customers → Pending approval." checked={s.approve_signups} onChange={(v) => up({ approve_signups: v })} disabled={dis} />
          </div>
          <p className="text-xs text-muted-foreground">Online M-Pesa payments use the payment gateway in use (JMSURF PAY by default). Paid orders deduct stock and appear in Sales → Online Orders.</p>
        </Section>
      </>}

      {canManage && <div className="sticky bottom-2 z-10 flex justify-end"><Button onClick={submit} className="shadow-lg"><CheckCircle2 /> Save website</Button></div>}
    </div>
  );
}

