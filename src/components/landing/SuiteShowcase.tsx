/**
 * The suites, one stage: the section pins to the screen and each suite's panel
 * slides up over the one before (the previous one sinks back), text and picture
 * swapping sides each time. Every suite costs about half a screen of scrolling,
 * so sixteen suites do not make the page long. With reduced motion the panels
 * simply follow one another.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useScroll, useTransform, useMotionValueEvent, useReducedMotion, type MotionValue } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { MODULES, type ModuleDef } from "@/lib/modules";
import SuiteVisual from "./SuiteVisual";
import { track } from "@/lib/tracking";
import { cn } from "@/lib/utils";

const NUM = (i: number) => String(i + 1).padStart(2, "0");
const STEP_VH = 58;

/** Shrinks its content to fit the space left in the panel, so nothing is ever cut off; hides it when there is no room. */
function Fit({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const measure = () => { const h = i.offsetHeight, w = i.offsetWidth, H = o.clientHeight, W = o.clientWidth; setK(h && H ? Math.min(1, H / h, W / Math.max(1, w)) : 1); };
    const ro = new ResizeObserver(measure);
    ro.observe(o); ro.observe(i); measure();
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="relative h-full min-h-0 w-full overflow-hidden">
      <div ref={inner} className="mx-auto w-full" style={{ transform: `scale(${k})`, transformOrigin: "top center", visibility: k < 0.38 ? "hidden" : "visible" }}>{children}</div>
    </div>
  );
}

function PanelBody({ m, i, n }: { m: ModuleDef; i: number; n: number }) {
  const flip = i % 2 === 1;
  const short = m.name.replace(/^(JMSURF|DASH) /, "");
  return (
    <div className="relative h-full overflow-hidden rounded-[28px] border border-white/60 shadow-[0_30px_80px_-30px_rgba(16,18,24,.5)] dark:border-white/10 sm:rounded-[36px]"
      style={{ background: `radial-gradient(900px 500px at ${flip ? "10%" : "90%"} 0%, ${m.color}26, transparent 60%), radial-gradient(700px 500px at ${flip ? "100%" : "0%"} 100%, hsl(var(--primary) / .12), transparent 60%), hsl(var(--card))` }}>
      <div className="lx-grain" />
      <span aria-hidden className="pointer-events-none absolute -bottom-10 font-accent text-[11rem] leading-none opacity-[0.06] sm:text-[16rem]" style={{ color: m.color, [flip ? "left" : "right"]: "-0.5rem" }}>{NUM(i)}</span>
      <div className={cn("relative flex h-full flex-col gap-4 p-5 sm:p-8 lg:grid lg:grid-cols-2 lg:items-center lg:gap-12 lg:p-14", flip && "lg:[&>*:first-child]:order-2")}>
        <div className="shrink-0">
          <div className="flex items-center gap-3 pr-16">
            <span className="font-accent text-3xl leading-none sm:text-5xl" style={{ color: m.color }}>{NUM(i)}</span>
            <span className="h-px w-10 bg-current opacity-30" />
            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">{m.category}</span>
          </div>
          <h3 className="mt-3 font-display text-[1.7rem] font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            {short.split(" ")[0]} <span className="font-accent font-normal" style={{ color: m.color }}>{short.split(" ").slice(1).join(" ") || ""}</span>
          </h3>
          <p className="mt-3 line-clamp-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-lg [@media(max-height:560px)]:line-clamp-2">{m.tagline}</p>
          <ul className="mt-4 hidden max-w-xl gap-2 sm:grid sm:grid-cols-2 [@media(max-height:700px)]:!hidden">
            {m.features.slice(0, 4).map((f) => <li key={f} className="flex gap-2 text-sm text-foreground/80"><Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: m.color }} />{f}</li>)}
          </ul>
          <div className="mt-4 flex flex-wrap gap-1.5 [@media(max-height:620px)]:hidden">
            {m.apps.slice(0, 5).map((x, j) => <span key={x.key} className={cn("items-center gap-1 rounded-full border border-border bg-background/70 px-2.5 py-1 text-[11px] font-medium text-foreground/80 backdrop-blur", j >= 3 ? "hidden sm:inline-flex" : "inline-flex")}><x.icon className="h-3 w-3" style={{ color: m.color }} />{x.name}</span>)}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-5">
            <Link to={`/solutions/${m.key}`} onClick={() => track("ViewContent", { content_name: m.key })}
              className="group inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-bold text-white sm:px-5 sm:py-2.5 sm:text-sm shadow-lg transition-transform hover:-translate-y-0.5" style={{ background: m.color, boxShadow: `0 14px 30px -12px ${m.color}` }}>
              Explore {short} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            {!m.included && <Link to={`/register?app=${m.key}`} className="rounded-full px-3.5 py-2 text-[13px] font-semibold text-foreground ring-1 ring-border hover:bg-muted sm:px-4 sm:py-2.5 sm:text-sm">Try it free</Link>}
          </div>
        </div>
        <div className="min-h-0 flex-1 lg:h-full lg:flex-none lg:py-6">
          <Fit><SuiteVisual m={m} /></Fit>
        </div>
      </div>
      <span className="absolute right-5 top-5 text-[11px] font-bold tabular-nums tracking-[0.2em] text-muted-foreground sm:right-8 sm:top-7">{String(i + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}</span>
    </div>
  );
}

