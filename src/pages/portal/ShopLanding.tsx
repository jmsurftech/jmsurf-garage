import { Helmet } from "react-helmet-async";
import { ThinkingOrb, type OrbState } from "@/components/orbs/lib";
import { Droplets, ShieldCheck, Truck, Wallet, Phone, MessageCircle, Mail, MapPin, Clock, ArrowRight, Smartphone, CheckCircle2, Sparkles, LogIn } from "lucide-react";
import { formatKES } from "@/lib/format";
import { formatLitres } from "@/lib/businessType";
import { ACCENTS, whatsappUrl, type SiteContent } from "@/lib/shopSite";
import { refillSizes, type PortalShop, type PortalSize } from "@/lib/portalApi";

const FEATURE_ICONS = [ShieldCheck, Truck, Wallet, Sparkles, CheckCircle2, Droplets];

/** Decorative animated dot orb (thinking-orbs) blown up and floating. */
function FloatOrb({ state, color = "#ffffff", scale = 2, className = "", style, delay = 0 }: {
  state: OrbState; color?: string; scale?: number; className?: string; style?: React.CSSProperties; delay?: number;
}) {
  return (
    <div aria-hidden className={`pointer-events-none absolute ${className}`} style={{ width: 64 * scale, height: 64 * scale, animation: `drift ${6 + (delay % 4)}s ease-in-out ${delay}s infinite`, ...style }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: 64, height: 64 }}>
        <ThinkingOrb state={state} size={64} tint={color} />
      </div>
    </div>
  );
}

/** Wavy divider used between sections. */
function Wave({ fill, flip, className = "" }: { fill: string; flip?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 1440 90" preserveAspectRatio="none" className={`block h-12 w-full sm:h-20 ${flip ? "rotate-180" : ""} ${className}`} aria-hidden>
      <path fill={fill} d="M0,48 C180,96 360,0 540,32 C720,64 900,96 1080,64 C1260,32 1350,16 1440,24 L1440,90 L0,90 Z" />
    </svg>
  );
}

/**
 * One-page website of a water refill shop: what it sells, live prices, how
 * delivery works, about, areas served and contacts. "Order" opens the
 * customer ordering page. Content comes from Website in the shop's menu.
 */
