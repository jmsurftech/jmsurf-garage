import { PageHeader, Panel, Field } from "@/components/kit";
import { SELLS_OPTIONS } from "@/lib/sells";
import { lazy as lazyTax } from "react";
const TaxTab = lazyTax(() => import("@/pages/settings/TaxTab"));
import DocContactPanel from "@/components/DocContactPanel";
import { CURRENCIES } from "@/lib/currencies";
import { COUNTRY_GROUPS, countryByCode } from "@/lib/countries";
import { setCurrency } from "@/lib/format";
import { Settings as SettingsIcon } from "lucide-react";
import { currencyCode } from "@/lib/format";
import PageHead from "@/components/PageHead";
import { useEffect, useMemo, useState } from "react";
import {
  Building2, ReceiptText, Percent, Smartphone, Plus, Save,
  MapPin, UserCog, Bell, Mail, Shield, X, Trash2, CreditCard, Palette, Check, Send, Barcode, Phone, MessageSquare, Landmark, Banknote, Globe, Globe2, Database, Wallet, CheckCircle2, PlugZap, Loader2,
} from "lucide-react";
import AccountDataTab from "@/components/AccountDataTab";
import MessagingSettingsTab from "@/components/MessagingSettingsTab";
import GatewaysPanel from "@/components/GatewaysPanel";
import BankAccountSettings from "@/components/BankAccountSettings";
import LocationsSettingsTab from "@/components/LocationsSettingsTab";
import ReceiptTemplatesPanel from "@/components/ReceiptTemplatesPanel";
import type { ReceiptTemplateId } from "@/lib/receiptTemplates";


import RoleSettings from "@/components/RoleSettings";
import LogoUpload from "@/components/LogoUpload";
import { useAuth } from "@/hooks/useAuth";
import { useAllUserLocations, useBusinessSettings, useLocations, useStaff } from "@/hooks/useData";
import { useTenant } from "@/hooks/useTenant";
import { useTenantId } from "@/hooks/useTenantId";
import { useInventorySettings } from "@/hooks/useInventorySettings";
import { supabase } from "@/integrations/supabase/client";
import { offlineMutate } from "@/lib/offlineMutate";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVatEnabled } from "@/hooks/useVatEnabled";
import { useBusinessType } from "@/hooks/useBusinessType";
import { BUSINESS_TYPES, type BusinessType } from "@/lib/businessType";
import { Store } from "lucide-react";
import { KENYA_BANK_PAYBILLS } from "@/lib/kenyaBanks";
import { registerPayoutChannel, listPayoutBanks, jmsurfSettings, registerJmsurf } from "@/lib/serverPayments";


