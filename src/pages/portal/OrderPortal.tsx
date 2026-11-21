import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Droplets, Minus, Plus, MapPin, Package, Receipt, User, LogOut, CheckCircle2, Phone, Eye, EyeOff, X, LifeBuoy, Send, ChevronLeft, Milk } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatKES, setCurrency } from "@/lib/format";
import { formatLitres } from "@/lib/businessType";
import { LocationPicker, DeliveryMap, distanceKm, type LatLng } from "@/components/maps/Maps";
import { portal, getToken, setToken, PortalError, refillSizes, containerItems, type PortalShop, type PortalSize, type PortalCustomer } from "@/lib/portalApi";
import { OrbSpinner } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";

const STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: "Received", tone: "bg-sky-100 text-sky-800" },
  accepted: { label: "Accepted", tone: "bg-amber-100 text-amber-800" },
  assigned: { label: "Rider assigned", tone: "bg-indigo-100 text-indigo-800" },
  on_the_way: { label: "On the way", tone: "bg-blue-100 text-blue-800" },
  delivered: { label: "Delivered · pay now", tone: "bg-orange-100 text-orange-800" },
  paid: { label: "Paid", tone: "bg-emerald-100 text-emerald-800" },
  cancelled: { label: "Cancelled", tone: "bg-zinc-200 text-zinc-700" },
};
const STEPS = ["new", "accepted", "assigned", "on_the_way", "delivered", "paid"];

type Tab = "order" | "orders" | "payments" | "help" | "profile";

