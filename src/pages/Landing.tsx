import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { motion, useScroll, useTransform, useReducedMotion, useInView, AnimatePresence, animate } from "framer-motion";
import SuiteShowcase from "@/components/landing/SuiteShowcase";
import {
  ArrowRight, Check, X, Menu, Sparkles, Mic, Send, Smartphone, ShieldCheck, Lock, DatabaseBackup, KeyRound, Fingerprint,
  Globe2, Building2, Repeat, Layers, Zap, Receipt, Wallet, Users, FileCheck, BellRing, Workflow, UploadCloud, FileSpreadsheet,
  CheckCircle2, MessageCircle, Phone, Mail, ChevronDown, Landmark, Banknote, CreditCard, WifiOff, Languages, Scale, LayoutDashboard,
  Package, ShoppingBag, Handshake, FolderKanban, UserRoundCog, Factory, BarChart3, FolderOpen, Box, Star, Sun, Moon, PlugZap, Headset,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashLogo, DashMark } from "@/components/brand/DashLogo";
import { Orbs, LedgerBackdrop } from "@/components/brand/Orbs";
import { MODULES, MODULE_CATEGORIES, moduleName, type ModuleDef } from "@/lib/modules";
import { useTheme } from "@/hooks/useTheme";
import { track } from "@/lib/tracking";
import { JMSURF_FAMILY, PUBLIC_PLANS } from "@/lib/siteFacts";
import { HOME_META, canonicalUrl } from "@/seo/meta";
import { cn } from "@/lib/utils";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const SUITES = MODULES.length;
const APPS = MODULES.reduce((a, m) => a + m.apps.length, 0);

/* ------------------------------------------------------------------ bits */

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.6, delay, ease: [0.2, 0.7, 0.2, 1] }}>
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
      <motion.div initial={{ y: "105%" }} animate={{ y: seen ? "0%" : "105%" }} transition={{ duration: 0.9, delay, ease: [0.2, 0.7, 0.2, 1] }}>{children}</motion.div>
    </div>
  );
}

export function Eyebrow({ children, left }: { children: ReactNode; left?: boolean }) {
  return <span className={cn("lx-eyebrow", left && "left")}>{children}</span>;
}

