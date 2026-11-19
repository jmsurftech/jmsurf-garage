import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Truck, Smartphone, ShieldCheck, Dog, Cat, Fish, Bird, Rabbit, Pill, Scissors, Package, Shapes as BrandIcon, Phone, MapPin, Mail,
  CheckCircle2, MessageCircle, Clock, Bone, Utensils, Sparkles, HeartPulse, Send,
} from "lucide-react";
import ShopLayout from "../ShopLayout";
import ProductCard from "../ProductCard";
import { useCatalogue, useShopCategories, useSite, shopApi, visitorId } from "../shopData";
import PageHead from "@/components/PageHead";
import { BrandOrb } from "@/components/Orb";
import { cn } from "@/lib/utils";

const CAT_ICON: [RegExp, any][] = [[/food/i, Utensils], [/dog/i, Dog], [/cat/i, Cat], [/fish|aqua/i, Fish], [/bird/i, Bird], [/small|rabbit/i, Rabbit], [/medic|health/i, Pill], [/groom/i, Scissors], [/toy/i, Bone], [/recover|care/i, HeartPulse], [/feed/i, Utensils], [/restrain/i, ShieldCheck], [/access/i, Sparkles]];
const iconFor = (name: string) => CAT_ICON.find(([r]) => r.test(name))?.[1] || Package;
const waLink = (n: string) => `https://wa.me/${n.replace(/[^\d]/g, "").replace(/^0/, "254")}`;

