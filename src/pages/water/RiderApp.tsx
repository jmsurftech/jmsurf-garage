import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bike, LayoutDashboard, Truck, PackageCheck, Map as MapIcon, Ticket, Settings, LogOut, RefreshCw, MapPin, Navigation,
  Wallet, Banknote, Smartphone, Droplets, Clock, Package, ArrowLeft, Store, KeyRound, User, Save, Eye, EyeOff, Phone, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, StatTile, StatGrid, PageLoader, EmptyState, Pill, Segmented, Field } from "@/components/kit";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import { tenantPath } from "@/lib/host";
import { cn } from "@/lib/utils";
import { PasswordInput } from "@/components/PasswordInput";
import { MultiMap, directionsUrl, distanceKm, useWatchPosition, type LatLng } from "@/components/maps/Maps";
import { ORDER_STATUS, type WaterOrder, useWaterOrders, orderPoint, itemsSummary } from "@/lib/waterOrders";
import { useOpenTicketCount } from "@/lib/tickets";
import { RiderOrder } from "@/pages/water/Rider";
import { MyTickets } from "@/pages/Tickets";
import NotificationBell from "@/components/NotificationBell";

export type RiderSection = "dashboard" | "orders" | "delivered" | "map" | "tickets" | "settings";

const NAV: { key: RiderSection; path: string; label: string; short: string; icon: any }[] = [
  { key: "dashboard", path: "/rider", label: "Dashboard", short: "Home", icon: LayoutDashboard },
  { key: "orders", path: "/rider/orders", label: "Assigned orders", short: "Orders", icon: Truck },
  { key: "delivered", path: "/rider/delivered", label: "Delivered orders", short: "Delivered", icon: PackageCheck },
  { key: "map", path: "/rider/map", label: "Map", short: "Map", icon: MapIcon },
  { key: "tickets", path: "/rider/tickets", label: "Tickets", short: "Tickets", icon: Ticket },
  { key: "settings", path: "/rider/settings", label: "Settings", short: "Account", icon: Settings },
];