function SectionTitle({ eyebrow, title, text, center = true }: { eyebrow?: string; title: ReactNode; text?: ReactNode; center?: boolean }) {
  return (
    <div className={cn("max-w-3xl", center ? "mx-auto text-center" : "")}>
      {eyebrow && <Reveal><Eyebrow left={!center}>{eyebrow}</Eyebrow></Reveal>}
      <MaskRise className="mt-5">
        <h2 className="font-display text-[2rem] font-extrabold leading-[1.04] tracking-[-0.035em] text-foreground sm:text-[3.4rem]">{title}</h2>
      </MaskRise>
      {text && <Reveal delay={0.15}><p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">{text}</p></Reveal>}
    </div>
  );
}

/** Highlight words: the brand gradient (the website's signature). */
export const Hl = ({ children }: { children: ReactNode }) => <span className="bg-gradient-to-r from-primary via-[hsl(355_80%_52%)] to-[hsl(10_85%_55%)] bg-clip-text pr-1 text-transparent">{children}</span>;

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
  const links = [["/solutions", "Suites"], ["/#worldwide", "Built for the world"], ["/#migrate", "Move in"], ["/#pricing", "Pricing"]];
  return (
    <header className={cn("fixed inset-x-0 top-0 z-50 transition-all", scrolled ? "border-b border-border bg-background/85 shadow-sm backdrop-blur-xl" : "bg-transparent")}>
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 xl:gap-6">
        <Link to="/" aria-label="JMSURF Garage home"><DashLogo tone={darkMode ? "light" : "dark"} /></Link>
        <nav className="hidden flex-1 items-center justify-center gap-0 lg:flex xl:gap-1">
          {links.map(([h, l]) => <a key={h} href={h} className="group relative whitespace-nowrap px-2 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground xl:px-3 xl:tracking-[0.2em] transition-colors hover:text-foreground">{l}<span className="absolute inset-x-3 -bottom-0.5 h-px origin-left scale-x-0 bg-primary transition-transform group-hover:scale-x-100" /></a>)}
        </nav>
        <div className="hidden shrink-0 items-center gap-1 whitespace-nowrap lg:flex xl:gap-2">
          <ThemeToggle />
          <a href="/api/demo/start" className="rounded-full px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted">Live demo</a>
          <Link to="/login" className="rounded-full px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted">Sign in</Link>
          <CTA className="!px-5 !py-2.5 text-sm">Start free</CTA>
        </div>
        <div className="ml-auto flex items-center gap-1 lg:hidden">
          <ThemeToggle />
          <button onClick={() => setOpen(!open)} className="rounded-lg p-2 text-foreground" aria-label="Menu">{open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}</button>
        </div>
      </div>
      {open && (
        <div className="border-t border-border bg-background px-4 pb-5 pt-2 shadow-xl lg:hidden">
          {links.map(([h, l]) => <a key={h} href={h} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-3 font-medium text-foreground hover:bg-muted">{l}</a>)}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link to="/login" className="rounded-full border border-border py-3 text-center font-semibold">Sign in</Link>
            <Link to="/register" className="rounded-full bg-primary py-3 text-center font-semibold text-primary-foreground">Start free</Link>
            <a href="/api/demo/start" className="col-span-2 rounded-full border border-primary/40 py-3 text-center font-semibold text-primary">Try the live demo</a>
          </div>
        </div>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ hero */

/** What happens in a DASH company, one event at a time (the hero's live feed). */
const EVENTS = [
  { icon: Smartphone, tone: "#16a34a", t: "M-Pesa payment received", d: "KES 48,500 · INV-00142 marked paid" },
  { icon: FileCheck, tone: "#2563eb", t: "eTIMS invoice signed", d: "Sent to KRA and the customer" },
  { icon: Users, tone: "#047857", t: "Payroll done for 48 staff", d: "PAYE · NSSF · SHIF · Housing Levy" },
  { icon: Package, tone: "#d97706", t: "Low stock: reorder sent", d: "Purchase order to your supplier" },
  { icon: Sparkles, tone: "#dc2626", t: "Garage AI", d: "3 invoices worth KES 412K are overdue" },
  { icon: Handshake, tone: "#7c3aed", t: "New lead from your website", d: "Added to the CRM pipeline" },
];

function LiveFeed() {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => { if (reduce) return; const t = setInterval(() => setI((x) => (x + 1) % EVENTS.length), 2600); return () => clearInterval(t); }, [reduce]);
  const e = EVENTS[i];
  return (
    <div className="relative h-[68px] w-[280px] sm:w-[300px]">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={i} initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -24, scale: 0.96 }}
          transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
          className="absolute inset-0 flex items-center gap-3 rounded-2xl border border-border bg-card/95 p-3 pr-4 text-left shadow-[0_24px_50px_-24px_rgba(16,18,24,.45)] backdrop-blur">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: e.tone }}><e.icon className="h-5 w-5" /></span>
          <span className="min-w-0"><b className="block truncate text-[13px] text-foreground">{e.t}</b><span className="block truncate text-[11px] text-muted-foreground">{e.d}</span></span>
          <span className="ml-auto h-2 w-2 shrink-0 animate-pulse rounded-full bg-success" />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Every suite circling the one dashboard they share. */
function Orbit() {
  const inner = MODULES.slice(0, 6), outer = MODULES.slice(6);
  const ring = (list: ModuleDef[], r: number, spin: string, rev?: boolean, offset = 0) => (
    <div className={cn("lx-spin absolute inset-0", rev && "rev")} style={{ ["--spin" as any]: spin }}>
      {list.map((m, i) => {
        const a = ((i / list.length) * 360 + offset) * (Math.PI / 180);
        return (
          <div key={m.key} className="absolute" style={{ left: `${50 + r * Math.cos(a)}%`, top: `${50 + r * Math.sin(a)}%`, transform: "translate(-50%,-50%)" }}>
            <Link to={`/solutions/${m.key}`} title={m.name} aria-label={m.name}
              className={cn("lx-spin group flex h-10 w-10 items-center justify-center rounded-2xl border bg-card shadow-lg sm:h-12 sm:w-12", !rev && "rev")} style={{ ["--spin" as any]: spin, borderColor: `${m.color}40`, backgroundImage: `linear-gradient(${m.color}14, ${m.color}14)` }}>
              <m.icon className="h-4 w-4 sm:h-5 sm:w-5" style={{ color: m.color }} />
            </Link>
          </div>
        );
      })}
    </div>
  );
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[340px] sm:max-w-[520px]">
      <div className="absolute inset-[4%] rounded-full border border-dashed border-primary/20" />
      <div className="absolute inset-[24%] rounded-full border border-dashed border-primary/25" />
      <div className="absolute inset-[30%] rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/.18),transparent_70%)] blur-2xl" />
      {ring(outer, 46, "80s", false, 15)}
      {ring(inner, 26, "55s", true)}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
        <span className="absolute h-24 w-24 animate-ping rounded-[28px] bg-primary/10 sm:h-28 sm:w-28" style={{ animationDuration: "2.8s" }} />
        <span className="relative flex h-20 w-20 items-center justify-center rounded-[26px] border border-border bg-card shadow-[0_30px_60px_-20px_hsl(var(--primary)/.55)] sm:h-24 sm:w-24">
          <DashMark className="h-11 w-11 sm:h-14 sm:w-14" />
        </span>
        <span className="relative mt-2 rounded-full bg-foreground px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-background">One login</span>
      </div>
    </div>
  );
}

/** A line of the headline rising out of its own mask, word by word. */
function RiseLine({ text, delay = 0, className }: { text: string; delay?: number; className?: string }) {
  return (
    <span className="block overflow-hidden pb-[0.08em]">
      {text.split(" ").map((w, i) => (
        <motion.span key={i} className={cn("mr-[0.22em] inline-block", className)} initial={{ y: "110%" }} animate={{ y: "0%" }}
          transition={{ duration: 0.8, delay: delay + i * 0.07, ease: [0.2, 0.7, 0.2, 1] }}>{w}</motion.span>
      ))}
    </span>
  );
}

/** A number that counts up when it scrolls into view. */
function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true });
  const [v, setV] = useState(0);
  useEffect(() => { if (!seen) return; const c = animate(0, to, { duration: 1.4, ease: "easeOut", onUpdate: (x) => setV(Math.round(x)) }); return () => c.stop(); }, [seen, to]);
  return <span ref={ref}>{v}{suffix}</span>;
}

function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const reduce = useReducedMotion();
  const orbitY = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["0%", "18%"]);
  const orbitScale = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : [1, 0.86]);
  const textY = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["0%", "-12%"]);
  const fade = useTransform(scrollYProgress, [0.4, 0.9], [1, 0]);
  const stats: [number, string, string][] = [[SUITES, "", "suites"], [APPS, "+", "apps"], [14, "", "days free"], [1, "", "login"]];
  return (
    <section ref={ref} className="relative overflow-hidden bg-background">
      <Orbs />
      <LedgerBackdrop />
      <div className="lx-grain" />
      <motion.div style={{ opacity: fade }} className="relative mx-auto grid min-h-[100svh] max-w-7xl items-center gap-10 px-4 pb-14 pt-28 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:gap-6 lg:pt-24">
        <motion.div style={{ y: textY }} className="text-center lg:text-left">
          <h1 className="font-display text-[2.55rem] font-extrabold leading-[1.02] tracking-[-0.04em] text-foreground min-[400px]:text-[2.9rem] sm:text-7xl xl:text-[5.2rem]">
            <motion.span className="mb-6 block" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <span className="lx-eyebrow">JMSURF Garage · Business software for the world</span>
            </motion.span>
            <RiseLine text="Your whole" delay={0.1} />
            <RiseLine text="business," delay={0.24} />
            <RiseLine text="one dashboard." delay={0.38} className="bg-gradient-to-r from-primary via-[hsl(355_80%_52%)] to-[hsl(10_85%_55%)] bg-clip-text text-transparent" />
          </h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.7 }}
            className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg lg:mx-0">
            Accounting, stock, sales, CRM, HR &amp; payroll, projects, a till and a call centre sharing one login, one customer list
            and one set of books. M-Pesa and KRA eTIMS built in.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.85 }}
            className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <CTA />
            <a href="/api/demo/start" onClick={() => track("Lead", { content_name: "demo" })} className="inline-flex items-center justify-center gap-2 rounded-full bg-card/70 px-6 py-3.5 font-display text-[15px] font-bold text-foreground ring-1 ring-border backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-muted">Try the live demo</a>
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 1 }}
            className="mx-auto mt-10 grid max-w-md grid-cols-4 divide-x divide-border lg:mx-0">
            {stats.map(([n, suf, l]) => (
              <div key={l} className="px-2 text-center first:pl-0 lg:text-left lg:px-4">
                <p className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl"><CountUp to={n} suffix={suf} /></p>
                <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{l}</p>
              </div>
            ))}
          </motion.div>
        </motion.div>
        <motion.div style={{ y: orbitY, scale: orbitScale }} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.3 }} className="relative">
          <Orbit />
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 sm:bottom-2 lg:-left-6 lg:translate-x-0">
            <LiveFeed />
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}

