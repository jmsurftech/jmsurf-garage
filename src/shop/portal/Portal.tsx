import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import {
  LayoutDashboard, ShoppingBag, FileText, ScrollText, Wallet, FileMinus, Tag, Shapes as BrandIcon, UserCog, ShieldCheck, LogOut, Store, Menu, X,
  Truck, CheckCircle2, Clock, Package, CreditCard, AlertTriangle, Printer, RefreshCw, Bell, ChevronRight, Smartphone, KeyRound, Sun, Moon, Repeat,
  FileSignature, MessagesSquare, FolderOpen, FolderKanban, Eye, Download, Paperclip, Send, XCircle, Receipt, Flag,
} from "lucide-react";
import { toast } from "sonner";
import { shopApi, getCustomerToken, setCustomerToken, useSite, useCart, CartProvider } from "../shopData";
import PageHead from "@/components/PageHead";
import PoweredBy from "@/components/PoweredBy";
import { BrandOrb } from "@/components/Orb";
import { useTheme } from "@/hooks/useTheme";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { cn } from "@/lib/utils";
import { PasswordInput } from "@/components/PasswordInput";
import { Modal, Field, Pill } from "@/components/kit";
import { erpApi } from "@/lib/erpApi";
import { loadDocModel, memoryDocClient, type DocumentKind } from "@/lib/docModels";
import { buildDocPdf } from "@/lib/doc-pdf";
import { DocPaper } from "@/components/print/doc-paper";
import { PRINT_CSS, printDocSheet } from "@/components/print/document-pdf-view";
import { PagedRows } from "@/components/Pager";

type Me = any;
type Api = <T = any>(route: string, body?: Record<string, unknown>) => Promise<T>;

/**
 * The customer portal (/account) and staff's read-only "View as customer" (/customers/:id/portal-view).
 * Customers reach only their own records: every call goes to the server with their session
 * (shop.js / portal.js), never to the database.
 */
const PortalCtx = createContext<{ api: Api; preview: boolean; base: string; ccy: string }>({ api: async () => ({}) as any, preview: false, base: "/account", ccy: "KES" });
const usePortal = () => useContext(PortalCtx);

const SECTIONS = [
  ["", "Home", LayoutDashboard], ["quotes", "Quotes", FileSignature], ["invoices", "Invoices", FileText], ["payments", "Payments", Wallet],
  ["statement", "Statement", ScrollText], ["credit", "Credit notes", FileMinus], ["messages", "Messages", MessagesSquare], ["documents", "Documents", FolderOpen],
  ["projects", "Projects", FolderKanban], ["orders", "My orders", ShoppingBag], ["offers", "Offers", Tag], ["pets", "Reminders", BrandIcon],
  ["profile", "My details", UserCog], ["security", "Security", ShieldCheck],
] as const;
type SectionKey = (typeof SECTIONS)[number][0];
/** Section → the company's switch for it (System → Customer portal). */
const SWITCH: Partial<Record<SectionKey, string>> = { quotes: "quotes", messages: "messages", documents: "documents", projects: "projects", orders: "orders", offers: "offers", pets: "reminders" };

