/**
 * /solutions: every garage module on one page, grouped and filterable, each card
 * opening its own page (/solutions/<module>). Prices are on /pricing.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Check, Layers } from "lucide-react";
import { PUBLIC_MODULES as MODULES, MODULE_CATEGORIES, type ModuleCategory } from "@/lib/modules";
import { Orbs, GridGlow } from "@/components/brand/Orbs";
import { Nav, Footer, FinalCta, Eyebrow, Hl, CTA, useSiteContact, WhatsAppButton } from "@/pages/Landing";
import { track } from "@/lib/tracking";
import GaragePhoto from "@/components/landing/GaragePhoto";
import { MODULE_PHOTOS, PHOTOS } from "@/lib/photos";
import { SOLUTIONS_META } from "@/seo/meta";
import { cn } from "@/lib/utils";

const short = (n: string) => n.replace(/^(JMSURF|DASH) /, "");

export default function Solutions() {
  const contact = useSiteContact();
  const [cat, setCat] = useState<ModuleCategory | "all">("all");
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const list = useMemo(() => MODULES.filter((m) => cat === "all" || m.category === cat), [cat]);
  const cats = MODULE_CATEGORIES.filter((c) => MODULES.some((m) => m.category === c));

  return (
    <div className="min-h-screen overflow-x-clip bg-background font-body text-foreground">
      <Helmet>
        <title>{SOLUTIONS_META.title}</title>
        <meta name="description" content={SOLUTIONS_META.description} />
        <link rel="canonical" href="https://jmsurfgarage.co.ke/solutions" />
        <meta property="og:title" content="All modules · JMSURF Garage" />
        <meta property="og:url" content="https://jmsurfgarage.co.ke/solutions" />
      </Helmet>
      <Nav />
      <main>
        <section className="relative overflow-hidden pb-10 pt-28 sm:pt-36">
          <Orbs />
          <GridGlow />
          <div className="lx-grain" />
          <div className="relative mx-auto max-w-5xl px-4 text-center sm:px-6">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <Eyebrow>{MODULES.length} modules · one login</Eyebrow>
            </motion.div>
            <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.1 }}
              className="mt-6 font-display text-[2.5rem] font-extrabold leading-[1.02] tracking-[-0.035em] sm:text-7xl">
              Every module your <Hl>garage needs.</Hl>
            </motion.h1>
            <motion.p initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.25 }}
              className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Garage Core is in every plan. Switch on any other module from inside your workspace, each free for 14 days, and it shares your customers, vehicles, parts and invoices from the first minute.
            </motion.p>
          </div>
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.35 }}
            className="relative mx-auto mt-10 hidden max-w-6xl grid-cols-4 gap-3 px-4 sm:grid sm:px-6">
            {[PHOTOS.workshop, PHOTOS.spares, PHOTOS.yard, PHOTOS.wash].map((ph, i) => (
              <GaragePhoto key={ph.name} photo={ph} sizes="25vw" className={cn("aspect-[4/3] rounded-3xl ring-1 ring-border", i % 2 && "translate-y-4")} />
            ))}
          </motion.div>
        </section>

        <section className="relative pb-24">
          <div className="sticky top-16 z-20 border-y border-border/60 bg-background/80 backdrop-blur-xl">
            <div className="mx-auto flex max-w-7xl gap-1.5 overflow-x-auto px-4 py-3 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden">
              {(["all", ...cats] as const).map((c) => (
                <button key={c} onClick={() => setCat(c)}
                  className={cn("relative shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors", cat === c ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {cat === c && <motion.span layoutId="sol-cat" className="absolute inset-0 rounded-full bg-primary" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
                  <span className="relative">{c === "all" ? "All modules" : c}</span>
                </button>
              ))}
            </div>
          </div>

          <motion.div layout className="mx-auto mt-10 grid max-w-7xl gap-5 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {list.map((m, i) => (
                <motion.div key={m.key} layout initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.45, delay: Math.min(i, 8) * 0.04, ease: [0.2, 0.7, 0.2, 1] }}>
                  <Link to={`/solutions/${m.key}`} onClick={() => track("ViewContent", { content_name: m.key })}
                    className="group relative flex h-full flex-col overflow-hidden rounded-[28px] border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_30px_60px_-30px_rgba(16,18,24,.45)]">
                    <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-25 blur-3xl transition-opacity duration-500 group-hover:opacity-50" style={{ background: m.color }} />
                    {MODULE_PHOTOS[m.key] && (
                      <GaragePhoto photo={MODULE_PHOTOS[m.key]} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className="-mx-6 -mt-6 mb-[-1.5rem] aspect-[16/8]" imgClassName="transition-transform duration-700 group-hover:scale-105" />
                    )}
                    <div className={cn("relative flex items-start justify-between gap-3", MODULE_PHOTOS[m.key] && "items-end")}>
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6" style={{ background: m.color, boxShadow: `0 12px 24px -12px ${m.color}` }}>
                        <m.icon className="h-6 w-6" />
                      </span>
                      <span className="rounded-full border border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{m.included ? "In every plan" : m.category}</span>
                    </div>
                    <h2 className="relative mt-5 font-display text-2xl font-extrabold tracking-tight">{short(m.name)}</h2>
                    <p className="relative mt-2 text-[15px] leading-relaxed text-muted-foreground">{m.tagline}</p>
                    <ul className="relative mt-4 space-y-1.5">
                      {m.features.slice(0, 3).map((f) => <li key={f} className="flex gap-2 text-sm text-foreground/80"><Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: m.color }} />{f}</li>)}
                    </ul>
                    <div className="relative mt-auto flex items-center justify-between pt-6">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Layers className="h-3.5 w-3.5" />{m.category}</span>
                      <span className="inline-flex items-center gap-1 text-sm font-bold" style={{ color: m.color }}>Explore <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
          <div className="mt-14 flex flex-col items-center justify-center gap-3 px-4 sm:flex-row"><CTA /><Link to="/pricing" className="inline-flex items-center justify-center rounded-full bg-card px-6 py-3.5 font-display text-[15px] font-bold ring-1 ring-border hover:bg-muted">See prices</Link></div>
        </section>
        <FinalCta />
      </main>
      <Footer phone={contact.phone} email={contact.email} />
      <WhatsAppButton wa={contact.wa} />
    </div>
  );
}