const COUNTRIES: [string, string][] = [
  ["ke", "Kenya"], ["ug", "Uganda"], ["tz", "Tanzania"], ["rw", "Rwanda"], ["bi", "Burundi"], ["ss", "South Sudan"], ["et", "Ethiopia"], ["so", "Somalia"],
  ["cd", "DR Congo"], ["ng", "Nigeria"], ["gh", "Ghana"], ["za", "South Africa"], ["zm", "Zambia"], ["mw", "Malawi"], ["zw", "Zimbabwe"], ["bw", "Botswana"],
  ["na", "Namibia"], ["mz", "Mozambique"], ["cm", "Cameroon"], ["sn", "Senegal"], ["ci", "Côte d'Ivoire"], ["eg", "Egypt"], ["ma", "Morocco"], ["dj", "Djibouti"],
  ["ae", "UAE"], ["sa", "Saudi Arabia"], ["qa", "Qatar"], ["gb", "United Kingdom"], ["us", "United States"], ["ca", "Canada"], ["de", "Germany"], ["in", "India"],
];

/** Rolling strip of countries DASH serves. */
function Countries() {
  const half = Math.ceil(COUNTRIES.length / 2);
  const rows = [COUNTRIES.slice(0, half), COUNTRIES.slice(half)];
  return (
    <section aria-label="Countries" className="relative overflow-hidden bg-background py-14 sm:py-20">
      <Reveal className="mx-auto max-w-3xl px-4 text-center">
        <Eyebrow>Built in Nairobi, serving the world</Eyebrow>
        <h2 className="mt-4 font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-4xl">Ready for business <Hl>wherever you trade.</Hl></h2>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">Local currencies, local tax and mobile money wherever you trade, with billing in shillings or USD.</p>
      </Reveal>
      <div className="mt-10 space-y-3">
        {rows.map((row, r) => (
          <div key={r} className="lx-fade-x overflow-hidden">
            <div className={cn("lx-marquee flex w-max gap-3", r === 1 && "rev")} style={{ ["--dur" as any]: r ? "70s" : "60s" }}>
              {[...row, ...row].map(([code, name], i) => (
                <span key={i} aria-hidden={i >= row.length} className="inline-flex shrink-0 items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm">
                  <img src={`https://flagcdn.com/${code}.svg`} alt="" width={24} height={16} loading="lazy" className="h-4 w-6 rounded-[3px] object-cover ring-1 ring-black/5" />
                  {name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** A big statement whose words sharpen one by one as it scrolls into view. */
function Statement() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 45%"] });
  const words = "Most businesses run on a dozen tools that never talk to each other. JMSURF Garage puts your money, stock, sales, people and customers in one place: one login, one ledger, one truth.".split(" ");
  const accent = new Set(["one", "place:", "login,", "ledger,", "truth."]);
  return (
    <section className="relative overflow-hidden bg-background py-24 sm:py-36">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Eyebrow left>The idea</Eyebrow>
        <div ref={ref} className="mt-8 flex flex-wrap font-display text-[1.9rem] font-bold leading-[1.15] tracking-tight sm:text-5xl lg:text-[3.6rem]">
          {words.map((w, i) => <Word key={i} progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]} accent={i > 14 && accent.has(w)}>{w}</Word>)}
        </div>
      </div>
    </section>
  );
}
function Word({ children, progress, range, accent }: { children: string; progress: any; range: [number, number]; accent?: boolean }) {
  const opacity = useTransform(progress, range, [0.14, 1]);
  const blur = useTransform(progress, range, ["blur(6px)", "blur(0px)"]);
  return <motion.span style={{ opacity, filter: blur }} className={cn("mr-[0.28em]", accent ? "font-accent font-normal text-primary" : "text-foreground")}>{children}</motion.span>;
}

/* ------------------------------------------------------------------ sections */

/* ---------- bento: why it's different ---------- */

/** A highlight that walks down the suites, like moving through the sidebar. */
function SidebarTile() {
  const list = MODULES.slice(0, 8);
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % list.length), 1400); return () => clearInterval(t); }, [list.length]);
  return (
    <div className="relative mt-6 grid flex-1 grid-cols-[140px_1fr] gap-3 overflow-hidden rounded-2xl border border-border bg-background/70 p-3 sm:grid-cols-[180px_1fr]">
      <div className="relative space-y-1">
        <motion.span layout className="absolute inset-x-0 h-8 rounded-lg bg-primary" style={{ top: i * 36 }} transition={{ type: "spring", stiffness: 260, damping: 28 }} />
        {list.map((m, j) => (
          <div key={m.key} className={cn("relative flex h-8 items-center gap-2 rounded-lg px-2 text-[12px] font-semibold transition-colors duration-300", j === i ? "text-primary-foreground" : "text-muted-foreground")}>
            <m.icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate capitalize">{m.name.replace(/^(JMSURF|DASH) /, "").toLowerCase()}</span>
          </div>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={i} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.35 }} className="min-w-0 rounded-xl border border-border bg-card p-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: list[i].color }}>{list[i].category}</p>
          <p className="mt-1 font-display text-lg font-extrabold text-foreground">{list[i].name.replace(/^(JMSURF|DASH) /, "")}</p>
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{list[i].tagline}</p>
          <div className="mt-3 space-y-1.5">
            {list[i].apps.slice(0, 4).map((a) => (
              <div key={a.key} className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-2 py-1.5">
                <a.icon className="h-3.5 w-3.5 shrink-0" style={{ color: list[i].color }} />
                <span className="truncate text-[11px] font-semibold text-foreground">{a.name}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function AddressTile() {
  const hosts = ["yourcompany.garage.jmsurf.co.ke", "yourcompany.co.ke", "shop.yourcompany.com"];
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % hosts.length), 2200); return () => clearInterval(t); }, [hosts.length]);
  return (
    <div className="mt-6 flex items-center gap-2 overflow-hidden rounded-full border border-border bg-background/80 px-4 py-3 text-sm">
      <Lock className="h-4 w-4 shrink-0 text-success" />
      <AnimatePresence mode="wait">
        <motion.span key={i} initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }} transition={{ duration: 0.3 }} className="truncate font-semibold text-foreground">{hosts[i]}</motion.span>
      </AnimatePresence>
    </div>
  );
}

function CompaniesTile() {
  const cos = [["SH", "Savannah Hardware", "#e11d48"], ["NB", "Nile Bistro", "#2563eb"], ["KF", "Kilimo Farms", "#16a34a"]];
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % cos.length), 1900); return () => clearInterval(t); }, [cos.length]);
  return (
    <div className="mt-6 space-y-2">
      {cos.map(([ab, n, c], j) => (
        <div key={n} className={cn("flex items-center gap-3 rounded-xl border px-3 py-2 transition-all duration-500", j === i ? "border-primary/50 bg-primary/5 shadow-sm" : "border-border bg-background/60 opacity-60")}>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-bold text-white" style={{ background: c }}>{ab}</span>
          <span className="text-sm font-semibold text-foreground">{n}</span>
          {j === i && <Check className="ml-auto h-4 w-4 text-primary" />}
        </div>
      ))}
    </div>
  );
}

