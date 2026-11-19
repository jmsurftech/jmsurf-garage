/**
 * garage.jmsurf.co.ke: the JMSURF Garage website home page. Phone first, light by
 * default with dark mode, plain words. The words come from src/seo/homeContent.ts
 * (the build-time snapshot in src/seo/pages.ts uses the same text).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { motion, useInView } from "framer-motion";
import {
  ArrowRight, Check, X, Menu, Smartphone, ShieldCheck, FileCheck, MessageSquare, WifiOff, Headset, Wallet,
  ClipboardList, ClipboardCheck, FileText, ThumbsUp, Wrench, Receipt, BellRing, ChevronDown, MessageCircle, Phone, Mail,
  Sun, Moon, Car, Store, Ship, SprayCan, Droplets, Truck, Gauge, Building2, Lock, DatabaseBackup, UserRoundCog,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashLogo, DashMark } from "@/components/brand/DashLogo";
import { Orbs } from "@/components/brand/Orbs";
import GaragePhoto from "@/components/landing/GaragePhoto";
import { PHOTOS, WHO_PHOTOS } from "@/lib/photos";
import { MODULE_BY_KEY, MODULE_CATEGORIES, PUBLIC_MODULES } from "@/lib/modules";
import { kes } from "@/lib/garagePlans";
import { useGarageCatalogue } from "@/hooks/useGarageCatalogue";
import { useTheme } from "@/hooks/useTheme";
import { track } from "@/lib/tracking";
import { JMSURF_FAMILY } from "@/lib/siteFacts";
import { HOME, HOME_HEADINGS } from "@/seo/homeContent";
import { HOME_META, canonicalUrl } from "@/seo/meta";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ bits */

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.55, delay, ease: [0.2, 0.7, 0.2, 1] }}>
      {children}
    </motion.div>
  );
}

/** Content that rises out of its own mask when the mask scrolls into view. */
export function MaskRise({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "-40px" });
  return (
    <div ref={ref} className={cn("overflow-hidden pb-1", className)}>
      <motion.div initial={{ y: "105%" }} animate={{ y: seen ? "0%" : "105%" }} transition={{ duration: 0.8, delay, ease: [0.2, 0.7, 0.2, 1] }}>{children}</motion.div>
    </div>
  );
}

export function Eyebrow({ children, left }: { children: ReactNode; left?: boolean }) {
  return <span className={cn("lx-eyebrow", left && "left")}>{children}</span>;
}

/** Highlight words: the brand gradient. */
export const Hl = ({ children }: { children: ReactNode }) => <span className="bg-gradient-to-r from-primary via-[hsl(355_80%_52%)] to-[hsl(10_85%_55%)] bg-clip-text pr-1 text-transparent">{children}</span>;

/** A heading whose highlighted last words use the brand gradient. */
function Title({ text, highlight }: { text: string; highlight: number }) {
  const words = text.split(" ");
  const cut = Math.max(0, words.length - highlight);
  return <>{words.slice(0, cut).join(" ")} <Hl>{words.slice(cut).join(" ")}</Hl></>;
}

