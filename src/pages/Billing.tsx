import { useEffect, useRef, useState } from "react";
import { moduleName } from "@/lib/modules";
import { useQuery as useOptionsQuery } from "@tanstack/react-query";
import { payApi } from "@/lib/gateways";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Smartphone, ShieldCheck, RefreshCw, Users, MapPin, CheckCircle2, XCircle, AlertTriangle, X, CreditCard as CreditCardIcon } from "lucide-react";
import { PageHeader, Segmented, StatusPill } from "@/components/kit";
import { cn } from "@/lib/utils";
import PageHead from "@/components/PageHead";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSubscriptionLock } from "@/hooks/useSubscriptionLock";
import { useTenant } from "@/hooks/useTenant";
import { useToast } from "@/hooks/use-toast";
import { ALL_FEATURES, type FeatureKey } from "@/hooks/useTenantFeatures";
import { getHostSlug } from "@/lib/host";
import { subscriptionPayment } from "@/lib/serverPayments";
import { useBusinessType } from "@/hooks/useBusinessType";
import { planPrice, shopMonthly, cycleMonths } from "@/lib/planPricing";
import { useBusinessSettings } from "@/hooks/useData";

/** Companies outside Kenya see and pay prices in US dollars (with their own currency alongside). */
function useBillingCurrency() {
  const { data: biz } = useBusinessSettings();
  const country = String((biz as any)?.country || "KE").toUpperCase();
  const local = String((biz as any)?.currency || "KES").toUpperCase();
  const foreign = country !== "KE";
  const { data: fx } = useQuery({ queryKey: ["usd-rates"], enabled: foreign, staleTime: 3600e3, queryFn: async () => (await fetch("/api/payments/fx")).json() as Promise<{ rates: Record<string, number> }> });
  const kesPerUsd = Number(fx?.rates?.KES) || 129;
  const usd = (kes: number) => Math.max(1, Math.ceil((kes / kesPerUsd) * 100) / 100);
  const fmt = (kes: number) => {
    if (!foreign) return `KES ${Math.round(kes).toLocaleString()}`;
    const u = usd(kes);
    const loc = local !== "USD" && fx?.rates?.[local] ? ` (≈ ${local} ${Math.round(u * fx.rates[local]).toLocaleString()})` : "";
    return `USD ${u.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${loc}`;
  };
  return { foreign, fmt };
}
import { OrbSpinner } from "@/components/orbs";
import GarageBillPanel from "@/components/billing/GarageBillPanel";

type Plan = {
  id: string;
  name: string;
  price_monthly: number;
  price_quarterly: number | null;
  price_annually: number | null;
  max_users: number;
  max_locations: number;
  features: Record<string, boolean> | null;
  all_modules?: boolean;
  included_modules?: string[];
  description?: string | null;
  quote_only?: boolean;
};

type Cycle = "monthly" | "quarterly" | "semi_annually" | "annually";

const CYCLES: { key: Cycle; label: string; duration: string }[] = [
  { key: "monthly", label: "Monthly", duration: "1 month" },
  { key: "quarterly", label: "Quarterly", duration: "3 months" },
  { key: "semi_annually", label: "Semi-annually", duration: "6 months" },
  { key: "annually", label: "Yearly", duration: "12 months" },
];

/** Older plans without a description of their own. */
const HIGHLIGHT: Record<string, string> = {};

const cap = (n: number) => (n >= 999999 ? "Unlimited" : String(n));

// Same rule as the server (planPricing.js): some shop types start higher.
let shopTypeForPricing = "general";
function priceFor(plan: Plan, cycle: Cycle) {
  return planPrice(plan, cycle, shopTypeForPricing);
}

/** Pull the readable reason out of an edge function failure. */
async function readFunctionError(error: any, data: any): Promise<string | null> {
  if (data?.error) return String(data.error);
  const res = error?.context;
  if (res && typeof res.text === "function") {
    try {
      const body = await res.text();
      const parsed = JSON.parse(body);
      if (parsed?.error) return String(parsed.error);
      if (body) return body.slice(0, 300);
    } catch {
      /* fall through to the generic message */
    }
  }
  return error ? error.message || "Could not reach the payment service." : null;
}

