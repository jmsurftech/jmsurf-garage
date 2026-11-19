import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { ShoppingCart, User, Search, Menu, X, Shapes as BrandIcon, Phone, Mail, MapPin, Moon, Sun, Facebook, Instagram, Youtube, MessageCircle, Clock, LogIn, UserPlus } from "lucide-react";
import { useTheme, hexToHsl } from "@/hooks/useTheme";
import PoweredBy from "@/components/PoweredBy";
import { CartProvider, useCart, useSite, getCustomerToken, shopApi, visitorId } from "./shopData";
import { cn } from "@/lib/utils";

const NAV = [["/", "Home"], ["/about", "About"], ["/services", "Services"], ["/shop", "Shop"], ["/contact", "Contact"]] as const;
const waLink = (n: string) => `https://wa.me/${n.replace(/[^\d]/g, "").replace(/^0/, "254")}`;

function TopBar() {
  const site = useSite();
  const signedIn = !!getCustomerToken();
  if (!site.topbar.show) return null;
  return (
    <div className="bg-[hsl(var(--site-dark))] text-[12px] text-white/85">
      <div className="mx-auto flex h-9 max-w-7xl items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-4">
          {site.contact.phone && <a href={`tel:${site.contact.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 hover:text-white"><Phone className="h-3.5 w-3.5" />{site.contact.phone}</a>}
          {site.contact.email && <a href={`mailto:${site.contact.email}`} className="hidden items-center gap-1.5 hover:text-white sm:inline-flex"><Mail className="h-3.5 w-3.5" />{site.contact.email}</a>}
          {site.topbar.text && <span className="hidden truncate lg:inline">{site.topbar.text}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {signedIn ? <Link to="/account" className="inline-flex items-center gap-1.5 hover:text-white"><User className="h-3.5 w-3.5" /> My account</Link> : <>
            <Link to="/login" className="inline-flex items-center gap-1.5 hover:text-white"><LogIn className="h-3.5 w-3.5" /> Sign in</Link>
            <span className="opacity-40">|</span>
            <Link to="/login?mode=up" className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-0.5 font-semibold text-primary-foreground hover:bg-primary/90"><UserPlus className="h-3.5 w-3.5" /> Sign up</Link>
          </>}
        </div>
      </div>
    </div>
  );
}

function Header() {
  const { count } = useCart();
  const site = useSite();
  const shop = site.shop;
  const { darkMode, toggleDarkMode } = useTheme();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (searching) inputRef.current?.focus(); }, [searching]);
  const search = (e: React.FormEvent) => { e.preventDefault(); if (!q.trim()) return; navigate(`/shop?q=${encodeURIComponent(q.trim())}`); setOpen(false); setSearching(false); };
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="relative mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          {shop?.logo_url ? <img src={shop.logo_url} alt="" className="h-10 w-10 rounded-xl object-contain" /> : <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><BrandIcon className="h-5 w-5" /></span>}
          <span className="hidden font-display text-lg font-bold leading-tight sm:block">{shop?.name || "JMSURF Garage"}</span>
        </Link>
        {/* Centred menu (desktop); the search grows over it when opened. */}
        <nav className={cn("absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 transition-opacity lg:flex", searching && "pointer-events-none opacity-0")}>
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => cn("rounded-full px-4 py-2 text-sm font-medium transition-colors", isActive ? "text-primary" : "text-foreground/75 hover:text-primary")}>{label}</NavLink>
          ))}
        </nav>
        <form onSubmit={search} className={cn("absolute inset-x-4 top-1/2 z-10 -translate-y-1/2 transition-all duration-300 lg:left-1/2 lg:right-auto lg:w-[min(560px,52vw)] lg:-translate-x-1/2", searching ? "visible scale-100 opacity-100" : "invisible scale-95 opacity-0")}>
          <div className="flex overflow-hidden rounded-full border-2 border-primary bg-card shadow-lg">
            <Search className="ml-4 h-5 w-5 self-center text-muted-foreground" />
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setSearching(false)} placeholder="Search food, medicine, toys, brands…" className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none" />
            <button className="bg-primary px-5 text-sm font-semibold text-primary-foreground">Search</button>
            <button type="button" onClick={() => setSearching(false)} className="px-3 text-muted-foreground hover:text-foreground" aria-label="Close search"><X className="h-4 w-4" /></button>
          </div>
        </form>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setSearching(true)} className="rounded-full p-2 text-foreground/80 hover:bg-muted" aria-label="Search"><Search className="h-5 w-5" /></button>
          <button onClick={toggleDarkMode} className="hidden rounded-full p-2 text-muted-foreground hover:bg-muted sm:inline-flex" aria-label={darkMode ? "Light mode" : "Dark mode"}>{darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}</button>
          <Link to={getCustomerToken() ? "/account" : "/login"} className="rounded-full p-2 text-foreground/80 hover:bg-muted" aria-label="My account"><User className="h-5 w-5" /></Link>
          <Link to="/cart" className="relative rounded-full p-2 text-foreground/80 hover:bg-muted" aria-label="Cart">
            <ShoppingCart className="h-5 w-5" />
            {count > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-primary px-1 text-center text-[10px] font-bold leading-[18px] text-primary-foreground">{count > 99 ? "99+" : count}</span>}
          </Link>
          <button onClick={() => setOpen(!open)} className="rounded-full p-2 lg:hidden" aria-label="Menu">{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
        </div>
      </div>
      {open && (
        <div className="border-t border-border bg-background px-4 pb-4 lg:hidden">
          {NAV.map(([to, label]) => <Link key={to} to={to} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2.5 font-medium hover:bg-muted">{label}</Link>)}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Link to="/login" onClick={() => setOpen(false)} className="rounded-full border border-border py-2 text-center text-sm font-semibold">Sign in</Link>
            <Link to="/login?mode=up" onClick={() => setOpen(false)} className="rounded-full bg-primary py-2 text-center text-sm font-semibold text-primary-foreground">Sign up</Link>
          </div>
        </div>
      )}
    </header>
  );
}

function Footer() {
  const site = useSite();
  const name = site.shop?.name || "JMSURF Garage";
  const social = ([["facebook", Facebook], ["instagram", Instagram], ["youtube", Youtube]] as const).filter(([k]) => site.social[k]);
  return (
    <footer className="mt-16 bg-[hsl(var(--site-dark))] text-white/80">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="flex items-center gap-2 font-display text-lg font-bold text-white"><BrandIcon className="h-5 w-5 text-primary" /> {site.shop?.name || "JMSURF Garage"}</p>
          <p className="mt-2 text-sm">{site.footer.text}</p>
          {social.length > 0 && <div className="mt-4 flex gap-2">{social.map(([k, I]) => <a key={k} href={site.social[k]} target="_blank" rel="noopener noreferrer" className="rounded-full bg-white/10 p-2 hover:bg-primary" aria-label={k}><I className="h-4 w-4" /></a>)}</div>}
        </div>
        <div>
          <p className="font-semibold text-white">Shop</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link to="/shop" className="hover:text-white">All products</Link></li>
            <li><Link to="/services" className="hover:text-white">Services</Link></li>
            <li><Link to="/cart" className="hover:text-white">Cart</Link></li>
            <li><Link to="/account" className="hover:text-white">My account & orders</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-white">Company</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link to="/about" className="hover:text-white">About us</Link></li>
            <li><Link to="/contact" className="hover:text-white">Contact</Link></li>
            <li><Link to="/terms" className="hover:text-white">Terms</Link></li>
            <li><Link to="/privacy" className="hover:text-white">Privacy</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-white">Contact</p>
          <ul className="mt-3 space-y-2 text-sm">
            {site.contact.phone && <li className="flex items-center gap-2"><Phone className="h-4 w-4" /><a href={`tel:${site.contact.phone.replace(/\s/g, "")}`} className="hover:text-white">{site.contact.phone}</a></li>}
            {site.contact.whatsapp && <li className="flex items-center gap-2"><MessageCircle className="h-4 w-4" /><a href={waLink(site.contact.whatsapp)} target="_blank" rel="noopener noreferrer" className="hover:text-white">WhatsApp us</a></li>}
            {site.contact.email && <li className="flex items-center gap-2"><Mail className="h-4 w-4" /><a href={`mailto:${site.contact.email}`} className="hover:text-white">{site.contact.email}</a></li>}
            {site.contact.address && <li className="flex items-center gap-2"><MapPin className="h-4 w-4" />{site.contact.address}</li>}
            {site.contact.hours && <li className="flex items-center gap-2"><Clock className="h-4 w-4" />{site.contact.hours}</li>}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs sm:flex-row">
          <p>© {new Date().getFullYear()} {name}</p>
          <PoweredBy className="text-white/70 hover:text-white" />
        </div>
      </div>
    </footer>
  );
}

/** Website colours from System → Online shop & website, as CSS variables for this page. */
function useSiteColours(): CSSProperties {
  const site = useSite();
  const ok = (h: string) => /^#[0-9a-f]{6}$/i.test(h || "");
  return {
    ...(ok(site.colors.primary) ? { "--primary": hexToHsl(site.colors.primary), "--ring": hexToHsl(site.colors.primary) } : {}),
    ...(ok(site.colors.accent) ? { "--accent": hexToHsl(site.colors.accent) } : {}),
    "--site-dark": ok(site.colors.dark) ? hexToHsl(site.colors.dark) : "20 14% 11%",
  } as CSSProperties;
}

function Frame({ children }: { children: ReactNode }) {
  const style = useSiteColours();
  const site = useSite();
  return (
    <div className="min-h-screen bg-background text-foreground" style={style}>
      {site.shop?.announcement && <div className="bg-primary px-4 py-1.5 text-center text-xs font-medium text-primary-foreground">{site.shop.announcement}</div>}
      <TopBar />
      <Header />
      <main>{children}</main>
      <Footer />
    </div>
  );
}

export default function ShopLayout({ children }: { children: ReactNode }) {
  // The company's live-chat bubble (it only appears when chat is switched on).
  useEffect(() => {
    if (document.querySelector('script[data-dash-chat]')) return;
    const s = document.createElement("script");
    s.src = "/chat.js"; s.async = true; s.dataset.dashChat = "1";
    document.body.appendChild(s);
  }, []);
  // Each page view counts as a website visit (CRM → Visits). The first one carries the referrer and campaign.
  const { pathname } = useLocation();
  const firstView = useRef(true);
  useEffect(() => {
    const vid = visitorId();
    if (!vid) return;
    const q = new URLSearchParams(window.location.search);
    const first = firstView.current; firstView.current = false;
    const t = setTimeout(() => {
      void shopApi("visit", {
        vid, path: pathname, title: document.title,
        ref: first && document.referrer && !document.referrer.startsWith(window.location.origin) ? document.referrer : null,
        utm_source: q.get("utm_source"), utm_medium: q.get("utm_medium"), utm_campaign: q.get("utm_campaign"),
      }).catch(() => undefined);
    }, 600);
    return () => clearTimeout(t);
  }, [pathname]);
  return <CartProvider><Frame>{children}</Frame></CartProvider>;
}

/** Banner with breadcrumbs for the website's inner pages (About, Services, Shop, Contact …). */
export function PageBanner({ title, subtitle, crumbs }: { title: string; subtitle?: string; crumbs: { label: string; to?: string }[] }) {
  return (
    <section className="relative overflow-hidden border-b border-border bg-[linear-gradient(120deg,hsl(var(--primary)/0.12),hsl(var(--background))_55%,hsl(var(--accent)/0.12))]">
      <BrandIcon aria-hidden className="ft-float absolute -right-6 -top-6 h-40 w-40 rotate-12 text-primary/10" />
      <div className="relative mx-auto max-w-7xl px-4 py-10 sm:py-14" data-reveal>
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/" className="hover:text-primary">Home</Link>
          {crumbs.map((c, i) => <span key={i} className="flex items-center gap-1.5"><span className="opacity-50">/</span>{c.to ? <Link to={c.to} className="hover:text-primary">{c.label}</Link> : <span className="font-medium text-foreground">{c.label}</span>}</span>)}
        </nav>
        <h1 className="mt-3 font-display text-3xl font-extrabold sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-muted-foreground">{subtitle}</p>}
      </div>
    </section>
  );
}