function SectionTitle({ eyebrow, title, text, center = true }: { eyebrow?: string; title: ReactNode; text?: ReactNode; center?: boolean }) {
  return (
    <div className={cn("max-w-3xl", center ? "mx-auto text-center" : "")}>
      {eyebrow && <Reveal><Eyebrow left={!center}>{eyebrow}</Eyebrow></Reveal>}
      <MaskRise className="mt-5">
        <h2 className="font-display text-[1.9rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-[3.2rem]">{title}</h2>
      </MaskRise>
      {text && <Reveal delay={0.12}><p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">{text}</p></Reveal>}
    </div>
  );
}

export const CTA = ({ children = "Start free for 14 days", className, ghost }: { children?: ReactNode; className?: string; ghost?: boolean }) => (
  <Link to="/register" onClick={() => track("Lead", { content_name: "start_free" })}
    className={cn("group inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 font-display text-[15px] font-bold transition-all hover:-translate-y-0.5",
      ghost ? "bg-card text-foreground ring-1 ring-border hover:bg-muted" : "bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:bg-primary/90", className)}>
    {children} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
  </Link>
);

function ThemeToggle({ className }: { className?: string }) {
  const { darkMode, toggleDarkMode } = useTheme();
  return (
    <button onClick={toggleDarkMode} aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
      className={cn("flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground ring-1 ring-border transition-colors hover:bg-muted hover:text-foreground", className)}>
      {darkMode ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}

/* ------------------------------------------------------------------ nav */

export function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { darkMode } = useTheme();
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const links: [string, string][] = [["/#who", "Who it's for"], ["/#how", "How it works"], ["/solutions", "Modules"], ["/pricing", "Pricing"], ["/#faq", "Questions"]];
  return (
    <header className={cn("fixed inset-x-0 top-0 z-50 transition-all", scrolled || open ? "border-b border-border bg-background/90 shadow-sm backdrop-blur-xl" : "bg-transparent")}>
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 xl:gap-6">
        <Link to="/" aria-label="JMSURF Garage home"><DashLogo tone={darkMode ? "light" : "dark"} /></Link>
        <nav className="hidden flex-1 items-center justify-center gap-0 lg:flex xl:gap-1">
          {links.map(([h, l]) => <a key={h} href={h} className="group relative whitespace-nowrap px-2 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground xl:px-3 xl:tracking-[0.2em]">{l}<span className="absolute inset-x-3 -bottom-0.5 h-px origin-left scale-x-0 bg-primary transition-transform group-hover:scale-x-100" /></a>)}
        </nav>
        <div className="hidden shrink-0 items-center gap-1 whitespace-nowrap lg:flex xl:gap-2">
          <ThemeToggle />
          <a href="https://app.garage.jmsurf.co.ke/login" className="rounded-full px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted">Sign in</a>
          <CTA className="!px-5 !py-2.5 text-sm">Start free</CTA>
        </div>
        <div className="ml-auto flex items-center gap-1 lg:hidden">
          <ThemeToggle />
          <button onClick={() => setOpen(!open)} className="rounded-lg p-2 text-foreground" aria-label="Menu" aria-expanded={open}>{open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}</button>
        </div>
      </div>
      {open && (
        <div className="border-t border-border bg-background px-4 pb-5 pt-2 shadow-xl lg:hidden">
          {links.map(([h, l]) => <a key={h} href={h} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-3 font-medium text-foreground hover:bg-muted">{l}</a>)}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <a href="https://app.garage.jmsurf.co.ke/login" className="rounded-full border border-border py-3 text-center font-semibold">Sign in</a>
            <Link to="/register" className="rounded-full bg-primary py-3 text-center font-semibold text-primary-foreground">Start free</Link>
          </div>
        </div>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ hero */

function Hero() {
  return (
    <section className="relative overflow-hidden bg-background pb-16 pt-28 sm:pb-24 sm:pt-36">
      <Orbs intensity="subtle" />
      <div className="lx-grain" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}><Eyebrow left>{HOME.eyebrow}</Eyebrow></motion.div>
          <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.75, delay: 0.08 }}
            className="mt-6 font-display text-[2.6rem] font-extrabold leading-[1] tracking-[-0.035em] sm:text-7xl">
            <Title text={HOME.headline} highlight={2} />
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.2 }}
            className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">{HOME.lead}</motion.p>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.3 }} className="mt-8 flex flex-col gap-3 sm:flex-row">
            <CTA />
            <Link to="/pricing" className="inline-flex items-center justify-center rounded-full bg-card/70 px-6 py-3.5 font-display text-[15px] font-bold ring-1 ring-border backdrop-blur hover:bg-muted">See prices</Link>
          </motion.div>
          <ul className="mt-8 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
            {HOME.stats.map((s) => (
              <li key={s.v} className="rounded-2xl border border-border bg-card/70 p-3 backdrop-blur">
                <p className="font-display text-lg font-extrabold leading-tight">{s.v}</p>
                <p className="text-xs text-muted-foreground">{s.l}</p>
              </li>
            ))}
          </ul>
        </div>
        <motion.div initial={{ opacity: 0, y: 36 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.85, delay: 0.2 }} className="relative">
          <HeroPhoto />
        </motion.div>
      </div>
    </section>
  );
}

/** The hero picture: a real workshop with the job's progress floating over it. */
function HeroPhoto() {
  const chips: [typeof ClipboardCheck, string, string, string][] = [
    [ClipboardCheck, "Job card", "Inspection done, photos added", "left-3 top-5 sm:-left-6 sm:top-8"],
    [Receipt, "eTIMS invoice", "Signed for KRA", "right-3 top-1/2 sm:-right-6"],
    [BellRing, "Car ready", "SMS sent to the customer", "bottom-5 left-6 sm:-bottom-5 sm:left-10"],
  ];
  return (
    <div className="relative">
      <div aria-hidden className="absolute -inset-4 rounded-[2.5rem] bg-gradient-to-br from-primary/25 via-transparent to-primary/10 blur-2xl" />
      <GaragePhoto photo={PHOTOS.hero} eager sizes="(min-width: 1024px) 45vw, 100vw"
        className="relative aspect-[4/3] rounded-[2rem] shadow-2xl shadow-primary/20 ring-1 ring-border sm:aspect-[5/4]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[2rem] bg-gradient-to-t from-black/45 via-transparent to-transparent" />
      {chips.map(([Icon, t, d, pos], i) => (
        <motion.div key={t} initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.6, delay: 0.55 + i * 0.18 }}
          className={cn("absolute flex max-w-[15rem] items-center gap-3 rounded-2xl border border-border/70 bg-card/95 px-3.5 py-2.5 shadow-xl backdrop-blur", pos)}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-[18px] w-[18px]" /></span>
          <span className="min-w-0">
            <span className="block font-display text-sm font-bold leading-tight text-foreground">{t}</span>
            <span className="block text-xs text-muted-foreground">{d}</span>
          </span>
          <Check className="h-4 w-4 shrink-0 text-emerald-600" />
        </motion.div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ who */

const WHO_ICONS = [Wrench, Car, Gauge, Building2, Store, Ship, SprayCan, Droplets, Truck];

function Who() {
  return (
    <section id="who" className="scroll-mt-20 bg-muted/40 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle eyebrow="Who it's for" title={<Title text={HOME_HEADINGS.who} highlight={3} />} text="One system that grows with you: start small, add modules as you grow." />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HOME.who.map((w, i) => {
            const Icon = WHO_ICONS[i % WHO_ICONS.length];
            return (
              <Reveal key={w.t} delay={Math.min(i, 6) * 0.04} className="group overflow-hidden rounded-3xl border border-border bg-card transition-all hover:-translate-y-1 hover:shadow-xl">
                {WHO_PHOTOS[i] && (
                  <div className="relative">
                    <GaragePhoto photo={WHO_PHOTOS[i]} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="aspect-[16/9]" imgClassName="transition-transform duration-700 group-hover:scale-105" />
                    <span className="absolute -bottom-5 left-6 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-card"><Icon className="h-5 w-5" /></span>
                  </div>
                )}
                <div className={cn("p-6", WHO_PHOTOS[i] && "pt-8")}>
                  {!WHO_PHOTOS[i] && <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>}
                  <h3 className="font-display text-lg font-bold">{w.t}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{w.d}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ workshop flow */

const FLOW_ICONS = [ClipboardList, ClipboardCheck, FileText, ThumbsUp, Wrench, Receipt, BellRing];

function Flow() {
  return (
    <section id="how" className="scroll-mt-20 bg-background py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle eyebrow="How it works" title={<Title text={HOME_HEADINGS.flow} highlight={3} />} text="Garage Core follows every car through your gate, the same way every time." />
        <div className="mx-auto mt-12 grid max-w-3xl items-start gap-10 lg:max-w-none lg:grid-cols-[1fr_1.1fr]">
        <div className="hidden lg:sticky lg:top-24 lg:grid lg:gap-4">
          <GaragePhoto photo={PHOTOS.inspect} sizes="40vw" className="aspect-[4/3] rounded-3xl ring-1 ring-border" />
          <div className="grid grid-cols-2 gap-4">
            <GaragePhoto photo={PHOTOS.wheel} sizes="20vw" className="aspect-square rounded-3xl ring-1 ring-border" />
            <GaragePhoto photo={PHOTOS.engine} sizes="20vw" className="aspect-square rounded-3xl ring-1 ring-border" />
          </div>
        </div>
        <ol className="relative w-full space-y-4">
          <span aria-hidden className="absolute bottom-6 left-[1.4rem] top-6 w-px bg-gradient-to-b from-primary/60 via-primary/20 to-transparent" />
          {HOME.flow.map((s, i) => {
            const Icon = FLOW_ICONS[i % FLOW_ICONS.length];
            return (
              <Reveal key={s.t} delay={i * 0.04}>
                <li className="relative flex gap-4 rounded-3xl border border-border bg-card p-5">
                  <span className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25"><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0">
                    <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Step {i + 1}</span>
                    <h3 className="font-display text-lg font-bold">{s.t}</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{s.d}</p>
                  </span>
                </li>
              </Reveal>
            );
          })}
        </ol>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Kenya */

const KENYA_ICONS = [Smartphone, FileCheck, MessageSquare, WifiOff, Headset, Wallet];

function Kenya() {
  return (
    <section className="bg-muted/40 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle eyebrow="M-Pesa · KRA eTIMS · SMS" title={<Title text={HOME_HEADINGS.kenya} highlight={3} />} />
        <Reveal className="relative mt-10 overflow-hidden rounded-[2rem] ring-1 ring-border">
          <GaragePhoto photo={PHOTOS.fundi} sizes="(min-width: 1280px) 1216px, 100vw" className="aspect-[4/3] sm:aspect-[21/8]" />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent sm:bg-gradient-to-r sm:from-black/75 sm:via-black/35" />
          <div className="absolute inset-y-0 left-0 flex max-w-lg flex-col justify-end p-6 text-white sm:justify-center sm:p-10">
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/75">Made in Nairobi</p>
            <p className="mt-2 font-display text-2xl font-extrabold leading-tight sm:text-4xl">Built for how Kenyan garages really work.</p>
            <p className="mt-2 hidden text-white/80 sm:block">From the fundi at the roadside to the dealer with branches: M-Pesa, eTIMS and SMS on any phone.</p>
          </div>
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HOME.kenya.map((k, i) => {
            const Icon = KENYA_ICONS[i % KENYA_ICONS.length];
            return (
              <Reveal key={k.t} delay={i * 0.04} className="rounded-3xl border border-border bg-card p-6">
                <Icon className="h-7 w-7 text-primary" />
                <h3 className="mt-4 font-display text-lg font-bold">{k.t}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{k.d}</p>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ modules */

function Modules() {
  const [cat, setCat] = useState<string>("all");
  const list = PUBLIC_MODULES.filter((m) => cat === "all" || m.category === cat);
  return (
    <section id="modules" className="scroll-mt-20 bg-background py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle eyebrow="Modules" title={<Title text={HOME_HEADINGS.modules} highlight={3} />} text="Garage Core is in every plan. Add a module for each thing your business does, each free for 14 days." />
        <div className="mt-8 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] sm:justify-center [&::-webkit-scrollbar]:hidden">
          {["all", ...MODULE_CATEGORIES].map((c) => (
            <button key={c} onClick={() => setCat(c)} className={cn("shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors", cat === c ? "bg-primary text-primary-foreground" : "text-muted-foreground ring-1 ring-border hover:text-foreground")}>
              {c === "all" ? "All" : c}
            </button>
          ))}
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((m) => (
            <Link key={m.key} to={`/solutions/${m.key}`} onClick={() => track("ViewContent", { content_name: m.key })}
              className="group flex h-full flex-col rounded-3xl border border-border bg-card p-5 transition-all hover:-translate-y-1 hover:shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl text-white" style={{ background: m.color }}><m.icon className="h-5 w-5" /></span>
                <span className="rounded-full border border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{m.included ? "In every plan" : m.category}</span>
              </div>
              <h3 className="mt-4 font-display text-lg font-extrabold">{m.name}</h3>
              <p className="mt-1.5 flex-1 text-[15px] leading-relaxed text-muted-foreground">{m.tagline}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-primary">What it does <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ pricing teaser */

function Plans() {
  const cat = useGarageCatalogue();
  const plans = cat.plans.filter((p) => !p.bundle);
  const bundle = cat.plans.find((p) => p.bundle);
  return (
    <section id="pricing" className="scroll-mt-20 bg-muted/40 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle eyebrow="Pricing" title={<Title text={HOME_HEADINGS.pricing} highlight={3} />} text="Choose a plan by the size of your garage, then add modules. Every plan starts with 14 days free; pay yearly and get 2 months free." />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {plans.map((p) => (
            <div key={p.code} className={cn("flex flex-col rounded-3xl border bg-card p-5", p.code === "business" ? "border-primary ring-1 ring-primary/30" : "border-border")}>
              <p className="font-display text-lg font-extrabold">{p.name}</p>
              <p className="mt-2 font-display text-2xl font-extrabold">{p.quoteOnly ? "Talk to us" : kes(p.price)}<span className="text-sm font-medium text-muted-foreground">{p.quoteOnly ? "" : " / month"}</span></p>
              <p className="text-xs text-muted-foreground">{p.users >= 999999 ? "Any number of users" : `${p.users} users`} · {p.branches >= 999 ? "many branches" : `${p.branches} branch${p.branches === 1 ? "" : "es"}`}</p>
              <p className="mt-3 flex-1 text-sm text-muted-foreground">{p.blurb}</p>
              <ul className="mt-3 space-y-1 text-sm">
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Garage Core</li>
                {p.code !== "enterprise" && p.includes.map((k) => <li key={k} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{MODULE_BY_KEY[k]?.name}</li>)}
              </ul>
            </div>
          ))}
        </div>
        {bundle && (
          <p className="mx-auto mt-6 max-w-3xl rounded-2xl bg-primary/10 px-4 py-3 text-center text-sm font-medium text-foreground">
            <b>{bundle.name}:</b> Pro plus every garage module for {kes(bundle.price)} a month. Extra branches {kes(2000)} a month each.
          </p>
        )}
        <div className="mt-8 flex justify-center"><Link to="/pricing" className="inline-flex items-center gap-2 rounded-full bg-card px-6 py-3 font-display font-bold ring-1 ring-border hover:bg-muted">Module prices and calculator <ArrowRight className="h-4 w-4" /></Link></div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ security + FAQ */

const SAFE_ICONS = [Lock, ShieldCheck, UserRoundCog, DatabaseBackup];

function Security() {
  return (
    <section className="bg-background py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle eyebrow="Safe by default" title={<Title text={HOME_HEADINGS.security} highlight={2} />} />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {HOME.security.map((s, i) => {
            const Icon = SAFE_ICONS[i % SAFE_ICONS.length];
            return <Reveal key={s.t} delay={i * 0.04} className="rounded-3xl border border-border bg-card p-6"><Icon className="h-6 w-6 text-primary" /><h3 className="mt-3 font-display font-bold">{s.t}</h3><p className="mt-1 text-sm text-muted-foreground">{s.d}</p></Reveal>;
          })}
        </div>
      </div>
    </section>
  );
}

export function Faq({ items, title, id }: { items: [string, string][]; title: ReactNode; id?: string }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id={id} className="scroll-mt-20 bg-muted/40 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionTitle eyebrow="Questions" title={title} />
        <div className="mt-10 divide-y divide-border rounded-3xl border border-border bg-card">
          {items.map(([q, a], i) => (
            <div key={q}>
              <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-display font-bold" aria-expanded={open === i}>
                {q}<ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform", open === i && "rotate-180")} />
              </button>
              {open === i && <p className="px-5 pb-4 leading-relaxed text-muted-foreground">{a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-background py-20 text-center sm:py-28">
      <GaragePhoto photo={PHOTOS.workshop} sizes="100vw" className="!absolute inset-0 opacity-[0.16] dark:opacity-25" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-background via-background/70 to-background" />
      <Orbs intensity="strong" />
      <div className="relative mx-auto max-w-3xl px-4">
        <Reveal><DashMark className="mx-auto h-16 w-16" /></Reveal>
        <MaskRise className="mt-6">
          <h2 className="font-display text-[2.3rem] font-extrabold leading-[1.02] tracking-[-0.035em] text-foreground sm:text-6xl"><Title text={HOME_HEADINGS.final} highlight={3} /></h2>
        </MaskRise>
        <Reveal delay={0.12}><p className="mt-5 text-lg text-muted-foreground">Set up in a few minutes. Free for 14 days, no card needed.</p></Reveal>
        <Reveal delay={0.2} className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><CTA /><a href="https://app.garage.jmsurf.co.ke/login" className="rounded-full bg-card/70 px-6 py-3.5 font-display font-bold text-foreground ring-1 ring-border backdrop-blur hover:bg-muted">Sign in</a></Reveal>
      </div>
    </section>
  );
}

export function Footer({ phone, email }: { phone: string; email: string }) {
  const { darkMode } = useTheme();
  const cols: [string, [string, string][]][] = [
    ["Product", [["Modules", "/solutions"], ["Pricing", "/pricing"], ["How it works", "/#how"], ["Start free", "/register"], ["Sign in", "https://app.garage.jmsurf.co.ke/login"]]],
    ["Modules", [["Garage Core", "/solutions/garage_core"], ["Workshop Pro", "/solutions/workshop_pro"], ["Parts & Stock", "/solutions/inventory"], ["Body & Paint", "/solutions/body_paint"], ["Car Wash", "/solutions/car_wash"], ["All modules", "/solutions"]]],
    ["Legal", [["Terms of service", "/terms"], ["Privacy policy", "/privacy"], ["System status", "/status"], ["Photo credits", "/photo-credits"]]],
  ];
  return (
    <footer className="border-t border-border bg-card pb-10 pt-14 text-muted-foreground">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <DashLogo tone={darkMode ? "light" : "dark"} tagline="Garage management" />
            <p className="mt-4 max-w-xs text-sm">Garage management software for Kenya, from the roadside fundi to the dealer.</p>
            <div className="mt-4 space-y-1.5 text-sm">
              {phone && <a href={`tel:${phone.replace(/\s/g, "")}`} className="flex items-center gap-2 hover:text-foreground"><Phone className="h-4 w-4" />{phone}</a>}
              {email && <a href={`mailto:${email}`} className="flex items-center gap-2 hover:text-foreground"><Mail className="h-4 w-4" />{email}</a>}
            </div>
          </div>
          {cols.map(([t, links]) => (
            <div key={t}>
              <p className="font-display text-sm font-bold text-foreground">{t}</p>
              <ul className="mt-4 space-y-2.5 text-sm">{links.map(([l, h]) => <li key={l}><a href={h} className="hover:text-foreground">{l}</a></li>)}</ul>
            </div>
          ))}
        </div>
        <nav aria-label="More from JMSURF" className="mt-12 border-t border-border pt-8">
          <p className="font-display text-sm font-bold text-foreground">More from JMSURF</p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {JMSURF_FAMILY.map((f) => <li key={f.url}><a href={f.url} className="hover:text-foreground">{f.name}</a></li>)}
          </ul>
        </nav>
        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-border pt-8 text-center text-xs sm:flex-row sm:text-left">
          <p>© {new Date().getFullYear()} JMSURF Garage. All rights reserved.</p>
          <p className="text-[11px] opacity-80">JMSURF TECHNOLOGIES LTD is registered with the ODPC (Kenya) as a Data Controller and Data Processor, reg. no. 194-9812-26EB.</p>
          <p>Powered by <a href="https://jmsurf.co.ke" className="font-bold tracking-wide text-foreground hover:text-primary">JMSURF TECHNOLOGIES</a></p>
        </div>
      </div>
    </footer>
  );
}

/** Contact details from the website settings (super admin → CMS), with the JMSURF defaults. */
export function useSiteContact() {
  const [c, setC] = useState({ phone: "0712 504 593", email: "info@jmsurf.co.ke", wa: "254712504593" });
  useEffect(() => {
    void supabase.from("cms_content").select("section, content").in("section", ["contact", "whatsapp"]).then(({ data }) => {
      const map: Record<string, any> = {};
      (data || []).forEach((r: any) => { map[r.section] = r.content || {}; });
      setC((x) => ({
        phone: String(map.contact?.phone || x.phone),
        email: String(map.contact?.email || x.email),
        wa: String(map.whatsapp?.number || x.wa).replace(/\D/g, "") || x.wa,
      }));
    });
  }, []);
  return c;
}

export function WhatsAppButton({ wa, text = "Hello, I'd like to know more about JMSURF Garage." }: { wa: string; text?: string }) {
  return (
    <a href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer"
      onClick={() => track("Contact", { method: "whatsapp" })}
      className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25d366] text-white shadow-2xl transition-transform hover:scale-105" aria-label="Chat with us on WhatsApp">
      <MessageCircle className="h-7 w-7" />
    </a>
  );
}

/* ------------------------------------------------------------------ page */

export default function Landing() {
  const contact = useSiteContact();
  useEffect(() => {
    // /features lands on the modules section.
    if (window.location.pathname.replace(/^\//, "") === "features") setTimeout(() => document.getElementById("modules")?.scrollIntoView({ behavior: "smooth" }), 400);
  }, []);

  return (
    <div className="min-h-screen overflow-x-clip bg-background font-body text-foreground">
      <Helmet>
        <html lang="en" />
        <title>{HOME_META.title}</title>
        <meta name="description" content={HOME_META.description} />
        <link rel="canonical" href={canonicalUrl("/")} />
      </Helmet>
      <Nav />
      <main>
        <Hero />
        <Who />
        <Flow />
        <Kenya />
        <Modules />
        <Plans />
        <Security />
        <Faq id="faq" items={HOME.faq} title={<Title text={HOME_HEADINGS.faq} highlight={2} />} />
        <FinalCta />
      </main>
      <Footer phone={contact.phone} email={contact.email} />
      <WhatsAppButton wa={contact.wa} />
    </div>
  );
}