export default function ShopLanding({ shop, sizes: catalogue, site, orderHref, signInHref = "/signin", signInLabel = "Sign in" }: {
  shop: PortalShop; sizes: PortalSize[]; site: SiteContent; orderHref: string;
  /** One sign-in for customers, riders and staff; each lands on their own page. */
  signInHref?: string; signInLabel?: string;
}) {
  const sizes = refillSizes(catalogue);
  const a = ACCENTS[site.accent] || ACCENTS.sky;
  const wa = whatsappUrl(site.whatsapp || site.phone);
  const phone = site.phone || shop.phone || "";
  const features = site.features.filter((f) => f.title?.trim());
  const grad = `linear-gradient(135deg, ${a.from} 0%, ${a.to} 100%)`;

  return (
    <div className="min-h-screen bg-white text-slate-800" style={{ fontFamily: "inherit" }}>
      <Helmet>
        <title>{shop.name} · {site.tagline}</title>
        <meta name="description" content={site.subheadline} />
      </Helmet>
      <style>{`
        @keyframes drift { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-14px) } }
        @keyframes rise { 0% { transform: translateY(0) scale(.6); opacity: 0 } 15% { opacity: .55 } 100% { transform: translateY(-420px) scale(1.1); opacity: 0 } }
        .bubble { position:absolute; bottom:-20px; border-radius:9999px; background:rgba(255,255,255,.35); animation: rise linear infinite }
      `}</style>

      {/* Top bar */}
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
          {shop.logo_url
            ? <img src={shop.logo_url} alt="" className="h-10 w-10 rounded-xl bg-white object-cover shadow" />
            : <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-white backdrop-blur"><Droplets className="h-5 w-5" /></span>}
          <span className="min-w-0 truncate font-display text-lg font-bold text-white">{shop.name}</span>
          <nav className="ml-auto flex items-center gap-2">
            {phone && <a href={`tel:${phone}`} className="hidden items-center gap-1.5 rounded-full bg-white/15 px-3 py-2 text-sm font-medium text-white backdrop-blur hover:bg-white/25 sm:inline-flex"><Phone className="h-4 w-4" />{phone}</a>}
            <a href={signInHref} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/50 bg-white/10 px-3 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/20 sm:px-4"><LogIn className="hidden h-4 w-4 sm:block" />{signInLabel}</a>
            <a href={orderHref} className="shrink-0 whitespace-nowrap rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-lg" style={{ color: a.solid }}>Order</a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden text-white" style={{ background: grad }}>
        {[...Array(14)].map((_, i) => (
          <span key={i} className="bubble" style={{
            left: `${(i * 37) % 100}%`, width: 8 + ((i * 13) % 22), height: 8 + ((i * 13) % 22),
            animationDuration: `${7 + (i % 6) * 1.7}s`, animationDelay: `${(i * 0.9) % 7}s`,
          }} />
        ))}
        <FloatOrb state="weaving" scale={3.2} className="-left-16 top-20 opacity-60" />
        <FloatOrb state="breathing" scale={2.2} className="right-[8%] top-16 hidden opacity-70 lg:block" delay={1.5} />
        <FloatOrb state="connecting" scale={1.6} className="bottom-24 left-[42%] hidden opacity-60 md:block" delay={3} />
        <FloatOrb state="listening" scale={2.6} className="-right-10 bottom-10 opacity-50" delay={2.2} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-10 pt-28 sm:px-6 lg:grid-cols-2 lg:pb-16 lg:pt-32">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider backdrop-blur">
              <Droplets className="h-3.5 w-3.5" /> {site.tagline}
            </span>
            <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">{site.headline}</h1>
            <p className="mt-5 max-w-xl text-base text-white/85 sm:text-lg">{site.subheadline}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={orderHref} className="inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-base font-bold shadow-xl transition hover:-translate-y-0.5" style={{ color: a.solid }}>
                {site.cta_label || "Order water now"} <ArrowRight className="h-5 w-5" />
              </a>
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-2xl border border-white/40 px-5 py-3.5 text-base font-semibold backdrop-blur hover:bg-white/10"><MessageCircle className="h-5 w-5" /> WhatsApp</a>}
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/85">
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> Pay on delivery</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> Track your rider live</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> M-Pesa or cash</span>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-md">
            {site.hero_image ? (
              <img src={site.hero_image} alt="" className="aspect-[4/5] w-full rounded-[2rem] object-cover shadow-2xl ring-4 ring-white/20" style={{ animation: "drift 7s ease-in-out infinite" }} />
            ) : (
              <div className="relative mx-auto aspect-square w-full max-w-sm" style={{ animation: "drift 7s ease-in-out infinite" }}>
                <div className="absolute inset-6 rounded-full bg-white/10 blur-2xl" />
                <svg viewBox="0 0 200 200" className="relative h-full w-full drop-shadow-2xl" aria-hidden>
                  <defs>
                    <linearGradient id="dropg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity=".95" /><stop offset="1" stopColor="#ffffff" stopOpacity=".55" /></linearGradient>
                  </defs>
                  <path d="M100 14 C100 14 40 88 40 128 a60 60 0 0 0 120 0 C160 88 100 14 100 14 Z" fill="url(#dropg)" />
                  <path d="M72 128 a28 28 0 0 0 28 28" stroke={a.solid} strokeWidth="8" strokeLinecap="round" fill="none" opacity=".55" />
                </svg>
                <FloatOrb state="shaping" scale={1.5} color={a.solid} className="left-1/2 top-[52%] -translate-x-1/2 opacity-80" style={{ animation: "none" }} />
              </div>
            )}
            {site.show_prices && sizes.length > 0 && (
              <div className="absolute -bottom-4 left-1/2 w-[88%] -translate-x-1/2 rounded-2xl bg-white p-3 text-slate-800 shadow-2xl sm:-left-6 sm:w-auto sm:translate-x-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">20 litres from</p>
                <p className="font-display text-2xl font-extrabold" style={{ color: a.solid }}>
                  {formatKES(sizes.reduce((m, s) => (s.litres === 20 ? s.price : m), sizes[sizes.length - 1].price))}
                </p>
              </div>
            )}
          </div>
        </div>
        <Wave fill="#ffffff" />
      </section>

      {/* Prices */}
      {site.show_prices && sizes.length > 0 && (
        <section className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <FloatOrb state="solving" scale={1.6} color={a.solid} className="right-2 top-6 hidden opacity-50 sm:block" />
          <FloatOrb state="composing" scale={1.2} color={a.to} className="left-2 top-16 hidden opacity-45 md:block" delay={2} />
          <div className="relative text-center">
            <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: a.solid }}>Refill prices</p>
            <h2 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Pick your size</h2>
          </div>
          <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {sizes.map((s) => {
              const h = Math.min(100, 30 + Math.sqrt(s.litres) * 15);
              return (
                <a key={s.id} href={orderHref} className="group relative flex flex-col items-center overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 text-center shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                  <div className="relative flex h-28 w-full items-end justify-center">
                    <div className="relative w-14 overflow-hidden rounded-b-2xl rounded-t-lg border-2 border-slate-200" style={{ height: `${h}%` }}>
                      <div className="absolute inset-x-0 bottom-0 transition-all duration-500 group-hover:h-full" style={{ height: "70%", background: grad, opacity: 0.85 }} />
                    </div>
                  </div>
                  <p className="mt-4 font-display text-2xl font-extrabold">{formatLitres(s.litres)}</p>
                  <p className="text-sm text-slate-500">{formatKES(s.price)}</p>
                  <span className="mt-3 text-xs font-semibold opacity-0 transition group-hover:opacity-100" style={{ color: a.solid }}>Order →</span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="relative overflow-hidden" style={{ background: a.soft }}>
        <FloatOrb state="breathing" scale={3} color={a.solid} className="-left-24 top-1/3 opacity-30" delay={1} />
        <Wave fill="#ffffff" flip />
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: a.text }}>How it works</p>
            <h2 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Water at your door in 3 steps</h2>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              { icon: Smartphone, t: "Order online", d: "Create your account once, pin your place, and choose your refills." },
              { icon: Truck, t: "We deliver", d: "A rider brings it to you. Watch them coming on the map." },
              { icon: Wallet, t: "Pay on arrival", d: "Approve the M-Pesa prompt or pay cash. Your receipt is in your account." },
            ].map((x, i) => (
              <div key={x.t} className="relative overflow-hidden rounded-3xl bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
                <div aria-hidden className="pointer-events-none absolute -bottom-3 -right-3 opacity-45"><ThinkingOrb state={(["listening", "connecting", "working"] as OrbState[])[i]} size={64} tint={a.solid} /></div>
                <span className="absolute right-5 top-4 font-display text-5xl font-black opacity-10" style={{ color: a.solid }}>{i + 1}</span>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-white" style={{ background: grad }}><x.icon className="h-6 w-6" /></span>
                <h3 className="mt-4 text-lg font-bold">{x.t}</h3>
                <p className="mt-1 text-sm text-slate-600">{x.d}</p>
              </div>
            ))}
          </div>
        </div>
        <Wave fill="#ffffff" />
      </section>

      {/* Why us */}
      {features.length > 0 && (
        <section className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <FloatOrb state="searching" scale={1.4} color={a.solid} className="left-4 top-8 hidden opacity-50 sm:block" delay={0.8} />
          <div className="relative text-center">
            <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: a.solid }}>Why {shop.name}</p>
            <h2 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Water you can trust</h2>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => {
              const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length];
              return (
                <div key={i} className="rounded-3xl border border-slate-200 p-6 transition hover:shadow-lg">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: a.soft, color: a.solid }}><Icon className="h-5 w-5" /></span>
                  <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{f.text}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* About */}
      {site.about_text?.trim() && (
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-14 sm:px-6 lg:grid-cols-2">
          {site.about_image
            ? <img src={site.about_image} alt="" className="aspect-[4/3] w-full rounded-[2rem] object-cover shadow-xl" />
            : <div className="flex aspect-[4/3] w-full items-center justify-center rounded-[2rem] text-white shadow-xl" style={{ background: grad }}><div className="relative"><Droplets className="h-24 w-24 opacity-80" /><FloatOrb state="weaving" scale={3.4} className="-left-[61px] -top-[61px] opacity-80" /></div></div>}
          <div>
            <h2 className="font-display text-3xl font-bold sm:text-4xl">{site.about_title}</h2>
            <p className="mt-4 whitespace-pre-line text-slate-600">{site.about_text}</p>
            {site.areas.length > 0 && (
              <div className="mt-6">
                <p className="text-sm font-semibold">We deliver to</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {site.areas.map((x) => <span key={x} className="rounded-full px-3 py-1 text-sm font-medium" style={{ background: a.soft, color: a.text }}>{x}</span>)}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* CTA + contacts */}
      <section className="relative overflow-hidden text-white" style={{ background: grad }}>
        <Wave fill="#ffffff" flip />
        <FloatOrb state="connecting" scale={3.4} className="-right-16 top-20 opacity-45" delay={0.5} />
        <FloatOrb state="working" scale={1.6} className="bottom-24 left-[46%] hidden opacity-50 lg:block" delay={2.5} />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl font-bold sm:text-4xl">Thirsty? We are on our way.</h2>
            <p className="mt-3 text-white/85">Create your account in a minute and get water delivered today.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href={orderHref} className="inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-3.5 font-bold shadow-xl" style={{ color: a.solid }}>
                {site.cta_label || "Order water now"} <ArrowRight className="h-5 w-5" />
              </a>
              <a href={signInHref} className="inline-flex items-center gap-2 rounded-2xl border border-white/40 px-5 py-3.5 font-semibold backdrop-blur hover:bg-white/10"><LogIn className="h-5 w-5" /> {signInLabel}</a>
            </div>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            {phone && <a href={`tel:${phone}`} className="flex items-center gap-3 rounded-2xl bg-white/10 p-4 backdrop-blur hover:bg-white/15"><Phone className="h-5 w-5 shrink-0" /><span><span className="block text-xs text-white/70">Call</span>{phone}</span></a>}
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl bg-white/10 p-4 backdrop-blur hover:bg-white/15"><MessageCircle className="h-5 w-5 shrink-0" /><span><span className="block text-xs text-white/70">WhatsApp</span>{site.whatsapp || phone}</span></a>}
            {site.email && <a href={`mailto:${site.email}`} className="flex items-center gap-3 rounded-2xl bg-white/10 p-4 backdrop-blur hover:bg-white/15"><Mail className="h-5 w-5 shrink-0" /><span className="min-w-0"><span className="block text-xs text-white/70">Email</span><span className="block truncate">{site.email}</span></span></a>}
            {site.address && <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-4 backdrop-blur"><MapPin className="h-5 w-5 shrink-0" /><span><span className="block text-xs text-white/70">Visit us</span>{site.address}</span></div>}
            {site.hours && <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-4 backdrop-blur sm:col-span-2"><Clock className="h-5 w-5 shrink-0" /><span><span className="block text-xs text-white/70">Open</span>{site.hours}</span></div>}
          </div>
        </div>
        <footer className="border-t border-white/15">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-white/70 sm:px-6">
            <span>© {new Date().getFullYear()} {shop.name}</span>
            <a href="https://garage.jmsurf.co.ke" target="_blank" rel="noopener noreferrer" className="font-medium underline-offset-2 hover:text-white hover:underline">Powered by JMSURF Garage</a>
          </div>
        </footer>
      </section>
    </div>
  );
}
