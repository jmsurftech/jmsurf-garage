import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { mpesaReason } from "@/lib/mpesaReason";
import { Bike, Phone, MapPin, Navigation, Banknote, Smartphone, CheckCircle2, ArrowLeft, LogOut, RefreshCw, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill, PageLoader } from "@/components/kit";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import { DeliveryMap, directionsUrl, distanceKm, useWatchPosition } from "@/components/maps/Maps";
import { ORDER_STATUS, type WaterOrder, useWaterOrders, orderAction, chargeOrder, useOrderPrompt, orderPoint, itemsSummary } from "@/lib/waterOrders";
import { confirmAction } from "@/components/books/confirm";

import { PagedRows } from "@/components/Pager";
/** Rider phone screen: my deliveries, map to the customer, and payment on delivery. */
export default function RiderPortal() {
  const { user, role, profile, signOut } = useAuth() as any;
  const isRider = role === "rider";
  // Riders see their own orders; a manager opening this sees everything out for delivery.
  const { data: orders = [], isLoading, refetch, isFetching } = useWaterOrders({ riderId: isRider ? user?.id : undefined });
  const [openId, setOpenId] = useState<string | null>(null);
  const { pos } = useWatchPosition(true);

  const active = orders.filter((o) => ["assigned", "on_the_way", "delivered"].includes(o.status) && (isRider || o.rider_id));
  const done = orders.filter((o) => o.status === "paid" && o.paid_at && new Date(o.paid_at).toDateString() === new Date().toDateString()
    && (!isRider || o.rider_id === user?.id));
  const open = orders.find((o) => o.id === openId) || null;

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

  if (isLoading) return <PageLoader label="Loading deliveries…" />;
  if (open) return <RiderOrder order={open} me={pos} onBack={() => setOpenId(null)} />;

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-background pb-10">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Bike className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold leading-tight">My deliveries</p>
          <p className="truncate text-xs text-muted-foreground">{profile?.display_name || "Rider"}</p>
        </div>
        <button type="button" className="rounded-lg p-2 hover:bg-muted" onClick={() => refetch()} aria-label="Refresh"><RefreshCw className={`h-5 w-5 ${isFetching ? "animate-spin" : ""}`} /></button>
        {isRider && <button type="button" className="rounded-lg p-2 hover:bg-muted" onClick={() => signOut?.()} aria-label="Sign out"><LogOut className="h-5 w-5" /></button>}
      </header>

      <div className="grid grid-cols-2 gap-3 p-4">
        <div className="rounded-2xl border border-border bg-card p-3"><p className="text-xs text-muted-foreground">To deliver</p><p className="font-display text-2xl font-bold">{active.length}</p></div>
        <div className="rounded-2xl border border-border bg-card p-3"><p className="text-xs text-muted-foreground">Paid today</p><p className="font-display text-2xl font-bold">{formatKES(done.reduce((a, o) => a + o.total, 0))}</p></div>
      </div>

      <div className="space-y-3 px-4">
        {active.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            <Package className="mx-auto mb-2 h-8 w-8 opacity-50" />
            No deliveries for you right now. New ones appear here automatically.
          </div>
        )}
        {active.map((o) => {
          const p = orderPoint(o);
          const km = p && pos ? distanceKm(pos, p) : null;
          return (
            <button key={o.id} type="button" onClick={() => setOpenId(o.id)} className="block w-full rounded-2xl border border-border bg-card p-4 text-left active:scale-[0.99]">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">#{o.order_no} · {o.customer_name}</p>
                <Pill tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Pill>
              </div>
              <p className="mt-1 text-sm">{itemsSummary(o)}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{o.landmark || o.address || "Pinned location"}{km != null && ` · ${km.toFixed(1)} km`}</p>
              <p className="mt-2 font-display text-lg font-bold">{formatKES(o.total)}</p>
            </button>
          );
        })}
        {done.length > 0 && (
          <div className="pt-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Delivered and paid today</p>
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card text-sm">
              <PagedRows rows={done} list>{(pageRows) => pageRows.map((o) => (
                <li key={o.id} className="flex justify-between px-4 py-2.5"><span>#{o.order_no} · {o.customer_name}</span><span className="tabular-nums">{formatKES(o.total)}</span></li>
              ))}</PagedRows>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function RiderOrder({ order: o, me, onBack }: { order: WaterOrder; me: { lat: number; lng: number } | null; onBack: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const prompt = useOrderPrompt();
  const [busy, setBusy] = useState<string | null>(null);
  const [phone, setPhone] = useState(o.customer_phone || "");
  const [sent, setSent] = useState(false);
  const point = useMemo(() => orderPoint(o), [o]);
  // After a prompt, follow the sale so a failed or cancelled payment shows at once.
  const { data: sale } = useQuery({
    queryKey: ["rider-sale", o.transaction_id],
    enabled: sent && !!o.transaction_id && o.status !== "paid",
    refetchInterval: 4000,
    queryFn: async () => (await (supabase as any).from("transactions").select("status,mpesa_error_message").eq("id", o.transaction_id).maybeSingle()).data,
  });
  const failed = sent && sale && (sale.status === "failed" || sale.status === "cancelled") ? mpesaReason(sale.status, sale.mpesa_error_message) : null;

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["water-orders"] });
      toast({ title: done });
      return true;
    } catch (e: any) {
      toast({ title: "Could not do that", description: e.message, variant: "destructive" });
      return false;
    } finally { setBusy(null); }
  };

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-background pb-10">
      <header className="sticky top-0 z-[1100] flex items-center gap-2 border-b border-border bg-card/95 px-2 py-2 backdrop-blur">
        <button type="button" onClick={onBack} className="rounded-lg p-2 hover:bg-muted" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
        <p className="flex-1 font-semibold">Order #{o.order_no}</p>
        <Pill tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Pill>
      </header>

      {point ? <DeliveryMap to={point} me={me} className="h-[45vh] rounded-none border-x-0 border-t-0" showNavigate={false} />
        : <p className="p-4 text-sm text-muted-foreground">This order has no pinned location. Call the customer.</p>}

      <div className="space-y-4 p-4">
        {point && (
          <a href={directionsUrl(point)} target="_blank" rel="noopener noreferrer"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground">
            <Navigation className="h-5 w-5" /> Navigate{me ? ` · ${distanceKm(me, point).toFixed(1)} km` : ""}
          </a>
        )}

        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="font-semibold">{o.customer_name}</p>
          {(o.address || o.landmark) && <p className="mt-1 text-sm text-muted-foreground">{[o.address, o.landmark].filter(Boolean).join(" · ")}</p>}
          {o.notes && <p className="mt-2 rounded-lg bg-muted px-2 py-1.5 text-sm">“{o.notes}”</p>}
          {o.customer_phone && (
            <a href={`tel:${o.customer_phone}`} className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl border border-border font-medium"><Phone className="h-4 w-4" /> Call {o.customer_phone}</a>
          )}
        </div>

        <ul className="divide-y divide-border rounded-2xl border border-border bg-card text-sm">
          {o.items.map((i, k) => <li key={k} className="flex justify-between px-4 py-2.5"><span>{i.quantity} × {i.name}</span><span className="tabular-nums">{formatKES(i.price * i.quantity)}</span></li>)}
          <li className="flex justify-between px-4 py-3 text-base font-bold"><span>To collect</span><span className="tabular-nums">{formatKES(o.total)}</span></li>
        </ul>

        {o.status === "assigned" && (
          <Button className="h-12 w-full text-base" disabled={!!busy} onClick={() => run("go", () => orderAction(o.id, "on_the_way"), "Marked on the way. The customer can see it.")}>
            <Bike /> Picked up · on the way
          </Button>
        )}

        {["assigned", "on_the_way", "delivered"].includes(o.status) && (
          <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <p className="font-semibold">Delivered? Collect payment</p>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Customer's M-Pesa number</span>
              <input className="fi h-12 text-base" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <Button className="h-12 w-full text-base" disabled={!phone || !!busy}
              onClick={async () => { if (await run("mpesa", async () => { const sale = await chargeOrder(o.id, "mpesa"); await prompt(sale, phone); }, "Prompt sent. Ask the customer to enter their M-Pesa PIN.")) setSent(true); }}>
              <Smartphone /> {busy === "mpesa" ? "Sending…" : sent ? "Send the prompt again" : "Send M-Pesa prompt"}
            </Button>
            {failed ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">
                <p className="font-semibold text-destructive">{failed.title}</p>
                <p className="mt-0.5">{failed.reason}</p>
                <p className="mt-1 text-xs text-muted-foreground">{failed.advice}</p>
              </div>
            ) : sent && o.status !== "paid" && <p className="text-center text-xs text-muted-foreground">Waiting for the payment… this screen updates by itself.</p>}
            <Button variant="outline" className="h-12 w-full text-base" disabled={!!busy}
              onClick={async () => { if (await confirmAction({ title: `Confirm you received ${formatKES(o.total)} in cash?`, confirmLabel: "Confirm" })) run("cash", () => chargeOrder(o.id, "cash"), "Cash recorded. Order closed."); }}>
              <Banknote /> Cash received
            </Button>
          </div>
        )}

        {o.status === "paid" && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-success/30 bg-success/10 p-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-success" />
            <p className="font-semibold">Paid · order closed</p>
            <Button variant="outline" onClick={onBack}>Back to my deliveries</Button>
          </div>
        )}
      </div>
    </div>
  );
}
