/**
 * One page per suite (garage.jmsurf.co.ke/solutions/<key>): what it does, every app in it,
 * the features, how it works with the rest of JMSURF Garage, who it is for and how to start.
 * No module prices here (they are shown inside the app when a suite is switched on).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import { ArrowRight, Check, ChevronDown, Layers, Smartphone, ShieldCheck, Sparkles, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MODULES, MODULE_BY_KEY } from "@/lib/modules";
import { SUITE_AUDIENCE, suiteFaqs } from "@/lib/siteFacts";
import { suiteMeta } from "@/seo/meta";
import SuiteVisual from "@/components/landing/SuiteVisual";
import { Orbs } from "@/components/brand/Orbs";
import { Nav, Footer, FinalCta, Reveal, Eyebrow, Hl, CTA } from "@/pages/Landing";
import { track } from "@/lib/tracking";
import { cn } from "@/lib/utils";

const WHO = SUITE_AUDIENCE;

export default function Solution() {
  const { key = "" } = useParams<{ key: string }>();
  const m = MODULE_BY_KEY[key];
  const [contact, setContact] = useState({ phone: "0712 504 593", email: "support@jmsurf.co.ke" });
  const [open, setOpen] = useState<number | null>(0);
  useEffect(() => {
    window.scrollTo(0, 0);
    void supabase.from("cms_content").select("section, content").eq("section", "contact").maybeSingle().then(({ data }) => {
      const c = (data as any)?.content || {};
      setContact({ phone: String(c.phone || "0712 504 593"), email: String(c.email || "support@jmsurf.co.ke") });
    });
  }, [key]);
  const related = useMemo(() => {
    if (!m) return [];
    const same = MODULES.filter((x) => x.key !== m.key && x.category === m.category);
    const base = MODULES.filter((x) => ["books", "ai", "crm", "inventory"].includes(x.key) && x.key !== m.key && !same.includes(x));
    return [...same, ...base].slice(0, 4);
  }, [m]);
  if (!m) return <Navigate to="/solutions" replace />;
  const short = m.name.replace(/^(JMSURF|DASH) /, "");
  const idx = MODULES.findIndex((x) => x.key === m.key);
  const prev = MODULES[(idx - 1 + MODULES.length) % MODULES.length], next = MODULES[(idx + 1) % MODULES.length];
  const faqs = suiteFaqs(m);
  const meta = suiteMeta(m.key);
  return (
    <div className="min-h-screen overflow-x-clip bg-background font-body text-foreground">
      <Helmet>
        <title>{meta?.title || `${m.name} · JMSURF Garage`}</title>
        <meta name="description" content={meta?.description || m.tagline} />
        <link rel="canonical" href={`https://garage.jmsurf.co.ke/solutions/${m.key}`} />
        <meta property="og:title" content={`${m.name} · JMSURF Garage`} />
        <meta property="og:description" content={meta?.description || m.tagline} />
        <meta property="og:url" content={`https://garage.jmsurf.co.ke/solutions/${m.key}`} />
      </Helmet>
      <Nav />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden pb-20 pt-28 sm:pt-36" style={{ background: `radial-gradient(900px 520px at 85% 0%, ${m.color}2b, transparent 60%), hsl(var(--background))` }}>
          <Orbs intensity="subtle" />
          <div className="lx-grain" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <Link to="/solutions" className="text-[11px] font-bold uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground">← All suites</Link>
              <div className="mt-6 flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg" style={{ background: m.color, boxShadow: `0 16px 30px -14px ${m.color}` }}><m.icon className="h-6 w-6" /></span>
                <span className="text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: m.color }}>{m.category}</span>
              </div>
              <motion.h1 initial={{ opacity: 0, y: 20, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.8 }}
                className="mt-5 font-display text-[2.6rem] font-extrabold leading-[0.98] tracking-tight sm:text-7xl">
                JMSURF <span className="font-accent font-normal" style={{ color: m.color }}>{short}</span>
              </motion.h1>
              <p className="mt-5 max-w-xl text-lg font-medium text-foreground/85">{m.tagline}</p>
              <p className="mt-4 max-w-xl leading-relaxed text-muted-foreground">{m.description}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                {m.included ? <CTA /> : (
                  <Link to={`/register?app=${m.key}`} onClick={() => track("Lead", { content_name: `solution_${m.key}` })}
                    className="group inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 font-display text-[15px] font-bold text-white transition-transform hover:-translate-y-0.5" style={{ background: m.color, boxShadow: `0 18px 36px -16px ${m.color}` }}>
                    Start with {short} free <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                )}
                <a href="/api/demo/start" className="inline-flex items-center justify-center rounded-full bg-card/70 px-6 py-3.5 font-display text-[15px] font-bold ring-1 ring-border backdrop-blur hover:bg-muted">See it in the live demo</a>
              </div>
              <p className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                {["14 days free", "No card", `${m.apps.length} apps`].map((t) => <span key={t} className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5" style={{ color: m.color }} />{t}</span>)}
              </p>
            </div>
            <motion.div initial={{ opacity: 0, y: 40, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ duration: 0.9, delay: 0.2 }}>
              <SuiteVisual m={m} />
            </motion.div>
          </div>
        </section>

        {/* Apps */}
        <section className="bg-muted/30 py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <Reveal className="max-w-3xl">
              <Eyebrow left>What's inside</Eyebrow>
              <h2 className="mt-5 font-display text-[2rem] font-extrabold leading-[1.05] tracking-tight sm:text-[3.2rem]">{m.apps.length} apps, <Hl>one suite.</Hl></h2>
              <p className="mt-4 text-lg text-muted-foreground">Switch on {m.name} and all of these appear in your menu together.</p>
            </Reveal>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {m.apps.map((x, i) => (
                <Reveal key={x.key} delay={i * 0.05} className="group rounded-3xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:shadow-xl">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: `${m.color}1a`, color: m.color }}><x.icon className="h-5 w-5" /></span>
                  <h3 className="mt-4 font-display text-lg font-bold">{x.name}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{x.desc}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Features, alternating with a picture */}
        <section className="py-24">
          <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2">
            <Reveal className="order-2 lg:order-1"><SuiteVisual m={m} /></Reveal>
            <div className="order-1 lg:order-2">
              <Eyebrow left>Features</Eyebrow>
              <h2 className="mt-5 font-display text-[2rem] font-extrabold leading-[1.05] tracking-tight sm:text-[3rem]">Everything you expect, <Hl>and the local bits.</Hl></h2>
              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {m.features.map((f, i) => (
                  <motion.li key={f} initial={{ opacity: 0, x: 16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.04 }} className="flex gap-2.5 text-[15px] text-foreground/85">
                    <Check className="mt-0.5 h-5 w-5 shrink-0" style={{ color: m.color }} />{f}
                  </motion.li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Built in for every suite */}
        <section className="bg-muted/30 py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <Reveal className="mx-auto max-w-3xl text-center">
              <Eyebrow>Part of one system</Eyebrow>
              <h2 className="mt-5 font-display text-[2rem] font-extrabold leading-[1.05] tracking-tight sm:text-[3rem]">{short} works with <Hl>everything else.</Hl></h2>
            </Reveal>
            <div className="mt-12 grid gap-4 md:grid-cols-4">
              {[[Layers, "One set of books", "Every sale, cost and payment lands in the same ledger, ready for reports."], [Smartphone, "M-Pesa & SMS built in", "Collect payments and send messages without extra tools."], [Sparkles, "Garage AI included", "Ask questions about your data and let it draft the work."], [ShieldCheck, "Roles & audit trail", "Each person sees only what they should; every change is recorded."]].map(([Icon, t, d]: any) => (
                <Reveal key={t} className="rounded-3xl border border-border bg-card p-6"><Icon className="h-7 w-7" style={{ color: m.color }} /><h3 className="mt-4 font-display text-lg font-bold">{t}</h3><p className="mt-1.5 text-[15px] text-muted-foreground">{d}</p></Reveal>
              ))}
            </div>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((r) => (
                <Link key={r.key} to={`/solutions/${r.key}`} className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: r.color }}><r.icon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1"><b className="block truncate">{r.name}</b><span className="block truncate text-xs text-muted-foreground">{r.tagline}</span></span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Who it is for + FAQ */}
        <section className="py-24">
          <div className="mx-auto grid max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-2">
            <div>
              <Eyebrow left>Who it's for</Eyebrow>
              <h2 className="mt-5 font-display text-[2rem] font-extrabold leading-[1.05] tracking-tight sm:text-[2.8rem]">Made for <Hl>businesses like yours.</Hl></h2>
              <ul className="mt-8 space-y-3">
                {WHO[m.category].map((w) => <li key={w} className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 font-medium"><span className="h-2 w-2 rounded-full" style={{ background: m.color }} />{w}</li>)}
              </ul>
            </div>
            <div>
              <Eyebrow left>Questions</Eyebrow>
              <div className="mt-8 divide-y divide-border rounded-3xl border border-border bg-card">
                {faqs.map(([q, a], i) => (
                  <div key={q}>
                    <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-display font-bold" aria-expanded={open === i}>{q}<ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform", open === i && "rotate-180")} /></button>
                    {open === i && <p className="px-5 pb-4 leading-relaxed text-muted-foreground">{a}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Previous / next suite */}
        <section className="border-t border-border">
          <div className="mx-auto grid max-w-7xl sm:grid-cols-2">
            {[[prev, "Previous suite"], [next, "Next suite"]].map(([x, l]: any, i) => (
              <Link key={l} to={`/solutions/${x.key}`} className={cn("group flex items-center gap-4 px-4 py-8 transition-colors hover:bg-muted/40 sm:px-6", i === 1 && "sm:justify-end sm:text-right")}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white" style={{ background: x.color }}><x.icon className="h-5 w-5" /></span>
                <span className={cn(i === 1 && "sm:order-first")}><span className="block text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{l}</span><b className="font-display text-lg">{x.name}</b></span>
              </Link>
            ))}
          </div>
        </section>
        <FinalCta />
      </main>
      <Footer phone={contact.phone} email={contact.email} />
      <a href={`https://wa.me/254712504593?text=${encodeURIComponent(`Hello, I'd like to know more about ${m.name}.`)}`} target="_blank" rel="noopener noreferrer"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25d366] text-white shadow-2xl transition-transform hover:scale-105" aria-label="Chat with us on WhatsApp">
        <MessageCircle className="h-7 w-7" />
      </a>
    </div>
  );
}