const day = (d: string) => new Date(String(d).length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const STEPS = [["pending_payment", "Placed"], ["paid", "Paid"], ["processing", "Preparing"], ["ready", "Ready / packed"], ["out_for_delivery", "On the way"], ["delivered", "Delivered"]] as const;
let CCY = "KES";
/** Money in the company's currency. */
const kes = (n: number) => `${CCY} ${(Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function Portal({ preview }: { preview?: { customerId: string } }) {
  return <CartProvider><PortalInner preview={preview} /></CartProvider>;
}

function PortalInner({ preview }: { preview?: { customerId: string } }) {
  const { section = "" } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const site = useSite();
  const { count } = useCart();
  const [token] = useState(preview ? null : getCustomerToken());
  const [menu, setMenu] = useState(false);
  const { darkMode, toggleDarkMode } = useTheme();
  const isPreview = !!preview;
  const base = isPreview ? location.pathname.slice(0, location.pathname.indexOf("/portal-view") + "/portal-view".length) : "/account";
  const api: Api = useMemo(() => (isPreview
    ? (route, body = {}) => erpApi("portal/preview", { customer_id: preview!.customerId, route, body })
    : (route, body = {}) => shopApi(`c/${route}`, body, token)) as Api, [isPreview, preview?.customerId, token]);

  const signOut = async () => { try { await shopApi("c/logout", {}, token); } catch { /* signed out anyway */ } setCustomerToken(null); qc.removeQueries({ queryKey: ["portal-me"] }); navigate("/login", { replace: true }); };
  const { data: me, isLoading, isFetching, refetch, dataUpdatedAt, error } = useQuery({
    queryKey: ["portal-me", token, preview?.customerId],
    enabled: !!token || isPreview,
    // Live: refreshed every 15 seconds and whenever the tab is opened again.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: (n, e: any) => e?.status !== 403 && n < 2,
    queryFn: async () => {
      try { return await api<Me>("me"); }
      catch (e: any) { if (e.status === 401 && !isPreview) { setTimeout(() => { setCustomerToken(null); navigate("/login", { replace: true }); }, 0); return null; } throw e; }
    },
  });
  if (!token && !isPreview) return <Navigate to="/login?next=/account" replace />;
  if (error && !me) return <div className="flex h-screen items-center justify-center p-6"><div className="max-w-sm rounded-2xl border border-border bg-card p-6 text-center"><AlertTriangle className="mx-auto h-8 w-8 text-warning" /><p className="mt-2 font-semibold">{(error as Error).message}</p>{!isPreview && <button onClick={signOut} className="mt-4 text-sm font-semibold text-primary">Sign out</button>}</div></div>;
  if (isLoading || !me) return <div className="flex h-screen items-center justify-center"><OrbLoader label="Opening your account…" /></div>;
  CCY = me.currency || me.shop?.currency || "KES";
  const sections = me.sections || {};
  const visible = SECTIONS.filter(([k]) => (!SWITCH[k] || sections[SWITCH[k]!] !== false) && !(isPreview && k === "security"));
  const current = visible.find(([k]) => k === section) || visible[0];
  const c = me.customer || {};
  const shopName = me.shop?.name || site.shop?.name || "JMSURF Garage";
  const logo = me.shop?.logo_url || site.shop?.logo_url;
  const dueCount = (me.invoices || []).filter((i: any) => i.overdue).length;
  const badge: Partial<Record<SectionKey, number>> = { invoices: dueCount, quotes: (me.open_quotes || []).length, messages: me.unread_messages || 0 };
  const href = (k: string) => `${base}${k ? `/${k}` : ""}`;

  const groups: [string, SectionKey[]][] = [
    ["Account", ["", "quotes", "projects"]], ["Money", ["invoices", "payments", "statement", "credit"]],
    ["Talk to us", ["messages", "documents"]], ["Shopping", ["orders", "offers", "pets"]], ["Settings", ["profile", "security"]],
  ];
  const Nav = (
    <nav className="space-y-4">
      {groups.map(([title, keys]) => {
        const items = visible.filter(([k]) => keys.includes(k));
        if (!items.length) return null;
        return (
          <div key={title}>
            <p className="flex items-center gap-2 px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">{title}<span className="h-px flex-1 bg-border" /></p>
            <div className="space-y-1">{items.map(([k, label, Icon]) => (
              <NavLink key={k} to={href(k)} end onClick={() => setMenu(false)}
                className={({ isActive }) => cn("group flex items-center gap-3 rounded-2xl px-2 py-1.5 text-[15px] font-semibold transition-all", isActive ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25" : "text-foreground/80 hover:bg-primary hover:text-primary-foreground")}>
                {({ isActive }) => <>
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-[10px]", isActive ? "bg-white/20" : "bg-muted group-hover:bg-white/20")}><Icon className="h-[18px] w-[18px]" /></span>
                  <span className="flex-1">{label}</span>
                  {!!badge[k] && <span className={cn("rounded-full px-1.5 text-[11px] font-bold text-white", k === "invoices" ? "bg-destructive" : "bg-primary")}>{badge[k]}</span>}
                </>}
              </NavLink>
            ))}</div>
          </div>
        );
      })}
    </nav>
  );

  const ctx = { api, preview: isPreview, base, ccy: CCY };
  return (
    <PortalCtx.Provider value={ctx}>
      <div className="glass-shell flex min-h-screen bg-muted/30">
        <PageHead title={`${current[1]} · ${shopName}`} description="Your account" path="/account" noindex />
        {menu && <div className="fixed inset-0 z-40 bg-foreground/30 lg:hidden" onClick={() => setMenu(false)} />}
        <aside className={cn("glass-side glass-float fixed inset-y-0 left-0 z-50 flex w-[290px] flex-col border-r border-border bg-card p-4 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0", menu ? "translate-x-0 shadow-2xl" : "-translate-x-full")}>
          <div className="relative mb-5 overflow-hidden rounded-3xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(var(--primary)/0.85)_55%,hsl(var(--accent)))] p-4 text-primary-foreground shadow-lg shadow-primary/20">
            <BrandOrb state="breathing" size={150} tint="#ffffff" className="absolute -right-10 -top-10 opacity-30" />
            <div className="relative flex items-center gap-2.5">
              {logo ? <img src={logo} alt="" className="h-10 w-10 rounded-xl bg-white object-contain p-1" /> : <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20"><BrandIcon className="h-5 w-5" /></span>}
              <p className="min-w-0 flex-1 truncate font-display font-bold">{shopName}</p>
              <button onClick={() => setMenu(false)} className="rounded-lg p-1.5 hover:bg-white/15 lg:hidden" aria-label="Close menu"><X className="h-5 w-5" /></button>
            </div>
            <div className="relative mt-4 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/25 font-display text-lg font-bold">{String(c.name || "?").charAt(0).toUpperCase()}</span>
              <span className="min-w-0"><span className="block truncate font-semibold">{c.name}</span><span className="block truncate text-xs opacity-80">{c.phone || c.email}</span></span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto pr-1">{Nav}</div>
          <div className="space-y-1 border-t border-border pt-3">
            <button onClick={toggleDarkMode} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-muted">{darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} {darkMode ? "Light mode" : "Dark mode"}</button>
            {!isPreview && sections.orders !== false && <Link to="/shop" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-muted"><Store className="h-4 w-4" /> Shop{count > 0 && <span className="ml-auto rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{count} in cart</span>}</Link>}
            {!isPreview && <button onClick={signOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-destructive hover:bg-destructive/10"><LogOut className="h-4 w-4" /> Sign out</button>}
            <div className="px-3 pt-2"><PoweredBy className="text-[10px]" /></div>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          {isPreview && (
            <div className="sticky top-0 z-40 flex flex-wrap items-center gap-2 bg-foreground px-4 py-2 text-sm text-background">
              <Eye className="h-4 w-4" /><span className="flex-1">Preview of {c.name}'s portal. Read-only: nothing is saved, sent or marked as read.</span>
              <Link to={base.replace(/\/portal-view$/, "")} className="rounded-full bg-background/15 px-3 py-1 font-semibold hover:bg-background/25">Close preview</Link>
            </div>
          )}
          <header className={cn("glass-bar sticky z-30 flex h-14 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur sm:px-6", isPreview ? "top-9" : "top-0")}>
            <button onClick={() => setMenu(true)} className="-ml-1 rounded-lg p-2 hover:bg-muted lg:hidden" aria-label="Menu"><Menu className="h-5 w-5" /></button>
            <h1 className="flex-1 truncate font-display text-lg font-bold">{current[1]}</h1>
            <button onClick={() => refetch()} className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex" title="Updates by itself every few seconds">
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} /> Live · {new Date(dataUpdatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </button>
            <button onClick={toggleDarkMode} className="rounded-full p-2 text-muted-foreground hover:bg-muted" aria-label={darkMode ? "Light mode" : "Dark mode"} title={darkMode ? "Light mode" : "Dark mode"}>{darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}</button>
            {!isPreview && sections.orders !== false && <Link to="/shop" className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground">Shop</Link>}
          </header>
          <main key={section} className="ft-page-in mx-auto max-w-6xl space-y-5 p-4 pb-28 sm:p-6">
            {c.approval_status === "pending" && <Banner icon={Clock} tone="info">Your account is waiting for approval. You can still shop and order.</Banner>}
            {c.approval_status === "info_requested" && <Banner icon={AlertTriangle} tone="warning">We need more details: <b>{c.info_request}</b> <Link to={href("profile")} className="font-semibold underline">Update my details</Link></Banner>}
            {!isPreview && me.account?.must_change_password && section !== "security" && <Banner icon={KeyRound} tone="warning">Please set your own password. <Link to={`${href("security")}?first=1`} className="font-semibold underline">Change password</Link></Banner>}
            {current[0] === "" && <Overview me={me} />}
            {current[0] === "quotes" && <Quotes me={me} />}
            {current[0] === "orders" && <Orders me={me} />}
            {current[0] === "invoices" && <Invoices me={me} />}
            {current[0] === "statement" && <Statement me={me} />}
            {current[0] === "payments" && <Payments me={me} />}
            {current[0] === "credit" && <Credits me={me} />}
            {current[0] === "messages" && <Messages me={me} onRead={() => refetch()} />}
            {current[0] === "documents" && <SharedDocs />}
            {current[0] === "projects" && <Projects />}
            {current[0] === "offers" && <Offers me={me} />}
            {current[0] === "pets" && <Pets me={me} />}
            {current[0] === "profile" && <Profile me={me} token={token} onSaved={() => refetch()} />}
            {current[0] === "security" && <Security me={me} token={token!} onSaved={() => refetch()} />}
            {section && !visible.some(([k]) => k === section) && <Navigate to={base} replace />}
          </main>
          {/* Phone tab bar */}
          <nav aria-label="My account" className="notch-nav lg-hide" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
            {([["", "Home", LayoutDashboard], ["invoices", "Invoices", FileText], [sections.quotes !== false ? "quotes" : "statement", sections.quotes !== false ? "Quotes" : "Statement", sections.quotes !== false ? FileSignature : ScrollText], [sections.messages !== false ? "messages" : "payments", sections.messages !== false ? "Messages" : "Payments", sections.messages !== false ? MessagesSquare : Wallet]] as const).map(([k, l, I]) => (
              <NavLink key={k} to={href(k)} end className={({ isActive }) => cn("notch-item", isActive && !menu && "is-active")}><span className="notch-ico"><I /></span><span>{l}</span></NavLink>
            ))}
            <button onClick={() => setMenu(true)} className={cn("notch-item border-0 bg-transparent", menu && "is-active")}><span className="notch-ico"><Menu /></span><span>More</span></button>
          </nav>
        </div>
      </div>
    </PortalCtx.Provider>
  );
}

function Banner({ icon: Icon, tone, children }: { icon: any; tone: "info" | "warning"; children: ReactNode }) {
  return <div className={cn("flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm", tone === "info" ? "border-info/30 bg-info/10" : "border-warning/30 bg-warning/10")}><Icon className="mt-0.5 h-4 w-4 shrink-0" /><div>{children}</div></div>;
}
function Card({ title, icon: Icon, action, children, className }: { title?: string; icon?: any; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border border-border bg-card", className)}>
      {title && <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5"><h2 className="flex items-center gap-2 font-display font-semibold">{Icon && <Icon className="h-4 w-4 text-primary" />}{title}</h2>{action}</div>}
      <div>{children}</div>
    </section>
  );
}
function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "primary" | "danger" | "success" }) {
  return <div data-reveal className={cn("rounded-2xl border bg-gradient-to-br p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg", tone === "danger" ? "border-destructive/20 from-destructive/10 to-card" : tone === "success" ? "border-success/20 from-success/10 to-card" : "border-primary/20 from-primary/10 to-card")}><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-1 font-display text-xl font-bold", tone === "danger" && "text-destructive", tone === "success" && "text-success", tone === "primary" && "text-primary")}>{value}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}
const Empty = ({ text }: { text: string }) => <p className="px-5 py-10 text-center text-sm text-muted-foreground">{text}</p>;
const PREVIEW_TIP = "Preview only";
const Btn = ({ onClick, children, primary, disabled, title }: { onClick?: () => void; children: ReactNode; primary?: boolean; disabled?: boolean; title?: string }) => (
  <button type="button" onClick={onClick} disabled={disabled} title={title} className={cn("inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold disabled:opacity-50", primary ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground")}>{children}</button>
);

/** Opens the invoice's Pay now page (M-Pesa or card): the same page as the link in invoice emails. */
function usePayNow() {
  const { api, preview } = usePortal();
  const [busy, setBusy] = useState<string | null>(null);
  const pay = async (invoiceId: string) => {
    if (preview) return;
    setBusy(invoiceId);
    const w = window.open("", "_blank");
    try {
      const { url } = await api<{ url: string }>("invoice/pay-link", { invoice_id: invoiceId });
      if (w) w.location.href = url; else window.location.href = url;
    } catch (e: any) { w?.close(); toast.error(e.message); }
    finally { setBusy(null); }
  };
  return { pay, busy, preview };
}

// ------------------------------------------------------------------ document viewer (same layout staff print)
function DocViewer({ kind, id, title, onClose }: { kind: DocumentKind; id: string; title: string; onClose: () => void }) {
  const { api, preview } = usePortal();
  const { data, error, isLoading } = useQuery({
    queryKey: ["portal-doc", kind, id, preview],
    queryFn: async () => {
      const b = await api<any>("doc", { kind, id });
      return loadDocModel(kind, id, { db: memoryDocClient(b.tables || {}, b.signed || {}), currency: b.currency });
    },
  });
  const [busy, setBusy] = useState(false);
  const pdf = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const bytes = await buildDocPdf(data.model);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = data.filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) { toast.error(e.message || "Could not make the PDF"); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="2xl" title={title} icon={FileText}
      footer={<><button onClick={printDocSheet} disabled={!data} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold disabled:opacity-50"><Printer className="h-4 w-4" /> Print</button>
        <button onClick={pdf} disabled={!data || busy} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? <OrbSpinner className="size-4" tint="#fff" /> : <Download className="h-4 w-4" />} Download PDF</button></>}>
      <style>{PRINT_CSS}</style>
      {error ? <p className="p-6 text-center text-sm text-muted-foreground">{(error as Error).message}</p>
        : isLoading || !data ? <OrbLoader label="Preparing the document…" />
          : <div className="zd-print-root rounded-lg bg-muted/50 p-1 sm:p-3"><DocPaper model={data.model} className="mx-auto max-w-[794px]" /></div>}
    </Modal>
  );
}

// ------------------------------------------------------------------ home
function Overview({ me }: { me: Me }) {
  const { base, preview } = usePortal();
  const { pay, busy } = usePayNow();
  const [doc, setDoc] = useState<{ kind: DocumentKind; id: string; title: string } | null>(null);
  const cr = me.credit || {};
  const sections = me.sections || {};
  const first = String(me.customer?.name || "").split(" ")[0];
  const open = (me.invoices || []).filter((i: any) => i.balance > 0);
  const due = [...open].sort((a: any, b: any) => String(a.due_date || a.issue_date).localeCompare(String(b.due_date || b.issue_date)));
  // Balance due, one line per currency (invoices carry the company currency unless they say otherwise).
  const byCcy = new Map<string, number>();
  for (const i of open) byCcy.set(i.currency || CCY, (byCcy.get(i.currency || CCY) || 0) + Number(i.balance));
  const overdue = open.filter((i: any) => i.overdue).reduce((a: number, i: any) => a + Number(i.balance), 0);
  const quotes = me.open_quotes || [];
  const payments = (me.payments || []).slice(0, 5);
  const orders = (me.orders || []).slice(0, 4);
  const max = Math.max(1, ...(me.monthly || []).map((m: any) => m.total));
  return (
    <>
      {doc && <DocViewer {...doc} onClose={() => setDoc(null)} />}
      <div className="relative overflow-hidden rounded-3xl bg-[linear-gradient(120deg,hsl(var(--primary)),hsl(var(--primary)/0.8)_60%,hsl(var(--accent)))] p-6 text-primary-foreground sm:p-8">
        <BrandOrb state="weaving" size={260} tint="#ffffff" className="absolute -right-12 -top-16 opacity-30" />
        <p className="relative text-sm opacity-85">{preview ? "Customer view" : "Welcome back"}</p>
        <h2 className="font-display text-3xl font-bold">{preview ? me.customer?.name : `Hi ${first || "there"}`}</h2>
        <div className="relative mt-5 grid gap-4 sm:grid-cols-3">
          <div><p className="text-xs opacity-80">Balance due</p>
            {byCcy.size === 0 ? <p className="font-display text-2xl font-bold">{kes(0)}</p>
              : [...byCcy.entries()].map(([c, v]) => <p key={c} className="font-display text-2xl font-bold">{c} {v.toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>)}
          </div>
          <div><p className="text-xs opacity-80">Overdue</p><p className="font-display text-2xl font-bold">{kes(overdue)}</p></div>
          <div className="flex items-end">{due[0] && <button onClick={() => void pay(due[0].id)} disabled={preview || busy === due[0].id} title={preview ? PREVIEW_TIP : undefined}
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 font-semibold text-primary shadow-lg disabled:opacity-60">{busy === due[0].id ? <OrbSpinner className="size-4" /> : <CreditCard className="h-4 w-4" />} Pay now</button>}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Invoices to pay" value={String(open.length)} hint={due[0]?.due_date ? `Next due ${day(due[0].due_date)}` : undefined} tone={overdue > 0 ? "danger" : "primary"} />
        {sections.quotes !== false ? <Stat label="Quotes to answer" value={String(quotes.length)} /> : <Stat label="Spent this year" value={kes(me.totals?.this_year || 0)} />}
        {sections.messages !== false ? <Stat label="New messages" value={String(me.unread_messages || 0)} /> : <Stat label="Credit limit" value={cr.limit ? kes(cr.limit) : "None"} />}
        <Stat label="Unused credit" value={kes(cr.unused_credit || 0)} tone="success" hint="From credit notes" />
      </div>
      {cr.limit > 0 && (
        <Card title="Credit used" icon={CreditCard}>
          <div className="p-5"><div className="h-3 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", cr.used / cr.limit > 0.9 ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.min(100, (cr.used / cr.limit) * 100)}%` }} /></div>
            <p className="mt-2 text-sm text-muted-foreground">{kes(cr.used)} used of {kes(cr.limit)} · {kes(cr.available)} available{cr.days ? ` · ${cr.days} days to pay` : ""}</p></div>
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Invoices to pay" icon={FileText} action={<Link to={`${base}/invoices`} className="text-sm font-semibold text-primary">All</Link>}>
          {due.length === 0 ? <Empty text="Nothing to pay. Thank you!" /> : <ul className="divide-y divide-border">{due.slice(0, 5).map((i: any) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <button onClick={() => setDoc({ kind: "invoice", id: i.id, title: `Invoice ${i.invoice_number}` })} className="min-w-0 flex-1 text-left"><b className="text-primary">{i.invoice_number}</b><span className={cn("block text-xs", i.overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>{i.due_date ? `${i.overdue ? "Overdue since" : "Due"} ${day(i.due_date)}` : "Due on receipt"}</span></button>
              <span className="font-display font-bold">{kes(i.balance)}</span>
              <Btn primary onClick={() => void pay(i.id)} disabled={preview || busy === i.id} title={preview ? PREVIEW_TIP : undefined}>Pay</Btn>
            </li>
          ))}</ul>}
        </Card>
        {sections.quotes !== false && (
          <Card title="Quotes to answer" icon={FileSignature} action={<Link to={`${base}/quotes`} className="text-sm font-semibold text-primary">All</Link>}>
            {quotes.length === 0 ? <Empty text="No quotes waiting for you." /> : <ul className="divide-y divide-border">{quotes.slice(0, 5).map((q: any) => (
              <li key={q.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <span className="min-w-0 flex-1"><b>{q.quote_number}</b><span className="block truncate text-xs text-muted-foreground">{q.subject || day(q.issue_date)}{q.valid_until ? ` · valid to ${day(q.valid_until)}` : ""}</span></span>
                <span className="font-display font-bold">{kes(Number(q.total))}</span>
                <Link to={`${base}/quotes`} className="rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">Answer</Link>
              </li>
            ))}</ul>}
          </Card>
        )}
        <Card title="Recent payments" icon={Wallet} action={<Link to={`${base}/payments`} className="text-sm font-semibold text-primary">All</Link>}>
          {payments.length === 0 ? <Empty text="No payments recorded yet." /> : <ul className="divide-y divide-border">{payments.map((p: any) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className="min-w-0 flex-1"><b>{p.payment_number || "Payment"}</b><span className="block text-xs capitalize text-muted-foreground">{day(p.payment_date)} · {String(p.method).replace(/_/g, " ")}</span></span>
              <span className="font-display font-bold text-success">{kes(Number(p.amount))}</span>
              <button onClick={() => setDoc({ kind: "payment", id: p.id, title: `Receipt ${p.payment_number || ""}` })} className="icon-btn" aria-label="Receipt" title="Receipt"><Receipt className="h-4 w-4" /></button>
            </li>
          ))}</ul>}
        </Card>
        {sections.orders !== false && orders.length > 0 && (
          <Card title="Recent orders" icon={ShoppingBag} action={<Link to={`${base}/orders`} className="text-sm font-semibold text-primary">All</Link>}>
            <ul className="divide-y divide-border">{orders.map((o: any) => (
              <li key={o.id} className="flex items-center gap-3 px-4 py-3 sm:px-5"><span className="flex-1"><b>{o.order_no}</b><span className="block text-xs text-muted-foreground">{day(o.created_at)}</span></span><span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{String(o.status).replace(/_/g, " ")}</span><span className="font-display font-bold">{kes(Number(o.total))}</span></li>
            ))}</ul>
          </Card>
        )}
      </div>
      {(me.monthly || []).some((m: any) => m.total > 0) && (
        <Card title="Your purchases, last 12 months" icon={Wallet}>
          <div className="flex h-40 items-end gap-1.5 p-5">{(me.monthly || []).map((m: any) => (
            <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${m.month}: ${kes(m.total)}`}><div className="w-full rounded-t-md bg-primary/80" style={{ height: `${(m.total / max) * 100}%`, minHeight: m.total ? 4 : 0 }} /><span className="text-[10px] text-muted-foreground">{new Date(`${m.month}-01`).toLocaleDateString("en-GB", { month: "short" })}</span></div>
          ))}</div>
        </Card>
      )}
      {sections.offers !== false && (me.offers || []).length > 0 && !preview && <Offers me={me} compact />}
    </>
  );
}

// ------------------------------------------------------------------ quotes
const QUOTE_TONE: Record<string, "info" | "success" | "danger" | "muted" | "primary"> = { sent: "info", accepted: "success", invoiced: "primary", declined: "danger", expired: "muted" };
const QUOTE_LABEL: Record<string, string> = { sent: "Waiting for you", accepted: "Accepted", invoiced: "Invoiced", declined: "Declined", expired: "Expired" };

function Quotes({ me }: { me: Me }) {
  const { api, preview } = usePortal();
  const qc = useQueryClient();
  const [view, setView] = useState<"open" | "all">("open");
  const [doc, setDoc] = useState<any>(null);
  const [answer, setAnswer] = useState<{ q: any; action: "accept" | "decline" } | null>(null);
  const { data, isLoading, refetch } = useQuery({ queryKey: ["portal-quotes", preview, me.customer?.id], queryFn: () => api<{ quotes: any[] }>("quotes"), refetchInterval: 30_000 });
  const all = data?.quotes || [];
  const list = all.filter((q) => view === "all" || q.can_answer);
  return (
    <>
      {doc && <DocViewer kind="quote" id={doc.id} title={`Quote ${doc.quote_number}`} onClose={() => setDoc(null)} />}
      {answer && <QuoteAnswer q={answer.q} action={answer.action} me={me} onClose={() => setAnswer(null)} onDone={() => { setAnswer(null); void refetch(); void qc.invalidateQueries({ queryKey: ["portal-me"] }); }} />}
      <div className="flex gap-1 rounded-xl bg-muted p-1 sm:w-fit">{([["open", "To answer"], ["all", "All quotes"]] as const).map(([v, l]) => <button key={v} onClick={() => setView(v)} className={cn("flex-1 rounded-lg px-4 py-1.5 text-sm", view === v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{l}</button>)}</div>
      <Card>
        {isLoading ? <OrbLoader label="Loading quotes…" /> : list.length === 0 ? <Empty text={view === "open" ? "No quotes waiting for you." : "No quotes yet."} /> : <ul className="divide-y divide-border"><PagedRows rows={list} list>{(rows) => rows.map((q: any) => (
          <li key={q.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <button onClick={() => setDoc(q)} className="min-w-0 flex-1 text-left">
              <b className="text-primary">{q.quote_number}</b> <span className="text-sm text-muted-foreground">· {day(q.issue_date)}</span>
              <span className="block truncate text-xs text-muted-foreground">{q.subject || (q.salesperson_name ? `From ${q.salesperson_name}` : "")}{q.valid_until ? ` · valid to ${day(q.valid_until)}` : ""}</span>
              {q.customer_signed_name && <span className="block text-xs text-success">Accepted by {q.customer_signed_name}{q.customer_responded_at ? ` on ${day(q.customer_responded_at)}` : ""}</span>}
              {q.decline_reason && <span className="block text-xs text-destructive">Declined: {q.decline_reason}</span>}
            </button>
            <Pill tone={QUOTE_TONE[q.status] || "muted"}>{QUOTE_LABEL[q.status] || q.status}</Pill>
            <span className="font-display font-bold">{kes(Number(q.total))}</span>
            <span className="flex gap-1.5">
              <Btn onClick={() => setDoc(q)}><Eye className="h-4 w-4" /> View</Btn>
              {q.can_answer && <>
                <Btn primary onClick={() => setAnswer({ q, action: "accept" })} disabled={preview} title={preview ? PREVIEW_TIP : undefined}><CheckCircle2 className="h-4 w-4" /> Accept</Btn>
                <Btn onClick={() => setAnswer({ q, action: "decline" })} disabled={preview} title={preview ? PREVIEW_TIP : undefined}><XCircle className="h-4 w-4" /> Decline</Btn>
              </>}
            </span>
          </li>
        ))}</PagedRows></ul>}
      </Card>
    </>
  );
}

function QuoteAnswer({ q, action, me, onClose, onDone }: { q: any; action: "accept" | "decline"; me: Me; onClose: () => void; onDone: () => void }) {
  const { api } = usePortal();
  const [name, setName] = useState(String(me.customer?.name || ""));
  const [text, setText] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const accept = action === "accept";
  const send = async () => {
    setBusy(true); setErr("");
    try {
      await api("quote/respond", accept ? { id: q.id, action, name, comment: text } : { id: q.id, action, reason: text });
      toast.success(accept ? `Quote ${q.quote_number} accepted. Thank you!` : `Quote ${q.quote_number} declined`);
      onDone();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const ok = accept ? name.trim().length >= 3 && agree : text.trim().length > 0;
  return (
    <Modal open center onClose={onClose} locked={busy} icon={accept ? FileSignature : XCircle} title={accept ? `Accept quote ${q.quote_number}` : `Decline quote ${q.quote_number}`} description={`${kes(Number(q.total))}${q.valid_until ? ` · valid to ${day(q.valid_until)}` : ""}`}
      footer={<><button onClick={onClose} className="h-10 rounded-xl px-4 text-sm font-semibold hover:bg-muted">Cancel</button><button onClick={send} disabled={!ok || busy} className={cn("inline-flex h-10 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white disabled:opacity-50", accept ? "bg-success" : "bg-destructive")}>{busy && <OrbSpinner className="size-4" tint="#fff" />}{accept ? "Accept and sign" : "Decline quote"}</button></>}>
      <div className="space-y-3">
        {accept ? <>
          <Field label="Type your full name to sign" required hint="Your typed name is your signature on this quote."><input className="fi font-display text-lg italic" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <Field label="Comment (optional)"><textarea className="fi" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Delivery date, contact person…" /></Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I accept this quote, its prices and its terms.</label>
        </> : <Field label="Why are you declining?" required hint="This helps us send you a better offer."><textarea className="fi" rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus /></Field>}
        {err && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ orders (unchanged)
function Orders({ me }: { me: Me }) {
  const { preview } = usePortal();
  const [open, setOpen] = useState<string | null>(null);
  const { add } = useCart();
  const navigate = useNavigate();
  const again = (items: any[]) => { let n = 0; for (const it of items || []) if (it.product_id || it.id) { add(it.product_id || it.id, Number(it.quantity) || 1); n++; } if (n) navigate("/cart"); };
  const orders = me.orders || [];
  return (
    <div className="space-y-5">
      <Card title="Online orders" icon={ShoppingBag}>
        {orders.length === 0 ? <Empty text="You have not ordered online yet." /> : <ul className="divide-y divide-border"><PagedRows rows={orders} list>{(pageRows) => pageRows.map((o: any) => {
          const idx = o.status === "completed" ? STEPS.length - 1 : STEPS.findIndex(([k]) => k === o.status);
          const steps = (o.delivery_method === "pickup" ? STEPS.filter(([k]) => k !== "out_for_delivery") : [...STEPS])
            .map(([k, l]): [string, string] => [k, o.delivery_method === "pickup" && k === "delivered" ? "Collected" : l]);
          const at = o.status === "completed" ? steps.length - 1 : steps.findIndex(([k]) => k === o.status);
          return (
            <li key={o.id} className="px-4 py-4 sm:px-5">
              <button onClick={() => setOpen(open === o.id ? null : o.id)} className="flex w-full items-center gap-3 text-left">
                <span className="flex-1"><b>{o.order_no}</b> <span className="text-sm text-muted-foreground">· {day(o.created_at)} · {o.delivery_method === "delivery" ? "Delivery" : "Pickup"}</span></span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold capitalize", o.status === "cancelled" ? "bg-destructive/10 text-destructive" : idx >= 5 ? "bg-success/10 text-success" : "bg-info/10 text-info")}>{String(o.status).replace(/_/g, " ")}</span>
                <span className="font-display font-bold">{kes(Number(o.total))}</span><ChevronRight className={cn("h-4 w-4 transition-transform", open === o.id && "rotate-90")} />
              </button>
              {o.status !== "cancelled" && (
                <ol className="mt-4 flex items-center">{steps.map(([k, l], i) => (
                  <li key={k} className="flex flex-1 flex-col items-center gap-1 text-center">
                    <div className="flex w-full items-center"><span className={cn("h-0.5 flex-1", i === 0 ? "opacity-0" : i <= at ? "bg-primary" : "bg-border")} /><span className={cn("flex h-7 w-7 items-center justify-center rounded-full border-2", i <= at ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground")}>{i < at ? <CheckCircle2 className="h-4 w-4" /> : i === at ? (k === "out_for_delivery" ? <Truck className="h-3.5 w-3.5" /> : <Package className="h-3.5 w-3.5" />) : <span className="text-[10px]">{i + 1}</span>}</span><span className={cn("h-0.5 flex-1", i === steps.length - 1 ? "opacity-0" : i < at ? "bg-primary" : "bg-border")} /></div>
                    <span className={cn("text-[10px] sm:text-xs", i <= at ? "font-semibold" : "text-muted-foreground")}>{l}</span>
                  </li>
                ))}</ol>
              )}
              {open === o.id && !preview && <button onClick={() => again((o.items || []).filter((x: any) => x.product_id))} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary"><Repeat className="h-4 w-4" /> Buy again</button>}
              {open === o.id && <ul className="mt-3 space-y-1 rounded-xl bg-muted/50 p-3 text-sm">{(o.items || []).map((it: any, n: number) => <li key={n} className="flex justify-between"><span>{it.quantity} × {it.name}</span><span>{kes(Number(it.price) * Number(it.quantity))}</span></li>)}{o.address && <li className="pt-1 text-xs text-muted-foreground">Deliver to: {o.address}</li>}</ul>}
            </li>
          );
        })}</PagedRows></ul>}
      </Card>
      <Card title="Shop purchases" icon={Store}>
        {(me.purchases || []).length === 0 ? <Empty text="No purchases yet." /> : <ul className="divide-y divide-border">{me.purchases.slice(0, 50).map((p: any) => (
          <li key={p.id} className="px-4 py-3 text-sm sm:px-5"><div className="flex justify-between"><b>{day(p.date)}</b><b>{kes(p.total)}</b></div><p className="truncate text-xs text-muted-foreground">{p.items.map((i: any) => `${i.quantity}× ${i.name}`).join(", ")} · {String(p.payment_method).replace(/_/g, " ")}</p></li>
        ))}</ul>}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ invoices
function Invoices({ me }: { me: Me }) {
  const { api, preview } = usePortal();
  const { pay: payNow, busy } = usePayNow();
  const [params] = useSearchParams();
  const [view, setView] = useState<"due" | "all">(params.get("view") === "all" ? "all" : "due");
  const [pay, setPay] = useState<any>(null);
  const [doc, setDoc] = useState<any>(null);
  const [f, setF] = useState({ amount: "", reference: "" });
  const [state, setState] = useState("");
  const shop = me.shop || {};
  const list = (me.invoices || []).filter((i: any) => view === "all" || i.balance > 0);
  const claim = async () => {
    setState("sending");
    try { await api("pay-claim", { invoice_id: pay.id, amount: Number(f.amount), reference: f.reference }); setState("sent"); }
    catch (e: any) { setState(e.message); }
  };
  return (
    <>
      {doc && <DocViewer kind="invoice" id={doc.id} title={`Invoice ${doc.invoice_number}`} onClose={() => setDoc(null)} />}
      <div className="flex gap-1 rounded-xl bg-muted p-1 sm:w-fit">{([["due", "To pay"], ["all", "All invoices"]] as const).map(([v, l]) => <button key={v} onClick={() => setView(v)} className={cn("flex-1 rounded-lg px-4 py-1.5 text-sm", view === v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{l}</button>)}</div>
      <Card>
        {list.length === 0 ? <Empty text={view === "due" ? "Nothing to pay. Thank you!" : "No invoices yet."} /> : <ul className="divide-y divide-border"><PagedRows rows={list} list>{(pageRows) => pageRows.map((i: any) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <button onClick={() => setDoc(i)} className="min-w-0 flex-1 text-left"><b className="text-primary">{i.invoice_number}</b> <span className="text-sm text-muted-foreground">· {day(i.issue_date)}</span><span className={cn("block text-xs", i.overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>{i.balance <= 0 ? "Paid" : i.due_date ? `${i.overdue ? "Overdue since" : "Due"} ${day(i.due_date)}` : "Due on receipt"} · total {kes(Number(i.total))}</span></button>
            <span className="font-display font-bold">{kes(i.balance)}</span>
            <span className="flex gap-1.5">
              <Btn onClick={() => setDoc(i)}><Eye className="h-4 w-4" /> View</Btn>
              {i.balance > 0 && <Btn primary onClick={() => { setPay(i); setF({ amount: String(i.balance), reference: "" }); setState(""); }} disabled={preview} title={preview ? PREVIEW_TIP : undefined}>Pay</Btn>}
            </span>
          </li>
        ))}</PagedRows></ul>}
      </Card>
      {pay && (
        <Modal open center onClose={() => setPay(null)} icon={CreditCard} title={`Pay ${pay.invoice_number}`} description={`Balance ${kes(pay.balance)}`}>
          <div className="space-y-4">
            <button onClick={() => void payNow(pay.id)} disabled={busy === pay.id} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary font-semibold text-primary-foreground disabled:opacity-50">{busy === pay.id ? <OrbSpinner className="size-4" tint="#fff" /> : <Smartphone className="h-4 w-4" />} Pay now by M-Pesa or card</button>
            <p className="text-center text-xs text-muted-foreground">Opens the secure payment page for this invoice. Your balance updates by itself once paid.</p>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Or pay yourself</p>
            <div className="space-y-2 rounded-2xl bg-muted/60 p-4 text-sm">
              {shop.till && <p className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-primary" /> M-Pesa <b>Buy Goods, Till {shop.till}</b></p>}
              {shop.paybill && <p className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-primary" /> M-Pesa <b>Paybill {shop.paybill}</b>, account <b>{pay.invoice_number}</b></p>}
              {shop.bank_details && <p className="whitespace-pre-line"><b>Bank:</b> {shop.bank_details}</p>}
              {!shop.till && !shop.paybill && !shop.bank_details && <p>Call {shop.phone || "us"} for payment details.</p>}
            </div>
            <p className="text-sm font-semibold">Paid that way? Tell us and we will update your account.</p>
            <div className="grid grid-cols-2 gap-2"><input className="fi" type="number" placeholder="Amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /><input className="fi" placeholder="M-Pesa or bank ref." value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value.toUpperCase() })} /></div>
            {state === "sent" ? <p className="rounded-xl bg-success/10 p-3 text-sm text-success">Thank you! We will confirm it and your balance updates here.</p>
              : state && state !== "sending" ? <p className="text-sm text-destructive">{state}</p> : null}
            <button onClick={claim} disabled={state === "sending" || state === "sent"} className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-primary font-semibold text-primary disabled:opacity-50">{state === "sending" && <OrbSpinner className="size-4" />} I have paid</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ------------------------------------------------------------------ statement
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function Statement({ me }: { me: Me }) {
  const { api, preview } = usePortal();
  const now = new Date();
  const [from, setFrom] = useState(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(iso(now));
  const { data: st, isLoading, refetch } = useQuery({
    queryKey: ["portal-statement", from, to, preview, me.synced_at?.slice(0, 16)],
    queryFn: () => api<any>("statement", { from, to }),
    refetchInterval: 30_000,
  });
  const shop = me.shop || {};
  const c = me.customer || {};
  const label = (k: string) => (k === "invoice" ? "Invoice" : k === "payment" ? "Payment" : "Credit note");
  const print = () => {
    if (!st) return;
    const w = window.open("", "_blank", "width=820,height=900");
    if (!w) return;
    const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[ch]);
    w.document.write(`<!doctype html><html><head><title>Statement ${esc(c.name)}</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#222}h1{color:#A8121B;margin:0}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:16px}th,td{padding:7px;border-bottom:1px solid #eee;text-align:left}.r{text-align:right}th{background:#faf6f2}</style></head><body>
      <div style="display:flex;justify-content:space-between"><div><b style="font-size:18px">${esc(shop.name)}</b><br>${esc(shop.address || "")}<br>${esc(shop.phone || "")} ${esc(shop.email || "")}</div><div style="text-align:right"><h1>STATEMENT</h1>${day(st.from)} – ${day(st.to)}</div></div>
      <p style="margin-top:20px"><b>${esc(c.name)}</b><br>${esc(c.phone || "")} ${esc(c.email || "")}</p>
      <table><thead><tr><th>Date</th><th>Transaction</th><th class="r">Charges</th><th class="r">Credits</th><th class="r">Balance</th></tr></thead><tbody>
      <tr><td></td><td><b>Opening balance</b></td><td></td><td></td><td class="r">${st.opening.toFixed(2)}</td></tr>
      ${st.lines.map((l: any) => `<tr><td>${day(l.date)}</td><td>${label(l.kind)} ${esc(l.ref)}<br><small>${esc(l.detail)}</small></td><td class="r">${l.debit ? l.debit.toFixed(2) : ""}</td><td class="r">${l.credit ? l.credit.toFixed(2) : ""}</td><td class="r">${l.balance.toFixed(2)}</td></tr>`).join("")}
      <tr><td></td><td><b>Closing balance</b></td><td class="r">${st.invoiced.toFixed(2)}</td><td class="r">${st.received.toFixed(2)}</td><td class="r"><b>${esc(CCY)} ${st.closing.toFixed(2)}</b></td></tr></tbody></table>
      <script>setTimeout(()=>print(),300)</script></body></html>`);
    w.document.close();
  };
  const csv = () => {
    if (!st) return;
    const q = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Date", "Transaction", "Reference", "Detail", "Charges", "Credits", "Balance"].join(","), ["", "Opening balance", "", "", "", "", st.opening.toFixed(2)].map(q).join(","),
      ...st.lines.map((l: any) => [l.date, label(l.kind), l.ref, l.detail, l.debit ? l.debit.toFixed(2) : "", l.credit ? l.credit.toFixed(2) : "", l.balance.toFixed(2)].map(q).join(",")),
      ["", "Closing balance", "", "", st.invoiced.toFixed(2), st.received.toFixed(2), st.closing.toFixed(2)].map(q).join(",")];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `statement-${from}-to-${to}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">From<input className="fi mt-1 w-40" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs text-muted-foreground">To<input className="fi mt-1 w-40" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {([["This month", 0], ["3 months", 2], ["This year", -1]] as const).map(([l, m]) => <button key={l} onClick={() => { setTo(iso(now)); setFrom(m === -1 ? `${now.getFullYear()}-01-01` : iso(new Date(now.getFullYear(), now.getMonth() - m, 1))); }} className="h-10 rounded-xl border border-border bg-card px-3 text-sm hover:border-primary">{l}</button>)}
        <span className="flex-1" />
        <button onClick={csv} disabled={!st} className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold"><Download className="h-4 w-4" /> CSV</button>
        <button onClick={print} disabled={!st} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"><Printer className="h-4 w-4" /> Print / PDF</button>
      </div>
      {isLoading || !st ? <OrbLoader label="Loading your statement…" /> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Opening balance" value={kes(st.opening)} /><Stat label="Charges" value={kes(st.invoiced)} /><Stat label="Payments and credits" value={kes(st.received)} tone="success" /><Stat label="Closing balance" value={kes(st.closing)} tone={st.closing > 0 ? "danger" : "success"} />
        </div>
        <Card title="Transactions" icon={ScrollText} action={<button onClick={() => refetch()} className="text-xs text-muted-foreground"><RefreshCw className="inline h-3.5 w-3.5" /> Refresh</button>}>
          {st.lines.length === 0 ? <Empty text="No transactions in this period." /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><th className="px-4 py-2">Date</th><th className="px-4 py-2">Transaction</th><th className="px-4 py-2 text-right">Charges</th><th className="px-4 py-2 text-right">Credits</th><th className="px-4 py-2 text-right">Balance</th></tr></thead>
              <tbody><PagedRows rows={st.lines} colSpan={5}>{(pageRows) => pageRows.map((l: any, n: number) => (
                <tr key={n} className="border-t border-border"><td className="whitespace-nowrap px-4 py-2.5">{day(l.date)}</td><td className="px-4 py-2.5">{label(l.kind)} <b>{l.ref}</b><span className="block text-xs text-muted-foreground">{l.detail}</span></td><td className="px-4 py-2.5 text-right tabular-nums">{l.debit ? kes(l.debit) : ""}</td><td className="px-4 py-2.5 text-right tabular-nums text-success">{l.credit ? kes(l.credit) : ""}</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums">{kes(l.balance)}</td></tr>
              ))}</PagedRows></tbody></table></div>
          )}
        </Card>
      </>}
    </>
  );
}

// ------------------------------------------------------------------ payments and credit notes
function Payments({ me }: { me: Me }) {
  const [doc, setDoc] = useState<any>(null);
  const list = me.payments || [];
  return (
    <>
      {doc && <DocViewer kind="payment" id={doc.id} title={`Receipt ${doc.payment_number || ""}`} onClose={() => setDoc(null)} />}
      <Card title="Payment history" icon={Wallet}>
        {list.length === 0 ? <Empty text="No payments recorded yet." /> : <ul className="divide-y divide-border"><PagedRows rows={list} list>{(pageRows) => pageRows.map((p: any) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-3 sm:px-5"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-success/10 text-success"><CheckCircle2 className="h-4 w-4" /></span><span className="min-w-0 flex-1"><b>{p.payment_number || "Payment"}</b><span className="block text-xs capitalize text-muted-foreground">{day(p.payment_date)} · {String(p.method).replace(/_/g, " ")}{p.reference ? ` · ${p.reference}` : ""}</span></span><span className="font-display font-bold text-success">{kes(Number(p.amount))}</span>
            <Btn onClick={() => setDoc(p)}><Receipt className="h-4 w-4" /> Receipt</Btn></li>
        ))}</PagedRows></ul>}
      </Card>
    </>
  );
}

function Credits({ me }: { me: Me }) {
  const [doc, setDoc] = useState<any>(null);
  const list = me.credit_notes || [];
  return (
    <>
      {doc && <DocViewer kind="credit_note" id={doc.id} title={`Credit note ${doc.credit_note_number}`} onClose={() => setDoc(null)} />}
      <Card title="Credit notes" icon={FileMinus}>
        {list.length === 0 ? <Empty text="No credit notes." /> : <ul className="divide-y divide-border"><PagedRows rows={list} list>{(pageRows) => pageRows.map((n: any) => {
          const left = Number(n.total) - Number(n.amount_applied) - Number(n.amount_refunded);
          return <li key={n.id} className="flex items-center gap-3 px-4 py-3 sm:px-5"><button onClick={() => setDoc(n)} className="min-w-0 flex-1 text-left"><b className="text-primary">{n.credit_note_number}</b><span className="block text-xs text-muted-foreground">{day(n.issue_date)} · {n.reason}</span></button><span className="text-right"><b className="block font-display">{kes(Number(n.total))}</b><span className="text-xs text-muted-foreground">{left > 0 ? `${kes(left)} unused` : "Used"}</span></span></li>;
        })}</PagedRows></ul>}
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ messages
function Messages({ me, onRead }: { me: Me; onRead: () => void }) {
  const { api, preview } = usePortal();
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["portal-messages", preview, me.customer?.id],
    queryFn: async () => { const r = await api<{ messages: any[] }>("messages"); if (!preview) onRead(); return r; },
    refetchInterval: 15_000,
  });
  const list = data?.messages || [];
  const open = async (m: any) => {
    const w = window.open("", "_blank");
    try { const r = await api<{ url: string }>("message/file", { id: m.id }); if (w) w.location.href = r.url; else window.location.href = r.url; }
    catch (e: any) { w?.close(); toast.error(e.message); }
  };
  const send = async () => {
    if (preview || (!body.trim() && !file)) return;
    if (file && file.size > 5 * 1024 * 1024) return toast.error("Files up to 5 MB");
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { body };
      if (file) payload.file = { name: file.name, type: file.type, data: await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(new Error("Could not read the file")); r.readAsDataURL(file); }) };
      await api("message/send", payload);
      setBody(""); setFile(null); void refetch();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  return (
    <Card title={`Messages with ${me.shop?.name || "us"}`} icon={MessagesSquare}>
      <div className="max-h-[60vh] min-h-[16rem] space-y-3 overflow-y-auto p-4 sm:p-5">
        {isLoading ? <OrbLoader label="Loading messages…" /> : list.length === 0 ? <Empty text="No messages yet. Ask us anything here." /> : list.map((m: any) => {
          const mine = m.sender === "customer";
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-sm", mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted")}>
                {!mine && <p className="mb-0.5 text-xs font-semibold opacity-80">{m.staff_name || me.shop?.name}</p>}
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                {m.attachment_name && <button onClick={() => void open(m)} className={cn("mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold", mine ? "bg-white/20" : "bg-card")}><Paperclip className="h-3.5 w-3.5" /> {m.attachment_name}</button>}
                <p className={cn("mt-1 text-[10px]", mine ? "text-primary-foreground/75" : "text-muted-foreground")}>{new Date(m.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{mine && m.read_by_staff_at ? " · Read" : ""}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-border p-3 sm:p-4">
        {file && <p className="mb-2 inline-flex items-center gap-2 rounded-lg bg-muted px-2 py-1 text-xs"><Paperclip className="h-3.5 w-3.5" /> {file.name}<button onClick={() => setFile(null)} aria-label="Remove file"><X className="h-3.5 w-3.5" /></button></p>}
        <div className="flex items-end gap-2">
          <button onClick={() => input.current?.click()} disabled={preview} className="rounded-xl border border-border p-2.5 text-muted-foreground hover:text-foreground disabled:opacity-50" aria-label="Attach a file" title="Attach a file (up to 5 MB)"><Paperclip className="h-4 w-4" /></button>
          <textarea className="fi min-h-[44px] flex-1" rows={2} disabled={preview} placeholder={preview ? PREVIEW_TIP : "Write a message…"} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send(); }} />
          <button onClick={() => void send()} disabled={preview || busy || (!body.trim() && !file)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50">{busy ? <OrbSpinner className="size-4" tint="#fff" /> : <Send className="h-4 w-4" />} Send</button>
        </div>
        <input ref={input} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.txt,.csv,.doc,.docx,.xls,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] || null); e.target.value = ""; }} />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ shared documents
function SharedDocs() {
  const { api, preview } = usePortal();
  const { data, isLoading } = useQuery({ queryKey: ["portal-documents", preview], queryFn: () => api<{ documents: any[] }>("documents") });
  const list = data?.documents || [];
  const open = async (d: any) => {
    const w = window.open("", "_blank");
    try { const r = await api<{ url: string }>("document/open", { id: d.id }); if (w) w.location.href = r.url; else window.location.href = r.url; }
    catch (e: any) { w?.close(); toast.error(e.message); }
  };
  const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  return (
    <Card title="Documents shared with you" icon={FolderOpen}>
      {isLoading ? <OrbLoader label="Loading documents…" /> : list.length === 0 ? <Empty text="No documents shared with you yet." /> : <ul className="divide-y divide-border">{list.map((d) => (
        <li key={d.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileText className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1"><b className="block truncate">{d.name}</b><span className="text-xs text-muted-foreground">{d.category || "Document"} · {day(d.shared_at || d.created_at)}{d.size_bytes ? ` · ${size(d.size_bytes)}` : ""}{d.expires_on ? ` · valid to ${day(d.expires_on)}` : ""}</span></span>
          <Btn onClick={() => void open(d)}><Download className="h-4 w-4" /> Open</Btn>
        </li>
      ))}</ul>}
    </Card>
  );
}

// ------------------------------------------------------------------ projects
function Projects() {
  const { api, preview } = usePortal();
  const { data, isLoading } = useQuery({ queryKey: ["portal-projects", preview], queryFn: () => api<{ projects: any[] }>("projects"), refetchInterval: 60_000 });
  const list = data?.projects || [];
  const t = todayIso();
  if (isLoading) return <OrbLoader label="Loading projects…" />;
  if (!list.length) return <Card><Empty text="No projects yet." /></Card>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">{list.map((p) => (
      <Card key={p.id}>
        <div className="space-y-3 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><FolderKanban className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1"><p className="font-display font-bold">{p.title}</p><p className="text-xs text-muted-foreground">{[p.number, p.starts_at ? `Started ${day(p.starts_at)}` : "", p.due_date ? `Due ${day(p.due_date)}` : ""].filter(Boolean).join(" · ")}</p></div>
            <Pill tone={p.stage === "completed" ? "success" : p.stage === "active" ? "info" : p.stage === "on_hold" ? "warning" : p.stage === "cancelled" ? "danger" : "muted"}>{p.stage_label}</Pill>
          </div>
          <div><div className="flex justify-between text-xs text-muted-foreground"><span>Progress</span><span>{p.tasks ? `${p.tasks_done} of ${p.tasks} tasks done` : ""} · {p.progress}%</span></div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${p.progress}%` }} /></div></div>
          {p.milestones?.length > 0 && <ul className="space-y-1.5 text-sm">{p.milestones.map((m: any, n: number) => (
            <li key={n} className="flex items-center gap-2">{m.reached ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Flag className={cn("h-4 w-4", m.due_date && m.due_date < t ? "text-destructive" : "text-muted-foreground")} />}<span className="flex-1">{m.title}</span>{m.due_date && <span className="text-xs text-muted-foreground">{day(m.due_date)}</span>}</li>
          ))}</ul>}
        </div>
      </Card>
    ))}</div>
  );
}

// ------------------------------------------------------------------ offers and reminders
function Offers({ me, compact }: { me: Me; compact?: boolean }) {
  const { base, preview } = usePortal();
  const { add } = useCart();
  const [added, setAdded] = useState<string | null>(null);
  const list = (me.offers || []).slice(0, compact ? 4 : 24);
  return (
    <Card title="Products on offer" icon={Tag} action={compact ? <Link to={`${base}/offers`} className="text-sm font-semibold text-primary">All offers</Link> : undefined}>
      {list.length === 0 ? <Empty text="No offers right now. Check back soon!" /> : (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4"><PagedRows rows={list} gridSpan>{(pageRows) => pageRows.map((o: any) => {
          const off = Math.round((1 - Number(o.price) / Number(o.compare_at_price)) * 100);
          return (
            <div key={o.id} className="overflow-hidden rounded-2xl border border-border">
              <Link to={preview ? "#" : `/shop/p/${o.id}`} className="relative block aspect-square bg-muted/50">{o.image_url ? <img src={o.image_url} alt="" className="h-full w-full object-cover" /> : <BrandIcon className="m-auto h-10 w-10 text-muted-foreground/40" />}<span className="absolute left-2 top-2 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-white">-{off}%</span></Link>
              <div className="p-3"><p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium">{o.name}</p><p className="font-display font-bold text-primary">{kes(Number(o.price))} <span className="text-xs font-normal text-muted-foreground line-through">{kes(Number(o.compare_at_price))}</span></p>
                <button disabled={preview} onClick={() => { add(o.id, 1); setAdded(o.id); setTimeout(() => setAdded(null), 1500); }} className="mt-2 w-full rounded-full bg-primary/10 py-1.5 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-50">{added === o.id ? "Added ✓" : "Add to cart"}</button></div>
            </div>
          );
        })}</PagedRows></div>
      )}
    </Card>
  );
}

function Pets({ me }: { me: Me }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="My reminders" icon={BrandIcon}>
        {(me.pets || []).length === 0 ? <Empty text="Reminders from the business appear here." /> : <ul className="divide-y divide-border">{me.pets.map((p: any) => <li key={p.id} className="px-4 py-3 sm:px-5"><b>{p.name}</b> <span className="text-sm capitalize text-muted-foreground">· {[p.species, p.breed].filter(Boolean).join(", ")}{p.birth_date ? ` · born ${day(p.birth_date)}` : ""}</span></li>)}</ul>}
      </Card>
      <Card title="Reminders" icon={Bell}>
        {(me.reminders || []).length === 0 ? <Empty text="No reminders yet." /> : <ul className="divide-y divide-border">{me.reminders.map((r: any) => <li key={r.id} className="flex justify-between px-4 py-3 text-sm sm:px-5"><span>{r.product_name}</span><span className="text-muted-foreground">{day(r.due_date)}</span></li>)}</ul>}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ my details
const FIELD_LABEL: Record<string, string> = { name: "Full name", phone: "Phone", email: "Email", alt_phone: "Other phone", company_name: "Company", kra_pin: "KRA PIN", address: "Address", area: "Area / estate", building: "Building / house no.", landmark: "Landmark" };
function Profile({ me, token, onSaved }: { me: Me; token: string | null; onSaved: () => void }) {
  const { preview } = usePortal();
  const c = me.customer || {};
  const [f, setF] = useState({ name: c.name || "", phone: c.phone || "", email: c.email || "", alt_phone: c.alt_phone || "", address: c.address || "", area: c.area || "", building: c.building || "", landmark: c.landmark || "", company_name: c.company_name || "", kra_pin: c.kra_pin || "" });
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (preview) return;
    setBusy(true);
    try {
      const r = await shopApi<any>("c/profile", f, token);
      setMsg({ ok: true, text: r.pending ? "Sent. Your changes show here once they are approved." : r.changed === false ? "Nothing changed" : "Saved" });
      onSaved();
    } catch (err: any) { setMsg({ text: err.message }); }
    finally { setBusy(false); }
  };
  const T = (k: keyof typeof f, l: string, type = "text") => <label className="block text-sm"><span className="mb-1 block font-medium">{l}</span><input className="fi" type={type} disabled={preview} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  const pending = me.pending_update;
  return (
    <div className="space-y-5">
      {pending && <Banner icon={Clock} tone="info">Waiting for approval since {day(pending.created_at)}: {Object.entries(pending.changes || {}).map(([k, v]) => `${FIELD_LABEL[k] || k}: ${v ?? "(removed)"}`).join(" · ")}</Banner>}
      <Card title="My details" icon={UserCog}>
        <form onSubmit={save} className="grid gap-4 p-5 sm:grid-cols-2">
          {T("name", "Full name")}{T("email", "Email (statements are sent here)", "email")}
          {T("phone", "Phone (you sign in with it)", "tel")}{T("alt_phone", "Other phone")}
          {T("company_name", "Company (optional)")}{T("kra_pin", "KRA PIN (for invoices)")}
          {T("address", "Address")}{T("area", "Area / estate")}{T("building", "Building / house no.")}{T("landmark", "Landmark")}
          {me.profile_review && <p className="text-xs text-muted-foreground sm:col-span-2">Changes are checked by our team before they apply.</p>}
          {msg && <p className={cn("text-sm sm:col-span-2", msg.ok ? "text-success" : "text-destructive")}>{msg.text}</p>}
          <div className="sm:col-span-2"><button disabled={preview || busy} title={preview ? PREVIEW_TIP : undefined} className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-semibold text-primary-foreground disabled:opacity-50">{busy && <OrbSpinner className="size-4" tint="#fff" />} Save details</button></div>
        </form>
      </Card>
    </div>
  );
}

function Security({ me, token, onSaved }: { me: Me; token: string; onSaved: () => void }) {
  const [params] = useSearchParams();
  const [pw, setPw] = useState({ password: "", new_password: "", confirm: "" });
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [mfa, setMfa] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [mfaMsg, setMfaMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [offPw, setOffPw] = useState("");
  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.new_password !== pw.confirm) return setMsg({ text: "The new passwords do not match" });
    try { await shopApi("c/profile", { password: pw.password, new_password: pw.new_password }, token); setMsg({ ok: true, text: "Password changed" }); setPw({ password: "", new_password: "", confirm: "" }); onSaved(); }
    catch (err: any) { setMsg({ text: err.message }); }
  };
  const startMfa = async () => {
    try { const r = await shopApi<any>("c/mfa/setup", {}, token); setMfa({ ...r, qr: await QRCode.toDataURL(r.uri, { margin: 1, width: 220 }) }); setMfaMsg(null); }
    catch (e: any) { setMfaMsg({ text: e.message }); }
  };
  const enable = async () => { try { await shopApi("c/mfa/enable", { code }, token); setMfa(null); setCode(""); setMfaMsg({ ok: true, text: "Two-step sign-in is on." }); onSaved(); } catch (e: any) { setMfaMsg({ text: e.message }); } };
  const disable = async () => { try { await shopApi("c/mfa/disable", { password: offPw }, token); setOffPw(""); setMfaMsg({ ok: true, text: "Two-step sign-in is off." }); onSaved(); } catch (e: any) { setMfaMsg({ text: e.message }); } };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title={params.get("first") ? "Set your own password" : "Change password"} icon={KeyRound}>
        <form onSubmit={changePw} className="space-y-3 p-5">
          <PasswordInput className="fi" required placeholder={me.account?.must_change_password ? "Password you were given" : "Current password"} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} />
          <PasswordInput className="fi" required minLength={6} placeholder="New password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
          <PasswordInput className="fi" required minLength={6} placeholder="Repeat the new password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          {msg && <p className={cn("text-sm", msg.ok ? "text-success" : "text-destructive")}>{msg.text}</p>}
          <button className="rounded-full bg-primary px-6 py-2.5 font-semibold text-primary-foreground">Change password</button>
          <p className="text-xs text-muted-foreground">Forgot it? Sign out and use “Forgot password” on the sign-in page.</p>
        </form>
      </Card>
      <Card title="Two-step sign-in (authenticator app)" icon={ShieldCheck}>
        <div className="space-y-3 p-5 text-sm">
          {me.account?.mfa_enabled ? <>
            <p className="flex items-center gap-2 font-semibold text-success"><CheckCircle2 className="h-4 w-4" /> On: you enter a code from your app when signing in.</p>
            <PasswordInput className="fi" placeholder="Your password to switch it off" value={offPw} onChange={(e) => setOffPw(e.target.value)} />
            <button onClick={disable} className="rounded-full border border-destructive px-5 py-2 font-semibold text-destructive">Turn off</button>
          </> : mfa ? <>
            <p>1. Scan this with Google Authenticator, Microsoft Authenticator or Authy.</p>
            <img src={mfa.qr} alt="Authenticator QR code" className="mx-auto h-44 w-44 rounded-xl border border-border bg-white p-2" />
            <p className="break-all text-center font-mono text-xs text-muted-foreground">{mfa.secret}</p>
            <p>2. Enter the 6-digit code it shows.</p>
            <div className="flex gap-2"><input className="fi text-center font-mono tracking-widest" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" /><button onClick={enable} className="rounded-xl bg-primary px-5 font-semibold text-primary-foreground">Turn on</button></div>
          </> : <>
            <p className="text-muted-foreground">Protect your account with a code from your phone each time you sign in.</p>
            <button onClick={startMfa} className="rounded-full bg-primary px-6 py-2.5 font-semibold text-primary-foreground">Set up</button>
          </>}
          {mfaMsg && <p className={cn(mfaMsg.ok ? "text-success" : "text-destructive")}>{mfaMsg.text}</p>}
        </div>
      </Card>
      <Card title="Sign-in" icon={Clock} className="lg:col-span-2"><p className="p-5 text-sm text-muted-foreground">Last signed in {me.account?.last_login_at ? new Date(me.account.last_login_at).toLocaleString("en-GB") : "—"}.</p></Card>
    </div>
  );
}