const ACTIVE = ["assigned", "on_the_way", "delivered"];
const L = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} L`;
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** The rider's own app: dashboard, assigned and delivered orders, map, tickets and account. */
export default function RiderApp({ section }: { section: RiderSection }) {
  const { user, role, profile, signOut } = useAuth() as any;
  const { tenant } = useTenant() as any;
  const { slug } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const location = useLocation();
  const isRider = role === "rider";
  const go = (p: string) => tenantPath(slug, p);
  // Riders see their own orders; a manager opening this sees every rider's.
  const { data: orders = [], isLoading, refetch, isFetching } = useWaterOrders({ riderId: isRider ? user?.id : undefined });
  const { pos, error: gpsError } = useWatchPosition(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const tickets = useOpenTicketCount(true);
  useEffect(() => { setOpenId(null); }, [location.pathname]);

  const active = orders.filter((o) => ACTIVE.includes(o.status) && (isRider || o.rider_id));
  // While this rider has deliveries out, share the position so reception and
  // the customer can see where the water is (every 20 s at most).
  const posRef = useRef(pos);
  posRef.current = pos;
  const sharing = isRider && active.length > 0;
  useEffect(() => {
    if (!sharing) return;
    const send = () => {
      const p = posRef.current;
      if (p) (supabase as any).rpc("water_rider_ping", { p_lat: p.lat, p_lng: p.lng }).then(() => undefined, () => undefined);
    };
    send();
    const t = setInterval(send, 20_000);
    return () => clearInterval(t);
  }, [sharing]);

  const open = orders.find((o) => o.id === openId) || null;
  const name = profile?.display_name || "Rider";

  return (
    <div className="flex h-[100svh] overflow-hidden bg-background">
      {/* Sidebar (tablet / desktop) */}
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-16 items-center gap-3 px-4">
          {tenant?.logo_url
            ? <img src={tenant.logo_url} alt="" className="h-10 w-10 rounded-xl bg-white/95 object-contain p-1" />
            : <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><Bike className="h-5 w-5" /></span>}
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-sidebar-primary-foreground">{tenant?.business_name || "Deliveries"}</p>
            <p className="truncate text-[11px] text-sidebar-foreground/50">{name} · {isRider ? "rider" : String(role || "").replace("_", " ")}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {NAV.map((n) => {
            const on = section === n.key;
            const badge = n.key === "orders" ? active.length : n.key === "tickets" ? tickets : 0;
            return (
              <Link key={n.key} to={go(n.path)}
                className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  on ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}>
                <n.icon className="h-[19px] w-[19px] shrink-0" />
                <span className="flex-1 truncate">{n.label}</span>
                {badge > 0 && <span className="min-w-[20px] rounded-full bg-destructive px-1.5 text-center text-[11px] font-bold leading-5 text-destructive-foreground">{badge}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-sidebar-border px-3 py-3">
          {!isRider && (
            <Link to={go("/dashboard")} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent">
              <Store className="h-5 w-5" /> Back to the shop
            </Link>
          )}
          <button type="button" onClick={() => signOut?.()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent">
            <LogOut className="h-5 w-5" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card/95 px-3 backdrop-blur md:h-16 md:px-6">
          {!isRider && (
            <Link to={go("/dashboard")} className="rounded-lg p-2 hover:bg-muted md:hidden" aria-label="Back to the shop"><ArrowLeft className="h-5 w-5" /></Link>
          )}
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary md:hidden"><Bike className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[15px] font-semibold">{NAV.find((n) => n.key === section)?.label}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {sharing ? "Sharing your location with the shop and customers" : gpsError || (pos ? "Location on" : "Waiting for your location…")}
            </p>
          </div>
          <button type="button" className="rounded-lg p-2 hover:bg-muted" onClick={() => refetch()} aria-label="Refresh"><RefreshCw className={cn("h-5 w-5", isFetching && "animate-spin")} /></button>
          <NotificationBell makePath={go} />
          <button type="button" className="rounded-lg p-2 hover:bg-muted md:hidden" onClick={() => signOut?.()} aria-label="Sign out"><LogOut className="h-5 w-5" /></button>
        </header>

        <main className="flex-1 overflow-y-auto pb-28 md:pb-6">
          {isLoading ? <PageLoader label="Loading deliveries…" /> : open ? (
            <RiderOrder order={open} me={pos} onBack={() => setOpenId(null)} />
          ) : (
            <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
              {section === "dashboard" && <Dashboard orders={orders} active={active} me={pos} isRider={isRider} userId={user?.id} name={name} onOpen={setOpenId} go={(p) => nav(go(p))} />}
              {section === "orders" && <AssignedOrders active={active} me={pos} isRider={isRider} onOpen={setOpenId} />}
              {section === "delivered" && <Delivered orders={orders} isRider={isRider} userId={user?.id} />}
              {section === "map" && <RiderMap active={active} me={pos} onOpen={setOpenId} />}
              {section === "tickets" && (
                <>
                  <PageHeader title="Tickets" icon={Ticket} description="Problems with a delivery, a customer, your bike or a payment? Tell the shop here." />
                  <MyTickets compact />
                </>
              )}
              {section === "settings" && <RiderSettings />}
            </div>
          )}
        </main>

        {/* Bottom bar (phones) */}
        {!open && (
          <nav aria-label="Rider" className="hide-on-keyboard notch-nav md-hide" style={{ zIndex: 700, gridTemplateColumns: `repeat(${NAV.length}, minmax(0, 1fr))` }}>
              {NAV.map((n) => {
                const on = section === n.key;
                const badge = n.key === "orders" ? active.length : n.key === "tickets" ? tickets : 0;
                return (
                  <Link key={n.key} to={go(n.path)} aria-current={on ? "page" : undefined} className={cn("notch-item", on && "is-active")}>
                    <span className="notch-ico"><n.icon />{badge > 0 && <span className="notch-badge">{badge}</span>}</span>
                    <span>{n.short}</span>
                  </Link>
                );
              })}
          </nav>
        )}
      </div>
    </div>
  );
}

function OrderCard({ o, me, onOpen, showRider }: { o: WaterOrder; me: LatLng | null; onOpen: (id: string) => void; showRider?: boolean }) {
  const p = orderPoint(o);
  const km = p && me ? distanceKm(me, p) : null;
  return (
    <button type="button" onClick={() => onOpen(o.id)} className="block w-full rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/40 active:scale-[0.99]">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">#{o.order_no} · {o.customer_name}</p>
        <Pill tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Pill>
      </div>
      <p className="mt-1 text-sm">{itemsSummary(o)}</p>
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{o.landmark || o.address || "Pinned location"}{km != null && ` · ${km.toFixed(1)} km`}</p>
      {showRider && o.rider_name && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Bike className="h-3 w-3" />{o.rider_name}</p>}
      <div className="mt-2 flex items-center justify-between">
        <span className="font-display text-lg font-bold">{formatKES(o.total)}</span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">Open <ChevronRight className="h-3.5 w-3.5" /></span>
      </div>
    </button>
  );
}

function Dashboard({ orders, active, me, isRider, userId, name, onOpen, go }: {
  orders: WaterOrder[]; active: WaterOrder[]; me: LatLng | null; isRider: boolean; userId?: string; name: string;
  onOpen: (id: string) => void; go: (p: string) => void;
}) {
  const t0 = startOfDay();
  const week = Date.now() - 7 * 86400_000;
  const mine = (o: WaterOrder) => !isRider || o.rider_id === userId;
  const paid = orders.filter((o) => o.status === "paid" && o.paid_at && mine(o));
  const today = paid.filter((o) => new Date(o.paid_at!).getTime() >= t0);
  const thisWeek = paid.filter((o) => new Date(o.paid_at!).getTime() >= week);
  const cash = today.filter((o) => o.payment_method === "cash").reduce((a, o) => a + o.total, 0);
  const mpesa = today.filter((o) => o.payment_method === "mpesa").reduce((a, o) => a + o.total, 0);
  const minutes = thisWeek.filter((o) => o.assigned_at && o.delivered_at)
    .map((o) => (new Date(o.delivered_at!).getTime() - new Date(o.assigned_at!).getTime()) / 60000);
  const avg = minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : null;
  const next = useMemo(() => {
    const withPoint = active.filter((o) => orderPoint(o));
    if (!me || !withPoint.length) return active[0] || null;
    return [...withPoint].sort((a, b) => distanceKm(me, orderPoint(a)!) - distanceKm(me, orderPoint(b)!))[0];
  }, [active, me]);
  const stops = active.filter((o) => orderPoint(o)).map((o) => ({ id: o.id, at: orderPoint(o)!, label: String(o.order_no).slice(-2) }));
  const hour = new Date().getHours();

  return (
    <>
      <div>
        <p className="font-display text-2xl font-bold">{hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}, {name.split(" ")[0]}</p>
        <p className="text-sm text-muted-foreground">{active.length ? `You have ${active.length} deliver${active.length === 1 ? "y" : "ies"} to make.` : "No deliveries waiting. New ones appear here by themselves."}</p>
      </div>
      <StatGrid className="grid-cols-2 lg:grid-cols-4">
        <StatTile label="To deliver" value={active.length} hint={`${active.filter((o) => o.status === "on_the_way").length} on the way`} icon={Truck} tone={active.length ? "warning" : "success"} />
        <StatTile label="Delivered today" value={today.length} hint={L(today.reduce((a, o) => a + o.litres_total, 0))} icon={PackageCheck} tone="success" />
        <StatTile label="Collected today" value={formatKES(cash + mpesa)} hint={`Cash ${formatKES(cash)} · M-Pesa ${formatKES(mpesa)}`} icon={Wallet} tone="primary" />
        <StatTile label="This week" value={thisWeek.length} hint={avg != null ? `about ${avg} min per delivery` : "deliveries"} icon={Clock} tone="info" />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Next delivery" icon={Navigation}>
          {next ? (
            <div className="space-y-3">
              <OrderCard o={next} me={me} onOpen={onOpen} showRider={!isRider} />
              {orderPoint(next) && (
                <a href={directionsUrl(orderPoint(next)!)} target="_blank" rel="noopener noreferrer"
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground">
                  <Navigation className="h-4 w-4" /> Navigate{me ? ` · ${distanceKm(me, orderPoint(next)!).toFixed(1)} km` : ""}
                </a>
              )}
              {next.customer_phone && (
                <a href={`tel:${next.customer_phone}`} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border font-medium"><Phone className="h-4 w-4" /> Call {next.customer_name}</a>
              )}
            </div>
          ) : <p className="py-6 text-center text-sm text-muted-foreground"><Package className="mx-auto mb-2 h-8 w-8 opacity-40" />Nothing to deliver right now.</p>}
        </Panel>
        <Panel title="Your stops" icon={MapIcon} actions={<Button size="sm" variant="outline" onClick={() => go("/rider/map")}>Full map</Button>}>
          {stops.length || me ? <MultiMap stops={stops} me={me} onPick={onOpen} className="h-72" />
            : <p className="py-6 text-center text-sm text-muted-foreground">Allow location to see yourself and your stops on the map.</p>}
        </Panel>
      </div>

      {today.length > 0 && (
        <Panel title="Delivered today" icon={PackageCheck} flush>
          <ul className="divide-y divide-border text-sm">
            {today.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0 truncate">#{o.order_no} · {o.customer_name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {o.payment_method === "mpesa" ? <Smartphone className="h-3.5 w-3.5 text-success" /> : <Banknote className="h-3.5 w-3.5 text-success" />}
                  <span className="tabular-nums font-medium">{formatKES(o.total)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function AssignedOrders({ active, me, isRider, onOpen }: { active: WaterOrder[]; me: LatLng | null; isRider: boolean; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<"near" | "old">("near");
  const list = useMemo(() => {
    const l = [...active];
    if (sort === "near" && me) l.sort((a, b) => (orderPoint(a) ? distanceKm(me, orderPoint(a)!) : 1e9) - (orderPoint(b) ? distanceKm(me, orderPoint(b)!) : 1e9));
    else l.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return l;
  }, [active, sort, me]);
  return (
    <>
      <PageHeader title="Assigned orders" icon={Truck} description={isRider ? "Deliveries the shop gave you. Open one to navigate, call the customer and collect payment." : "Every order out for delivery."}
        actions={<Segmented value={sort} onChange={(v) => setSort(v as any)} options={[{ value: "near", label: "Nearest first" }, { value: "old", label: "Oldest first" }]} />} />
      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50">
          <EmptyState icon={Truck} title="No deliveries right now" description="New deliveries appear here by themselves." />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((o) => <OrderCard key={o.id} o={o} me={me} onOpen={onOpen} showRider={!isRider} />)}
        </div>
      )}
    </>
  );
}

function Delivered({ orders, isRider, userId }: { orders: WaterOrder[]; isRider: boolean; userId?: string }) {
  const [range, setRange] = useState<"today" | "7" | "30" | "all">("today");
  const from = range === "today" ? startOfDay() : range === "all" ? 0 : Date.now() - Number(range) * 86400_000;
  const list = orders.filter((o) => o.status === "paid" && o.paid_at && new Date(o.paid_at).getTime() >= from && (!isRider || o.rider_id === userId))
    .sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)));
  const total = list.reduce((a, o) => a + o.total, 0);
  const cash = list.filter((o) => o.payment_method === "cash").reduce((a, o) => a + o.total, 0);
  return (
    <>
      <PageHeader title="Delivered orders" icon={PackageCheck} description="Deliveries you completed and the money collected."
        actions={<Segmented value={range} onChange={(v) => setRange(v as any)} options={[
          { value: "today", label: "Today" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "all", label: "All" },
        ]} />} />
      <StatGrid className="grid-cols-2 lg:grid-cols-4">
        <StatTile label="Delivered" value={list.length} icon={PackageCheck} tone="success" />
        <StatTile label="Water" value={L(list.reduce((a, o) => a + o.litres_total, 0))} icon={Droplets} tone="info" />
        <StatTile label="Cash collected" value={formatKES(cash)} hint="hand this in to the shop" icon={Banknote} tone="warning" />
        <StatTile label="M-Pesa" value={formatKES(total - cash)} icon={Smartphone} tone="primary" />
      </StatGrid>
      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50">
          <EmptyState icon={PackageCheck} title="Nothing delivered in this period" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <ul className="divide-y divide-border">
            {list.map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">#{o.order_no} · {o.customer_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{itemsSummary(o)}</p>
                  <p className="text-xs text-muted-foreground">{new Date(o.paid_at!).toLocaleString()}{!isRider && o.rider_name ? ` · ${o.rider_name}` : ""}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums">{formatKES(o.total)}</p>
                  <p className="text-xs text-muted-foreground">{o.payment_method === "mpesa" ? "M-Pesa" : "Cash"}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function RiderMap({ active, me, onOpen }: { active: WaterOrder[]; me: LatLng | null; onOpen: (id: string) => void }) {
  const stops = active.filter((o) => orderPoint(o)).map((o) => ({
    id: o.id, at: orderPoint(o)!, label: String(o.order_no).slice(-2),
    color: o.status === "on_the_way" ? "#2563eb" : o.status === "delivered" ? "#ea580c" : "#dc2626",
  }));
  return (
    <>
      <PageHeader title="Map" icon={MapIcon} description="Your position (blue dot) and every stop. Tap a pin to open the order." />
      <MultiMap stops={stops} me={me} onPick={onOpen} className="h-[60svh]" />
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#dc2626]" /> Assigned</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#2563eb]" /> On the way</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#ea580c]" /> Awaiting payment</span>
      </div>
      {active.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {active.map((o) => {
            const p = orderPoint(o);
            return (
              <div key={o.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(o.id)}>
                  <p className="truncate text-sm font-semibold">#{o.order_no} · {o.customer_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{o.landmark || o.address || "Pinned location"}{p && me ? ` · ${distanceKm(me, p).toFixed(1)} km` : ""}</p>
                </button>
                {p && <a href={directionsUrl(p)} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"><Navigation className="h-3.5 w-3.5" /> Go</a>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function RiderSettings() {
  const { user, profile, refreshProfile } = useAuth() as any;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(profile?.display_name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  const saveProfile = async () => {
    setSavingProfile(true);
    const { error } = await (supabase as any).from("profiles").update({ display_name: name.trim(), phone: phone.trim() || null }).eq("user_id", user.id);
    setSavingProfile(false);
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    await refreshProfile?.();
    qc.invalidateQueries({ queryKey: ["riders"] });
    toast({ title: "Your details are saved" });
  };
  const savePw = async () => {
    if (pw.length < 8) { toast({ title: "Use at least 8 characters", variant: "destructive" }); return; }
    if (pw !== pw2) { toast({ title: "The two passwords don't match", variant: "destructive" }); return; }
    setSavingPw(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSavingPw(false);
    if (error) { toast({ title: "Could not change the password", description: error.message, variant: "destructive" }); return; }
    setPw(""); setPw2("");
    toast({ title: "Password changed", description: "Use the new password next time you sign in." });
  };

  return (
    <>
      <PageHeader title="Settings" icon={Settings} description="Your name, phone number and password." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="My account" icon={User}>
          <div className="space-y-3">
            <Field label="Name"><input className="fi" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Phone number" hint="The shop and customers may call you on it"><input className="fi" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Field label="Sign-in email"><input className="fi opacity-70" value={user?.email || ""} disabled /></Field>
            <Button disabled={savingProfile || !name.trim()} onClick={saveProfile}><Save /> {savingProfile ? "Saving…" : "Save"}</Button>
          </div>
        </Panel>
        <Panel title="Change password" icon={KeyRound}>
          <div className="space-y-3">
            <Field label="New password" hint="At least 8 characters">
              <div className="relative">
                <input className="fi pr-10" type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            <Field label="Type it again"><PasswordInput className="fi" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
            <Button disabled={savingPw || !pw || !pw2} onClick={savePw}><KeyRound /> {savingPw ? "Saving…" : "Change password"}</Button>
          </div>
        </Panel>
        <Panel title="Location" icon={MapPin} className="lg:col-span-2">
          <p className="text-sm text-muted-foreground">
            While you have deliveries out, this app shares your position every 20 seconds so the shop and the customer can see where the water is.
            It stops when you have nothing to deliver. Keep location allowed for this site in your phone's browser settings.
          </p>
        </Panel>
      </div>
    </>
  );
}
