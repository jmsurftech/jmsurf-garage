import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Truck, Phone, MapPin, Check, X, Bike, Banknote, Smartphone, Clock, Copy, Droplets, ExternalLink, PackageCheck, Plus } from "lucide-react";
import { PageHeader, Toolbar, SearchBox, Segmented, EmptyState, Modal, Field, StatTile, StatGrid, PageLoader, Pill, Panel, TableWrap } from "@/components/kit";
import NewOrderDialog from "@/pages/water/NewOrderDialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/hooks/useTenant";
import { formatKES } from "@/lib/format";
import { tenantUrl } from "@/lib/host";
import { DeliveryMap, directionsUrl } from "@/components/maps/Maps";
import {
  ORDER_STATUS, type WaterOrder, useWaterOrders, useRiders, useOrderEvents, orderAction, chargeOrder, useOrderPrompt,
  orderPoint, itemsSummary, riderPoint,
} from "@/lib/waterOrders";

import { PagedRows } from "@/components/Pager";
type Filter = "active" | "new" | "delivery" | "unpaid" | "paid" | "cancelled" | "done" | "all";

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString();
};

/**
 * Reception. view "active": live orders (new, with a rider, awaiting payment)
 * with a New order button for customers who call in. view "done": delivered
 * (paid) and cancelled orders.
 */
