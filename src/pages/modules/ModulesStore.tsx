import { useEffect, useMemo, useState } from "react";
import { openCallCentre } from "@/pages/callcentre/CallCentre";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Clock, Grid2x2, Lock, Power, Search, Sparkles, X, ArrowRight, CreditCard, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Modal, Pill, Segmented } from "@/components/kit";
import { PUBLIC_MODULES as MODULES, MODULE_CATEGORIES, CORE_KEY, type ModuleDef } from "@/lib/modules";
import { GARAGE_NAV } from "@/garage/nav";
import { usePermissions } from "@/hooks/usePermissions";
import { useGarageCatalogue } from "@/hooks/useGarageCatalogue";
import { kes as kesFmt } from "@/lib/garagePlans";
import { useModules } from "@/hooks/useModules";
import { useErpSettings } from "@/pages/settings/ErpSettingsTabs";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessSettings } from "@/hooks/useData";
import { confirmAction } from "@/components/books/confirm";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { track } from "@/lib/tracking";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

interface PriceRow { key: string; price_monthly: number; is_active: boolean; included: boolean }

/** Where "Open" goes: the module's own home, else its first entry in the garage menu. */
function homeOf(m: ModuleDef): string {
  if (m.home) return m.home;
  for (const e of GARAGE_NAV) {
    if (e.module === m.key && !e.children?.length) return e.path;
    const kid = e.children?.find((c) => c.module === m.key) || (e.module === m.key ? e.children?.[0] : undefined);
    if (kid) return kid.path;
  }
  return "/dashboard";
}

/**
 * System → Modules & billing: the module store. Switching a module on adds it to the menu at once
 * (free for 14 days the first time, then billed pro-rata from that day). Switching off runs to the
 * end of the paid period; the records stay and can be read. Only the owner or a role with billing
 * rights may buy or remove (the database checks it too: garage_can_bill).
 */
