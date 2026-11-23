/**
 * jmsurfgarage.co.ke/pricing: plans by garage size, every module's monthly price,
 * extra branches, the All modules bundle and a live price calculator. Prices come
 * from the live plans and platform_modules tables (super admin), over the defaults.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Check, Sparkles } from "lucide-react";
import { Orbs } from "@/components/brand/Orbs";
import { MODULE_BY_KEY, MODULE_CATEGORIES, ADDON_MODULES } from "@/lib/modules";
import { EXTRA_BRANCH_PRICE, bundleListPrice, kes, priceBox, YEAR_MONTHS } from "@/lib/garagePlans";
import { useGarageCatalogue } from "@/hooks/useGarageCatalogue";
import { HOME } from "@/seo/homeContent";
import { PRICING_META, canonicalUrl } from "@/seo/meta";
import { Nav, Footer, FinalCta, Eyebrow, Hl, CTA, Faq, useSiteContact, WhatsAppButton } from "@/pages/Landing";
import { cn } from "@/lib/utils";
import { PLAN_TABLE_HEADING, planTable } from "@/seo/content";
import { TableView } from "@/pages/ContentPage";

export default function Pricing() {
  const cat = useGarageCatalogue();
  const contact = useSiteContact();
  const [year, setYear] = useState(false);
  const [plan, setPlan] = useState("starter");
  const [mods, setMods] = useState<string[]>([]);
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const sizePlans = cat.plans.filter((p) => !p.bundle);
  const bundle = cat.plans.find((p) => p.bundle);
  const box = useMemo(() => priceBox(cat, plan, mods, { cycle: year ? "year" : "month" }), [cat, plan, mods, year]);
  const unit = year ? "year" : "month";
  const price = (monthly: number) => (year ? monthly * YEAR_MONTHS : monthly);
  const shown = ADDON_MODULES.filter((m) => !cat.off.has(m.key));

  return (
    <div className="min-h-screen overflow-x-clip bg-background font-body text-foreground">
      <Helmet>
        <title>{PRICING_META.title}</title>
        <meta name="description" content={PRICING_META.description} />
        <link rel="canonical" href={canonicalUrl("/pricing")} />
      </Helmet>
      <Nav />
      <main>
        <section className="relative overflow-hidden pb-10 pt-28 sm:pt-36">
          <Orbs intensity="subtle" />
          <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
            <Eyebrow>Pricing</Eyebrow>
            <h1 className="mt-6 font-display text-[2.4rem] font-extrabold leading-[1.02] tracking-[-0.035em] sm:text-6xl">Pay for your size. <Hl>Add what you do.</Hl></h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">Every plan includes Garage Core. Prices are per garage per month in Kenya shillings, VAT excluded. Pay yearly and get 2 months free. Everything is free for 14 days.</p>
            <div className="mt-8 inline-flex rounded-full bg-muted p-1" role="group" aria-label="Billing period">
              {[["Monthly", false], ["Yearly · 2 months free", true]].map(([l, v]) => (
                <button key={String(l)} onClick={() => setYear(v as boolean)} className={cn("rounded-full px-4 py-2 text-sm font-semibold", year === v ? "bg-card text-foreground shadow" : "text-muted-foreground")}>{l as string}</button>
              ))}
            </div>
          </div>
        </section>

        {/* Plans */}
        <section className="pb-16">
          <div className="mx-auto grid max-w-7xl gap-4 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-5">
            {sizePlans.map((p) => (
              <div key={p.code} className={cn("flex flex-col rounded-3xl border bg-card p-5", p.code === "business" ? "border-primary ring-1 ring-primary/30" : "border-border")}>
                {p.code === "business" && <span className="mb-2 self-start rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">Most garages</span>}
                <h2 className="font-display text-xl font-extrabold">{p.name}</h2>
                <p className="mt-2 font-display text-3xl font-extrabold">{p.quoteOnly ? "Talk to us" : kes(year ? p.priceYear : p.price)}<span className="text-sm font-medium text-muted-foreground">{p.quoteOnly ? "" : ` / ${unit}`}</span></p>
                <p className="text-xs text-muted-foreground">{p.users >= 999999 ? "Any number of users" : `Up to ${p.users} users`} · {p.branches >= 999 ? "many branches" : `${p.branches} branch${p.branches === 1 ? "" : "es"}`}</p>
                <p className="mt-3 text-sm text-muted-foreground">{p.blurb}</p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Garage Core</li>
                  {(p.quoteOnly ? ["Every garage module", "Your own price and terms"] : p.includes.map((k) => MODULE_BY_KEY[k]?.name || k)).map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{x}</li>)}
                </ul>
                {p.quoteOnly
                  ? <a href={`https://wa.me/${contact.wa}?text=${encodeURIComponent("Hello, I'd like an Enterprise price for JMSURF Garage.")}`} className="mt-5 rounded-full bg-card py-2.5 text-center text-sm font-bold ring-1 ring-border hover:bg-muted">Contact us</a>
                  : <Link to={`/register?plan=${p.code}`} className="mt-5 rounded-full bg-primary py-2.5 text-center text-sm font-bold text-primary-foreground hover:bg-primary/90">Start free</Link>}
              </div>
            ))}
          </div>
          {bundle && (
            <div className="mx-auto mt-6 max-w-7xl px-4 sm:px-6">
              <div className="flex flex-col items-start gap-3 rounded-3xl bg-[linear-gradient(135deg,#7a0b14,#a8121b_50%,#1f2329)] p-6 text-white sm:flex-row sm:items-center">
                <Sparkles className="h-8 w-8 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-display text-xl font-extrabold">{bundle.name}: {kes(year ? bundle.priceYear : bundle.price)} / {unit}</p>
                  <p className="text-sm text-white/80">{bundle.blurb} Normally {kes(price(bundleListPrice(cat)))} / {unit}. {bundle.users} users, {bundle.branches} branches.</p>
                </div>
                <Link to="/register?plan=all_modules" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-[#a8121b]">Start free</Link>
              </div>
            </div>
          )}
        </section>

        {/* Plans side by side (same table as the page snapshot) */}
        <section className="pb-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <h2 className="font-display text-3xl font-extrabold tracking-tight">{PLAN_TABLE_HEADING}</h2>
            <TableView t={planTable(cat.plans)} />
          </div>
        </section>

        {/* Modules + calculator */}
        <section className="bg-muted/40 py-16 sm:py-24">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[1.5fr_1fr]">
            <div>
              <h2 className="font-display text-3xl font-extrabold tracking-tight">Module prices</h2>
              <p className="mt-2 text-muted-foreground">Tick modules to add them to the calculator. A module you turn on is billed from that day; one you turn off runs to the end of the period you paid for.</p>
              {MODULE_CATEGORIES.map((c) => {
                const list = shown.filter((m) => m.category === c);
                if (!list.length) return null;
                return (
                  <div key={c} className="mt-6">
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">{c}</h3>
                    <div className="mt-2 divide-y divide-border rounded-2xl border border-border bg-card">
                      {list.map((m) => {
                        const on = mods.includes(m.key);
                        const inPlans = (m.includedIn || []).map((k) => cat.plans.find((x) => x.code === k)?.name).filter(Boolean);
                        return (
                          <label key={m.key} className="flex cursor-pointer items-start gap-3 p-3.5">
                            <input type="checkbox" className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" checked={on} onChange={() => setMods((x) => (on ? x.filter((k) => k !== m.key) : [...x, m.key]))} />
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: m.color }}><m.icon className="h-4 w-4" /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold">{m.name}</span>
                              <span className="block text-xs text-muted-foreground">{m.tagline}</span>
                              {inPlans.length > 0 && <span className="mt-1 block text-xs font-semibold text-primary">Included in {inPlans.join(" and ")}</span>}
                            </span>
                            <span className="shrink-0 text-right font-display font-extrabold">{kes(price(cat.prices[m.key] ?? m.price))}<span className="block text-[10px] font-medium text-muted-foreground">/ {unit}</span></span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
                <h2 className="font-display text-xl font-extrabold">Your price</h2>
                <label className="mt-4 block text-sm font-medium">Plan
                  <select className="fi mt-1.5" value={plan} onChange={(e) => setPlan(e.target.value)}>
                    {cat.plans.filter((p) => !p.quoteOnly).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                  </select>
                </label>
                <ul className="mt-4 space-y-2 text-sm">
                  {box.lines.map((l) => <li key={l.key} className="flex justify-between gap-3"><span>{l.label}{l.note ? <span className="text-muted-foreground"> · {l.note}</span> : null}</span><b className="shrink-0">{kes(l.amount)}</b></li>)}
                </ul>
                <p className="mt-4 flex justify-between border-t border-border pt-3 font-display text-lg font-extrabold"><span>Total</span><span>{kes(box.total)} / {unit}</span></p>
                {box.bundleSaves > 0 && box.bundle && (
                  <button onClick={() => { setPlan(box.bundle!.code); setMods([]); }} className="mt-3 w-full rounded-xl bg-primary/10 px-3 py-2 text-left text-sm font-medium text-primary">
                    {box.bundle.name} costs {kes(box.bundleSaves)} less. Use it instead.
                  </button>
                )}
                <p className="mt-3 text-xs text-muted-foreground">Extra branches {kes(EXTRA_BRANCH_PRICE)} a month each. SMS bought in bundles. Prices exclude VAT.</p>
                <CTA className="mt-5 w-full">Start free for 14 days</CTA>
              </div>
            </aside>
          </div>
        </section>

        <Faq items={HOME.pricingFaq} title={<>Billing <Hl>questions.</Hl></>} />
        <FinalCta />
      </main>
      <Footer phone={contact.phone} email={contact.email} />
      <WhatsAppButton wa={contact.wa} />
    </div>
  );
}