export default function WaterOrders({ view = "active" }: { view?: "active" | "done" }) {
  const { data: orders = [], isLoading } = useWaterOrders();
  const { tenant } = useTenant() as any;
  const { toast } = useToast();
  const isDone = view === "done";
  const [filter, setFilter] = useState<Filter>(isDone ? "paid" : "active");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const count = (f: Filter) => orders.filter((o) => match(o, f)).length;
  const shown = useMemo(() => orders.filter((o) => match(o, filter)
    && (!search.trim() || `${o.order_no} ${o.customer_name || ""} ${o.customer_phone || ""} ${o.landmark || ""} ${o.address || ""} ${o.rider_name || ""}`
      .toLowerCase().includes(search.trim().toLowerCase()))), [orders, filter, search]);
  const today = new Date().toDateString();
  const paidToday = orders.filter((o) => o.status === "paid" && o.paid_at && new Date(o.paid_at).toDateString() === today);
  const open = orders.find((o) => o.id === openId) || null;
  const portal = tenant?.slug ? tenantUrl(tenant.slug, "/") : null;
  const paidAll = orders.filter((o) => o.status === "paid");

  if (isLoading) return <PageLoader label="Loading orders…" />;

  if (isDone) return (
    <div className="space-y-5">
      <PageHeader title="Delivered orders" icon={PackageCheck} description="Orders delivered and paid, and orders that were cancelled." />
      <StatGrid className="lg:grid-cols-3">
        <StatTile label="Delivered and paid" value={paidAll.length} hint={`${paidAll.reduce((a, o) => a + o.litres_total, 0).toLocaleString()} L`} icon={PackageCheck} tone="success" />
        <StatTile label="Collected" value={formatKES(paidAll.reduce((a, o) => a + o.total, 0))} icon={Banknote} tone="primary" />
        <StatTile label="Paid today" value={formatKES(paidToday.reduce((a, o) => a + o.total, 0))} hint={`${paidToday.length} order${paidToday.length === 1 ? "" : "s"}`} icon={Clock} tone="info" className="col-span-2 lg:col-span-1" />
      </StatGrid>
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Order no, customer, place, rider…" />
        <Segmented value={filter} onChange={(v) => setFilter(v as Filter)} options={[
          { value: "paid", label: "Delivered", count: count("paid") },
          { value: "cancelled", label: "Cancelled", count: count("cancelled") },
          { value: "done", label: "All", count: count("done") },
        ]} />
      </Toolbar>
      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50"><EmptyState icon={PackageCheck} title="Nothing here yet" /></div>
      ) : (
        <Panel flush>
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th className="text-right">Litres</th><th className="text-right">Amount</th><th>Rider</th><th>Paid</th><th>Status</th></tr></thead>
              <tbody>
                <PagedRows rows={shown} colSpan={8}>{(pageRows) => pageRows.map((o) => (
                  <tr key={o.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setOpenId(o.id)}>
                    <td className="font-medium">#{o.order_no}</td>
                    <td>{o.customer_name}</td>
                    <td className="max-w-[220px] truncate text-xs">{itemsSummary(o)}</td>
                    <td className="text-right tabular-nums">{o.litres_total.toLocaleString()}</td>
                    <td className="text-right tabular-nums">{formatKES(o.total)}</td>
                    <td className="text-xs">{o.rider_name || "—"}</td>
                    <td className="whitespace-nowrap text-xs">{o.paid_at ? `${new Date(o.paid_at).toLocaleString()} · ${o.payment_method === "mpesa" ? "M-Pesa" : "Cash"}` : "—"}</td>
                    <td><Pill tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Pill></td>
                  </tr>
                ))}</PagedRows>
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      )}
      {open && <OrderDialog order={open} onClose={() => setOpenId(null)} />}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Orders" icon={Truck}
        description="Orders from your customers' page pop up here. Accept, give to a rider, and get paid on delivery."
        actions={<>
          {portal && (
            <Button variant="outline" onClick={() => { navigator.clipboard?.writeText(portal); toast({ title: "Ordering link copied", description: portal }); }}>
              <Copy /> Customer link
            </Button>
          )}
          <Button onClick={() => setCreating(true)}><Plus /> New order</Button>
        </>} />

      <StatGrid className="lg:grid-cols-4">
        <StatTile label="New" value={count("new")} icon={Clock} tone={count("new") ? "danger" : "muted"} />
        <StatTile label="Out for delivery" value={count("delivery")} icon={Bike} tone="info" />
        <StatTile label="Awaiting payment" value={count("unpaid")} icon={Smartphone} tone="warning" />
        <StatTile label="Paid today" value={formatKES(paidToday.reduce((a, o) => a + o.total, 0))}
          hint={`${paidToday.length} order${paidToday.length === 1 ? "" : "s"} · ${paidToday.reduce((a, o) => a + o.litres_total, 0).toLocaleString()} L`} icon={Banknote} tone="success" />
      </StatGrid>

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Order no, customer, place, rider…" />
        <Segmented value={filter} onChange={(v) => setFilter(v as Filter)} options={[
          { value: "active", label: "Active", count: count("active") },
          { value: "new", label: "New", count: count("new") },
          { value: "delivery", label: "On delivery", count: count("delivery") },
          { value: "unpaid", label: "Awaiting payment", count: count("unpaid") },
        ]} />
      </Toolbar>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50">
          <EmptyState icon={Truck} title={orders.length ? "Nothing here" : "No orders yet"}
            description={orders.length ? undefined : `Share your ordering link with customers${portal ? `: ${portal}` : ""}. Their orders appear here with a sound.`} />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          <PagedRows rows={shown} gridSpan>{(pageRows) => pageRows.map((o) => (
            <button key={o.id} type="button" onClick={() => setOpenId(o.id)}
              className={`rounded-2xl border bg-card p-4 text-left transition hover:border-primary/50 ${o.status === "new" ? "border-destructive/50 ring-1 ring-destructive/20" : "border-border"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">#{o.order_no} · {o.customer_name || "Customer"}</p>
                  <p className="text-xs text-muted-foreground">{ago(o.created_at)}{o.rider_name ? ` · ${o.rider_name}` : ""}</p>
                </div>
                <Pill tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Pill>
              </div>
              <p className="mt-2 line-clamp-2 text-sm">{itemsSummary(o)}</p>
              <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="h-3 w-3 shrink-0" />{o.landmark || o.address || "Pinned location"}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{o.litres_total.toLocaleString()} L</span>
                <span className="font-display text-lg font-bold">{formatKES(o.total)}</span>
              </div>
            </button>
          ))}</PagedRows>
        </div>
      )}

      {open && <OrderDialog order={open} onClose={() => setOpenId(null)} />}
      {creating && <NewOrderDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} />}
    </div>
  );
}

function match(o: WaterOrder, f: Filter) {
  switch (f) {
    case "active": return !["paid", "cancelled"].includes(o.status);
    case "new": return o.status === "new";
    case "delivery": return o.status === "assigned" || o.status === "on_the_way";
    case "unpaid": return o.status === "delivered";
    case "paid": return o.status === "paid";
    case "cancelled": return o.status === "cancelled";
    case "done": return o.status === "paid" || o.status === "cancelled";
    default: return true;
  }
}

/** One order: map, items, timeline and the actions for its current step. */
export function OrderDialog({ order: o, onClose }: { order: WaterOrder; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: riders = [] } = useRiders();
  const { data: events = [] } = useOrderEvents(o.id);
  const prompt = useOrderPrompt();
  const [rider, setRider] = useState(o.rider_id || "");
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [phone, setPhone] = useState(o.customer_phone || "");
  const point = orderPoint(o);
  const closed = o.status === "paid" || o.status === "cancelled";

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["water-orders"] });
      qc.invalidateQueries({ queryKey: ["water-order-events", o.id] });
      toast({ title: done });
    } catch (e: any) {
      toast({ title: "Could not do that", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const mpesa = () => run("mpesa", async () => {
    const sale = await chargeOrder(o.id, "mpesa");
    await prompt(sale, phone);
  }, "M-Pesa prompt sent. The order closes when the customer pays.");

  return (
    <Modal open onClose={onClose} size="xl" icon={Droplets} title={`Order #${o.order_no}`}
      description={<>{ORDER_STATUS[o.status].label} · placed {new Date(o.created_at).toLocaleString()}</>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          {point ? <DeliveryMap to={point} me={riderPoint(o)} label={String(o.order_no).slice(-3)} className="h-64" /> : <p className="text-sm text-muted-foreground">No location on this order.</p>}
          <div className="rounded-xl border border-border p-3 text-sm">
            <p className="font-semibold">{o.customer_name}</p>
            {o.customer_phone && <a href={`tel:${o.customer_phone}`} className="mt-1 flex items-center gap-1.5 text-primary"><Phone className="h-3.5 w-3.5" />{o.customer_phone}</a>}
            {(o.landmark || o.address) && <p className="mt-1 flex items-start gap-1.5 text-muted-foreground"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{[o.address, o.landmark].filter(Boolean).join(" · ")}</p>}
            {o.notes && <p className="mt-2 rounded-lg bg-muted px-2 py-1.5 text-xs">“{o.notes}”</p>}
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <Link to={`/customers/${o.customer_id}`} className="font-medium text-primary hover:underline">Customer details</Link>
              {point && <a href={directionsUrl(point)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">Directions <ExternalLink className="h-3 w-3" /></a>}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <ul className="divide-y divide-border rounded-xl border border-border text-sm">
            {o.items.map((i, k) => (
              <li key={k} className="flex justify-between gap-2 px-3 py-2"><span>{i.quantity} × {i.name}</span><span className="tabular-nums">{formatKES(i.price * i.quantity)}</span></li>
            ))}
            <li className="flex justify-between px-3 py-2 font-semibold"><span>Total · {o.litres_total.toLocaleString()} L</span><span className="tabular-nums">{formatKES(o.total)}</span></li>
          </ul>

          {!closed && (
            <div className="space-y-3 rounded-xl border border-border p-3">
              {o.status === "new" && (
                <Button className="w-full" disabled={!!busy} onClick={() => run("accept", () => orderAction(o.id, "accept"), "Order accepted")}><Check /> Accept order</Button>
              )}
              {["new", "accepted", "assigned", "on_the_way"].includes(o.status) && (
                <Field label="Rider" hint={riders.length ? undefined : "Add a staff member with the Rider role under Staff."}>
                  <div className="flex gap-2">
                    <select className="fi flex-1" value={rider} onChange={(e) => setRider(e.target.value)}>
                      <option value="">Choose a rider…</option>
                      {riders.map((r) => <option key={r.user_id} value={r.user_id}>{r.display_name || r.phone || "Rider"}</option>)}
                    </select>
                    <Button disabled={!rider || rider === o.rider_id || !!busy} onClick={() => run("assign", () => orderAction(o.id, "assign", rider), "Rider assigned")}><Bike /> Assign</Button>
                  </div>
                </Field>
              )}
              {["assigned", "on_the_way", "delivered"].includes(o.status) && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Take payment</p>
                  <div className="flex gap-2">
                    <input className="fi flex-1" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="M-Pesa number" />
                    <Button disabled={!phone || !!busy} onClick={mpesa}><Smartphone /> {busy === "mpesa" ? "Sending…" : "M-Pesa"}</Button>
                  </div>
                  <Button variant="outline" className="w-full" disabled={!!busy}
                    onClick={() => run("cash", () => chargeOrder(o.id, "cash"), "Cash recorded. Order closed.")}><Banknote /> Cash received</Button>
                </div>
              )}
              {!cancelling ? (
                <button type="button" className="text-xs font-medium text-destructive hover:underline" onClick={() => setCancelling(true)}>Cancel this order</button>
              ) : (
                <div className="flex gap-2">
                  <input className="fi flex-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (the customer sees it)" />
                  <Button variant="destructive" disabled={!!busy} onClick={() => run("cancel", () => orderAction(o.id, "cancel", null, reason || "Cancelled by the shop"), "Order cancelled")}><X /> Cancel</Button>
                </div>
              )}
            </div>
          )}
          {o.status === "cancelled" && o.cancel_reason && <p className="text-sm text-muted-foreground">Reason: {o.cancel_reason}</p>}

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Timeline</p>
            <ol className="space-y-2 border-l border-border pl-4 text-sm">
              {events.map((e: any) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                  <span className="font-medium">{ORDER_STATUS[e.status as keyof typeof ORDER_STATUS]?.label || e.status}</span>
                  {e.note && <span className="text-muted-foreground"> · {e.note}</span>}
                  <span className="block text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()} · {e.by_name}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </Modal>
  );
}