function Panel({ m, i, n, progress }: { m: ModuleDef; i: number; n: number; progress: MotionValue<number> }) {
  // Slides in during its own slot, then sinks back while the next one covers it.
  const start = (i - 1) / (n - 1), end = i / (n - 1), next = (i + 1) / (n - 1);
  const y = useTransform(progress, i === 0 ? [0, 1] : [start, end], i === 0 ? ["0%", "0%"] : ["105%", "0%"]);
  const scale = useTransform(progress, [end, Math.min(1, next)], [1, i === n - 1 ? 1 : 0.92]);
  const dim = useTransform(progress, [end, Math.min(1, next)], [0, i === n - 1 ? 0 : 0.55]);
  return (
    <motion.div className="absolute inset-x-3 bottom-3 top-20 will-change-transform sm:inset-x-6 sm:top-24 lg:inset-x-10" style={{ y, scale, zIndex: i + 1 }}>
      <PanelBody m={m} i={i} n={n} />
      <motion.div className="pointer-events-none absolute inset-0 rounded-[28px] bg-background sm:rounded-[36px]" style={{ opacity: dim }} />
    </motion.div>
  );
}

export default function SuiteShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const n = MODULES.length;
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setActive(Math.min(n - 1, Math.max(0, Math.round(v * (n - 1))))));

  // Landscape phones and other short screens: too little height to stack cards, so list them.
  const [short, setShort] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-height: 520px)").matches);
  useEffect(() => {
    const q = window.matchMedia("(max-height: 520px)");
    const on = () => setShort(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);

  if (reduce || short) {
    return (
      <div className="space-y-6 px-3 sm:px-6 lg:px-10">
        {MODULES.map((m, i) => <div key={m.key} className={short ? "" : "h-[min(760px,calc(100svh-6rem))]"}><PanelBody m={m} i={i} n={n} /></div>)}
      </div>
    );
  }
  const jump = (i: number) => {
    const el = ref.current; if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + (el.offsetHeight - window.innerHeight) * (i / (n - 1)), behavior: "smooth" });
  };
  return (
    <div ref={ref} className="relative" style={{ height: `calc(${(n - 1) * STEP_VH}svh + 100svh)` }}>
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        {MODULES.map((m, i) => <Panel key={m.key} m={m} i={i} n={n} progress={scrollYProgress} />)}
        {/* Where you are: one dot per suite (jumps there). */}
        <div className="absolute right-1 top-1/2 z-[60] hidden -translate-y-1/2 flex-col gap-2 lg:flex">
          {MODULES.map((m, i) => (
            <button key={m.key} onClick={() => jump(i)} aria-label={m.name} title={m.name}
              className={cn("h-2 w-2 rounded-full transition-all", i === active ? "h-6" : "opacity-40 hover:opacity-80")} style={{ background: i === active ? m.color : "hsl(var(--muted-foreground))" }} />
          ))}
        </div>
      </div>
    </div>
  );
}