/* ───── Business Settings Tab ───── */
export function BusinessTab({ canManage, mode = "business" }: { canManage: boolean; mode?: "business" | "receipts" }) {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant, refetch: refetchTenant } = useTenant();
  const { data: settings } = useBusinessSettings();
  const { data: locations = [] } = useLocations();
  const { data: staff = [] } = useStaff();
  const { data: assignments = [] } = useAllUserLocations();

  const [saving, setSaving] = useState(false);
  // Saved feedback stays on the button (no pop-up); it clears by itself.
  const [savedAt, setSavedAt] = useState(0);
  useEffect(() => { if (!savedAt) return; const t = setTimeout(() => setSavedAt(0), 2500); return () => clearTimeout(t); }, [savedAt]);
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationCode, setNewLocationCode] = useState("");

  const [form, setForm] = useState({
    business_name: "", business_phone: "", business_email: "",
    business_address: "", tax_pin: "", default_vat_rate: "16", currency: "KES", country: "KE", sells: "both",
    receipt_header: "Point of Sale System", receipt_footer: "Thank you for shopping with us!", receipt_terms: "",
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      business_name: settings.business_name || "",
      business_phone: settings.business_phone || "",
      business_email: settings.business_email || "",
      business_address: settings.business_address || "",
      tax_pin: settings.tax_pin || "",
      sells: (settings as any).sells || "both",
      default_vat_rate: String(settings.default_vat_rate ?? 16),
      currency: (settings as any).currency || "KES",
      country: (settings as any).country || "KE",
      receipt_header: settings.receipt_header || "Point of Sale System",
      receipt_footer: settings.receipt_footer || "Thank you for shopping with us!",
      receipt_terms: (settings as any).receipt_terms || "",
    });
  }, [settings]);

  // Template choice is saved on its own, the moment the shop presses Apply.
  const applyTemplate = async (id: ReceiptTemplateId) => {
    if (!canManage) return false;
    try {
      if (settings?.id) {
        await offlineMutate({
          table: "business_settings", action: "update",
          payload: { id: settings.id, receipt_template: id, updated_by: user?.id || null }, cacheStore: "business_settings",
        });
      } else {
        await offlineMutate({
          table: "business_settings", action: "insert",
          payload: { business_name: form.business_name.trim() || "My Company", receipt_template: id, tenant_id: profile?.tenant_id || null, updated_by: user?.id || null },
          cacheStore: "business_settings",
        });
      }
    } catch (e: any) {
      toast({ title: "Could not apply the template", description: e?.message, variant: "destructive" });
      return false;
    }
    queryClient.invalidateQueries({ queryKey: ["business-settings"] });
    toast({ title: "Receipt template applied", description: "New receipts will print with this layout." });
    return true;
  };

  const saveSettings = async () => {
    if (!canManage) return;
    if (!form.business_name.trim()) { toast({ title: "Enter your business name", variant: "destructive" }); return; }
    setSaving(true);
    // Only business fields: payment gateway settings are saved on their own tab,
    // so saving the profile can never undo a gateway change.
    const payload: any = {
      business_name: form.business_name.trim(),
      business_phone: form.business_phone || null,
      business_email: form.business_email || null,
      business_address: form.business_address || null,
      tax_pin: form.tax_pin || null,
      sells: (form as any).sells || "both",
      default_vat_rate: Math.max(0, Math.min(100, Number(form.default_vat_rate))) || 0,
      currency: form.currency,
      country: form.country,
      receipt_header: form.receipt_header,
      receipt_footer: form.receipt_footer,
      receipt_terms: form.receipt_terms.trim() || null,
      updated_by: user?.id || null,
    };
    let error: any;
    let offline = false;
    try {
      if (settings?.id) {
        const res = await offlineMutate({
          table: "business_settings", action: "update",
          payload: { id: settings.id, ...payload }, cacheStore: "business_settings",
        });
        offline = res.offline;
      } else {
        payload.tenant_id = profile?.tenant_id || null;
        const id = navigator.onLine ? undefined : crypto.randomUUID();
        const res = await offlineMutate({
          table: "business_settings", action: "insert",
          payload: id ? { id, ...payload } : payload, cacheStore: "business_settings",
        });
        offline = res.offline;
      }
    } catch (e) { error = e; }
    setSaving(false);
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    // Only what changed is refreshed: reloading the whole shop on every save made the screen jump.
    if (form.currency !== ((settings as any)?.currency || "KES")) setCurrency(form.currency);
    queryClient.invalidateQueries({ queryKey: ["business-settings"] });
    if (profile?.tenant_id && navigator.onLine && form.business_name.trim() !== (tenant?.business_name || "")) {
      await (supabase as any).from("tenants").update({ business_name: form.business_name.trim() }).eq("id", profile.tenant_id);
      refetchTenant();
    }
    if (offline) toast({ title: "Saved offline — it will sync when you are back online" });
    else setSavedAt(Date.now());
  };

  const locationMap = useMemo(() => {
    const map = new Map<string, string>();
    locations.forEach((l) => map.set(l.id, l.name));
    return map;
  }, [locations]);

  const primaryLocationByUser = useMemo(() => {
    const map = new Map<string, string>();
    assignments.forEach((a) => {
      if (a.is_primary && !map.has(a.user_id)) map.set(a.user_id, a.location_id);
    });
    return map;
  }, [assignments]);

  const addLocation = async () => {
    if (!canManage || !newLocationName.trim()) return;
    const { error } = await supabase.from("locations" as any).insert({ name: newLocationName.trim(), code: newLocationCode.trim() || null, tenant_id: profile?.tenant_id || null });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setNewLocationName(""); setNewLocationCode("");
    queryClient.invalidateQueries({ queryKey: ["locations"] });
    toast({ title: "Location added" });
  };

  const assignStaffLocation = async (userId: string, locationId: string) => {
    if (!canManage) return;
    await supabase.from("user_locations" as any).update({ is_primary: false }).eq("user_id", userId);
    const { error } = await supabase.from("user_locations" as any).upsert(
      { user_id: userId, location_id: locationId, is_primary: true },
      { onConflict: "user_id,location_id" }
    );
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["all-user-locations"] });
    queryClient.invalidateQueries({ queryKey: ["user-locations"] });
    toast({ title: "Staff assignment updated" });
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const sample = 1250;
  const currencyChanged = !!settings && ((settings as any).currency || "KES") !== form.currency;

  return (
    <div className="space-y-5">
      {mode === "business" && <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Business profile" description="Shown on receipts, invoices and quotes." icon={Building2}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" required className="sm:col-span-2"><input className="fi" value={form.business_name} onChange={set("business_name")} disabled={!canManage} /></Field>
            <Field label="Phone"><input className="fi" value={form.business_phone} onChange={set("business_phone")} placeholder="Include the country code" disabled={!canManage} /></Field>
            <Field label="Email"><input className="fi" type="email" value={form.business_email} onChange={set("business_email")} disabled={!canManage} /></Field>
            <Field label="Address" className="sm:col-span-2"><textarea className="fi" rows={2} value={form.business_address} onChange={set("business_address")} disabled={!canManage} /></Field>
            <Field label="What do you sell?" className="sm:col-span-2" hint={SELLS_OPTIONS.find((o) => o.value === (form as any).sells)?.hint}>
              <div className="grid gap-2 sm:grid-cols-3">
                {SELLS_OPTIONS.map((o) => (
                  <button key={o.value} type="button" disabled={!canManage} onClick={() => setForm((f: any) => ({ ...f, sells: o.value }))}
                    className={`rounded-xl border-2 px-3 py-2 text-left text-sm font-medium transition ${(form as any).sells === o.value ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40"}`}>{o.label}</button>
                ))}
              </div>
            </Field>
          </div>
        </Panel>

        <Panel title="Logo" description="Appears on the app, receipts and documents." icon={Palette}>
          <LogoUpload />
        </Panel>

        <Panel title="Country, currency and tax" description="Used for every price, receipt and report." icon={Percent}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Country" hint="Choosing a country sets its usual currency">
              <select className="fi" value={form.country} disabled={!canManage}
                onChange={(e) => { const c = countryByCode(e.target.value); setForm((f) => ({ ...f, country: e.target.value, currency: c?.currency || f.currency })); }}>
                {COUNTRY_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.items.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field label="Currency" hint={`Example: ${form.currency} ${sample.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}>
              <select className="fi" value={form.currency} onChange={set("currency")} disabled={!canManage}>
                <optgroup label="Africa">
                  {CURRENCIES.filter((c) => c.region === "Africa").map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                </optgroup>
                <optgroup label="Rest of the world">
                  {CURRENCIES.filter((c) => c.region === "World").map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                </optgroup>
              </select>
            </Field>
            <Field label="Tax ID" hint="e.g. KRA PIN, TIN or VAT number"><input className="fi" value={form.tax_pin} onChange={set("tax_pin")} disabled={!canManage} /></Field>
            <p className="sm:col-span-2 text-xs text-muted-foreground">VAT rates, VAT registration and withholding VAT: <Link to="/settings?tab=taxes" className="font-medium text-primary hover:underline">System → Taxes (VAT)</Link>.</p>
            <div className="sm:col-span-2"><VatToggle /></div>
            <VatRateField value={form.default_vat_rate} onChange={(v) => setForm((f) => ({ ...f, default_vat_rate: v }))} disabled={!canManage} />
          </div>
          {currencyChanged && (
            <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
              Changing currency relabels your existing prices — it does not convert them. {form.currency !== "KES" && "M-Pesa prompts still charge in Kenyan shillings; use a gateway for your country under Payment Gateways → More gateways."}
            </p>
          )}
        </Panel>

        <div className="xl:col-span-2"><DocContactPanel canManage={canManage} /></div>
      </div>}

      {mode === "receipts" && <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Receipt" description="Top and bottom lines of every printed receipt." icon={ReceiptText}>
          <div className="grid gap-4">
            <Field label="Header"><input className="fi" value={form.receipt_header} onChange={set("receipt_header")} disabled={!canManage} /></Field>
            <Field label="Footer"><textarea className="fi" rows={2} value={form.receipt_footer} onChange={set("receipt_footer")} disabled={!canManage} /></Field>
            <Field label="Terms and conditions" hint="Printed at the bottom of every receipt. Leave empty to print none.">
              <textarea className="fi" rows={4} maxLength={1500} value={form.receipt_terms} onChange={set("receipt_terms")} disabled={!canManage}
                placeholder={"e.g. Goods once sold cannot be returned after 7 days.\nKeep this receipt for warranty claims."} />
            </Field>
          </div>
          <div className="mx-auto mt-4 w-full max-w-[240px] rounded-lg border border-dashed border-border bg-background p-3 text-center font-mono text-[11px] leading-relaxed">
            <p className="font-bold">{form.business_name || "Your business"}</p>
            <p className="text-muted-foreground">{form.receipt_header}</p>
            <p className="my-1.5 border-y border-dashed border-border py-1.5 text-left">1 × Item<span className="float-right">{form.currency} {sample.toLocaleString("en-US")}</span></p>
            <p className="text-muted-foreground">{form.receipt_footer}</p>
            {form.receipt_terms.trim() && (
              <p className="mt-1.5 whitespace-pre-line border-t border-dashed border-border pt-1.5 text-left text-[10px] text-muted-foreground">{form.receipt_terms.trim()}</p>
            )}
            <p className="mt-1.5 text-[10px] font-semibold">Powered by JMSURF TECHNOLOGIES</p>
          </div>
        </Panel>
      </div>}

      {mode === "business" && <LocationsSettingsTab canManage={canManage} />}

      {mode === "receipts" && <ReceiptTemplatesPanel
        current={(settings as any)?.receipt_template}
        businessName={form.business_name}
        phone={form.business_phone}
        address={form.business_address}
        footer={form.receipt_footer}
        terms={form.receipt_terms}
        logoUrl={tenant?.logo_url}
        canManage={canManage}
        onApply={applyTemplate}
      />}

      {canManage && (
        <div className="sticky bottom-3 z-10 flex justify-end md:bottom-4">
          <Button onClick={saveSettings} disabled={saving} className="shadow-lg">{savedAt ? <Check /> : <Save />} {saving ? "Saving…" : savedAt ? "Saved" : mode === "receipts" ? "Save receipt settings" : "Save business settings"}</Button>
        </div>
      )}
    </div>
  );
}

/* ───── Payment Gateways Tab (Aggregator-first) ───── */
function PaymentGatewaysTab({ canManage }: { canManage: boolean }) {
  const { user, profile } = useAuth();
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = useBusinessSettings();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    payment_provider: "jmsurf" as "mpesa" | "bank" | "paystack" | "daraja" | "jmsurf",
    jmsurf_type: "till" as "till" | "paybill" | "bank",
    jmsurf_business_number: "",
    jmsurf_account_number: "",
    jmsurf_account_name: "",
    mpesa_type: "" as "" | "paybill" | "till" | "bank", // empty = nothing chosen yet (input hidden)
    // Independent fields — selecting one channel never overwrites another.
    paybill_number: "",
    till_number: "",
    // Bank is now its own provider, powered by PayHero bank paybills list.
    bank_paybill_id: "",        // PayHero bank id (uuid)
    bank_name: "",              // Friendly bank name (e.g. "Equity Bank")
    bank_short_code: "",        // PayHero paybill for the chosen bank
    bank_account_number: "",
    bank_account_name: "",
    paystack_public_key: "",
    paystack_secret_key: "",
    // STK push merchant label (shown to customer on M-Pesa prompt)
    stk_label_mode: "tenant" as "tenant" | "jmsurf" | "custom",
    stk_label_override: "",
    // Direct Safaricom Daraja (per-tenant M-Pesa app credentials)
    daraja_type: "paybill" as "paybill" | "till",
    daraja_shortcode: "",
    daraja_till_number: "",
    daraja_consumer_key: "",
    daraja_consumer_secret: "",
    daraja_passkey: "",
    daraja_environment: "live" as "live" | "sandbox",
    daraja_account_reference: "",
  });
  const [lastPayheroError, setLastPayheroError] = useState<{ message: string; details?: any } | null>(null);
  const [banksLoading, setBanksLoading] = useState(false);
  const [banks, setBanks] = useState<{ id: string; name: string; paybill: string }[]>(KENYA_BANK_PAYBILLS);
  const [jmsurfConfigured, setJmsurfConfigured] = useState(false);
  // Daraja test STK state
  const [darajaTestPhone, setDarajaTestPhone] = useState("");
  const [darajaTesting, setDarajaTesting] = useState(false);
  const [darajaTestResult, setDarajaTestResult] = useState<{ ok: boolean; message: string; checkout?: string } | null>(null);

  // Aggregator merchant record (Till/Paybill lives here; tenants never see Daraja keys).
  const [aggMerchant, setAggMerchant] = useState<any>(null);
  const tenantSlug = (tenant?.slug || profile?.tenant_id || "").toString().toLowerCase();

  // Existing PayHero channels for this tenant
  const [channels, setChannels] = useState<any[]>([]);

  useEffect(() => {
    if (tenant?.business_name) {
      setForm((f) => ({ ...f, jmsurf_account_name: f.jmsurf_account_name || tenant.business_name }));
    }
  }, [tenant?.business_name]);

  useEffect(() => {
    const tenantId = tenant?.id || profile?.tenant_id;
    if (!tenantId) return;
    let active = true;
    void jmsurfSettings({ tenant_id: tenantId }).then(({ data, error }) => {
      if (!active || error || !data) return;
      setJmsurfConfigured(Boolean(data.configured));
      if (data.configured) setForm((f) => ({
        ...f,
        jmsurf_type: data.destination_type as "till" | "paybill" | "bank",
        jmsurf_business_number: data.business_number || "",
        jmsurf_account_number: data.account_number || "",
        jmsurf_account_name: data.account_name || "",
      }));
    });
    return () => { active = false; };
  }, [profile?.tenant_id, tenant?.id, saving]);

  useEffect(() => {
    if (!tenantSlug) return;
    (async () => {
      const { data } = await supabase
        .from("aggregator_tenants" as any)
        .select("*")
        .eq("slug", tenantSlug)
        .maybeSingle();
      setAggMerchant(data || null);

      const { data: ch } = await supabase
        .from("tenant_payout_channels" as any)
        .select("*")
        .order("created_at", { ascending: false });
      setChannels(ch || []);
    })();
  }, [tenantSlug, saving]);

  useEffect(() => {
    if (!settings) return;
    const s: any = settings;
    // Database is source of truth for the saved M-Pesa channel & STK label.
    // Prefer DB values over the local cache so a user always sees what's actually saved.
    const dbType: "" | "paybill" | "till" =
      (s.mpesa_till_number && String(s.mpesa_till_number).trim())
        ? "till"
        : (s.mpesa_shortcode && String(s.mpesa_shortcode).trim())
        ? "paybill"
        : "";
    setForm((f) => ({
      ...f,
      // PayHero is retired here: shops on it are shown JMSURF PAY (the default) to switch to.
      payment_provider: (["bank", "mpesa", "payhero"].includes(s.payment_provider) ? "jmsurf" : ((s.payment_provider as any) || "jmsurf")) as any,
      paystack_public_key: "",
      paystack_secret_key: "",
      stk_label_mode: (s.stk_label_mode as any) || "tenant",
      stk_label_override: s.stk_label_override || "",
      // Hydrate from DB. Fall back to whatever is already in form (e.g. local cache).
      mpesa_type: s.payment_provider === "bank" ? "bank" : (dbType || f.mpesa_type),
      paybill_number: dbType === "paybill" ? String(s.mpesa_shortcode || "") : f.paybill_number,
      till_number: dbType === "till" ? String(s.mpesa_till_number || "") : f.till_number,
      // Direct Daraja hydrate (only when provider is daraja, otherwise keep blank inputs).
      daraja_type: (s.payment_provider === "daraja"
        ? (s.mpesa_till_number ? "till" : "paybill")
        : f.daraja_type),
      daraja_shortcode: s.payment_provider === "daraja" ? String(s.mpesa_shortcode || "") : f.daraja_shortcode,
      daraja_till_number: s.payment_provider === "daraja" ? String(s.mpesa_till_number || "") : f.daraja_till_number,
      daraja_environment: (s.mpesa_environment as any) || f.daraja_environment,
      daraja_account_reference: s.mpesa_account_reference || f.daraja_account_reference,
      // Secret-like fields: never prefill — show placeholder masked status instead.
      daraja_consumer_key: "",
      daraja_consumer_secret: "",
      daraja_passkey: "",
    }));
  }, [settings]);

  // Local-storage cache for the M-Pesa channel selection so it survives refresh
  // before the aggregator/channel records load. Scoped per tenant slug.
  const MPESA_CACHE_KEY = tenantSlug ? `jmsurf_mpesa_choice::${tenantSlug}` : "";

  // Restore cached selection on mount
  useEffect(() => {
    if (!MPESA_CACHE_KEY) return;
    try {
      const raw = localStorage.getItem(MPESA_CACHE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as { type?: "paybill" | "till"; paybill?: string; till?: string };
      setForm((f) => ({
        ...f,
        mpesa_type: f.mpesa_type || (cached.type ?? ""),
        paybill_number: f.paybill_number || cached.paybill || "",
        till_number: f.till_number || cached.till || "",
      }));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [MPESA_CACHE_KEY]);

  // Persist on change
  useEffect(() => {
    if (!MPESA_CACHE_KEY) return;
    if (!form.mpesa_type) return;
    try {
      localStorage.setItem(
        MPESA_CACHE_KEY,
        JSON.stringify({ type: form.mpesa_type, paybill: form.paybill_number, till: form.till_number }),
      );
    } catch {}
  }, [MPESA_CACHE_KEY, form.mpesa_type, form.paybill_number, form.till_number]);

  // Hydrate Till/Paybill from aggregator record into the right independent field.
  useEffect(() => {
    if (!aggMerchant) return;
    const type: "paybill" | "till" = aggMerchant.mpesa_type === "till" ? "till" : "paybill";
    setForm((f) => ({
      ...f,
      // Only seed mpesa_type if user hasn't picked yet
      mpesa_type: f.mpesa_type || type,
      paybill_number: type === "paybill" ? (aggMerchant.mpesa_number || f.paybill_number) : f.paybill_number,
      till_number: type === "till" ? (aggMerchant.mpesa_number || f.till_number) : f.till_number,
    }));
  }, [aggMerchant]);

  // Hydrate Bank from existing tenant_payout_channels
  useEffect(() => {
    const bank = channels.find((c) => c.channel_type === "bank" && c.is_active);
    if (bank) {
      setForm((f) => ({
        ...f,
        bank_short_code: f.bank_short_code || String(bank.short_code || ""),
        bank_account_number: f.bank_account_number || String(bank.account_number || ""),
        // description format: "Bank: <Name> · A/C Holder: <Name>"
        bank_name: f.bank_name || String(bank.description || "").match(/Bank:\s*([^·]+)/)?.[1]?.trim() || "",
        bank_account_name: f.bank_account_name || String(bank.description || "").match(/A\/C Holder:\s*(.+)$/)?.[1]?.trim() || "",
      }));
    }
  }, [channels]);

  // Auto-load PayHero bank list on mount with localStorage cache (24h)
  useEffect(() => {
    const CACHE_KEY = "payhero_banks_v1";
    const TTL_MS = 24 * 60 * 60 * 1000;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.ts && Date.now() - parsed.ts < TTL_MS && Array.isArray(parsed.banks)) {
          setBanks(parsed.banks);
        }
      }
    } catch {}
    setBanksLoading(true);
    listPayoutBanks()
      .then(({ data }) => {
        // The dropdown always has the standard Kenyan bank list, so a failure here
        // is never shown as an error — we just keep what we already have.
        const list = Array.isArray(data?.banks) ? data.banks : [];
        if (!list.length) return;
        setBanks(list as any);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), banks: list })); } catch {}
      })
      .catch(() => {})
      .finally(() => setBanksLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build payload for the active channel only — never sends Paybill while Till is selected, etc.
  const buildChannelPayload = () => {
    if (form.payment_provider === "bank" || (form.payment_provider === "mpesa" && form.mpesa_type === "bank")) {
      return {
        valid:
          /^\d{4,7}$/.test(form.bank_short_code) &&
          form.bank_account_number.trim().length >= 4 &&
          form.bank_account_name.trim().length >= 2 &&
          !!form.bank_name,
        validationMessage: "Select a bank, then enter a valid account number (min 4 chars) and account holder name.",
        short_code: String(form.bank_short_code).trim(),
        account_number: String(form.bank_account_number).trim(),
        channel_type: "bank" as const,
        description: `Bank: ${form.bank_name} · A/C Holder: ${form.bank_account_name.trim()}`,
      };
    }
    const t = form.mpesa_type;
    if (t === "paybill") {
      return {
        valid: /^\d{5,7}$/.test(form.paybill_number),
        validationMessage: "Paybill number must be 5–7 digits.",
        short_code: String(form.paybill_number).trim(),
        account_number: "",
        channel_type: "paybill" as const,
        description: "",
      };
    }
    if (t === "till") {
      return {
        valid: /^\d{5,7}$/.test(form.till_number),
        validationMessage: "Till number must be 5–7 digits.",
        short_code: String(form.till_number).trim(),
        account_number: "",
        channel_type: "till" as const,
        description: "",
      };
    }
    return {
      valid: false,
      validationMessage: "Choose Paybill or Till from the dropdown.",
      short_code: "",
      account_number: "",
      channel_type: "paybill" as const,
      description: "",
    };
  };

  const registerPayheroChannel = async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    const ch = buildChannelPayload();
    if (!ch.valid) {
      toast({ title: "Invalid input", description: ch.validationMessage, variant: "destructive" });
      return { ok: false, message: ch.validationMessage };
    }
    setLastPayheroError(null);
    const { data: phData, error: phError } = await registerPayoutChannel({
      channel_type: ch.channel_type,
      short_code: ch.short_code, // always a string
      account_number: ch.account_number,
      description: `${tenant?.business_name || tenantSlug} - ${ch.channel_type}`,
      tenant_id: profile?.tenant_id || tenant?.id || null,
      tenant_slug: tenantSlug || null,
    });
    if ((phData as any)?.pending) {
      // Destination stored; the network link finishes on its own later.
      return { ok: true };
    }
    if (phError) {
      const details = (phData as any)?.details;
      setLastPayheroError({ message: phError, details });
      return { ok: false, message: `${phError}${details?.error_message ? ` — ${details.error_message}` : ""}` };
    }
    return { ok: true };
  };

  const save = async () => {
    if (!canManage) return;
    if (form.payment_provider === "jmsurf") {
      const tenantId = tenant?.id || profile?.tenant_id;
      if (!tenantId) {
        toast({ title: "Company not found", variant: "destructive" });
        return;
      }
      setSaving(true);
      try {
        const { data, error } = await registerJmsurf({
          tenant_id: tenantId,
          destination_type: form.jmsurf_type,
          business_number: form.jmsurf_business_number,
          account_number: form.jmsurf_account_number,
          account_name: form.jmsurf_account_name,
        });
        if (error || !data?.success) throw new Error(error || "JMSURF PAY did not confirm this account");
        const payload = { payment_provider: "jmsurf", updated_by: user?.id || null };
        const result = settings?.id
          ? await supabase.from("business_settings" as any).update(payload).eq("id", settings.id)
          : await supabase.from("business_settings" as any).insert({ ...payload, tenant_id: tenantId });
        if (result.error) throw result.error;
        // One gateway at a time: switching to JMSURF retires any PayHero link.
        await (supabase as any)
          .from("tenant_payout_channels")
          .update({ is_active: false, is_default: false })
          .eq("tenant_id", tenantId);
        setJmsurfConfigured(true);
        queryClient.invalidateQueries({ queryKey: ["business-settings"] });
        toast({ title: "JMSURF gateway is ready", description: "M-Pesa payments will settle to this account." });
      } catch (e: any) {
        toast({ title: "JMSURF was not activated", description: e?.message || "Check the settlement details and try again.", variant: "destructive" });
      } finally { setSaving(false); }
      return;
    }
    // Provider-specific pre-save validation (frontend)
    if (form.payment_provider === "mpesa" && form.mpesa_type !== "bank") {
      if (!form.mpesa_type) {
        toast({ title: "Choose Paybill or Till", description: "Select an M-Pesa channel before saving.", variant: "destructive" });
        return;
      }
      const code = form.mpesa_type === "till" ? form.till_number : form.paybill_number;
      if (!/^\d{5,7}$/.test(String(code))) {
        toast({ title: "Invalid number", description: `${form.mpesa_type === "till" ? "Till" : "Paybill"} must be 5–7 digits.`, variant: "destructive" });
        return;
      }
    }
    if (form.payment_provider === "bank" || (form.payment_provider === "mpesa" && form.mpesa_type === "bank")) {
      if (!form.bank_paybill_id || !form.bank_name) {
        toast({ title: "Select your bank", description: "Pick a bank from the dropdown before saving.", variant: "destructive" });
        return;
      }
      if (form.bank_account_name.trim().length < 2) {
        toast({ title: "Account holder name required", description: "Enter the full name on the bank account.", variant: "destructive" });
        return;
      }
      if (!/^[A-Za-z0-9-]{4,32}$/.test(form.bank_account_number.trim())) {
        toast({ title: "Invalid account number", description: "Bank account number must be 4–32 alphanumeric characters.", variant: "destructive" });
        return;
      }
    }
    if (form.payment_provider === "daraja") {
      const isTill = form.daraja_type === "till";
      const code = isTill ? form.daraja_till_number : form.daraja_shortcode;
      if (!/^\d{5,7}$/.test(String(code || ""))) {
        toast({ title: "Invalid shortcode", description: `Enter a valid 5–7 digit ${isTill ? "Till" : "Paybill"} number.`, variant: "destructive" });
        return;
      }
      // For Buy Goods (Till), Account Reference is not used by Daraja — make sure it's not set.
      if (isTill && form.daraja_account_reference.trim()) {
        toast({ title: "Account Reference not allowed", description: "Buy Goods (Till) channels ignore Account Reference. Clear it or switch to Paybill.", variant: "destructive" });
        return;
      }
      const savedKey  = !!(settings as any)?.has_mpesa_consumer_key;
      const savedSec  = !!(settings as any)?.has_mpesa_consumer_secret;
      const savedPass = !!(settings as any)?.has_mpesa_passkey;
      if (!(form.daraja_consumer_key.trim() || savedKey)) {
        toast({ title: "Consumer Key required", description: "Paste the Consumer Key from your Daraja app.", variant: "destructive" }); return;
      }
      if (!(form.daraja_consumer_secret.trim() || savedSec)) {
        toast({ title: "Consumer Secret required", description: "Paste the Consumer Secret from your Daraja app.", variant: "destructive" }); return;
      }
      if (!(form.daraja_passkey.trim() || savedPass)) {
        toast({ title: "Passkey required", description: "Paste the Lipa na M-Pesa Passkey from the Daraja portal.", variant: "destructive" }); return;
      }
      if (form.daraja_passkey.trim() && form.daraja_passkey.trim().length < 32) {
        toast({ title: "Passkey looks too short", description: "Daraja passkeys are normally 64 hex characters. Double-check the value.", variant: "destructive" });
        return;
      }
    }
    
    setSaving(true);
    try {
      const ch = buildChannelPayload();
      if ((form.payment_provider === "mpesa" || form.payment_provider === "bank") && !ch.valid) {
        throw new Error(ch.validationMessage);
      }
      // 1. Save provider choice + Paystack creds in business_settings.
      //    SECURITY: secret fields are only included when the user typed a new value;
      //    otherwise we leave the stored value untouched (the browser never received it).
      const isDaraja = form.payment_provider === "daraja";
      const payload: any = {
        payment_provider: form.payment_provider,
        paystack_public_key: form.paystack_public_key || "",
        use_platform_mpesa: !isDaraja,
        mpesa_environment: isDaraja ? form.daraja_environment : ((settings as any)?.mpesa_environment || "live"),
        mpesa_account_reference: isDaraja ? (form.daraja_account_reference || "") : ((settings as any)?.mpesa_account_reference || ""),
        // Independent storage: only the active M-Pesa channel's number is saved.
        mpesa_shortcode: isDaraja
          ? (form.daraja_type === "paybill" ? form.daraja_shortcode : null)
          : (form.payment_provider === "mpesa" && form.mpesa_type === "paybill" ? (ch.short_code || null) : null),
        mpesa_till_number: isDaraja
          ? (form.daraja_type === "till" ? form.daraja_till_number : "")
          : (form.payment_provider === "mpesa" && form.mpesa_type === "till" ? ch.short_code : ""),
        mpesa_transaction_type: isDaraja
          ? (form.daraja_type === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline")
          : (form.mpesa_type === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline"),
        stk_label_mode: form.stk_label_mode,
        stk_label_override: form.stk_label_mode === "custom" ? sanitizeStkLabel(form.stk_label_override) : null,
        updated_by: user?.id || null,
      };
      if (form.paystack_secret_key.trim()) payload.paystack_secret_key = form.paystack_secret_key.trim();
      if (isDaraja) {
        if (form.daraja_consumer_key.trim())    payload.mpesa_consumer_key    = form.daraja_consumer_key.trim();
        if (form.daraja_consumer_secret.trim()) payload.mpesa_consumer_secret = form.daraja_consumer_secret.trim();
        if (form.daraja_passkey.trim())         payload.mpesa_passkey         = form.daraja_passkey.trim();
      } else {
        // Switching away from Daraja clears the stored Daraja credentials.
        payload.mpesa_consumer_key = "";
        payload.mpesa_consumer_secret = "";
        payload.mpesa_passkey = "";
      }
      if (settings?.id) {
        const { error } = await supabase.from("business_settings" as any).update(payload).eq("id", settings.id);
        if (error) throw error;
      } else {
        payload.tenant_id = profile?.tenant_id || tenant?.id || null;
        const { error } = await supabase.from("business_settings" as any).insert(payload);
        if (error) throw error;
      }

      // Your details are already saved at this point. The steps below link the
      // number with the payment network; if that link fails we keep the save.
      const warnings: string[] = [];

      // 2. Link the Till / Paybill / bank account with the payment network.
      if (form.payment_provider === "mpesa" || form.payment_provider === "bank") {
        try {
          const registration = await registerPayheroChannel();
          if (registration.ok === false) warnings.push(registration.message);
        } catch (err: any) {
          warnings.push(err?.message || "Payout channel could not be registered.");
        }
      }

      queryClient.invalidateQueries({ queryKey: ["business-settings"] });
      setForm((f) => ({ ...f, paystack_public_key: "", paystack_secret_key: "", daraja_consumer_key: "", daraja_consumer_secret: "", daraja_passkey: "" }));
      if (warnings.length) {
        toast({
          title: "Saved successfully",
          description: "Your payment details are active. Linking with the payout network will finish shortly.",
        });
        console.warn("[settings] payout link warnings", warnings);
      } else {
        toast({ title: "Saved successfully" });
      }
    } catch (e: any) {
      toast({ title: "Could not save", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const clearProviderConfig = async (which: "mpesa" | "paystack") => {
    if (!canManage) return;
    if (which === "mpesa") {
      if (!(await confirmAction({ title: "Remove your Till/Paybill from JMSURF Pay?", message: "Customer M-Pesa payments will stop until you set a new number.", danger: true, confirmLabel: "Remove" }))) return;
      const shopId = profile?.tenant_id || tenant?.id;
      if (shopId) {
        const { error } = await (supabase as any)
          .from("tenant_payout_channels")
          .update({ is_active: false, is_default: false })
          .eq("tenant_id", shopId);
        if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
      }
      if (settings?.id) {
        await supabase.from("business_settings" as any).update({ mpesa_shortcode: null, mpesa_till_number: "" }).eq("id", settings.id);
      }
      setAggMerchant((prev: any) => prev ? { ...prev, is_active: false, mpesa_number: "" } : null);
      setForm((f) => ({ ...f, paybill_number: "", till_number: "", bank_short_code: "", bank_account_number: "" }));
      queryClient.invalidateQueries({ queryKey: ["business-settings"] });
      toast({ title: "M-Pesa Till/Paybill removed" });
    } else {
      if (!settings?.id) return;
      if (!(await confirmAction({ title: "Remove all Paystack credentials?", message: "Card and Paystack-routed M-Pesa checkouts will stop working.", danger: true, confirmLabel: "Remove" }))) return;
      const { error } = await supabase.from("business_settings" as any).update({ paystack_public_key: "", paystack_secret_key: "" }).eq("id", settings.id);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
      queryClient.invalidateQueries({ queryKey: ["business-settings"] });
      toast({ title: "Paystack configuration cleared" });
    }
  };

  const mask = (v: string) => {
    if (!v) return "";
    const s = String(v);
    if (s.length <= 4) return "••••";
    return "•".repeat(Math.max(4, s.length - 4)) + s.slice(-4);
  };

  const provider = form.payment_provider;
  const savedPaystackPub = settings?.paystack_public_key || "";
  const savedPaystackSec = !!(settings as any)?.has_paystack_secret_key;
  const bankChannelConfigured = channels.some((c) => c.channel_type === "bank" && c.is_active && c.payhero_channel_id);
  // PayHero is ready once the shop's Till, Paybill or bank is linked as a channel.
  const mpesaConfigured = channels.some((c) => c.is_active && c.payhero_channel_id);
  const paystackConfigured = !!(savedPaystackPub && savedPaystackSec);
  const darajaConfigured = !!(
    (settings as any)?.payment_provider === "daraja" &&
    (settings as any)?.has_mpesa_consumer_key &&
    (settings as any)?.has_mpesa_consumer_secret &&
    (settings as any)?.has_mpesa_passkey &&
    (((settings as any)?.mpesa_shortcode) || ((settings as any)?.mpesa_till_number))
  );

  // Server-side sanitisation mirror — used only when persisting custom STK label values.
  const sanitizeStkLabel = (raw: string) =>
    String(raw || "").replace(/[^A-Za-z0-9 \-_.]/g, "").trim().slice(0, 20);



  const savedProvider = String((settings as any)?.payment_provider || "");
  const ProviderCard = ({
    name, subtitle, configured, active, onClick, icon: Icon, inUse = false, logo,
  }: { name: string; subtitle: string; configured: boolean; active: boolean; onClick: () => void; icon: any; inUse?: boolean; logo?: string }) => (
    <button
      type="button"
      onClick={onClick}
      className={`relative text-left p-4 rounded-xl border-2 transition-all ${
        active ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card hover:border-primary/40"
      }`}
    >
      <div className="flex items-start gap-3">
        {logo ? <BrandLogo id={logo} name={name} /> : <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
          <Icon className="w-5 h-5" />
        </div>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm whitespace-nowrap">{name}</span>
            {/* Only the gateway the shop has saved as active is marked; one at a time. */}
            {inUse && configured && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-success/15 text-success whitespace-nowrap">
                <Check className="w-3 h-3" /> In use
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</div>
        </div>
        <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${active ? "border-primary bg-primary" : "border-muted-foreground/40"}`}>
          {active && <div className="w-full h-full rounded-full bg-primary-foreground scale-50" />}
        </div>
      </div>
    </button>
  );

  return (
    <div className="space-y-5 w-full">
      {/* How customers pay you: one gateway at a time (same layout as JMSURF Mail). */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="font-semibold flex items-center gap-2 text-base"><Smartphone className="w-4 h-4 text-primary" /> How customers pay you</h2>
          <p className="text-xs text-muted-foreground mt-1">The gateway that sends the M-Pesa prompt and takes card payments on your invoices, till and online store. Only one is active at a time.</p>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row">
          {([
            ["jmsurf", "JMSURF PAY", "Recommended. Paid straight to your Till, Paybill or bank. Nothing else to set up.", jmsurfConfigured],
            ["daraja", "Daraja (M-Pesa direct)", "Your own Safaricom Daraja app, Paybill or Till.", darajaConfigured],
            ["paystack", "Paystack", "Cards and M-Pesa through your Paystack account.", paystackConfigured],
          ] as const).map(([key, title, text, ok]) => {
            const on = provider === key;
            return (
              <button key={key} type="button" onClick={() => setForm((f) => ({ ...f, payment_provider: key }))}
                className={`flex flex-1 items-start gap-3 rounded-2xl border p-4 text-left transition ${on ? "border-primary bg-primary/5 ring-2 ring-primary" : "border-border hover:border-primary/40"}`}>
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-primary" : "border-muted-foreground/40"}`}>{on && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}</span>
                <span className="min-w-0">
                  <b className="block text-sm">{title}</b>
                  <span className="text-xs text-muted-foreground">{text}</span>
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    {ok ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">Set up</span> : <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-[hsl(32_90%_38%)]">Not set up</span>}
                    {savedProvider === key && ok && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">In use</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {false && provider === "mpesa" && (
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Smartphone className="w-4.5 h-4.5" />
              </div>
              <div>
                <h2 className="font-semibold leading-tight">PayHero settlement</h2>
                <p className="text-[11px] text-muted-foreground">Customer M-Pesa payments settle automatically to your Till, Paybill or bank.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {mpesaConfigured && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-success/15 text-success">
                  <Check className="w-3 h-3" /> Active
                </span>
              )}
              {canManage && mpesaConfigured && (
                <button onClick={() => clearProviderConfig("mpesa")} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                  <Trash2 className="w-3 h-3" /> Remove
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <div className="space-y-1.5">
              <Label htmlFor="mpesa-channel" className="text-xs font-medium text-muted-foreground">M-Pesa Channel</Label>
              <Select
                value={form.mpesa_type || undefined}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, mpesa_type: v as "paybill" | "till" | "bank" }))
                }
              >
                <SelectTrigger id="mpesa-channel" className="w-full">
                  <SelectValue placeholder="Select Paybill or Till…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paybill">Paybill (Pay Bill)</SelectItem>
                  <SelectItem value="till">Till (Buy Goods)</SelectItem>
                  <SelectItem value="bank">Bank account</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Choose how customers pay you.</p>
            </div>

            {form.mpesa_type !== "bank" && <div className="space-y-1.5">
              <Label htmlFor="mpesa-shortcode" className="text-xs font-medium text-muted-foreground">
                {form.mpesa_type === "till" ? "Till Number" : form.mpesa_type === "paybill" ? "Paybill Number" : "Number"}
              </Label>
              <Input
                id="mpesa-shortcode"
                className="font-mono tracking-wider w-full"
                placeholder={form.mpesa_type === "till" ? "e.g. 4579120" : form.mpesa_type === "paybill" ? "e.g. 247247" : "Select a channel first"}
                inputMode="numeric"
                maxLength={7}
                disabled={!form.mpesa_type}
                value={form.mpesa_type === "till" ? form.till_number : form.mpesa_type === "paybill" ? form.paybill_number : ""}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 7);
                  setForm((f) =>
                    f.mpesa_type === "till"
                      ? { ...f, till_number: v }
                      : f.mpesa_type === "paybill"
                      ? { ...f, paybill_number: v }
                      : f,
                  );
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                {form.mpesa_type === "till"
                  ? "5–7 digit Lipa na M-Pesa Till."
                  : form.mpesa_type === "paybill"
                  ? "5–7 digit Paybill registered in your business name."
                  : "Pick Paybill or Till to enable this field."}
              </p>
            </div>}
          </div>
        </section>
      )}

      {provider === "jmsurf" && (
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-4">
          <div>
            <h2 className="font-semibold flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" /> JMSURF PAY</h2>
            <p className="text-xs text-muted-foreground mt-1">Enter where the money should go. JMSURF PAY sets up your settlement account automatically, and every payment lands there.</p>
          </div>
          {jmsurfConfigured && (
            <p className="flex flex-wrap items-center gap-2 rounded-2xl bg-success/10 p-3 text-sm text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Connected: payments go to {
                form.jmsurf_type === "till" ? `Till ${form.jmsurf_account_number}`
                : form.jmsurf_type === "bank" ? `${KENYA_BANK_PAYBILLS.find((b) => b.paybill === form.jmsurf_business_number)?.name || `bank paybill ${form.jmsurf_business_number}`}, account ${form.jmsurf_account_number}`
                : `Paybill ${form.jmsurf_business_number}, account ${form.jmsurf_account_number}`
              } ({form.jmsurf_account_name}).
            </p>
          )}
          <div className="flex gap-1 rounded-full bg-muted p-1 text-sm font-semibold sm:w-fit">
            {([["till", "Till"], ["paybill", "Paybill"], ["bank", "Bank"]] as const).map(([v, l]) => (
              <button key={v} type="button" disabled={!canManage}
                onClick={() => setForm((f) => (f.jmsurf_type === v ? f : { ...f, jmsurf_type: v, jmsurf_business_number: "", jmsurf_account_number: "" }))}
                className={`flex-1 rounded-full px-5 py-2 transition ${form.jmsurf_type === v ? "bg-card shadow" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Paid to (name)</Label>
              <Input placeholder="Enter business name" value={form.jmsurf_account_name} onChange={(e) => setForm((f) => ({ ...f, jmsurf_account_name: e.target.value.slice(0, 100) }))} />
            </div>
            {form.jmsurf_type === "bank" && (
              <div className="space-y-1.5">
                <Label>Bank</Label>
                <Select value={form.jmsurf_business_number || undefined} onValueChange={(value) => setForm((f) => ({ ...f, jmsurf_business_number: value }))}>
                  <SelectTrigger><SelectValue placeholder="Select your bank" /></SelectTrigger>
                  <SelectContent>{KENYA_BANK_PAYBILLS.map((bank) => (
                    <SelectItem key={bank.id} value={bank.paybill}>{bank.name} ({bank.paybill})</SelectItem>
                  ))}</SelectContent>
                </Select>
              </div>
            )}
            {form.jmsurf_type === "paybill" && (
              <div className="space-y-1.5">
                <Label>Paybill number</Label>
                <Input className="font-mono" inputMode="numeric" placeholder="Enter paybill" value={form.jmsurf_business_number} onChange={(e) => setForm((f) => ({ ...f, jmsurf_business_number: e.target.value.replace(/\D/g, "").slice(0, 7) }))} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{form.jmsurf_type === "till" ? "Till number" : form.jmsurf_type === "bank" ? "Bank account number" : "Account number"}</Label>
              <Input className="font-mono" inputMode={form.jmsurf_type === "till" ? "numeric" : "text"} placeholder="Enter number"
                value={form.jmsurf_account_number}
                onChange={(e) => setForm((f) => ({ ...f, jmsurf_account_number: (f.jmsurf_type === "till" ? e.target.value.replace(/\D/g, "").slice(0, 7) : e.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32)) }))} />
              {form.jmsurf_type === "paybill" && <p className="text-[11px] text-muted-foreground">The account customers pay into on that paybill.</p>}
            </div>
          </div>
          {canManage && (
            <button type="button" onClick={save} disabled={saving}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-40 sm:w-auto">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} {jmsurfConfigured ? "Save and reconnect" : "Connect JMSURF PAY"}
            </button>
          )}
          <p className="text-xs text-muted-foreground">Customers get the M-Pesa prompt on invoices, at the till and in your online store; each payment marks the invoice or sale paid automatically.</p>
        </section>
      )}

      {provider === "daraja" && (
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Smartphone className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold leading-tight">Direct Safaricom Daraja</h2>
                <p className="text-[11px] text-muted-foreground">Use your own Safaricom Daraja app. Funds settle directly into your Paybill/Till and the STK prompt shows your business name.</p>
              </div>
            </div>
            {darajaConfigured && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-success/15 text-success">
                <Check className="w-3 h-3" /> Active
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Channel Type</Label>
              <Select
                value={form.daraja_type}
                onValueChange={(v) => setForm((f) => ({ ...f, daraja_type: v as "paybill" | "till" }))}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paybill">Paybill (Pay Bill)</SelectItem>
                  <SelectItem value="till">Till (Buy Goods)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Environment</Label>
              <Select
                value={form.daraja_environment}
                onValueChange={(v) => setForm((f) => ({ ...f, daraja_environment: v as "live" | "sandbox" }))}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="live">Production (Live)</SelectItem>
                  <SelectItem value="sandbox">Sandbox (Testing)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="daraja-shortcode" className="text-xs font-medium text-muted-foreground">
                {form.daraja_type === "till" ? "Till Number" : "Paybill Number"}
              </Label>
              <Input
                id="daraja-shortcode"
                className="font-mono tracking-wider"
                inputMode="numeric"
                maxLength={7}
                placeholder={form.daraja_type === "till" ? "e.g. 4579120" : "e.g. 247247"}
                value={form.daraja_type === "till" ? form.daraja_till_number : form.daraja_shortcode}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 7);
                  setForm((f) => f.daraja_type === "till"
                    ? { ...f, daraja_till_number: v }
                    : { ...f, daraja_shortcode: v });
                }}
              />
              <p className="text-[11px] text-muted-foreground">5–7 digits. Must match the Shortcode registered to your Daraja app.</p>
            </div>

            {form.daraja_type === "paybill" && (
              <div className="space-y-1.5">
                <Label htmlFor="daraja-acc-ref" className="text-xs font-medium text-muted-foreground">Account Reference (optional)</Label>
                <Input
                  id="daraja-acc-ref"
                  placeholder="e.g. POS"
                  maxLength={20}
                  value={form.daraja_account_reference}
                  onChange={(e) => setForm((f) => ({ ...f, daraja_account_reference: e.target.value.slice(0, 20) }))}
                />
                <p className="text-[11px] text-muted-foreground">Shown as the account on the Paybill prompt.</p>
              </div>
            )}

            <div className="space-y-1.5 sm:col-span-2 border-t border-border pt-4">
              <p className="text-xs font-semibold text-foreground">Daraja API Credentials</p>
              <p className="text-[11px] text-muted-foreground">
                Get these from <a href="https://developer.safaricom.co.ke/" target="_blank" rel="noreferrer" className="underline text-primary">developer.safaricom.co.ke</a> → My Apps → Lipa na M-Pesa Online.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="daraja-key" className="text-xs font-medium text-muted-foreground">Consumer Key</Label>
              <Input
                id="daraja-key"
                type="password"
                autoComplete="off"
                placeholder={(settings as any)?.has_mpesa_consumer_key ? "Saved (leave blank to keep)" : "Consumer Key"}
                value={form.daraja_consumer_key}
                onChange={(e) => setForm((f) => ({ ...f, daraja_consumer_key: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="daraja-secret" className="text-xs font-medium text-muted-foreground">Consumer Secret</Label>
              <Input
                id="daraja-secret"
                type="password"
                autoComplete="off"
                placeholder={(settings as any)?.has_mpesa_consumer_secret ? "Saved (leave blank to keep)" : "Consumer Secret"}
                value={form.daraja_consumer_secret}
                onChange={(e) => setForm((f) => ({ ...f, daraja_consumer_secret: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="daraja-passkey" className="text-xs font-medium text-muted-foreground">Lipa na M-Pesa Passkey</Label>
              <Input
                id="daraja-passkey"
                type="password"
                autoComplete="off"
                placeholder={(settings as any)?.has_mpesa_passkey ? "Saved (leave blank to keep)" : "Passkey from Daraja portal"}
                value={form.daraja_passkey}
                onChange={(e) => setForm((f) => ({ ...f, daraja_passkey: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">Leave blank to keep the saved value.</p>
            </div>

            {/* Test STK push — verify saved Daraja credentials without taking a real payment */}
            <div className="sm:col-span-2 border-t border-border pt-4 space-y-2">
              <Label className="text-xs font-semibold text-foreground">Test STK Push</Label>
              <p className="text-[11px] text-muted-foreground">
                Send a KES 1 prompt to a phone number to verify your saved Daraja credentials. No transaction is recorded.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  inputMode="numeric"
                  placeholder="07XXXXXXXX"
                  value={darajaTestPhone}
                  onChange={(e) => setDarajaTestPhone(e.target.value.replace(/\D/g, "").slice(0, 12))}
                  className="flex-1 font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={darajaTesting || !darajaConfigured || !/^(\+?254|0)\d{9}$/.test(darajaTestPhone)}
                  onClick={async () => {
                    setDarajaTesting(true);
                    setDarajaTestResult(null);
                    try {
                      const { data, error } = await supabase.functions.invoke("mpesa-stk-push", {
                        body: {
                          phone: darajaTestPhone,
                          amount: 1,
                          tenant_slug: tenantSlug,
                          tenant_id: profile?.tenant_id || tenant?.id,
                          account_ref: "TEST",
                        },
                      });
                      let msg = "";
                      try {
                        const ctx: any = (error as any)?.context;
                        if (ctx?.body) {
                          const parsed = await new Response(ctx.body).json();
                          msg = parsed?.error || parsed?.errorMessage || "";
                        }
                      } catch {}
                      msg = msg || (error as any)?.message || data?.error || data?.errorMessage || "";
                      const okCheckout = data?.CheckoutRequestID || data?.checkout_request_id;
                      if (data?.success && okCheckout) {
                        setDarajaTestResult({ ok: true, message: "STK prompt sent. Approve on phone to complete the test.", checkout: okCheckout });
                      } else {
                        setDarajaTestResult({ ok: false, message: msg || "Daraja did not accept the test request." });
                      }
                    } catch (e: any) {
                      setDarajaTestResult({ ok: false, message: e?.message || "Test failed unexpectedly." });
                    } finally {
                      setDarajaTesting(false);
                    }
                  }}
                >
                  {darajaTesting ? "Sending..." : "Send Test STK"}
                </Button>
              </div>
              {!darajaConfigured && (
                <p className="text-[11px] text-muted-foreground">Save your Daraja credentials first, then come back to test.</p>
              )}
              {darajaTestResult && (
                <div className={cn(
                  "text-[11px] rounded-lg border p-2 font-mono break-all",
                  darajaTestResult.ok
                    ? "border-success/30 bg-success/5 text-success"
                    : "border-destructive/30 bg-destructive/5 text-destructive"
                )}>
                  {darajaTestResult.ok ? "" : ""}{darajaTestResult.message}
                  {darajaTestResult.checkout && <div className="mt-1 opacity-70">Ref: {darajaTestResult.checkout}</div>}
                </div>
              )}
            </div>
          </div>
        </section>
      )}


      {false && (provider === "bank" || (provider === "mpesa" && form.mpesa_type === "bank")) && (
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Landmark className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold leading-tight">Bank Direct Payout</h2>
                <p className="text-[11px] text-muted-foreground">Customer M-Pesa STK payments settle into your bank via PayHero.</p>
              </div>
            </div>
            {bankChannelConfigured && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-success/15 text-success">
                <Check className="w-3 h-3" /> Active
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="bank-select" className="text-xs font-medium text-muted-foreground">Bank</Label>
              <Select
                value={form.bank_paybill_id || undefined}
                onValueChange={(id) => {
                  const b = banks.find((x) => x.id === id);
                  if (!b) return;
                  setForm((f) => ({ ...f, bank_paybill_id: b.id, bank_name: b.name, bank_short_code: b.paybill }));
                }}
                disabled={banksLoading || banks.length === 0}
              >
                <SelectTrigger id="bank-select" className="w-full sm:w-80">
                  <SelectValue placeholder={banksLoading ? "Loading banks…" : "Select your bank…"} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {banks.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} <span className="text-muted-foreground">· {b.paybill}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!banksLoading && banks.length === 0 && (
                <p className="text-[11px] text-muted-foreground">Could not load bank list. Try saving again or contact support.</p>
              )}
            </div>

            {form.bank_paybill_id && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="bank-acc-name" className="text-xs font-medium text-muted-foreground">Account Holder Name</Label>
                  <Input
                    id="bank-acc-name"
                    placeholder="As it appears on the bank account"
                    maxLength={120}
                    value={form.bank_account_name}
                    onChange={(e) => setForm((f) => ({ ...f, bank_account_name: e.target.value.slice(0, 120) }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bank-acc-num" className="text-xs font-medium text-muted-foreground">Bank Account Number</Label>
                  <Input
                    id="bank-acc-num"
                    className="font-mono tracking-wider"
                    placeholder="e.g. 1280006242"
                    maxLength={32}
                    value={form.bank_account_number}
                    onChange={(e) => setForm((f) => ({ ...f, bank_account_number: e.target.value.replace(/\s/g, "").slice(0, 32) }))}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground sm:col-span-2">
                  Bank Paybill: <span className="font-mono text-foreground">{form.bank_short_code}</span> · Funds settle here via PayHero.
                </p>
              </>
            )}
          </div>
        </section>

      )}

      {provider === "paystack" && (
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold flex items-center gap-2"><CreditCard className="w-4 h-4" /> Paystack Credentials</h2>
            <div className="flex items-center gap-2">
              {paystackConfigured && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-success/15 text-success">
                  <Check className="w-3 h-3" /> Configured
                </span>
              )}
              {canManage && paystackConfigured && (
                <button onClick={() => clearProviderConfig("paystack")} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20">
                  <Trash2 className="w-3 h-3" /> Remove
                </button>
              )}
            </div>
          </div>
          <input
            className="fi"
            placeholder={savedPaystackPub ? `Paystack Public Key (saved: ${mask(savedPaystackPub)})` : "Paystack Public Key"}
            value={form.paystack_public_key}
            onChange={(e) => setForm((f) => ({ ...f, paystack_public_key: e.target.value }))}
          />
          <input
            className="fi"
            placeholder={savedPaystackSec ? "Paystack Secret Key (saved)" : "Paystack Secret Key"}
            type="password"
            value={form.paystack_secret_key}
            onChange={(e) => setForm((f) => ({ ...f, paystack_secret_key: e.target.value }))}
          />
        </section>
      )}

      {canManage && provider !== "jmsurf" && (
        <button onClick={save} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-40">
          <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save Payment Settings"}
        </button>
      )}

      {/* Extra gateways, on top of the main M-Pesa/Paystack choice above */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="font-semibold flex items-center gap-2 text-base"><Globe className="w-4 h-4 text-primary" /> More gateways</h2>
        </div>
        <GatewaysPanel scope="shop" canManage={canManage} baseCurrency={String((settings as any)?.currency || "KES")} />
      </section>
    </div>
  );
}

/* ───── Inventory Settings Tab ───── */
/* InventorySettingsTab removed — Categories/Subcategories/Units now live under Inventory → Categories & Units. */

/* ───── Notification Settings Tab ───── */
/* ───── Barcode Settings Tab ───── */
function BarcodeSettingsTab({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = useBusinessSettings();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    barcode_format: "CODE128",
    barcode_label_width: "50mm",
    barcode_label_height: "30mm",
    barcode_show_price: true,
    barcode_show_name: true,
  });

  useEffect(() => {
    if (!settings) return;
    const s = settings as any;
    setForm({
      barcode_format: s.barcode_format || "CODE128",
      barcode_label_width: s.barcode_label_width || "50mm",
      barcode_label_height: s.barcode_label_height || "30mm",
      barcode_show_price: s.barcode_show_price ?? true,
      barcode_show_name: s.barcode_show_name ?? true,
    });
  }, [settings]);

  const handleSave = async () => {
    if (!canManage || !settings?.id) return;
    setSaving(true);
    const { error } = await (supabase as any).from("business_settings").update({
      barcode_format: form.barcode_format,
      barcode_label_width: form.barcode_label_width,
      barcode_label_height: form.barcode_label_height,
      barcode_show_price: form.barcode_show_price,
      barcode_show_name: form.barcode_show_name,
    }).eq("id", settings.id);
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["business-settings"] });
    toast({ title: "Barcode settings saved" });
  };

  const Toggle = ({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
      <div><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground mt-0.5">{description}</p></div>
      <button onClick={() => onChange(!checked)} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"}`}>
        <span className={`inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Barcode className="w-4 h-4" /> Barcode Configuration</h2>
        <p className="text-xs text-muted-foreground">Configure barcode format and label printing preferences.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium mb-1 block">Barcode Format</label>
            <select className="fi" value={form.barcode_format} onChange={(e) => setForm((f) => ({ ...f, barcode_format: e.target.value }))}>
              <option value="CODE128">Code 128 (default)</option>
              <option value="EAN13">EAN-13</option>
              <option value="UPC">UPC-A</option>
              <option value="CODE39">Code 39</option>
              <option value="QR">QR Code</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Label Width</label>
            <select className="fi" value={form.barcode_label_width} onChange={(e) => setForm((f) => ({ ...f, barcode_label_width: e.target.value }))}>
              <option value="38mm">38mm (small)</option>
              <option value="50mm">50mm (medium)</option>
              <option value="70mm">70mm (large)</option>
              <option value="100mm">100mm (extra large)</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Label Height</label>
            <select className="fi" value={form.barcode_label_height} onChange={(e) => setForm((f) => ({ ...f, barcode_label_height: e.target.value }))}>
              <option value="20mm">20mm (small)</option>
              <option value="30mm">30mm (medium)</option>
              <option value="40mm">40mm (large)</option>
              <option value="50mm">50mm (extra large)</option>
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-3">
        <h2 className="font-semibold">Label Content</h2>
        <Toggle label="Show Product Name" description="Print the product name on barcode labels" checked={form.barcode_show_name} onChange={(v) => setForm((f) => ({ ...f, barcode_show_name: v }))} />
        <Toggle label="Show Price" description="Print the product price on barcode labels" checked={form.barcode_show_price} onChange={(v) => setForm((f) => ({ ...f, barcode_show_price: v }))} />
      </section>

      {/* Preview */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-3">
        <h2 className="font-semibold">Label Preview</h2>
        <div className="inline-block border border-border rounded-lg p-3 bg-background" style={{ width: form.barcode_label_width, minHeight: form.barcode_label_height }}>
          {form.barcode_show_name && <p className="text-[9px] font-medium text-center truncate">Sample Product</p>}
          <p className="text-center font-mono text-xs my-1" style={{ fontFamily: "'Libre Barcode 128', cursive", fontSize: "28px", lineHeight: 1 }}>ABC123456</p>
          <p className="text-[8px] text-center text-muted-foreground">ABC123456</p>
          {form.barcode_show_price && <p className="text-[9px] font-bold text-center">{currencyCode()} 500</p>}
        </div>
      </section>

      {canManage && (
        <button onClick={handleSave} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-40">
          <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save Barcode Settings"}
        </button>
      )}
    </div>
  );
}

/* PurchaseSettingsTab removed — Expense & Bill categories now live on /:slug/purchase-categories */

/* SMS + WhatsApp settings tabs removed — Twilio + SMS/WhatsApp channels deprecated. Email-only via custom SMTP. */
/* Theme tab is shared with Admin Settings — see src/components/ThemeTab.tsx */
import ThemeTab from "@/components/ThemeTab";

/* ───── Main Settings Page ───── */
import { useTenantFeatures, type FeatureKey } from "@/hooks/useTenantFeatures";
import { Suspense } from "react";
import { lazyPage } from "@/lib/lazyPage";
import { useSearchParams, Navigate, Link } from "react-router-dom";
import { AlertsTab } from "@/pages/settings/ErpSettingsTabs";
import { SmsGatewaysTab, StatementsTab, OnlineShopTab } from "@/pages/settings/SystemTabs";
import SystemShell from "@/pages/settings/SystemShell";
import { BrandLogo } from "@/components/BrandLogo";
import { confirmAction } from "@/components/books/confirm";
const BackupTab = lazyPage(() => import("@/pages/settings/BackupTab"));
const PortalTab = lazyPage(() => import("@/pages/settings/PortalTab"));
const ServiceTab = lazyPage(() => import("@/pages/settings/ServiceTab"));
const EtimsTab = lazyPage(() => import("@/pages/settings/EtimsTab"));
const MenuItemsTab = lazyPage(() => import("@/pages/settings/MenuItemsTab"));
const NumberingTab = lazyPage(() => import("@/pages/settings/NumberingTab"));
const CustomFieldsTab = lazyPage(() => import("@/pages/settings/CustomFieldsTab"));
const DomainSettings = lazyPage(() => import("@/components/settings/DomainSettings"));
const EmailSet = lazyPage(() => import("@/pages/settings/EmailSettings"));
const NotifRules = lazyPage(() => import("@/pages/settings/NotificationRules"));
const DevelopersTab = lazyPage(() => import("@/pages/settings/DevelopersTab"));
const WorkflowRulesTab = lazyPage(() => import("@/pages/settings/WorkflowRules"));
const ReportingTagsTab = lazyPage(() => import("@/pages/settings/ReportingTagsTab"));
const ModSet = lazyPage(() => import("@/pages/settings/ModuleSettings").then((m) => ({ default: m.PosSettings })));
const ItemSet = lazyPage(() => import("@/pages/settings/ModuleSettings").then((m) => ({ default: m.ItemSettings })));
const InvSet = lazyPage(() => import("@/pages/settings/ModuleSettings").then((m) => ({ default: m.InventorySettings })));
const PrjSet = lazyPage(() => import("@/pages/settings/ModuleSettings").then((m) => ({ default: m.ProjectSettings })));
const MfgSet = lazyPage(() => import("@/pages/settings/ModuleSettings").then((m) => ({ default: m.ManufacturingSettings })));
const ExpSet = lazyPage(() => import("@/pages/settings/ModuleSettings").then((m) => ({ default: m.ExpenseSettings })));
const AiSet = lazyPage(() => import("@/pages/settings/ModuleSettings").then((m) => ({ default: m.AiSettings })));
const ApprovalSettingsTab = lazyPage(() => import("@/pages/approvals/Approvals").then((m) => ({ default: m.ApprovalSettingsTab })));

const TAB_TITLES: Record<string, [string, string]> = {
  business: ["Business settings", "Company details, branches, currency and tax."],
  pos: ["Point of Sale", "How the till works, receipts, barcodes and labels."],
  inventory: ["Inventory", "Costing, batches, expiry and stock alerts."],
  projects: ["Projects", "Rates, billing and budgets for projects."],
  manufacturing: ["Manufacturing", "Labour, overheads, scrap and quality."],
  expense: ["Expense claims", "Mileage, per diem, receipts and approvals."],
  ai: ["Garage AI", "Who can use Garage AI and what it may do."],
  theme: ["Theme & appearance", "Colours, light or dark, sidebar, corners and text size."],
  notifications: ["Notifications", "Bell, email, SMS and WhatsApp alerts for approvals, CRM, tasks, meetings and more."],
  smtp: ["Email", "How invoices, statements, reminders and alerts are emailed, and where replies go."],
  barcodes: ["Barcodes & labels", "Barcode format and label size."],
  payments: ["Payment gateways", "How customers pay at the till, on invoices and online."],
  sms: ["SMS & WhatsApp", "Balance, top-ups, what uses SMS and the message log."],
  alerts: ["Debt & restock alerts", "Automatic reminders to customers, reps and staff."],
  statements: ["Customer statements", "Email statements automatically at month end or on set dates."],
  items: ["Items", "Item and stock preferences: quantity decimals, valuation, price lists, stock tracking and reorder alerts."],
  taxes: ["Taxes (VAT)", "VAT rates, VAT registration and withholding VAT, used on items and every document."],
  numbering: ["Document numbers", "The prefix, digits and starting number of invoices, quotes, bills and every other document."],
  "custom-fields": ["Custom fields", "Your own fields on customers, suppliers, items and documents."],
  menu: ["Menu items", "Hide the screens your company does not use, module by module. Nothing is deleted."],
  etims: ["KRA eTIMS", "KRA e-invoicing: sign invoices and credit notes, report purchases, fetch purchases and imports, notices and daily reports."],
  domain: ["Custom domain", "Use your own domain (e.g. erp.yourcompany.co.ke or yourcompany.com) for your workspace, website and customer portal."],
  service: ["Service & Marketing", "Helpdesk mailbox, website live chat, online booking, events page and social media accounts."],
  portal: ["Customer portal & website", "Open the customer portal, send customers their access by SMS, switch on your website and its tracking."],
  shop: ["Online shop & website", "Colours, layout, every piece of text, contacts and checkout."],
  backup: ["Backup & restore", "Automatic backups, downloads and restoring a module."],
  developers: ["API & webhooks", "Connect other systems: API keys for the JMSURF Garage REST API and webhooks for invoices, payments, customers and orders."],
  approvals: ["Approvals", "Who approves quotations, invoices, purchase orders, bills, expenses and more."],
  workflows: ["Workflow rules", "When something happens to a record, send an email or SMS, ring the bell, change a field or call a webhook."],
  "reporting-tags": ["Reporting tags", "Your own tags (e.g. Region) on invoices, bills, expenses, journals and credit notes, to filter and group reports."],
};

export default function SettingsPage() {
  const { role } = useAuth();
  const canManage = role === "admin" || role === "manager" || role === "super_admin";
  const owner = role === "admin" || role === "super_admin";
  const [params] = useSearchParams();
  const requested = params.get("tab") || "business";
  // Old links (Integrations, Locations, Your data, More settings, sessions) land on their new homes.
  const alias: Record<string, string> = { integrations: "sms", messaging: "sms", locations: "business", data: "backup", more: "business", website: "shop" };
  const tab = alias[requested] || requested;
  const allowed = (t: string) => {
    if (["smtp", "sms", "alerts", "statements", "shop", "portal", "etims", "menu", "taxes", "numbering", "custom-fields", "items", "service", "pos", "inventory", "projects", "manufacturing", "expense", "ai", "developers", "workflows", "reporting-tags"].includes(t)) return canManage;
    if (t === "backup" || t === "approvals" || t === "domain") return owner;
    return t in TAB_TITLES;
  };
  const active = allowed(tab) ? tab : "business";
  if (requested === "sessions") return <Navigate to="/staff?tab=sessions" replace />;
  const [title, description] = TAB_TITLES[active];

  return (
    <SystemShell>
      <PageHead title={`${title} · System`} description={description} noindex />
      <div className="space-y-5">
        <PageHeader title={title} icon={SettingsIcon} description={description} />
        {active === "business" && <BusinessTab canManage={canManage} />}
        {active === "theme" && <ThemeTab />}
        {active === "notifications" && <Suspense fallback={null}><NotifRules canManage={canManage} /></Suspense>}
        {active === "developers" && <Suspense fallback={null}><DevelopersTab /></Suspense>}
        {active === "workflows" && <Suspense fallback={null}><WorkflowRulesTab canManage={canManage} /></Suspense>}
        {active === "reporting-tags" && <Suspense fallback={null}><ReportingTagsTab canManage={canManage} /></Suspense>}
        {active === "smtp" && <Suspense fallback={null}><EmailSet canManage={canManage} /></Suspense>}
        {active === "barcodes" && <BarcodeSettingsTab canManage={canManage} />}
        {active === "pos" && <Suspense fallback={null}><ModSet canManage={canManage} barcodes={<BarcodeSettingsTab canManage={canManage} />} /></Suspense>}
        {active === "inventory" && <Suspense fallback={null}><InvSet canManage={canManage} /></Suspense>}
        {active === "items" && <Suspense fallback={null}><ItemSet canManage={canManage} /></Suspense>}
        {active === "projects" && <Suspense fallback={null}><PrjSet canManage={canManage} /></Suspense>}
        {active === "manufacturing" && <Suspense fallback={null}><MfgSet canManage={canManage} /></Suspense>}
        {active === "expense" && <Suspense fallback={null}><ExpSet canManage={canManage} /></Suspense>}
        {active === "ai" && <Suspense fallback={null}><AiSet canManage={canManage} /></Suspense>}
        {active === "payments" && <PaymentGatewaysTab canManage={canManage} />}
        {active === "sms" && <SmsGatewaysTab canManage={canManage} />}
        {active === "alerts" && <AlertsTab canManage={canManage} />}
        {active === "statements" && <StatementsTab canManage={canManage} />}
        {active === "shop" && <OnlineShopTab canManage={canManage} />}
        {active === "etims" && <Suspense fallback={null}><EtimsTab canManage={canManage} /></Suspense>}
        {active === "menu" && <Suspense fallback={null}><MenuItemsTab canManage={canManage} /></Suspense>}
        {active === "numbering" && <Suspense fallback={null}><NumberingTab canManage={canManage} /></Suspense>}
        {active === "custom-fields" && <Suspense fallback={null}><CustomFieldsTab canManage={canManage} /></Suspense>}
        {active === "taxes" && <Suspense fallback={null}><TaxTab canManage={canManage} /></Suspense>}
        {active === "domain" && <Suspense fallback={null}><DomainSettings /></Suspense>}
        {active === "service" && <Suspense fallback={null}><ServiceTab canManage={canManage} /></Suspense>}
        {active === "portal" && <Suspense fallback={null}><PortalTab canManage={canManage} /></Suspense>}
        {active === "approvals" && <Suspense fallback={null}><ApprovalSettingsTab /></Suspense>}
        {active === "backup" && <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>}><BackupTab /></Suspense>}
      </div>
    </SystemShell>
  );
}

/* ───── VAT helpers ───── */
function VatToggle() {
  const { vatEnabled, setVatEnabled } = useVatEnabled();
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3">
      <input
        id="vat-enabled-toggle"
        type="checkbox"
        checked={vatEnabled}
        onChange={(e) => setVatEnabled(e.target.checked)}
        className="mt-1 w-4 h-4 accent-primary"
      />
      <div className="flex-1">
        <label htmlFor="vat-enabled-toggle" className="text-sm font-medium cursor-pointer">
          Charge VAT / sales tax
        </label>
        <p className="text-xs text-muted-foreground mt-0.5">
          When off, tax is hidden everywhere (till, receipts and products) and calculated as 0.
        </p>
      </div>
    </div>
  );
}

function VatRateField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { vatEnabled } = useVatEnabled();
  if (!vatEnabled) return null;
  const presets = ["0", "5", "7.5", "15", "16", "18"];
  return (
    <Field label="Default VAT / sales tax (%)" hint="Use your country's standard rate" className="sm:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <input type="number" min={0} max={100} step="0.01" className="fi w-28" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
        {presets.map((p) => (
          <button key={p} type="button" disabled={disabled} onClick={() => onChange(p)}
            className={cn("rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              Number(value) === Number(p) ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>
            {p}%
          </button>
        ))}
      </div>
    </Field>
  );
}

function InventoryVatField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { vatEnabled } = useVatEnabled();
  if (!vatEnabled) return null;
  return (
    <div>
      <label className="text-sm font-medium mb-1 block">Default VAT Rate</label>
      <select
        className="fi"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="16">16% - Standard</option>
        <option value="8">8% - Reduced</option>
        <option value="0">0% - Zero Rated</option>
      </select>
    </div>
  );
}