/** One customer in the middle, every suite connected to it. */
function SharedDataTile() {
  const spokes = [["Till", ShoppingBag, 10, 18], ["CRM", Handshake, 82, 14], ["Call centre", Headset, 6, 78], ["Books", Receipt, 84, 80]] as const;
  return (
    <div className="relative mt-6 h-48 overflow-hidden rounded-2xl border border-border bg-background/70">
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden>
        {spokes.map(([l, , x, y]) => <line key={l} x1="50" y1="50" x2={x + 6} y2={y + 4} stroke="hsl(var(--primary))" strokeWidth="0.6" strokeDasharray="2 2" className="lx-dash" />)}
      </svg>
      {spokes.map(([l, Icon, x, y], k) => (
        <motion.span key={l} initial={{ opacity: 0, scale: 0.6 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.15 * k }}
          className="absolute flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground shadow-sm" style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-15%,-30%)" }}>
          <Icon className="h-3.5 w-3.5 text-primary" />{l}
        </motion.span>
      ))}
      <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-2xl bg-foreground px-3.5 py-2 text-xs font-bold text-background shadow-xl">
        <Users className="h-4 w-4" /> Hotel client
      </span>
    </div>
  );
}

function OneLogin() {
  const tile = "group relative overflow-hidden rounded-[28px] border border-border bg-card p-6 shadow-sm transition-shadow duration-500 hover:shadow-xl sm:p-7";
  const T = ({ icon: Icon, t, d }: { icon: any; t: string; d: string }) => (
    <>
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[hsl(355_80%_52%)] to-primary text-white shadow-lg shadow-primary/25 transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110"><Icon className="h-5 w-5" /></span>
      <h3 className="mt-5 font-display text-xl font-bold tracking-tight text-foreground">{t}</h3>
      <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{d}</p>
    </>
  );
  return (
    <section className="relative overflow-hidden bg-background py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle eyebrow="Why it's different" title={<>Not a bundle of apps. <Hl>One system.</Hl></>}
          text="Most business suites give you a different link, login and screen for every product. JMSURF Garage opens everything from one place: same sidebar, same search, same customer, same numbers." />
        <div className="mt-14 grid gap-5 lg:grid-cols-6">
          <Reveal className={cn(tile, "flex flex-col lg:col-span-4 lg:row-span-2")}>
            <T icon={LayoutDashboard} t="Every suite, one login" d="Accounting, stock, CRM, HR, projects, the till and the call centre sit in one sidebar. No second password, no switching apps." />
            <SidebarTile />
          </Reveal>
          <Reveal delay={0.08} className={cn(tile, "lg:col-span-2")}>
            <T icon={Globe2} t="Your own address" d="yourcompany.garage.jmsurf.co.ke on day one, your own domain whenever you like." />
            <AddressTile />
          </Reveal>
          <Reveal delay={0.16} className={cn(tile, "lg:col-span-2")}>
            <T icon={Building2} t="Every company, one login" d="Run several companies and switch in one click. Accountants manage every client the same way." />
            <CompaniesTile />
          </Reveal>
          <Reveal className={cn(tile, "lg:col-span-3")}>
            <T icon={Layers} t="Every suite shares the same data" d="A sale at the till, a deal in CRM, a call and a timesheet all land on the same customer and in the same books." />
            <SharedDataTile />
          </Reveal>
          <Reveal delay={0.08} className={cn(tile, "lg:col-span-3")}>
            <T icon={Smartphone} t="Made for the phone in your pocket" d="Installs like an app on any phone, fast on 3G, and the till keeps selling when the internet drops." />
            <div className="mt-6 grid grid-cols-3 gap-3">
              {[["3G", "fast"], ["Offline", "till"], ["1 tap", "install"]].map(([a, b]) => (
                <div key={a} className="rounded-2xl border border-border bg-background/70 p-3 text-center">
                  <p className="font-display text-xl font-extrabold text-foreground">{a}</p>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{b}</p>
                </div>
              ))}
            </div>
            <ul className="mt-5 grid gap-2 text-sm text-foreground/80 sm:grid-cols-2">
              {["Android and iPhone", "Tablets at the counter", "Any laptop or desktop", "Receipt printers and scanners"].map((x) => <li key={x} className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-primary" />{x}</li>)}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Suites() {
  return (
    <section id="suites" className="relative scroll-mt-0 bg-muted/30 pt-24 sm:pt-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle eyebrow={`${SUITES} suites · ${APPS} apps`} title={<>Every app a business needs. <Hl>Switch on what you use.</Hl></>}
          text="JMSURF BOOKS is your base. Add suites from inside your workspace whenever you need them, each free for 14 days." />
      </div>
      <div className="mt-10"><SuiteShowcase /></div>
      <div className="mx-auto max-w-7xl px-4 pb-24 pt-14 sm:px-6">
        <Reveal className="flex flex-wrap justify-center gap-2">
          {MODULES.map((m) => (
            <Link key={m.key} to={`/solutions/${m.key}`} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-all hover:-translate-y-0.5 hover:shadow-md">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg text-white" style={{ background: m.color }}><m.icon className="h-3.5 w-3.5" /></span>{m.name.replace(/^(JMSURF|DASH) /, "")}
            </Link>
          ))}
        </Reveal>
        <div className="mt-8 flex justify-center"><Link to="/solutions" className="inline-flex items-center gap-2 font-display font-bold text-primary hover:underline">See every suite <ArrowRight className="h-4 w-4" /></Link></div>
      </div>
    </section>
  );
}

/* ---------- Africa: pinned heading, numbered points scrolling past ---------- */

function Africa() {
  const pay = [
    ["M-Pesa STK, Till & Paybill", Smartphone], ["Airtel Money", Smartphone], ["MTN MoMo", Smartphone], ["EVC Plus · Zaad · Sahal", Smartphone],
    ["Bank transfer & EFT", Landmark], ["Visa & Mastercard", CreditCard], ["Flutterwave", Banknote], ["Paystack", Banknote], ["Pesapal", Banknote],
    ["Kopo Kopo", Banknote], ["IntaSend", Banknote], ["Chapa", Banknote], ["Stripe", CreditCard], ["PayPal", CreditCard],
  ] as const;
  const local = [
    { icon: Scale, t: "Tax & compliance", d: "VAT and withholding tax, KRA eTIMS e-invoicing, PAYE, NSSF, SHIF, Housing Levy and NITA. Tax rules per country." },
    { icon: Globe2, t: "Every currency", d: "Bill in KES, UGX, TZS, NGN, ZAR, USD, EUR, GBP, AED, INR and every other currency, with the exchange rate on each document." },
    { icon: MessageCircle, t: "SMS & WhatsApp", d: "Invoices, statements, payslips and reminders by SMS and WhatsApp, because that is where your customers are." },
    { icon: WifiOff, t: "Works on low data", d: "Fast on 3G, installs like an app on any phone, and the point of sale keeps selling when the internet drops." },
    { icon: Languages, t: "Local support", d: "Real people in Nairobi on phone and WhatsApp who understand mobile money, local tax and how growing businesses run." },
    { icon: Banknote, t: "Pay your way", d: "Pay your subscription by M-Pesa in Kenya, or in USD from anywhere else. No pricing surprises." },
  ];
  return (
    <section id="worldwide" className="relative scroll-mt-20 bg-muted/40 py-24 sm:py-32">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionTitle center={false} eyebrow="Built for the world" title={<>Built in Nairobi. <Hl>Ready for the world.</Hl></>}
            text="Wherever you trade, JMSURF Garage works the way you do: local payments, local tax, every currency and real people on support." />
          <Reveal delay={0.1} className="mt-8 hidden lg:block"><CTA ghost>Start free for 14 days</CTA></Reveal>
        </div>
        <ol className="relative">
          {local.map((c, i) => (
            <Reveal key={c.t} className="group relative border-t border-border py-8 first:border-t-0 first:pt-0 sm:py-10">
              <motion.span aria-hidden initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.9, ease: [0.2, 0.7, 0.2, 1] }}
                className="absolute inset-x-0 top-0 h-px origin-left bg-primary group-first:hidden" />
              <div className="flex items-start gap-5 sm:gap-8">
                <span className="font-display text-4xl font-extrabold tabular-nums text-foreground/10 transition-colors duration-500 group-hover:text-primary sm:text-6xl">{String(i + 1).padStart(2, "0")}</span>
                <div className="pt-1 sm:pt-2">
                  <h3 className="flex items-center gap-2.5 font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl"><c.icon className="h-5 w-5 text-primary" />{c.t}</h3>
                  <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-muted-foreground sm:text-base">{c.d}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
      {/* Payment methods roll past. */}
      <div className="lx-fade-x mt-16 overflow-hidden">
        <div className="lx-marquee flex w-max gap-2.5" style={{ ["--dur" as any]: "45s" }}>
          {[...pay, ...pay].map(([t, Icon], i) => <span key={i} aria-hidden={i >= pay.length} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground"><Icon className="h-4 w-4 text-primary" />{t}</span>)}
        </div>
      </div>
    </section>
  );
}

/* ---------- Workflows: cards slide sideways as you scroll ---------- */

function Workflows() {
  const w = [
    { icon: Workflow, t: "Approvals", d: "Purchases, expenses, discounts and leave go to the right manager, approved from a phone." },
    { icon: Repeat, t: "Recurring everything", d: "Invoices, bills, expenses, subscriptions and journals that create themselves on schedule." },
    { icon: BellRing, t: "Smart reminders", d: "Overdue invoices, low stock, expiring contracts and certificates trigger SMS, email and in-app alerts." },
    { icon: Wallet, t: "Payroll in minutes", d: "Attendance and leave flow into payroll; payslips go out by email and SMS; bank and M-Pesa files ready." },
    { icon: Zap, t: "Automations", d: "When a deal is won, create the project, the invoice and the welcome SMS without lifting a finger." },
    { icon: FileSpreadsheet, t: "Reports & dashboards", d: "Profit and loss, balance sheet, cash flow, ageing, stock, sales, HR and project reports, to Excel or PDF." },
  ];
  const ref = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [dist, setDist] = useState(0);
  useEffect(() => {
    const measure = () => { const t = trackRef.current; if (t) setDist(Math.max(0, t.scrollWidth - window.innerWidth + 48)); };
    measure(); window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const x = useTransform(scrollYProgress, [0, 1], [0, -dist]);
  const bar = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);
  const Card = ({ c, i }: { c: (typeof w)[number]; i: number }) => (
    <div className="group relative flex h-[300px] w-[78vw] max-w-[420px] shrink-0 snap-start flex-col overflow-hidden rounded-[28px] border border-border bg-card p-7 shadow-sm transition-shadow hover:shadow-xl sm:h-[340px] lg:w-[420px]">
      <span aria-hidden className="absolute -right-4 -top-6 font-display text-[9rem] font-extrabold leading-none text-foreground/[0.04] transition-colors duration-500 group-hover:text-primary/10">{String(i + 1).padStart(2, "0")}</span>
      <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-background transition-colors duration-500 group-hover:bg-primary group-hover:text-primary-foreground"><c.icon className="h-6 w-6" /></span>
      <h3 className="relative mt-auto font-display text-2xl font-bold tracking-tight text-foreground">{c.t}</h3>
      <p className="relative mt-2 text-[15px] leading-relaxed text-muted-foreground">{c.d}</p>
    </div>
  );
  const head = (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      <SectionTitle center={false} eyebrow="Workflows" title={<>The busywork <Hl>runs itself.</Hl></>} text="Every workflow a growing business needs, connected across every suite." />
    </div>
  );
  return (
    <section className="bg-background">
      {/* Phones and reduced motion: swipe sideways. */}
      <div className={cn("py-24", !reduce && "lg:hidden")}>
        {head}
        <div className="mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden">
          {w.map((c, i) => <Card key={c.t} c={c} i={i} />)}
        </div>
      </div>
      {/* Large screens: the section pins and the cards travel left as you scroll down. */}
      {!reduce && (
        <div ref={ref} className="relative hidden lg:block" style={{ height: "260vh" }}>
          <div className="sticky top-0 flex h-[100svh] flex-col justify-center overflow-hidden">
            {head}
            <motion.div ref={trackRef} style={{ x }} className="mt-12 flex gap-6 pl-[max(1.5rem,calc((100vw-80rem)/2+1.5rem))]">
              {w.map((c, i) => <Card key={c.t} c={c} i={i} />)}
            </motion.div>
            <div className="mx-auto mt-10 h-1 w-full max-w-7xl px-6"><div className="h-full overflow-hidden rounded-full bg-muted"><motion.div className="h-full rounded-full bg-primary" style={{ width: bar }} /></div></div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------- Move in: a timeline that fills as you scroll ---------- */

function Migrate() {
  const steps = [
    { icon: PlugZap, t: "Connect or export", d: "Connect your previous cloud accounting system by API in a few clicks, or upload its standard export files." },
    { icon: UploadCloud, t: "Everything comes across", d: "Contacts, items, accounts, documents and payments are mapped automatically, in the right order, with no retyping." },
    { icon: CheckCircle2, t: "Check and go live", d: "Trial balance, receivables and stock match before you switch over. Our team helps you all the way." },
  ];
  const what = ["Customers and vendors", "Items and stock", "Chart of accounts", "Quotes and sales orders", "Invoices and credit notes", "Payments received", "Bills and expenses", "Payments made", "Manual journals", "CRM leads and employees"];
  const ref = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 55%"] });
  const fill = useTransform(scrollYProgress, [0, 1], [0, 1]);
  return (
    <section id="migrate" className="scroll-mt-20 bg-muted/40 py-24 sm:py-32">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionTitle center={false} eyebrow="Move in" title={<>Switching systems? <Hl>Bring your history.</Hl></>}
            text="Built for companies moving from other accounting and business software, or from spreadsheets. Your history, balances and documents come across, so nothing is lost." />
          <Reveal delay={0.1} className="mt-8 rounded-[28px] border border-border bg-card p-6">
            <p className="font-display text-base font-bold text-foreground">What moves across</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {what.map((x) => <span key={x} className="flex items-center gap-2 text-sm text-foreground/80"><Check className="h-4 w-4 shrink-0 text-primary" />{x}</span>)}
            </div>
          </Reveal>
        </div>
        <ol ref={ref} className="relative space-y-10 pl-14 sm:space-y-14 sm:pl-20">
          <span aria-hidden className="absolute bottom-6 left-[22px] top-6 w-0.5 rounded-full bg-border sm:left-[30px]" />
          <motion.span aria-hidden className="absolute bottom-6 left-[22px] top-6 w-0.5 origin-top rounded-full bg-primary sm:left-[30px]" style={{ scaleY: fill }} />
          {steps.map((s, i) => (
            <Reveal key={s.t} delay={i * 0.05} className="relative">
              <span className="absolute -left-14 top-0 flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-sm sm:-left-20 sm:h-[60px] sm:w-[60px]"><s.icon className="h-5 w-5 sm:h-6 sm:w-6" /></span>
              <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-primary">Step {i + 1}</p>
              <h3 className="mt-2 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{s.t}</h3>
              <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted-foreground sm:text-base">{s.d}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

interface Plan { id: string; name: string; price_monthly: number; price_annually: number | null; max_users: number; description: string | null; all_modules: boolean; included_modules: string[]; sort: number }

function Pricing() {
  const [yearly, setYearly] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  useEffect(() => {
    void (supabase as any).from("plans").select("id, name, price_monthly, price_annually, max_users, description, all_modules, included_modules, sort").eq("is_active", true).order("sort")
      .then(({ data }: any) => setPlans((data || []) as Plan[]));
  }, []);
  const fallback: Plan[] = PUBLIC_PLANS;
  const list = plans.length ? plans : fallback;
  return (
    <section id="pricing" className="relative scroll-mt-20 overflow-hidden bg-muted/40 py-24">
      <Orbs intensity="subtle" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle eyebrow="Pricing" title={<>Simple plans. <Hl>No surprises.</Hl></>}
          text="Start with JMSURF BOOKS and add suites from inside your workspace as you grow, or take everything with All-in-One. Every plan starts with 14 days free." />
        <div className="mt-8 flex justify-center">
          <div className="inline-flex rounded-full bg-card p-1 ring-1 ring-border">
            {[["Monthly", false], ["Yearly · 2 months free", true]].map(([l, v]) => (
              <button key={String(l)} onClick={() => setYearly(v as boolean)} className={cn("rounded-full px-5 py-2 text-sm font-semibold", yearly === v ? "bg-foreground text-background shadow" : "text-muted-foreground")}>{l as string}</button>
            ))}
          </div>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {list.map((p) => {
            const best = p.all_modules;
            const price = yearly ? Number(p.price_annually || p.price_monthly * 10) : Number(p.price_monthly);
            return (
              <Reveal key={p.id} className={cn("relative flex flex-col rounded-3xl bg-card p-7", best ? "shadow-2xl shadow-primary/20 ring-2 ring-primary" : "border border-border")}>
                {best && <span className="absolute -top-3 left-7 rounded-full bg-gradient-to-r from-[hsl(355_80%_52%)] to-primary px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">Best value</span>}
                <p className="font-display text-lg font-bold text-foreground">{p.name}</p>
                <p className="mt-1 min-h-[40px] text-sm text-muted-foreground">{p.description}</p>
                <p className="mt-5"><span className="font-display text-4xl font-extrabold text-foreground">{kes(price)}</span><span className="text-sm text-muted-foreground"> / {yearly ? "year" : "month"}</span></p>
                <p className="mt-1 text-xs text-muted-foreground">Up to {p.max_users} users · per company</p>
                <ul className="mt-6 flex-1 space-y-2.5 text-sm text-foreground/85">
                  <li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-primary" />JMSURF BOOKS (accounting, sales, purchases, banking)</li>
                  {p.all_modules ? <li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-primary" />All {SUITES} suites, including Garage AI and the Call Centre</li>
                    : (p.included_modules || []).map((k) => <li key={k} className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-primary" />{moduleName(k)}</li>)}
                  <li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-primary" />Customer portal, documents, approvals</li>
                  <li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-primary" />Your own address and custom domain</li>
                </ul>
                <Link to="/register" onClick={() => track("Lead", { content_name: `plan_${p.name}` })}
                  className={cn("mt-7 inline-flex items-center justify-center gap-2 rounded-full py-3 font-display font-bold", best ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-foreground text-background hover:bg-foreground/90")}>
                  Start free <ArrowRight className="h-4 w-4" />
                </Link>
              </Reveal>
            );
          })}
        </div>
        <p className="mt-8 text-center text-sm text-muted-foreground">More suites can be added any time from System → Modules in your workspace. Prices exclude VAT. Outside Kenya? The same plans are billed in US dollars by card.</p>
      </div>
    </section>
  );
}

function Security() {
  const s = [
    { icon: Lock, t: "Encrypted everywhere", d: "TLS on every connection; secrets encrypted at rest." },
    { icon: Fingerprint, t: "Two-step sign-in", d: "Authenticator-app MFA for staff and customers." },
    { icon: KeyRound, t: "Roles & permissions", d: "Every person sees only what their role allows." },
    { icon: Building2, t: "Company isolation", d: "Database-level separation: one company can never see another's data." },
    { icon: DatabaseBackup, t: "Backups & standby", d: "Automatic backups and a live standby server in another country." },
    { icon: ShieldCheck, t: "Full audit trail", d: "Every change recorded: who, what and when." },
  ];
  return (
    <section className="bg-background px-3 py-10 sm:px-6 sm:py-16">
      <div className="relative mx-auto max-w-[90rem] overflow-hidden rounded-[36px] bg-[#0d0f14] px-5 py-20 text-white sm:rounded-[48px] sm:px-10 sm:py-28">
        <div aria-hidden className="absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-primary/30 blur-[120px]" />
        <div aria-hidden className="absolute -bottom-48 -left-40 h-[30rem] w-[30rem] rounded-full bg-[hsl(355_80%_52%/.18)] blur-[120px]" />
        <div className="lx-grain" />
        <div className="relative mx-auto grid max-w-7xl gap-14 lg:grid-cols-[1fr_1.4fr] lg:items-center">
          <div>
            <Reveal><span className="lx-eyebrow left !text-[hsl(0_90%_72%)]">Security</span></Reveal>
            <MaskRise className="mt-5">
              <h2 className="font-display text-[2.2rem] font-extrabold leading-[1.03] tracking-[-0.03em] sm:text-6xl">
                Bank-grade protection, <span className="text-[hsl(0_90%_72%)]">by default.</span>
              </h2>
            </MaskRise>
            <Reveal delay={0.15}><p className="mt-5 max-w-md text-base leading-relaxed text-white/60 sm:text-lg">Your books, your staff and your customers' details are guarded the way a bank guards accounts, on every plan.</p></Reveal>
            <Reveal delay={0.25} className="relative mt-10 hidden h-40 w-40 lg:block">
              <span className="absolute inset-0 animate-ping rounded-full border border-primary/40" style={{ animationDuration: "3s" }} />
              <span className="absolute inset-4 rounded-full border border-white/10" />
              <span className="absolute inset-0 flex items-center justify-center"><ShieldCheck className="h-16 w-16 text-[hsl(0_90%_72%)]" /></span>
            </Reveal>
          </div>
          <div className="grid gap-px overflow-hidden rounded-[28px] bg-white/10 sm:grid-cols-2">
            {s.map((c, i) => (
              <Reveal key={c.t} delay={i * 0.06} className="group bg-[#0d0f14] p-6 transition-colors duration-500 hover:bg-white/[0.04] sm:p-8">
                <c.icon className="h-7 w-7 text-[hsl(0_90%_72%)] transition-transform duration-500 group-hover:scale-110" />
                <h3 className="mt-5 font-display text-lg font-bold">{c.t}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-white/55">{c.d}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export const FAQS: [string, string][] = [
  ["What is JMSURF Garage?", "JMSURF Garage is an all-in-one, cloud business management system (ERP) for businesses everywhere. It brings accounting, invoicing, inventory, sales, purchases, CRM, HR and payroll, projects, manufacturing, marketing, point of sale, e-commerce, a call centre and more into one login and one set of books."],
  ["How is it different from other business suites?", "Every app opens from one dashboard with one sidebar, one customer list and one ledger, and you can run several companies from the same login. M-Pesa, KRA eTIMS, Kenyan payroll, SMS and WhatsApp are built in, prices are in shillings, and support is local."],
  ["Can I move from my current accounting system?", "Yes. Connect your previous cloud accounting system by API, or upload its export files (contacts, items, chart of accounts, invoices, bills, payments, credit notes, journals and more). Our team helps you check balances before you go live."],
  ["How do suites work?", "JMSURF BOOKS is included in every plan. Other suites are switched on from System → Modules inside your workspace, each free for 14 days and then added to your monthly bill. The All-in-One plan includes every suite."],
  ["Can I manage more than one company?", "Yes. Add companies from the company menu and switch between them in one click. Each has its own address, books, users and settings. Accountants can manage every client the same way."],
  ["Can I use my own domain?", "Yes. Every company gets yourcompany.garage.jmsurf.co.ke and can connect its own domain for the staff workspace, website and customer portal."],
  ["Does it work for my type of business?", "Retail and wholesale, services, manufacturing, construction, hospitality, healthcare, schools, NGOs, logistics, agriculture and more. Switch on the suites your industry needs."],
  ["How do customers pay me?", "By M-Pesa (STK push, Till or Paybill), Airtel Money, card or bank. Invoices carry a payment link, and payments mark invoices paid automatically."],
  ["Is my data safe?", "Yes. Data is encrypted in transit, companies are isolated at database level, sign-in supports two-step verification, and backups run automatically with a live standby server."],
  ["Is there a free trial?", "Yes: 14 days free with no card needed. Your company is ready in about a minute."],
];

export function FinalCta() {
  const words = ["Accounting", "Stock", "Sales", "Payroll", "CRM", "Projects", "Till", "Call centre"];
  return (
    <section className="relative overflow-hidden bg-background py-24 text-center sm:py-32">
      <Orbs intensity="strong" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 space-y-2 opacity-[0.07]">
        {[0, 1].map((r) => (
          <div key={r} className={cn("lx-marquee flex w-max gap-10 whitespace-nowrap font-display text-[5rem] font-extrabold leading-none tracking-tight text-foreground sm:text-[9rem]", r === 1 && "rev")} style={{ ["--dur" as any]: r ? "70s" : "55s" }}>
            {[...words, ...words].map((w, i) => <span key={i}>{w} ·</span>)}
          </div>
        ))}
      </div>
      <div className="relative mx-auto max-w-3xl px-4">
        <Reveal><DashMark className="mx-auto h-16 w-16" /></Reveal>
        <MaskRise className="mt-6">
          <h2 className="font-display text-[2.4rem] font-extrabold leading-[1.02] tracking-[-0.035em] text-foreground sm:text-7xl">Run it all from <Hl>one dashboard.</Hl></h2>
        </MaskRise>
        <Reveal delay={0.15}><p className="mt-5 text-lg text-muted-foreground">Join the businesses moving to JMSURF Garage. Free for 14 days, set up in a minute.</p></Reveal>
        <Reveal delay={0.25} className="mt-9 flex flex-col justify-center gap-3 sm:flex-row"><CTA /><Link to="/login" className="rounded-full bg-card/70 px-6 py-3.5 font-display font-bold text-foreground ring-1 ring-border backdrop-blur hover:bg-muted">Sign in</Link></Reveal>
      </div>
    </section>
  );
}

export function Footer({ phone, email }: { phone: string; email: string }) {
  const { darkMode } = useTheme();
  const cols: [string, [string, string][]][] = [
    ["Product", [["Suites", "/solutions"], ["Pricing", "/#pricing"], ["Garage AI", "/solutions/ai"], ["Move in", "/#migrate"], ["Start free", "/register"]]],
    ["Suites", [["JMSURF BOOKS", "/solutions/books"], ["JMSURF CRM", "/solutions/crm"], ["JMSURF COMMERCE", "/solutions/commerce"], ["JMSURF HRM", "/solutions/hrm"], ["JMSURF CALL CENTRE", "/solutions/callcentre"], ["All suites", "/solutions"]]],
    ["Legal", [["Terms of service", "/terms"], ["Privacy policy", "/privacy"], ["System status", "/status"]]],
  ];
  return (
    <footer className="border-t border-border bg-card pb-10 pt-16 text-muted-foreground">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <DashLogo tone={darkMode ? "light" : "dark"} tagline="All-in-one business management" />
            <p className="mt-4 max-w-xs text-sm">The all-in-one business management system for businesses around the world.</p>
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
        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-border pt-8 text-xs sm:flex-row">
          <p>© {new Date().getFullYear()} JMSURF Garage. All rights reserved.</p>
          <p className="text-[11px] opacity-80">JMSURF TECHNOLOGIES LTD is registered with the ODPC (Kenya) as a Data Controller and Data Processor, reg. no. 194-9812-26EB.</p>
          <p>Powered by <a href="https://jmsurf.co.ke" className="font-bold tracking-wide text-foreground hover:text-primary">JMSURF TECHNOLOGIES</a></p>
          <p className="flex items-center gap-1.5"><Star className="h-3.5 w-3.5 text-primary" /> Made in Kenya for the world</p>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ page */

export default function Landing() {
  const [cms, setCms] = useState<Record<string, any>>({});
  useEffect(() => {
    void supabase.from("cms_content").select("*").then(({ data }) => {
      const map: Record<string, any> = {};
      (data || []).forEach((r: any) => { map[r.section] = r.content; });
      setCms(map);
    });
    // /pricing, /features, /apps land on their section.
    const path = window.location.pathname.replace(/^\//, "");
    if (["pricing", "features", "apps", "suites"].includes(path)) setTimeout(() => document.getElementById(path === "pricing" ? "pricing" : "suites")?.scrollIntoView({ behavior: "smooth" }), 400);
  }, []);
  const contact = cms.contact || {};
  const phone = String(contact.phone || "0712 504 593");
  const email = String(contact.email || "info@jmsurf.co.ke");
  const wa = String((cms.whatsapp || {}).number || "254712504593").replace(/\D/g, "");

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
        <Countries />
        <Statement />
        <Suites />
        <OneLogin />
        <Africa />
        <Workflows />
        <Migrate />
        <Pricing />
        <Security />
        <FinalCta />
      </main>
      <Footer phone={phone} email={email} />
      <a href={`https://wa.me/${wa}?text=${encodeURIComponent("Hello, I'd like to know more about JMSURF Garage.")}`} target="_blank" rel="noopener noreferrer"
        onClick={() => track("Contact", { method: "whatsapp" })}
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25d366] text-white shadow-2xl transition-transform hover:scale-105" aria-label="Chat with us on WhatsApp">
        <MessageCircle className="h-7 w-7" />
      </a>
    </div>
  );
}