const cycleUnit = (cycle: Cycle) => {
  if (cycle === "quarterly") return "3 months";
  if (cycle === "semi_annually") return "6 months";
  if (cycle === "annually") return "year";
  return "month";
};

export default function Billing() {
  const { businessType } = useBusinessType();
  shopTypeForPricing = businessType;
  const { subscription: cachedSubscription, profile, refreshProfile } = useAuth() as any;
  const lock = useSubscriptionLock();
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [showOtherPlans, setShowOtherPlans] = useState(false);
  const [chosen, setChosen] = useState<Plan | null>(null);
  // Switched-on modules are billed with each renewal (same rule as the server).
  const { data: billable = [] } = useQuery({
    queryKey: ["billable-modules"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("tenant_modules").select("module_key, price_monthly, status, trial_ends_at").in("status", ["active", "past_due", "trial"]);
      return ((data || []) as any[]).filter((m) => m.status !== "trial" || new Date(m.trial_ends_at) > new Date());
    },
  });
  const moduleExtra = (plan: Plan | undefined | null, cycle: Cycle) => {
    if (!plan || plan.all_modules) return 0;
    const inc = new Set(plan.included_modules || []);
    return billable.filter((m) => !inc.has(m.module_key)).reduce((a, m) => a + Number(m.price_monthly || 0), 0) * cycleMonths(cycle);
  };
  const [phone, setPhone] = useState("");
  const { foreign, fmt } = useBillingCurrency();
  const [busy, setBusy] = useState<"idle" | "prompting">("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<null | { kind: "paid" | "cancelled" | "failed"; message: string; plan?: string }>(null);
  const stopped = useRef(false);

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["plans", "active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("plans")
        .select("id, name, price_monthly, price_quarterly, price_annually, max_users, max_locations, features, all_modules, included_modules, description, quote_only")
        .eq("is_active", true)
        .order("price_monthly", { ascending: true });
      if (error) throw error;
      // Enterprise is priced per garage by JMSURF (not bought here).
      return ((data || []) as Plan[]).filter((p) => !p.quote_only);
    },
  });

  const activeTenantId = profile?.tenant_id || tenant?.id || null;
  const activeTenantSlug = tenant?.slug || getHostSlug() || null;

  const { data: liveSubscription } = useQuery({
    queryKey: ["subscription", activeTenantId],
    enabled: !!activeTenantId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("subscriptions")
        .select("id, status, trial_ends_at, plan_name, plan_id, billing_cycle, price, max_users, max_locations, current_period_end")
        .eq("tenant_id", activeTenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: featureOverrides = {} } = useQuery({
    queryKey: ["billing-feature-overrides", activeTenantId],
    enabled: !!activeTenantId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenant_feature_overrides")
        .select("features")
        .eq("tenant_id", activeTenantId)
        .maybeSingle();
      if (error) throw error;
      return (data?.features || {}) as Record<string, boolean>;
    },
  });

  const subscription: any = liveSubscription || cachedSubscription || null;

  useEffect(() => {
    if (!activeTenantId) return;
    const queryKey = ["subscription", activeTenantId];
    const featureQueryKey = ["billing-feature-overrides", activeTenantId];
    const refreshPlan = () => {
      void queryClient.invalidateQueries({ queryKey: ["plans", "active"], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["tenant-features", activeTenantId], refetchType: "active" });
    };
    const channel = supabase
      .channel(`billing-subscription-${activeTenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `tenant_id=eq.${activeTenantId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey, refetchType: "active" });
          void queryClient.invalidateQueries({ queryKey: ["subscription-limits", activeTenantId], refetchType: "active" });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tenant_feature_overrides", filter: `tenant_id=eq.${activeTenantId}` },
        () => {
          try {
            localStorage.removeItem(`tenant-features:${activeTenantId}`);
          } catch {
            // Network invalidation below remains authoritative.
          }
          void queryClient.invalidateQueries({ queryKey: featureQueryKey, refetchType: "active" });
          void queryClient.invalidateQueries({ queryKey: ["tenant-features", activeTenantId], refetchType: "active" });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plans" },
        refreshPlan,
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeTenantId, queryClient]);

  const includedFeatures = (plan: Plan) =>
    ALL_FEATURES.filter((f) => plan.features?.[f.key as FeatureKey] === true);

  const currentPlan = plans.find(
    (p) => p.id === subscription?.plan_id || p.name === subscription?.plan_name,
  ) || (plans.length ? plans[0] : undefined);
  const planLabel = subscription?.plan_name || currentPlan?.name || "Free trial";
  // A stored price that differs from the package price is the shop's own deal.
  const dealMonthly = Number(subscription?.price) > 0 && currentPlan && Number(subscription?.price) !== Number(currentPlan.price_monthly)
    ? shopMonthly(Number(subscription?.price), businessType) : null;
  const currentCyclePrice = (selectedCycle: Cycle) =>
    dealMonthly != null ? dealMonthly * cycleMonths(selectedCycle) : currentPlan ? priceFor(currentPlan, selectedCycle) : 0;
  const currentMonthlyPrice = currentCyclePrice("monthly");
  const currentMaxUsers = Number(subscription?.max_users ?? currentPlan?.max_users ?? 0);
  const currentMaxLocations = Number(subscription?.max_locations ?? currentPlan?.max_locations ?? 0);
  const currentIncludedFeatures = currentPlan
    ? ALL_FEATURES.filter((feature) => {
        const override = featureOverrides[feature.key];
        return typeof override === "boolean" ? override : currentPlan.features?.[feature.key] === true;
      })
    : [];
  const renewsOn = subscription?.current_period_end || subscription?.trial_ends_at || null;
  const onTrial = String(subscription?.status || "") === "trial" || (!subscription?.current_period_end && !!subscription?.trial_ends_at);
  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" });

  // Other ways to pay (Flutterwave, Stripe, PayPal, MTN, Airtel…) switched on in Admin.
  const { data: payOptions = [] } = useOptionsQuery({
    queryKey: ["subscription-pay-options"],
    staleTime: 5 * 60_000,
    queryFn: async () => ((await payApi("subscription/options"))?.options || []) as { id: string; label: string; kind: "push" | "redirect"; countries: string }[],
  });
  const [method, setMethod] = useState<string>("mpesa");
  const [email, setEmail] = useState("");
  const other = payOptions.find((o) => o.id === method);

  const payOther = async () => {
    if (!chosen || !other) return;
    stopped.current = false;
    setFailure(null);
    setOutcome(null);
    setBusy("prompting");
    try {
      const r = await payApi("subscription/start", { plan_id: chosen.id, cycle, provider: other.id, phone, email });
      if (!r?.ok) throw new Error(r?.error || "Could not start the payment");
      if (r.url) window.open(r.url, "_blank", "noopener");
      toast({
        title: other.kind === "push" ? "Check your phone" : "Complete the payment",
        description: `Pay ${r.currency} ${Number(r.amount).toLocaleString()} for ${chosen.name}${other.kind === "push" ? "" : ` on the ${other.label} page`}. This page updates by itself.`,
      });
      for (let i = 0; i < 200; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        if (stopped.current) return;
        const st = await payApi("subscription/status", { payment_id: r.payment_id });
        if (stopped.current) return;
        if (st?.status === "completed") {
          setOutcome({ kind: "paid", plan: chosen.name, message: `${chosen.name} is active on your shop.` });
          queryClient.invalidateQueries();
          void refreshProfile?.();
          return;
        }
        if (st?.status === "cancelled" || st?.status === "failed") {
          setOutcome({ kind: st.status === "cancelled" ? "cancelled" : "failed", message: st?.message || "The payment was not completed. No money was taken." });
          return;
        }
      }
      setOutcome({ kind: "failed", message: "We did not hear back in time. If you paid, it will still be applied — check again in a few minutes." });
    } catch (e: any) {
      setOutcome({ kind: "failed", message: e.message || "We could not start the payment." });
    } finally {
      setBusy("idle");
    }
  };

  const stopWaiting = () => {
    stopped.current = true;
    setBusy("idle");
    setFailure(null);
    setOutcome(null);
    setChosen(null);
  };

  const pay = async () => {
    if (!chosen || (!phone && !foreign)) return;
    stopped.current = false;
    setFailure(null);
    setOutcome(null);
    setBusy("prompting");
    try {
      const { data, error } = await subscriptionPayment({
        action: "start",
        plan_id: chosen.id,
        cycle,
        phone,
        tenant_id: activeTenantId,
        tenant_slug: activeTenantSlug,
      });
      if (error) {
        throw new Error(error || "Could not start the payment");
      }

      if (data.authorization_url) {
        // Card / Paystack checkout opens in a new tab; we keep checking here.
        window.open(data.authorization_url, "_blank", "noopener");
        toast({
          title: "Complete the payment",
          description: `Pay ${fmt(Number(data.amount))} for ${chosen.name} in the Paystack tab. This page updates by itself.`,
        });
      } else {
        toast({
          title: "Check your phone",
          description: `Enter your M-Pesa PIN to pay KES ${Number(data.amount).toLocaleString()} for ${chosen.name}.`,
        });
      }

      const checkoutId = data.checkout_request_id;
      // Card checkouts take longer than an M-Pesa PIN: allow up to 10 minutes.
      const checks = data.authorization_url ? 200 : 40;
      for (let i = 0; i < checks; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        if (stopped.current) return;
        const { data: s, error: statusError } = await subscriptionPayment({
          action: "status",
          checkout_request_id: checkoutId,
          tenant_id: activeTenantId,
          tenant_slug: activeTenantSlug,
        });
        if (stopped.current) return;
        if (statusError) {
          setOutcome({ kind: "failed", message: statusError || "We could not check the payment. If money left your M-Pesa, it will still be applied — refresh in a minute." });
          return;
        }
        if (s?.status === "completed") {
          setOutcome({ kind: "paid", plan: s?.plan || chosen.name, message: `${s?.plan || chosen.name} is active on your shop.` });
          queryClient.invalidateQueries();
          void refreshProfile?.();
          return;
        }
        if (s?.status === "cancelled") {
          setOutcome({ kind: "cancelled", message: "You cancelled the M-Pesa prompt, so no money was taken." });
          return;
        }
        if (s?.status === "failed") {
          setOutcome({ kind: "failed", message: s?.message || "The M-Pesa payment did not go through. No money was taken." });
          return;
        }
      }
      setOutcome({ kind: "failed", message: "We did not hear back from M-Pesa in time. If you approved the payment, it will still be applied — check again in a minute." });
    } catch (e: any) {
      setOutcome({ kind: "failed", message: e.message || "We could not start the payment." });
    } finally {
      setBusy("idle");
    }
  };

  const [viewCycle, setViewCycle] = useState<Cycle>("monthly");
  const daysLeft = renewsOn ? Math.ceil((new Date(renewsOn).getTime() - Date.now()) / 86_400_000) : null;
  const periodDays = onTrial ? 14 : subscription?.billing_cycle === "annually" ? 365 : subscription?.billing_cycle === "semi_annually" ? 182
    : subscription?.billing_cycle === "quarterly" ? 91 : 30;
  const progress = daysLeft === null ? 0 : Math.max(0, Math.min(100, (daysLeft / periodDays) * 100));
  const expired = lock === "expired" || (daysLeft !== null && daysLeft < 0);
  const daysAgo = renewsOn ? Math.max(0, Math.floor((Date.now() - new Date(renewsOn).getTime()) / 86_400_000)) : 0;
  const openPay = (plan: Plan, c: Cycle = "monthly") => { setCycle(c); setChosen(plan); setPhone(""); setFailure(null); };

  return (
    <>
      <PageHead title="Plan and billing" description="Your system subscription." />

      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader title="Plan and billing" icon={CreditCardIcon} description="Your package, what it includes and renewals." />

        {lock !== "open" && (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="font-semibold text-destructive">
                {lock === "suspended" ? "Your company is suspended" : "Your company is locked until you renew"}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {lock === "suspended"
                  ? "Contact JMSURF support to restore access."
                  : "Your package has ended, so selling and the other pages are paused. Your records are safe. Pay below and the company opens again by itself."}
              </p>
            </div>
          </div>
        )}

        {(subscription || currentPlan) && (
          <div className="relative overflow-hidden rounded-3xl border border-border bg-card">
            <div aria-hidden className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-2xl" />
            <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.4fr_1fr]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current package</p>
                  <StatusPill status={expired ? "expired" : onTrial ? "trialing" : subscription?.status || "active"} />
                </div>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">{planLabel}</h2>
                <p className="mt-1 flex items-baseline gap-1.5">
                  <span className="font-display text-2xl font-bold text-primary">{fmt(currentMonthlyPrice)}</span>
                  <span className="text-sm text-muted-foreground">per month</span>
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  {currentPlan && (
                    <Button size="lg" onClick={() => openPay(currentPlan)}><RefreshCw /> {expired ? "Renew now" : "Renew package"}</Button>
                  )}
                  <Button size="lg" variant="outline" onClick={() => document.getElementById("packages")?.scrollIntoView({ behavior: "smooth" })}>Change package</Button>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-background/60 p-5">
                {renewsOn ? (
                  <>
                    <div className="flex items-baseline justify-between">
                      <p className="text-sm text-muted-foreground">{onTrial ? "Trial ends" : expired ? "Expired" : "Paid until"}</p>
                      <p className={cn("text-sm font-semibold", expired ? "text-destructive" : daysLeft !== null && daysLeft <= 5 ? "text-warning" : "text-foreground")}>
                        {expired ? (daysAgo === 0 ? "Ended today" : `${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`) : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                      </p>
                    </div>
                    <p className="mt-1 font-display text-xl font-bold">{formatDate(renewsOn)}</p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full transition-all", expired ? "bg-destructive" : daysLeft !== null && daysLeft <= 5 ? "bg-warning" : "bg-primary")}
                        style={{ width: `${expired ? 100 : progress}%` }} />
                    </div>
                  </>
                ) : <p className="text-sm text-muted-foreground">No end date on this package.</p>}
                <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4">
                  <div className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><span className="text-sm"><strong>{cap(currentMaxUsers)}</strong> users</span></div>
                  <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /><span className="text-sm"><strong>{cap(currentMaxLocations)}</strong> {currentMaxLocations === 1 ? "branch" : "branches"}</span></div>
                </div>
                {(() => {
                  // Modules added to the bill (not already in the package).
                  const inc = new Set(currentPlan?.included_modules || []);
                  const mods = currentPlan?.all_modules ? [] : billable.filter((m: any) => !inc.has(m.module_key));
                  if (!mods.length) return null;
                  return (
                    <div className="mt-4 border-t border-border pt-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Modules on your bill</p>
                      <ul className="space-y-1.5">{mods.map((m: any) => (
                        <li key={m.module_key} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate font-medium">{moduleName(m.module_key).replace(/^JMSURF /, "")}</span>
                          <span className={m.status === "past_due" ? "rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive" : m.status === "trial" ? "rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning" : "rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success"}>{m.status === "past_due" ? "Payment due" : m.status === "trial" ? "Free trial" : "Active"}</span>
                          <span className="whitespace-nowrap tabular-nums">KES {Number(m.price_monthly || 0).toLocaleString("en-KE")}/mo</span>
                        </li>
                      ))}</ul>
                    </div>
                  );
                })()}
              </div>
            </div>

            {currentIncludedFeatures.length > 0 && (
              <div className="relative border-t border-border px-6 py-5 sm:px-8">
                <p className="mb-3 text-sm font-semibold">Included</p>
                <div className="flex flex-wrap gap-2">
                  {currentIncludedFeatures.map((f) => (
                    <span key={f.key} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      <Check className="h-3 w-3" /> {f.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <GarageBillPanel tenantId={activeTenantId} onChoosePlan={() => document.getElementById("packages")?.scrollIntoView({ behavior: "smooth" })} />

        <section id="packages" className="space-y-4 scroll-mt-24">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold">Plans</h2>
              <p className="text-sm text-muted-foreground">Pay for longer and renew less often. Yearly is 10 months' price.</p>
            </div>
            <Segmented value={viewCycle} onChange={(v) => setViewCycle(v as Cycle)} options={CYCLES.map((c) => ({ value: c.key, label: c.label }))} />
          </div>

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-72 animate-pulse rounded-3xl bg-muted" />)}</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {plans.map((plan) => {
                const isCurrent = plan.id === currentPlan?.id;
                const featured = plan.name === "Business" && !isCurrent;
                const upgrade = currentPlan ? Number(plan.price_monthly) > Number(currentPlan.price_monthly) : false;
                return (
                  <div key={plan.id} className={cn(
                    "relative flex flex-col rounded-3xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg",
                    isCurrent ? "border-primary ring-2 ring-primary/30" : featured ? "border-primary/40" : "border-border",
                  )}>
                    {(isCurrent || featured) && (
                      <span className={cn("absolute -top-3 left-6 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide",
                        isCurrent ? "bg-primary text-primary-foreground" : "bg-foreground text-background")}>
                        {isCurrent ? "Current plan" : "Popular"}
                      </span>
                    )}
                    <h3 className="font-display text-lg font-bold">{plan.name}</h3>
                    <p className="mt-1 min-h-[36px] text-xs text-muted-foreground">{plan.description || HIGHLIGHT[plan.name] || ""}</p>
                    <p className="mt-3 flex items-baseline gap-1">
                      <span className="font-display text-2xl font-bold tracking-tight">{fmt(isCurrent ? currentCyclePrice(viewCycle) : priceFor(plan, viewCycle))}</span>
                      <span className="text-sm text-muted-foreground">/{cycleUnit(viewCycle)}</span>
                    </p>
                    <ul className="mt-5 flex-1 space-y-2 text-sm">
                      <li className="flex items-center gap-2"><Users className="h-4 w-4 shrink-0 text-primary" />{cap(plan.max_users)} user{plan.max_users === 1 ? "" : "s"}</li>
                      <li className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-primary" />{cap(plan.max_locations)} branch{plan.max_locations === 1 ? "" : "es"}</li>
                      <li className="flex items-center gap-2 text-muted-foreground"><Check className="h-4 w-4 shrink-0 text-primary" />{plan.all_modules ? "Every module included" : (plan.included_modules || []).length ? `Garage Core + ${(plan.included_modules || []).map((k) => moduleName(k).replace(/^JMSURF /, "")).join(", ")}` : "Garage Core included"}</li>
                    </ul>
                    <Button className="mt-6 w-full" variant={isCurrent || featured ? "default" : "outline"} onClick={() => openPay(plan, viewCycle)}>
                      {isCurrent ? "Renew" : upgrade ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          {businessType === "water" && <>Water refill companies start from KES 1,000 a month. Tanks, refill sizes, delivery orders, the rider app, tickets and your website come with every package. </>}
          {foreign ? "Your company is outside Kenya: packages are charged in US dollars by card (Visa, Mastercard), with your own currency shown for reference." : "Packages are priced in Kenyan shillings (KES). Paying from another country? Choose a card or mobile money option when you pay."}
        </p>
      </div>

      {chosen && (() => {
        const base = chosen.id === currentPlan?.id ? currentCyclePrice(cycle) : priceFor(chosen, cycle);
        const extra = moduleExtra(chosen, cycle);
        const amount = base + extra;
        const cycleLabel = CYCLES.find((item) => item.key === cycle)?.label;
        return (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => busy === "idle" && !outcome && setChosen(null)}>
          <div className="bg-card text-card-foreground w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-border shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4"
            onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
              {busy === "idle" && (
                <button onClick={stopWaiting} className="absolute right-4 top-4 p-1.5 rounded-lg text-muted-foreground hover:bg-muted" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              )}
              <p className="text-xs font-medium uppercase tracking-wider text-primary">{outcome?.kind === "paid" ? "Payment received" : "Renew package"}</p>
              <h3 className="font-display font-bold text-xl mt-1">{chosen.name}</h3>
              <p className="text-sm text-muted-foreground">{fmt(amount)} · {cycleLabel}</p>
              {extra > 0 && <p className="mt-1 text-xs text-muted-foreground">Plan KES {base.toLocaleString()} + modules KES {extra.toLocaleString()} ({billable.filter((m) => !(chosen.included_modules || []).includes(m.module_key)).map((m) => moduleName(m.module_key)).join(", ")})</p>}
            </div>

            <div className="px-6 pb-6 pt-5">
              {busy === "prompting" ? (
                <div className="text-center space-y-4 py-2">
                  <div className="relative w-20 h-20 mx-auto">
                    <span className="absolute inset-0 rounded-full bg-success/20 animate-ping" />
                    <span className="relative w-20 h-20 rounded-full bg-success/15 text-success flex items-center justify-center">
                      <Smartphone className="w-9 h-9" />
                    </span>
                  </div>
                  <div>
                    <p className="font-semibold text-lg">{other?.kind === "redirect" ? "Finish paying in the new tab" : "Check your phone"}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {other
                        ? other.kind === "redirect" ? <>Complete the payment on the {other.label} page. This window updates by itself.</> : <>A {other.label} prompt was sent to <strong className="text-foreground">{phone}</strong>. Approve it to pay.</>
                        : <>An M-Pesa prompt for <strong className="text-foreground">KES {amount.toLocaleString()}</strong> was sent to <strong className="text-foreground">{phone}</strong>. Enter your PIN to pay.</>}
                    </p>
                  </div>
                  <p className="inline-flex items-center gap-2 text-xs text-muted-foreground"><OrbSpinner className="w-3.5 h-3.5" /> Waiting for confirmation…</p>
                  <Button variant="outline" className="w-full rounded-xl" onClick={stopWaiting}>Close</Button>
                </div>
              ) : outcome?.kind === "paid" ? (
                <div className="text-center space-y-4 py-2">
                  <span className="w-20 h-20 rounded-full bg-success/15 text-success flex items-center justify-center mx-auto"><CheckCircle2 className="w-11 h-11" /></span>
                  <div>
                    <p className="font-semibold text-lg">Thank you — you're all set</p>
                    <p className="text-sm text-muted-foreground mt-1">{outcome.message} Your receipt is in the payment history.</p>
                  </div>
                  <Button className="w-full rounded-xl" onClick={() => window.location.reload()}>Done</Button>
                </div>
              ) : outcome?.kind === "cancelled" ? (
                <div className="text-center space-y-4 py-2">
                  <span className="w-20 h-20 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto"><XCircle className="w-11 h-11" /></span>
                  <div>
                    <p className="font-semibold text-lg">Payment cancelled</p>
                    <p className="text-sm text-muted-foreground mt-1">{outcome.message}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1 rounded-xl" onClick={stopWaiting}>Close</Button>
                    <Button className="flex-1 rounded-xl" onClick={method === "mpesa" ? pay : payOther} disabled={method === "mpesa" && !phone}>Try again</Button>
                  </div>
                </div>
              ) : outcome?.kind === "failed" ? (
                <div className="text-center space-y-4 py-2">
                  <span className="w-20 h-20 rounded-full bg-warning/15 text-warning flex items-center justify-center mx-auto"><AlertTriangle className="w-10 h-10" /></span>
                  <div>
                    <p className="font-semibold text-lg">Payment not completed</p>
                    <p className="text-sm text-muted-foreground mt-1">{outcome.message}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1 rounded-xl" onClick={stopWaiting}>Close</Button>
                    <Button className="flex-1 rounded-xl" onClick={method === "mpesa" ? pay : payOther} disabled={method === "mpesa" && !phone}>Try again</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div>
                    <p className="text-sm font-semibold mb-2">Payment period</p>
                    <div className="grid grid-cols-2 gap-2">
                      {CYCLES.map((item) => {
                        const price = (chosen.id === currentPlan?.id ? currentCyclePrice(item.key) : priceFor(chosen, item.key)) + moduleExtra(chosen, item.key);
                        const on = cycle === item.key;
                        return (
                          <button key={item.key} type="button" onClick={() => setCycle(item.key)}
                            className={`text-left rounded-2xl border-2 px-3.5 py-3 transition-colors ${on ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                            <span className="flex items-center justify-between">
                              <span className="font-semibold text-sm">{item.label}</span>
                              <span className={`w-4 h-4 rounded-full border-2 ${on ? "border-primary bg-primary" : "border-muted-foreground/40"}`} />
                            </span>
                            <span className="block text-[11px] text-muted-foreground">{item.duration}</span>
                            <span className="block font-bold mt-1">{fmt(price)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {payOptions.length > 0 && !foreign && (
                    <div>
                      <p className="text-sm font-semibold mb-2">Pay with</p>
                      <div className="flex flex-wrap gap-2">
                        {[{ id: "mpesa", label: "M-Pesa" }, ...payOptions].map((o) => (
                          <button key={o.id} type="button" onClick={() => setMethod(o.id)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${method === o.id ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>
                            {o.label}
                          </button>
                        ))}
                      </div>
                      {other && <p className="mt-2 text-[11px] text-muted-foreground">{other.countries}</p>}
                    </div>
                  )}
                  {other ? (
                    <div className="space-y-3">
                      <div>
                        <label className="text-sm font-semibold block mb-2">{other.kind === "push" ? "Phone number" : "Phone number (optional)"}</label>
                        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Enter phone number"
                          className="w-full h-12 px-3 rounded-xl border border-input bg-background text-base focus:outline-none focus:ring-2 focus:ring-primary/40" />
                      </div>
                      {other.kind === "redirect" && (
                        <div>
                          <label className="text-sm font-semibold block mb-2">Email for the receipt (optional)</label>
                          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
                            className="w-full h-12 px-3 rounded-xl border border-input bg-background text-base focus:outline-none focus:ring-2 focus:ring-primary/40" />
                        </div>
                      )}
                      <Button className="w-full h-12 rounded-xl gap-2 text-base font-semibold" disabled={other.kind === "push" && !phone} onClick={payOther}>
                        Pay KES {amount.toLocaleString()} with {other.label}
                      </Button>
                    </div>
                  ) : foreign ? (
                  <Button className="w-full h-12 rounded-xl gap-2 text-base font-semibold" onClick={pay}>
                    <CreditCardIcon className="w-4 h-4" /> Pay {fmt(amount)} by card
                  </Button>
                  ) : (<>
                  <div>
                    <label className="text-sm font-semibold block mb-2">M-Pesa number</label>
                    <div className="relative">
                      <Smartphone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel"
                        onKeyDown={(e) => { if (e.key === "Enter" && phone) { e.preventDefault(); pay(); } }}
                        placeholder="07XXXXXXXX" autoFocus
                        className="w-full h-12 pl-10 pr-3 rounded-xl border border-input bg-background text-base focus:outline-none focus:ring-2 focus:ring-primary/40" />
                    </div>
                  </div>
                  <Button className="w-full h-12 rounded-xl gap-2 text-base font-semibold" disabled={!phone} onClick={pay}>
                    <Smartphone className="w-4 h-4" /> Pay KES {amount.toLocaleString()}
                  </Button>
                  </>)}
                  <p className="text-[11px] text-center text-muted-foreground flex items-center justify-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" /> Secure payment to JMSURF Technologies
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}
    </>
  );
}