export default function Home() {
  const { data: items = [] } = useCatalogue();
  const { data: cats = [] } = useShopCategories();
  const site = useSite();
  const products = items.filter((i) => i.kind === "product");
  const withPics = products.filter((p) => p.images[0]);
  // Featured first, then products with photos, newest first.
  const ordered = [...products].sort((a, b) => Number(b.featured) - Number(a.featured) || Number(!!b.images[0]) - Number(!!a.images[0]) || b.created_at.localeCompare(a.created_at));
  const shown = ordered.slice(0, site.products.count);
  const heroPics = site.hero.images.length ? site.hero.images : withPics.slice(0, 6).map((p) => p.images[0]);
  const counts = new Map<string, number>();
  items.forEach((i) => i.category && counts.set(i.category, (counts.get(i.category) || 0) + 1));
  const shownCats = cats.filter((c) => counts.get(c.name));

  return (
    <ShopLayout>
      <PageHead title={site.seo.title} description={site.seo.description} path="/" />

      {/* ───────── Hero ───────── */}
      {site.template === "bold" ? (
        <section className="relative overflow-hidden bg-primary text-primary-foreground">
          <div className="absolute inset-0 grid grid-cols-3 opacity-15 sm:grid-cols-6">{heroPics.slice(0, 6).map((u, i) => <img key={i} src={u} alt="" className="h-full w-full object-cover" />)}</div>
          <div className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:py-28">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold"><BrandIcon className="h-3.5 w-3.5" /> {site.hero.badge}</span>
            <h1 className="mt-5 font-display text-4xl font-extrabold leading-tight sm:text-6xl">{site.hero.title}</h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg opacity-90">{site.hero.text}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/shop" className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 font-display font-semibold text-primary shadow-lg">{site.hero.cta} <ArrowRight className="h-4 w-4" /></Link>
              <Link to="/services" className="inline-flex items-center gap-2 rounded-full border-2 border-white/60 px-7 py-3 font-display font-semibold">{site.hero.cta2}</Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/12 via-background to-accent/10" />
          <BrandIcon aria-hidden className="ft-float absolute -left-10 top-10 h-48 w-48 rotate-[-20deg] text-primary/5" />
          <BrandOrb state="weaving" size={420} className="absolute -right-24 -top-24 opacity-30" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-12 md:grid-cols-2 md:py-20">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"><BrandIcon className="h-3.5 w-3.5" /> {site.hero.badge}</span>
              <h1 className="mt-4 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">{site.hero.title}</h1>
              <p className="mt-4 max-w-lg text-lg text-muted-foreground">{site.hero.text}</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to="/shop" className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-display font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90">{site.hero.cta} <ArrowRight className="h-4 w-4" /></Link>
                <Link to="/services" className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-6 py-3 font-display font-semibold hover:border-primary hover:text-primary">{site.hero.cta2}</Link>
              </div>
              <div className="mt-8 flex flex-wrap gap-5 text-sm text-muted-foreground">
                <span className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-primary" /> Pay with M-Pesa</span>
                <span className="flex items-center gap-2"><Truck className="h-4 w-4 text-primary" /> Pickup or delivery</span>
                <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Genuine products</span>
              </div>
            </div>
            {site.template === "split" ? (
              <div className="relative">
                <div className="aspect-[4/3] overflow-hidden rounded-[2rem] border border-border bg-card shadow-2xl">
                  {heroPics[0] ? <img src={heroPics[0]} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><BrandIcon className="h-20 w-20 text-primary/30" /></div>}
                </div>
                {heroPics[1] && <img src={heroPics[1]} alt="" className="hero-bob absolute -bottom-6 -left-6 hidden h-32 w-32 rounded-3xl border-4 border-background object-cover shadow-xl sm:block" style={{ animationDelay: "1.5s" }} />}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {heroPics.slice(0, 6).map((u, i) => (
                  <div key={i} className={cn(i % 3 === 1 && "translate-y-6", i > 2 && "hidden sm:block")}>
                    <div className="hero-bob overflow-hidden rounded-3xl border border-border bg-card shadow-xl" style={{ animationDelay: `${(i * 0.9) % 4}s`, animationDuration: `${6 + (i % 3)}s` }}>
                      <img src={u} alt="" className="aspect-square w-full object-cover transition-transform duration-700 hover:scale-105" />
                    </div>
                  </div>
                ))}
                {heroPics.length === 0 && <div className="col-span-3 flex aspect-[3/2] items-center justify-center rounded-3xl border border-dashed border-border"><BrandIcon className="h-16 w-16 text-primary/30" /></div>}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ───────── About (small) ───────── */}
      <section className="mx-auto max-w-7xl px-4 py-14" data-reveal>
        <div className="grid items-center gap-8 rounded-3xl border border-border bg-card p-6 sm:p-10 md:grid-cols-[1fr_1.2fr]">
          <div className="relative">
            {site.about.image ? <img src={site.about.image} alt="" className="aspect-[4/3] w-full rounded-2xl object-cover" />
              : <div className="grid aspect-[4/3] grid-cols-2 gap-2">{withPics.slice(6, 10).map((p) => <img key={p.id} src={p.images[0]} alt="" className="h-full w-full rounded-2xl object-cover" />)}</div>}
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">About us</p>
            <h2 className="mt-2 font-display text-3xl font-bold">{site.about.title}</h2>
            <p className="mt-3 text-muted-foreground">{site.about.text}</p>
            <ul className="mt-5 space-y-2">{site.about.points.filter(Boolean).map((p) => <li key={p} className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />{p}</li>)}</ul>
            <Link to="/about" className="mt-6 inline-flex items-center gap-1 font-semibold text-primary hover:underline">More about us <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </div>
      </section>

      {/* ───────── Products & services: statement + categories ───────── */}
      <section className="mx-auto max-w-7xl px-4 py-6">
        <div className="mx-auto max-w-2xl text-center" data-reveal>
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">What we offer</p>
          <h2 className="mt-2 font-display text-3xl font-bold">{site.services.title}</h2>
          <p className="mt-3 text-muted-foreground">{site.services.text}</p>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shownCats.map((c) => {
            const Icon = iconFor(c.name);
            return (
              <Link key={c.id} data-reveal to={`/shop?category=${encodeURIComponent(c.name)}`} className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg">
                {c.image_url ? <img src={c.image_url} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"><Icon className="h-6 w-6" /></span>}
                <span className="min-w-0"><span className="block truncate text-sm font-semibold">{c.name}</span><span className="text-xs text-muted-foreground">{counts.get(c.name) || 0} items</span></span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ───────── Products ───────── */}
      {shown.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-14">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold">{site.products.title}</h2>
            <p className="mt-2 text-muted-foreground">{site.products.text}</p>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3">{shown.map((p, i) => <div key={p.id} data-reveal style={{ ["--reveal-delay" as any]: `${(i % 3) * 90}ms` }}><ProductCard item={p} /></div>)}</div>
          <div className="mt-8 text-center">
            <Link to="/shop" className="inline-flex items-center gap-2 rounded-full border-2 border-primary px-8 py-3 font-display font-semibold text-primary hover:bg-primary hover:text-primary-foreground">View all products <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </section>
      )}

      {/* ───────── CTA ───────── */}
      <section className="mx-auto max-w-7xl px-4 py-6">
        <div data-reveal className="relative overflow-hidden rounded-[2rem] bg-[linear-gradient(120deg,hsl(var(--primary)),hsl(var(--primary)/0.85)_55%,hsl(var(--accent)))] p-8 text-primary-foreground sm:p-12">
          <BrandOrb state="breathing" size={260} tint="#ffffff" className="absolute -bottom-20 -left-16 opacity-25" />
          <BrandIcon aria-hidden className="absolute -right-8 -top-8 h-56 w-56 rotate-12 opacity-10" />
          <div className="relative grid items-center gap-6 md:grid-cols-[1.4fr_auto]">
            <div>
              <h2 className="font-display text-3xl font-extrabold sm:text-4xl">{site.cta.title}</h2>
              <p className="mt-3 max-w-xl opacity-90">{site.cta.text}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {/^https?:/.test(site.cta.link) ? <a href={site.cta.link} className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 font-display font-semibold text-primary shadow-lg">{site.cta.button} <ArrowRight className="h-4 w-4" /></a>
                : <Link to={site.cta.link || "/shop"} className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 font-display font-semibold text-primary shadow-lg">{site.cta.button} <ArrowRight className="h-4 w-4" /></Link>}
              <Link to="/login?mode=up" className="inline-flex items-center gap-2 rounded-full border-2 border-white/60 px-7 py-3 font-display font-semibold">Create an account</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Contact ───────── */}
      <ContactSection />
    </ShopLayout>
  );
}

export function ContactSection() {
  const site = useSite();
  const [f, setF] = useState({ name: "", phone: "", email: "", message: "" });
  const [state, setState] = useState<"" | "sending" | "sent" | string>("");
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    try { await shopApi("contact", { ...f, vid: visitorId() }); setState("sent"); setF({ name: "", phone: "", email: "", message: "" }); }
    catch (err: any) { setState(err.message || "Not sent"); }
  };
  const cards: [any, string, string, string | null][] = [
    [Phone, "Call us", site.contact.phone, site.contact.phone ? `tel:${site.contact.phone.replace(/\s/g, "")}` : null],
    [MessageCircle, "WhatsApp", site.contact.whatsapp ? "Chat with us" : "", site.contact.whatsapp ? waLink(site.contact.whatsapp) : null],
    [Mail, "Email", site.contact.email, site.contact.email ? `mailto:${site.contact.email}` : null],
    [MapPin, "Visit", site.contact.address, site.contact.map_url || (site.contact.address ? `https://www.google.com/maps/search/${encodeURIComponent(site.contact.address)}` : null)],
  ];
  return (
    <section id="contact" className="mx-auto max-w-7xl px-4 py-14" data-reveal>
      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Contact</p>
          <h2 className="mt-2 font-display text-3xl font-bold">{site.contact_section.title}</h2>
          <p className="mt-3 text-muted-foreground">{site.contact_section.text}</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {cards.filter(([, , v]) => v).map(([I, l, v, href]) => (
              <a key={l} href={href || undefined} target={href?.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 hover:border-primary">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><I className="h-5 w-5" /></span>
                <span className="min-w-0"><span className="block text-xs text-muted-foreground">{l}</span><span className="block truncate font-semibold">{v}</span></span>
              </a>
            ))}
          </div>
          {site.contact.hours && <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Clock className="h-4 w-4" /> {site.contact.hours}</p>}
        </div>
        <form onSubmit={send} className="space-y-3 rounded-3xl border border-border bg-card p-6 sm:p-8">
          <p className="font-display text-xl font-bold">Send us a message</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="fi" required placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <input className="fi" required inputMode="tel" placeholder="Phone number" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </div>
          <input className="fi" type="email" placeholder="Email (optional)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <textarea className="fi min-h-28" required placeholder="How can we help?" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
          {state === "sent" && <p className="text-sm font-medium text-success">Thank you! We'll get back to you shortly.</p>}
          {state && !["sent", "sending"].includes(state) && <p className="text-sm text-destructive">{state}</p>}
          <button disabled={state === "sending"} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-display font-semibold text-primary-foreground disabled:opacity-60"><Send className="h-4 w-4" /> {state === "sending" ? "Sending…" : "Send message"}</button>
        </form>
      </div>
    </section>
  );
}