export default function ModulesStore() {
  const { role } = useAuth();
  const { hasPermission } = usePermissions();
  const isAdmin = role === "admin" || role === "super_admin" || hasPermission("billing");
  const catalogue = useGarageCatalogue();
  const { modules: mine, has, hidden } = useModules();
  const { save } = useErpSettings();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [cat, setCat] = useState<string>("All");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<ModuleDef | null>(null);

  const { data: prices = [] } = useQuery({
    queryKey: ["platform-modules"],
    staleTime: 5 * 60_000,
    queryFn: async () => ((await (supabase as any).from("platform_modules").select("key, price_monthly, is_active, included")).data || []) as PriceRow[],
  });
  const { data: sub } = useQuery({
    queryKey: ["modules-subscription"],
    queryFn: async () => (await (supabase as any).from("subscriptions").select("plan_name, price, status, current_period_end, trial_ends_at, plans(all_modules, included_modules)").order("created_at", { ascending: false }).limit(1).maybeSingle()).data,
  });

  // Every module this company ever switched on (my_modules lists only those on now): a used-up trial is not offered again.
  const { data: history = [] } = useQuery({
    queryKey: ["module-history"],
    queryFn: async () => ((await (supabase as any).from("tenant_modules").select("module_key, status, trial_ends_at, current_period_end")).data || []) as { module_key: string; status: string; trial_ends_at: string | null; current_period_end: string | null }[],
  });
  const switchLabel = (m: ModuleDef) => {
    const h = history.find((x) => x.module_key === m.key);
    if (!h) return "Try free for 14 days";
    if (h.status === "cancelled" && h.current_period_end && new Date(h.current_period_end) > new Date()) return "Switch on again";
    return `Switch on · ${kes(priceOf(m))}/month`;
  };
  const priceOf = (m: ModuleDef) => Number(prices.find((p) => p.key === m.key)?.price_monthly ?? m.price);
  const bundlePlan = catalogue.plans.find((p) => p.bundle);
  const inPlan = (m: ModuleDef) => !!(sub as any)?.plans?.included_modules?.includes(m.key);
  const offered = (m: ModuleDef) => prices.length === 0 || prices.find((p) => p.key === m.key)?.is_active !== false;
  const stateOf = (m: ModuleDef) => mine.find((x) => x.module_key === m.key);

  useEffect(() => {
    const k = params.get("app");
    if (k) { const m = MODULES.find((x) => x.key === k); if (m) setDetail(m); }
  }, [params]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return MODULES.filter((m) => offered(m)
      && (cat === "All" || (cat === "On" ? has(m.key) : m.category === cat))
      && (!t || `${m.name} ${m.tagline} ${m.description} ${m.apps.map((x) => `${x.name} ${x.desc}`).join(" ")} ${m.features.join(" ")}`.toLowerCase().includes(t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, q, mine, prices]);

  const monthly = mine.filter((m) => ["active", "past_due", "trial"].includes(m.status) && MODULES.some((x) => x.key === m.module_key) && !inPlan(MODULES.find((x) => x.key === m.module_key)!)).reduce((a, m) => a + Number(m.price_monthly || 0), 0);
  const bundle = !!(sub as any)?.plans?.all_modules;

  const activate = async (m: ModuleDef) => {
    if (!isAdmin) return toast.error("Ask the owner, or someone with billing rights, to switch this on.");
    // JMSURF CALL CENTRE has its own plans and billing: sign up and pay there; it switches on here by itself.
    if (m.key === "callcentre") { void openCallCentre("/billing"); return; }
    setBusy(m.key);
    try {
      const { data, error } = await (supabase as any).rpc("activate_module", { p_key: m.key });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["my-modules"] });
      await qc.invalidateQueries({ queryKey: ["module-history"] });
      track("StartTrial", { content_name: m.key, value: priceOf(m), currency: "KES" });
      if (data?.status === "past_due") {
        // The free trial was used before: on for 3 days while the payment goes through.
        toast.warning(`${m.name} is on: payment due`, {
          description: `Your free trial was used before. Pay ${kes(priceOf(m))} a month on the Billing page within 3 days to keep it.`,
          action: { label: "Pay now", onClick: () => nav("/billing") },
        });
      } else {
        toast.success(data?.status === "trial" ? `${m.name} is on: 14 days free` : `${m.name} is on`, {
          description: data?.status === "trial" ? "It is in your menu now. After the trial it is added to your monthly bill."
            : "It is in your menu now. The days left in this period are added to your next bill, then it renews with your plan.",
          action: { label: "Open", onClick: () => nav(homeOf(m)) },
        });
      }
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(null); }
  };
  // Hide / Show: the module stays on and paid, only the menu changes (for everyone in the company).
  const hideToggle = async (m: ModuleDef) => {
    const next = hidden.has(m.key) ? [...hidden].filter((k) => k !== m.key) : [...hidden, m.key];
    setBusy(m.key);
    const { error } = await save("modules_hidden", next);
    setBusy(null);
    if (error) return toast.error(friendlyError(error));
    await qc.invalidateQueries({ queryKey: ["modules-hidden"] });
    toast.success(hidden.has(m.key) ? `${m.name} is back in the menu` : `${m.name} is hidden from the menu`, { description: hidden.has(m.key) ? undefined : "It stays on and your data is kept. Press Enable to bring it back." });
  };
  const deactivate = async (m: ModuleDef) => {
    if (!(await confirmAction({ title: `Switch off ${m.name}?`, message: "It keeps working until the end of the period you paid for, then leaves the menu and is no longer billed. Your records are kept and can still be read: switch it on again any time to pick up where you left off.", confirmLabel: "Switch off", danger: true }))) return;
    setBusy(m.key);
    try {
      const { error } = await (supabase as any).rpc("deactivate_module", { p_key: m.key });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["my-modules"] }); await qc.invalidateQueries({ queryKey: ["module-history"] });
      toast.success(`${m.name} switched off`, { description: "It stops at the end of the period you paid for. Your records are kept." });
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(null); }
  };

  const statusChip = (m: ModuleDef) => {
    const st = stateOf(m);
    if (hidden.has(m.key) && has(m.key)) return <Pill tone="muted"><EyeOff className="h-3 w-3" /> Disabled (hidden)</Pill>;
    if (m.included) return <Pill tone="success"><Check className="h-3 w-3" /> Included</Pill>;
    const h = history.find((x) => x.module_key === m.key);
    if (h?.status === "cancelled" && h.current_period_end && new Date(h.current_period_end) > new Date()) {
      return <Pill tone="warning"><Clock className="h-3 w-3" /> Ends {new Date(h.current_period_end).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}</Pill>;
    }
    if (!st) return null;
    if (st.status === "bundle") return <Pill tone="success"><Check className="h-3 w-3" /> In your plan</Pill>;
    if (st.status === "comped") return <Pill tone="success"><Sparkles className="h-3 w-3" /> Free for you</Pill>;
    if (st.status === "trial") {
      const days = Math.max(0, Math.ceil((new Date(st.trial_ends_at || Date.now()).getTime() - Date.now()) / 86400000));
      return <Pill tone="warning"><Clock className="h-3 w-3" /> Trial · {days} day{days === 1 ? "" : "s"} left</Pill>;
    }
    if (st.status === "past_due") return <Pill tone="danger">Payment due</Pill>;
    return <Pill tone="success"><CheckCircle2 className="h-3 w-3" /> Active</Pill>;
  };

  const actions = (m: ModuleDef, big?: boolean) => {
    const on = has(m.key);
    const st = stateOf(m);
    const removable = on && !m.included && st && !["bundle", "comped", "included", "cancelled"].includes(st.status);
    const ending = st?.status === "cancelled";
    const isHidden = hidden.has(m.key);
    return (
      <div className={cn("flex flex-wrap items-center gap-2", big && "w-full")}>
        {on && isHidden ? (
          <button disabled={busy === m.key || !isAdmin} onClick={() => void hideToggle(m)}
            className={cn("inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50", big && "flex-1")}>
            <Power className="h-4 w-4" /> Enable
          </button>
        ) : on && ending ? (
          <button disabled={busy === m.key || !isAdmin} onClick={() => void activate(m)}
            className={cn("inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50", big && "flex-1")}>
            <Power className="h-4 w-4" /> Keep it on
          </button>
        ) : on ? (
          <Link to={homeOf(m)} className={cn("inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90", big && "flex-1")}>
            Open <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <button disabled={busy === m.key || !isAdmin} onClick={() => void activate(m)}
            className={cn("inline-flex items-center justify-center gap-1.5 rounded-xl bg-foreground px-3.5 py-2 text-sm font-semibold text-background hover:bg-foreground/90 disabled:opacity-50", big && "flex-1")}>
            {busy === m.key ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" /> : <Power className="h-4 w-4" />}
            {m.key === "callcentre" ? "Get it at JMSURF CALL CENTRE" : switchLabel(m)}
          </button>
        )}
        {on && !isHidden && !ending && m.key !== CORE_KEY && isAdmin && (
          <button disabled={busy === m.key} onClick={() => void hideToggle(m)} title="Hide it from the menu. It stays on and paid."
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:border-primary/40 hover:text-primary">
            <EyeOff className="h-4 w-4" /> Disable
          </button>
        )}
        {removable && isAdmin && (
          <button disabled={busy === m.key} onClick={() => void deactivate(m)} className="rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:border-destructive/40 hover:text-destructive">
            Switch off
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#7a0b14,#c1121f_45%,#15171c)] p-6 text-white shadow-xl sm:p-8">
        <span aria-hidden className="absolute -right-16 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <span aria-hidden className="absolute -bottom-24 left-1/4 h-56 w-56 rounded-full bg-orange-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start gap-4">
          <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 sm:flex"><Grid2x2 className="h-6 w-6" /></span>
          <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/70">Modules & billing</p>
            <h1 className="font-display text-2xl font-extrabold sm:text-3xl">Add what your garage does</h1>
            <p className="mt-1 max-w-2xl text-sm text-white/80">Garage Core is your base. Switch on any module below: it appears in your menu straight away, free for 14 days the first time, and the bill rises from that day. Switch off any time: it runs to the end of the period you paid for and your records are kept.</p>
          </div>
          <Link to="/billing" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-bold text-[#a8121b] shadow-lg"><CreditCard className="h-4 w-4" /> Billing</Link>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Your plan", `${(sub as any)?.plan_name || "Garage Core"}${bundle ? " · all modules" : ""}`],
            ["Modules on", String(MODULES.filter((m) => !m.included && has(m.key)).length)],
            ["On free trial", String(mine.filter((m) => m.status === "trial" && MODULES.some((x) => x.key === m.module_key)).length)],
            ["Modules per month", kes(monthly)],
          ].map(([l, v]) => <div key={l} className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur"><p className="text-xs text-white/70">{l}</p><p className="mt-1 truncate font-display text-xl font-extrabold">{v}</p></div>)}
        </div>
        {!bundle && bundlePlan && (sub as any)?.plan_name !== bundlePlan.name && (
          <p className="relative mt-4 inline-flex flex-wrap items-center gap-2 rounded-2xl bg-white/15 px-4 py-2.5 text-sm backdrop-blur">
            <Sparkles className="h-4 w-4" /> {bundlePlan.name}: Pro plus every garage module for {kesFmt(bundlePlan.price)} / month.
            <Link to="/billing" className="font-semibold underline underline-offset-2">See plans</Link>
          </p>
        )}
      </section>


      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented value={cat} onChange={setCat} options={[{ value: "All", label: "All modules" }, { value: "On", label: "Switched on" }, ...MODULE_CATEGORIES.map((c) => ({ value: c, label: c }))]} />
        <div className="relative lg:ml-auto lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. car wash, payroll, insurance…" className="fi pl-9" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((m, i) => {
          const on = has(m.key);
          return (
            <article key={m.key} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }} className={cn("group flex flex-col overflow-hidden rounded-3xl border bg-card shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl", on ? "border-primary/40 ring-1 ring-primary/20" : "border-border")}>
              <button type="button" onClick={() => setDetail(m)} className="relative h-24 overflow-hidden text-left" style={{ background: `linear-gradient(135deg, ${m.color}, ${m.color}cc 55%, #111827)` }} aria-label={`About ${m.name}`}>
                <span aria-hidden className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/15 blur-xl transition-transform group-hover:scale-125" />
                <m.icon aria-hidden className="absolute -bottom-3 right-3 h-20 w-20 text-white/10" />
                <span className="absolute left-4 top-3 rounded-full bg-black/25 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur">{m.category}</span>
                {on && <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> On</span>}
                <span className="absolute bottom-0 left-4 flex h-12 w-12 translate-y-1/2 items-center justify-center rounded-2xl bg-card shadow-lg ring-4 ring-card" style={{ color: m.color }}><m.icon className="h-6 w-6" /></span>
              </button>
              <div className="flex flex-1 flex-col p-5 pt-8">
                <div className="flex flex-wrap items-center gap-2"><h3 className="font-display text-lg font-extrabold leading-tight">{m.name}</h3>{statusChip(m)}</div>
                <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{m.tagline}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {m.apps.slice(0, 6).map((x) => <span key={x.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"><x.icon className="h-3 w-3" />{x.name}</span>)}
                  {m.apps.length > 6 && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">+{m.apps.length - 6} more</span>}
                </div>
                <div className="flex-1" />
                <div className="mt-4 flex items-end justify-between gap-2">
                  <p><span className="font-display text-2xl font-extrabold">{m.included ? "Included" : inPlan(m) ? "In your plan" : kes(priceOf(m))}</span>{!m.included && !inPlan(m) && <span className="text-sm text-muted-foreground"> / month</span>}</p>
                  <button onClick={() => setDetail(m)} className="text-xs font-semibold text-primary hover:underline">What's inside</button>
                </div>
                <div className="mt-3 border-t border-border pt-3">{m.included ? <Pill tone="muted"><Lock className="h-3 w-3" /> Always on</Pill> : actions(m)}</div>
              </div>
            </article>
          );
        })}
      </div>
      {!list.length && <p className="rounded-3xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Nothing matches "{q}". Try another word, like tyres, payroll or insurance.</p>}

      <Modal open={!!detail} onClose={() => { setDetail(null); if (params.get("app")) { params.delete("app"); setParams(params, { replace: true }); } }}
        title={detail?.name} description={detail?.tagline} size="lg"
        footer={detail && !detail.included ? actions(detail, true) : undefined}>
        {detail && (
          <div className="space-y-5">
            <div className="flex items-center gap-4 rounded-2xl p-4 text-white" style={{ background: `linear-gradient(135deg, ${detail.color}, #15171c)` }}>
              <detail.icon className="h-10 w-10" />
              <div>
                <p className="font-display text-2xl font-extrabold">{detail.included ? "Included" : kes(priceOf(detail))}<span className="text-sm font-medium text-white/70">{detail.included ? " in every plan" : " / month per garage"}</span></p>
                <p className="text-sm text-white/75">{detail.category}{(detail.includedIn || []).length ? ` · free in ${(detail.includedIn || []).map((c) => catalogue.plans.find((p) => p.code === c)?.name).filter(Boolean).join(" and ")}` : ""}</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{detail.description}</p>
            <div>
              <p className="mb-2 text-sm font-semibold">What is inside</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {detail.apps.map((x) => (
                  <li key={x.key} className="flex gap-3 rounded-xl border border-border p-3 text-sm">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: detail.color }}><x.icon className="h-4 w-4" /></span>
                    <span><b className="block">{x.name}</b><span className="text-xs text-muted-foreground">{x.desc}</span></span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">What you get</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {detail.features.map((f) => (
                  <li key={f} className="flex gap-2 rounded-xl border border-border p-2.5 text-sm"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />{f}</li>
                ))}
              </ul>
            </div>
            {!isAdmin && <p className="flex items-center gap-2 rounded-xl bg-muted p-3 text-sm text-muted-foreground"><X className="h-4 w-4" /> Only the owner, or someone with billing rights, can switch modules on or off.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