/** Customer ordering page of a water refill shop: app.jmsurfgarage.co.ke/<shop>/order (or its own domain). */
export default function OrderPortal({ slug: hostSlug }: { slug?: string }) {
  const params = useParams<{ slug: string }>();
  const slug = (hostSlug || params.slug || "").toLowerCase();
  const [shop, setShop] = useState<PortalShop | null>(null);
  const [sizes, setSizes] = useState<PortalSize[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(!!getToken(slug));

  useEffect(() => {
    setLoadErr(null);
    portal(slug, "shop").then((d) => { setShop(d.shop); setSizes(d.sizes); setCurrency(d.shop.currency); })
      .catch((e) => setLoadErr(e.message));
  }, [slug]);

  if (loadErr) return <Shell><div className="p-8 text-center text-sm text-muted-foreground">{loadErr}</div></Shell>;
  if (!shop) return <Shell><div className="flex justify-center p-16"><OrbSpinner className="h-6 w-6 text-muted-foreground" /></div></Shell>;

  return (
    <Shell shop={shop} staffLogin={hostSlug ? "/signin" : `/${slug}/signin`}>
      <Helmet><title>Order water · {shop.name}</title></Helmet>
      {signedIn
        ? <Account slug={slug} shop={shop} sizes={sizes} onSignOut={() => { setToken(slug, null); setSignedIn(false); }} />
        : <Auth slug={slug} shop={shop} onDone={(t) => { setToken(slug, t); setSignedIn(true); }} />}
    </Shell>
  );
}

function Shell({ shop, children, staffLogin }: { shop?: PortalShop; children: React.ReactNode; staffLogin?: string }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-background dark:from-sky-950/30">
      <div className="mx-auto max-w-lg">
        <header className="flex items-center gap-3 px-4 pb-2 pt-5">
          {shop?.logo_url
            ? <img src={shop.logo_url} alt="" className="h-11 w-11 rounded-xl object-cover" />
            : <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500 text-white"><Droplets className="h-6 w-6" /></span>}
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-bold">{shop?.name || "Water delivery"}</p>
            <p className="text-xs text-muted-foreground">Order water to your door</p>
          </div>
          {shop?.phone && <a href={`tel:${shop.phone}`} className="ml-auto rounded-xl border border-border bg-card p-2.5" aria-label="Call the shop"><Phone className="h-4 w-4" /></a>}
        </header>
        {children}
        <p className="py-6 text-center text-[11px] text-muted-foreground">
          Powered by JMSURF TECHNOLOGIES
          {staffLogin && <> · <a href={staffLogin} className="hover:underline">Staff sign in</a></>}
        </p>
      </div>
    </div>
  );
}

const input = "fi h-12 text-base";

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input className={`${input} pr-11`} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="current-password" />
      <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function Auth({ slug, shop, onDone }: { slug: string; shop: PortalShop; onDone: (token: string) => void }) {
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "reset">("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [landmark, setLandmark] = useState("");
  const [altPhone, setAltPhone] = useState("");
  const [area, setArea] = useState("");
  const [building, setBuilding] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [point, setPoint] = useState<LatLng | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null); setInfo(null);
    try {
      if (mode === "login") onDone((await portal(slug, "login", { phone, password })).token);
      else if (mode === "register") {
        if (!point) throw new PortalError("Pin your delivery location on the map", 400);
        onDone((await portal(slug, "register", { name, phone, alt_phone: altPhone, password, email, area, building, address, landmark, delivery_notes: deliveryNotes, lat: point.lat, lng: point.lng })).token);
      } else if (mode === "forgot") {
        const r = await portal(slug, "forgot", { phone });
        if (r.ok === false) setErr(r.error); else { setInfo("If that number has an account, we've sent it a 6-digit code by SMS."); setMode("reset"); }
      } else onDone((await portal(slug, "reset", { phone, code, password })).token);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const ready = mode === "login" ? phone && password
    : mode === "register" ? name && phone && password.length >= 6 && point && area.trim() && building.trim()
    : mode === "forgot" ? phone : phone && code && password.length >= 6;

  return (
    <div className="space-y-4 p-4">
      {(mode === "login" || mode === "register") && (
        <div className="grid grid-cols-2 rounded-xl border border-border bg-card p-1 text-sm font-medium">
          <button type="button" className={`rounded-lg py-2 ${mode === "login" ? "bg-sky-500 text-white" : ""}`} onClick={() => { setMode("login"); setErr(null); }}>Sign in</button>
          <button type="button" className={`rounded-lg py-2 ${mode === "register" ? "bg-sky-500 text-white" : ""}`} onClick={() => { setMode("register"); setErr(null); }}>Create account</button>
        </div>
      )}
      <form className="space-y-3 rounded-2xl border border-border bg-card p-4" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) submit(); }}>
        {mode === "forgot" && <p className="text-sm">Enter your phone number and we'll text you a code to set a new password.</p>}
        {mode === "register" && <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />}
        <input className={input} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" autoComplete="tel" />
        {mode === "reset" && <input className={input} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" />}
        {mode !== "forgot" && <PasswordInput value={password} onChange={setPassword} placeholder={mode === "login" ? "Password" : "New password (6+ characters)"} />}
        {mode === "register" && (
          <>
            <input className={input} inputMode="tel" value={altPhone} onChange={(e) => setAltPhone(e.target.value)} placeholder="Other phone number (optional)" />
            <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional, for receipts)" autoComplete="email" />
            <div className="pt-1">
              <p className="mb-2 text-sm font-medium">Where should we deliver?</p>
              <LocationPicker value={point} onChange={setPoint} />
            </div>
            <input className={input} value={area} onChange={(e) => setArea(e.target.value)} placeholder="Estate / area (e.g. Kilimani) *" />
            <input className={input} value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="House / apartment, floor, door no. *" />
            <input className={input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street / road (optional)" />
            <input className={input} value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Landmark (e.g. opposite Naivas, blue gate)" />
            <textarea className="fi min-h-[70px] text-base" value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} maxLength={500}
              placeholder="Delivery instructions (gate code, call on arrival, best time…)" />
          </>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
        {info && <p className="text-sm text-emerald-700">{info}</p>}
        <Button type="submit" className="h-12 w-full bg-sky-600 text-base hover:bg-sky-700" disabled={!ready || busy}>
          {busy && <OrbSpinner />}
          {mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "forgot" ? "Send code" : "Set password and sign in"}
        </Button>
        {mode === "login" && <button type="button" className="w-full text-center text-sm text-sky-700 hover:underline" onClick={() => { setMode("forgot"); setErr(null); }}>Forgot password?</button>}
        {(mode === "forgot" || mode === "reset") && <button type="button" className="w-full text-center text-sm text-sky-700 hover:underline" onClick={() => { setMode("login"); setErr(null); }}>Back to sign in</button>}
      </form>
      {mode === "register" && <p className="px-2 text-center text-xs text-muted-foreground">Your details are shared only with {shop.name} for your deliveries.</p>}
    </div>
  );
}

function Account({ slug, shop, sizes, onSignOut }: { slug: string; shop: PortalShop; sizes: PortalSize[]; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("order");
  const [me, setMe] = useState<{ customer: PortalCustomer; totals: any } | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [unreadTickets, setUnreadTickets] = useState(0);
  // Replies from the shop show as a dot on Help.
  useEffect(() => {
    portal(slug, "tickets").then((d) => setUnreadTickets((d.tickets || []).filter((t: any) => t.unread_by_requester).length)).catch(() => undefined);
  }, [slug]);

  const fail = useCallback((e: any) => { if (e?.status === 401) onSignOut(); else setErr(e.message); }, [onSignOut]);
  const loadMe = useCallback(() => portal(slug, "me").then(setMe).catch(fail), [slug, fail]);
  const loadOrders = useCallback(() => portal(slug, "orders").then((d) => setOrders(d.orders)).catch(fail), [slug, fail]);

  useEffect(() => { loadMe(); loadOrders(); }, [loadMe, loadOrders]);
  // Follow live orders while any is open.
  const live = orders.some((o) => !["paid", "cancelled"].includes(o.status));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => { if (!document.hidden) loadOrders(); }, 30_000);
    return () => clearInterval(t);
  }, [live, loadOrders]);

  if (!me) return <div className="flex justify-center p-16">{err ? <p className="text-sm text-destructive">{err}</p> : <OrbSpinner className="h-6 w-6 text-muted-foreground" />}</div>;

  const openCount = orders.filter((o) => !["paid", "cancelled"].includes(o.status)).length;

  return (
    <div className="pb-24">
      <p className="px-4 pb-3 text-sm text-muted-foreground">Hi {me.customer.name.split(" ")[0]} 👋</p>
      {tab === "order" && <NewOrder slug={slug} sizes={sizes} customer={me.customer} onPlaced={() => { loadOrders(); loadMe(); setTab("orders"); }} />}
      {tab === "orders" && <MyOrders slug={slug} orders={orders} onChange={() => { loadOrders(); loadMe(); }} />}
      {tab === "payments" && <MyPayments slug={slug} totals={me.totals} />}
      {tab === "help" && <MyTickets slug={slug} shop={shop} orders={orders} onUnread={setUnreadTickets} />}
      {tab === "profile" && <Profile slug={slug} customer={me.customer} onSaved={loadMe} onSignOut={async () => { await portal(slug, "logout").catch(() => {}); onSignOut(); }} />}

      <nav className="fixed inset-x-0 bottom-0 z-[700] border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {([
            ["order", "Order", Droplets],
            ["orders", "My orders", Package],
            ["payments", "Payments", Receipt],
            ["help", "Help", LifeBuoy],
            ["profile", "Account", User],
          ] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${tab === k ? "text-sky-600" : "text-muted-foreground"}`}>
              <Icon className="h-5 w-5" />{label}
              {k === "orders" && openCount > 0 && <span className="absolute right-[30%] top-1.5 h-2 w-2 rounded-full bg-orange-500" />}
              {k === "help" && unreadTickets > 0 && <span className="absolute right-[30%] top-1.5 h-2 w-2 rounded-full bg-orange-500" />}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function NewOrder({ slug, sizes: catalogue, customer, onPlaced }: { slug: string; sizes: PortalSize[]; customer: PortalCustomer; onPlaced: () => void }) {
  const sizes = refillSizes(catalogue);
  const containers = containerItems(catalogue);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [where, setWhere] = useState<"saved" | "new">(customer.lat != null ? "saved" : "new");
  const [point, setPoint] = useState<LatLng | null>(null);
  const [address, setAddress] = useState("");
  const [landmark, setLandmark] = useState("");
  const [save, setSave] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [placed, setPlaced] = useState<any | null>(null);

  const lines = catalogue.filter((s) => (qty[s.id] || 0) > 0);
  const total = lines.reduce((a, s) => a + s.price * qty[s.id], 0);
  const litres = lines.reduce((a, s) => a + (s.litres || 0) * qty[s.id], 0);
  const set = (id: string, n: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(500, n)) }));

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const body: any = { items: lines.map((s) => ({ product_id: s.id, quantity: qty[s.id] })), notes };
      if (where === "new") {
        if (!point) throw new Error("Pin the delivery location on the map");
        Object.assign(body, { lat: point.lat, lng: point.lng, address, landmark, save_location: save });
      }
      const { order } = await portal(slug, "order", body);
      setPlaced(order); setQty({}); setNotes("");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (placed) return (
    <div className="mx-4 flex flex-col items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center dark:bg-emerald-950/30">
      <CheckCircle2 className="h-12 w-12 text-emerald-600" />
      <p className="text-lg font-semibold">Order #{placed.order_no} received</p>
      <p className="text-sm text-muted-foreground">The shop will send a rider. You pay {formatKES(Number(placed.total))} when your water arrives.</p>
      <Button className="bg-sky-600 hover:bg-sky-700" onClick={onPlaced}>Track my order</Button>
    </div>
  );

  if (sizes.length === 0) return <p className="mx-4 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">The shop has not listed any refill sizes yet.</p>;

  return (
    <div className="space-y-4 px-4">
      <div className="grid grid-cols-2 gap-3">
        {sizes.map((s) => {
          const n = qty[s.id] || 0;
          return (
            <div key={s.id} className={`rounded-2xl border bg-card p-3 transition ${n ? "border-sky-500 ring-1 ring-sky-500/30" : "border-border"}`}>
              <div className="flex items-center gap-2">
                {s.image_url
                  ? <img src={s.image_url} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
                  : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-900/40"><Droplets className="h-5 w-5" /></span>}
                <div className="min-w-0">
                  <p className="font-display text-lg font-bold leading-tight">{formatLitres(s.litres)}</p>
                  <p className="text-xs text-muted-foreground">{formatKES(s.price)}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg border border-border disabled:opacity-40" disabled={!n} onClick={() => set(s.id, n - 1)} aria-label="Less"><Minus className="h-4 w-4" /></button>
                <input className="w-12 bg-transparent text-center text-lg font-semibold tabular-nums outline-none" inputMode="numeric" value={n || ""} placeholder="0"
                  onChange={(e) => set(s.id, parseInt(e.target.value.replace(/\D/g, "")) || 0)} />
                <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-600 text-white" onClick={() => set(s.id, n + 1)} aria-label="More"><Plus className="h-4 w-4" /></button>
              </div>
            </div>
          );
        })}
      </div>

      {containers.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
          <p className="font-semibold">Need a bottle or jerrican?</p>
          <p className="text-xs text-muted-foreground">Add empty containers if you don't have your own. The refills above are water only.</p>
          <ul className="divide-y divide-border">
            {containers.map((s) => {
              const n = qty[s.id] || 0;
              return (
                <li key={s.id} className="flex items-center gap-3 py-2.5">
                  {s.image_url
                    ? <img src={s.image_url} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
                    : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Milk className="h-5 w-5" /></span>}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{formatLitres(Number(s.container_litres))} · {formatKES(s.price)}</p>
                  </div>
                  <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border disabled:opacity-40" disabled={!n} onClick={() => set(s.id, n - 1)} aria-label="Less"><Minus className="h-4 w-4" /></button>
                  <span className="w-6 text-center font-semibold tabular-nums">{n}</span>
                  <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white" onClick={() => set(s.id, n + 1)} aria-label="More"><Plus className="h-4 w-4" /></button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <p className="font-semibold">Deliver to</p>
        {customer.lat != null && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <button type="button" className={`rounded-xl border p-3 text-left ${where === "saved" ? "border-sky-500 bg-sky-50 dark:bg-sky-950/30" : "border-border"}`} onClick={() => setWhere("saved")}>
              <MapPin className="mb-1 h-4 w-4 text-sky-600" /><span className="font-medium">My saved place</span>
              <span className="block truncate text-xs text-muted-foreground">{customer.landmark || customer.address || "Pinned on the map"}</span>
            </button>
            <button type="button" className={`rounded-xl border p-3 text-left ${where === "new" ? "border-sky-500 bg-sky-50 dark:bg-sky-950/30" : "border-border"}`} onClick={() => setWhere("new")}>
              <Plus className="mb-1 h-4 w-4 text-sky-600" /><span className="font-medium">Somewhere else</span>
              <span className="block text-xs text-muted-foreground">Pin it on the map</span>
            </button>
          </div>
        )}
        {where === "new" && (
          <>
            <LocationPicker value={point} onChange={setPoint} autoLocate />
            <input className={input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Estate, street, house no." />
            <input className={input} value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Landmark" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Make this my saved place</label>
          </>
        )}
        <textarea className="fi min-h-[70px] text-base" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note for the rider (optional)" maxLength={500} />
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="sticky bottom-[68px] z-[650] rounded-2xl border border-border bg-card p-3 shadow-lg">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">{litres ? `${litres.toLocaleString()} L` : "Nothing chosen yet"}</span>
          <span className="font-display text-xl font-bold">{formatKES(total)}</span>
        </div>
        <Button className="h-12 w-full bg-sky-600 text-base hover:bg-sky-700" disabled={!litres || busy || (where === "new" && !point)} onClick={submit}>
          {busy && <OrbSpinner />} Place order · pay on delivery
        </Button>
      </div>
    </div>
  );
}

function MyOrders({ slug, orders, onChange }: { slug: string; orders: any[]; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (orders.length === 0) return <p className="mx-4 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No orders yet.</p>;
  const cancel = async (id: string) => {
    if (!(await confirmAction({ title: "Cancel this order?", danger: true, confirmLabel: "Cancel order" }))) return;
    setBusy(id);
    try { await portal(slug, "cancel", { order_id: id }); onChange(); } catch (e: any) { alert(e.message); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-3 px-4">
      {orders.map((o) => {
        const st = STATUS[o.status] || STATUS.new;
        const step = STEPS.indexOf(o.status);
        return (
          <div key={o.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">Order #{o.order_no}</p>
                <p className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString()}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${st.tone}`}>{st.label}</span>
            </div>
            {o.status !== "cancelled" && (
              <div className="mt-3 flex gap-1">
                {STEPS.map((s, i) => <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-sky-500" : "bg-muted"}`} />)}
              </div>
            )}
            <p className="mt-3 text-sm">{(o.items || []).map((i: any) => `${i.quantity} × ${Number(i.litres) ? formatLitres(Number(i.litres)) : i.name}`).join(", ")}</p>
            {o.rider_name && ["assigned", "on_the_way", "delivered"].includes(o.status) && <p className="mt-1 text-xs text-muted-foreground">Rider: {o.rider_name}</p>}
            {o.rider_lat != null && o.lat != null && ["assigned", "on_the_way"].includes(o.status) && (
              <div className="mt-3 space-y-1">
                <DeliveryMap to={{ lat: Number(o.lat), lng: Number(o.lng) }} me={{ lat: Number(o.rider_lat), lng: Number(o.rider_lng) }} label="You" className="h-52" showNavigate={false} />
                <p className="text-[11px] text-muted-foreground">
                  Blue dot: your rider, {distanceKm({ lat: Number(o.rider_lat), lng: Number(o.rider_lng) }, { lat: Number(o.lat), lng: Number(o.lng) }).toFixed(1)} km away · updated {Math.max(0, Math.round((Date.now() - new Date(o.rider_seen_at).getTime()) / 60000))} min ago
                </p>
              </div>
            )}
            {o.status === "delivered" && <p className="mt-2 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-800">Your rider will send an M-Pesa prompt to your phone. Enter your PIN to pay.</p>}
            {o.status === "cancelled" && o.cancel_reason && <p className="mt-1 text-xs text-muted-foreground">{o.cancel_reason}</p>}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{Number(o.litres_total).toLocaleString()} L{o.payment_method && o.status === "paid" ? ` · ${o.payment_method === "mpesa" ? "M-Pesa" : "Cash"}` : ""}</span>
              <span className="font-display text-lg font-bold">{formatKES(Number(o.total))}</span>
            </div>
            {["new", "accepted"].includes(o.status) && (
              <button type="button" disabled={busy === o.id} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-destructive" onClick={() => cancel(o.id)}><X className="h-3.5 w-3.5" /> Cancel order</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MyPayments({ slug, totals }: { slug: string; totals: any }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { portal(slug, "payments").then((d) => setRows(d.payments)).catch((e) => setErr(e.message)); }, [slug]);
  return (
    <div className="space-y-4 px-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Orders" value={String(totals.orders)} />
        <Stat label="Litres" value={Number(totals.litres).toLocaleString()} />
        <Stat label="Paid" value={formatKES(Number(totals.paid))} />
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {!rows ? <div className="flex justify-center p-8"><OrbSpinner className="h-5 w-5" /></div>
        : rows.length === 0 ? <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No payments yet.</p>
        : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {rows.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.what || "Payment"}</p>
                  <p className="text-xs text-muted-foreground">{new Date(p.at).toLocaleString()} · {p.method === "mpesa" ? "M-Pesa" : p.method === "cash" ? "Cash" : p.method}{p.status === "refunded" ? " · refunded" : ""}</p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums">{formatKES(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

const TICKET_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "Open", tone: "bg-sky-100 text-sky-800" },
  in_progress: { label: "Being handled", tone: "bg-amber-100 text-amber-800" },
  waiting: { label: "Waiting for you", tone: "bg-orange-100 text-orange-800" },
  resolved: { label: "Resolved", tone: "bg-emerald-100 text-emerald-800" },
  closed: { label: "Closed", tone: "bg-zinc-200 text-zinc-700" },
};
const TICKET_TOPICS = [
  ["delivery", "Delivery"], ["water_quality", "Water quality"], ["payment", "Payment"], ["rider", "Rider"], ["account", "My account"], ["general", "Something else"],
] as const;

/** Customer help desk: open a ticket and talk to the shop about it. */
function MyTickets({ slug, shop, orders, onUnread }: { slug: string; shop: PortalShop; orders: any[]; onUnread: (n: number) => void }) {
  const [list, setList] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => portal(slug, "tickets").then((d) => {
    setList(d.tickets);
    onUnread((d.tickets || []).filter((t: any) => t.unread_by_requester).length);
  }).catch((e) => setErr(e.message)), [slug, onUnread]);
  useEffect(() => { load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [load]);

  const open = list?.find((t) => t.id === openId) || null;
  useEffect(() => {
    if (open?.unread_by_requester) portal(slug, "ticket-read", { ticket_id: open.id }).then(load).catch(() => undefined);
  }, [open?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (creating) return <NewTicket slug={slug} orders={orders} onDone={(id) => { setCreating(false); load().then(() => { if (id) setOpenId(id); }); }} onCancel={() => setCreating(false)} />;
  if (open) return <TicketThread shop={shop} slug={slug} ticket={open} onBack={() => setOpenId(null)} onSent={load} />;

  return (
    <div className="space-y-3 px-4">
      <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:bg-sky-950/30">
        <p className="font-semibold">Need help?</p>
        <p className="mt-1 text-sm text-muted-foreground">Tell {shop.name} about a late delivery, a payment, water quality or anything else. The reply comes here.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button className="bg-sky-600 hover:bg-sky-700" onClick={() => setCreating(true)}><Plus /> New ticket</Button>
          {shop.phone && <a href={`tel:${shop.phone}`} className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium"><Phone className="h-4 w-4" /> Call the shop</a>}
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {!list ? <div className="flex justify-center p-8"><OrbSpinner className="h-5 w-5" /></div>
        : list.length === 0 ? <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No tickets yet.</p>
        : list.map((t) => {
          const st = TICKET_STATUS[t.status] || TICKET_STATUS.open;
          const last = t.messages.filter((m: any) => m.from !== "system").pop();
          return (
            <button key={t.id} type="button" onClick={() => setOpenId(t.id)} className="block w-full rounded-2xl border border-border bg-card p-4 text-left">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">#{t.ticket_no} · {t.subject}</p>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${st.tone}`}>{st.label}</span>
              </div>
              {last && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{last.from === "customer" ? "You: " : ""}{last.body}</p>}
              <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                {new Date(t.last_message_at).toLocaleString()}
                {t.unread_by_requester && <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white">New reply</span>}
              </p>
            </button>
          );
        })}
    </div>
  );
}

function NewTicket({ slug, orders, onDone, onCancel }: { slug: string; orders: any[]; onDone: (id?: string) => void; onCancel: () => void }) {
  const [category, setCategory] = useState("delivery");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const { ticket } = await portal(slug, "ticket", { category, subject, body, order_id: orderId || undefined });
      onDone(ticket?.id);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4 px-4">
      <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ChevronLeft className="h-4 w-4" /> Back</button>
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <p className="font-semibold">New ticket</p>
        <div className="flex flex-wrap gap-2">
          {TICKET_TOPICS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setCategory(k)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${category === k ? "border-sky-600 bg-sky-600 text-white" : "border-border"}`}>{label}</button>
          ))}
        </div>
        {orders.length > 0 && (
          <select className={input} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">Not about a specific order</option>
            {orders.slice(0, 20).map((o) => <option key={o.id} value={o.id}>Order #{o.order_no} · {new Date(o.created_at).toLocaleDateString()} · {formatKES(Number(o.total))}</option>)}
          </select>
        )}
        <input className={input} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} placeholder="Subject, e.g. My order is late" />
        <textarea className="fi min-h-[120px] text-base" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder="Tell us what happened" />
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button className="h-12 w-full bg-sky-600 text-base hover:bg-sky-700" disabled={busy || !subject.trim() || !body.trim()} onClick={submit}>
        {busy ? <OrbSpinner /> : <Send />} Send ticket
      </Button>
    </div>
  );
}

function TicketThread({ slug, shop, ticket: t, onBack, onSent }: { slug: string; shop: PortalShop; ticket: any; onBack: () => void; onSent: () => Promise<unknown> }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const st = TICKET_STATUS[t.status] || TICKET_STATUS.open;
  const send = async () => {
    setBusy(true); setErr(null);
    try { await portal(slug, "ticket-reply", { ticket_id: t.id, body }); setBody(""); await onSent(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 px-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ChevronLeft className="h-4 w-4" /> All tickets</button>
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold">#{t.ticket_no} · {t.subject}</p>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${st.tone}`}>{st.label}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Opened {new Date(t.created_at).toLocaleString()}</p>
      </div>
      <div className="space-y-2">
        {t.messages.map((m: any) => m.from === "system" ? (
          <p key={m.id} className="text-center text-[11px] text-muted-foreground">{m.body} · {new Date(m.at).toLocaleString()}</p>
        ) : (
          <div key={m.id} className={`flex ${m.from === "customer" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${m.from === "customer" ? "rounded-br-md bg-sky-600 text-white" : "rounded-bl-md border border-border bg-card"}`}>
              {m.from !== "customer" && <p className="mb-0.5 text-[11px] font-semibold text-sky-700">{m.name || shop.name}</p>}
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className={`mt-1 text-[10px] ${m.from === "customer" ? "text-white/70" : "text-muted-foreground"}`}>{new Date(m.at).toLocaleString()}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="sticky bottom-[68px] z-[650] space-y-2 rounded-2xl border border-border bg-card p-3 shadow-lg">
        {err && <p className="text-sm text-destructive">{err}</p>}
        <textarea className="fi min-h-[70px] text-base" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000}
          placeholder={["resolved", "closed"].includes(t.status) ? "Still a problem? Write here to reopen it" : "Write a reply"} />
        <Button className="h-11 w-full bg-sky-600 hover:bg-sky-700" disabled={busy || !body.trim()} onClick={send}>{busy ? <OrbSpinner /> : <Send />} Send</Button>
      </div>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-border bg-card p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="truncate font-display text-base font-bold">{value}</p></div>
);

function Profile({ slug, customer, onSaved, onSignOut }: { slug: string; customer: PortalCustomer; onSaved: () => void; onSignOut: () => void }) {
  const [name, setName] = useState(customer.name || "");
  const [email, setEmail] = useState(customer.email || "");
  const [address, setAddress] = useState(customer.address || "");
  const [landmark, setLandmark] = useState(customer.landmark || "");
  const [altPhone, setAltPhone] = useState(customer.alt_phone || "");
  const [area, setArea] = useState(customer.area || "");
  const [building, setBuilding] = useState(customer.building || "");
  const [deliveryNotes, setDeliveryNotes] = useState(customer.delivery_notes || "");
  const start = useMemo(() => (customer.lat != null && customer.lng != null ? { lat: customer.lat, lng: customer.lng } : null), [customer]);
  const [point, setPoint] = useState<LatLng | null>(start);
  const [pw, setPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await portal(slug, "profile", {
        name, email, landmark, area, building, alt_phone: altPhone, delivery_notes: deliveryNotes,
        ...(point ? { lat: point.lat, lng: point.lng } : {}),
        ...(newPw ? { password: pw, new_password: newPw } : {}),
      });
      setPw(""); setNewPw("");
      setMsg({ ok: true, text: "Saved" });
      onSaved();
    } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 px-4">
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <p className="font-semibold">My details</p>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <input className={`${input} opacity-70`} value={customer.phone} disabled />
        <input className={input} inputMode="tel" value={altPhone} onChange={(e) => setAltPhone(e.target.value)} placeholder="Other phone number (optional)" />
        <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" />
      </div>
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <p className="font-semibold">My delivery place</p>
        <LocationPicker value={point} onChange={setPoint} />
        <input className={input} value={area} onChange={(e) => setArea(e.target.value)} placeholder="Estate / area" />
        <input className={input} value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="House / apartment, floor, door no." />
        <input className={input} value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Landmark" />
        <textarea className="fi min-h-[70px] text-base" value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} maxLength={500} placeholder="Delivery instructions" />
      </div>
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <p className="font-semibold">Change password</p>
        <PasswordInput value={pw} onChange={setPw} placeholder="Current password" />
        <PasswordInput value={newPw} onChange={setNewPw} placeholder="New password (6+ characters)" />
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-destructive"}`}>{msg.text}</p>}
      <Button className="h-12 w-full bg-sky-600 text-base hover:bg-sky-700" disabled={busy || !name || (!!newPw && !pw)} onClick={save}>{busy && <OrbSpinner />} Save</Button>
      <Button variant="outline" className="h-12 w-full" onClick={onSignOut}><LogOut /> Sign out</Button>
    </div>
  );
}
