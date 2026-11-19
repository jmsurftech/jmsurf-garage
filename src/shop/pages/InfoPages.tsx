import { Link } from "react-router-dom";
import { Heart, Truck, Bell, ShieldCheck, CheckCircle2, ArrowRight } from "lucide-react";
import ShopLayout, { PageBanner } from "../ShopLayout";
import { useSite, useCatalogue } from "../shopData";
import PageHead from "@/components/PageHead";
import { ContactSection } from "./Home";

export function AboutPage() {
  const site = useSite();
  const { data: items = [] } = useCatalogue();
  const pics = items.filter((i) => i.images[0]).slice(0, 4);
  const name = site.shop?.name || "JMSURF Garage";
  return (
    <ShopLayout>
      <PageHead title={`About · ${name}`} path="/about" description={site.about.text.slice(0, 150)} />
      <PageBanner title={`About ${name}`} subtitle="Who we are and how we serve you." crumbs={[{ label: "About" }]} />
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:grid-cols-2" data-reveal>
        <div>
          <h2 className="font-display text-3xl font-extrabold">{site.about.title}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{site.about.text}</p>
          <ul className="mt-6 space-y-2">{site.about.points.filter(Boolean).map((p) => <li key={p} className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-5 w-5 text-primary" />{p}</li>)}</ul>
          <Link to="/shop" className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-display font-semibold text-primary-foreground">Visit the shop <ArrowRight className="h-4 w-4" /></Link>
        </div>
        {site.about.image ? <img src={site.about.image} alt="" className="aspect-[4/3] w-full rounded-3xl object-cover shadow-xl" />
          : <div className="grid grid-cols-2 gap-3">{pics.map((p) => <img key={p.id} src={p.images[0]} alt="" className="aspect-square w-full rounded-3xl object-cover shadow-lg" />)}</div>}
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[[Heart, "Quality first", "Every product is chosen for quality. Ask us anything: we'll help you choose the right one."], [Truck, "Shop your way", "Visit the shop, order online for pickup, or have it delivered."], [Bell, "Reminders that help", "We remind you about dewormers, flea treatment and food so your pet never misses a dose."], [ShieldCheck, "Clear records", "Every purchase is in your online account, with receipts, statements and balances."]].map(([Icon, t, d]: any) => (
            <div key={t} className="rounded-2xl border border-border bg-card p-5"><Icon className="h-6 w-6 text-primary" /><p className="mt-3 font-display text-lg font-bold">{t}</p><p className="mt-1 text-sm text-muted-foreground">{d}</p></div>
          ))}
        </div>
      </section>
    </ShopLayout>
  );
}

export function ContactPage() {
  const site = useSite();
  return (
    <ShopLayout>
      <PageHead title={`Contact · ${site.shop?.name || "JMSURF Garage"}`} path="/contact" description="Call, WhatsApp, email or visit the shop." />
      <PageBanner title="Contact us" subtitle="Call, WhatsApp, email or visit the shop. We reply quickly during shop hours." crumbs={[{ label: "Contact" }]} />
      <ContactSection />
    </ShopLayout>
  );
}
