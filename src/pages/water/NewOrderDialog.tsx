import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Droplets, Minus, Plus, UserPlus, Search, MapPin } from "lucide-react";
import { Modal, Field } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import { formatLitres } from "@/lib/businessType";
import { LocationPicker, type LatLng } from "@/components/maps/Maps";

const sb: any = supabase;

/** Reception takes an order for a customer who calls or walks in to book a delivery. */
export default function NewOrderDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (orderId: string) => void }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [cust, setCust] = useState<any | null>(null);
  const [newCust, setNewCust] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [useSaved, setUseSaved] = useState(true);
  const [point, setPoint] = useState<LatLng | null>(null);
  const [area, setArea] = useState("");
  const [building, setBuilding] = useState("");
  const [landmark, setLandmark] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: customers = [] } = useQuery({
    queryKey: ["order-customers", tenantId, q],
    enabled: !!tenantId && q.trim().length >= 2,
    queryFn: async () => {
      const t = q.trim().replace(/[%,()]/g, "");
      const { data } = await sb.from("customers").select("id,name,phone,lat,lng,address,area,building,landmark")
        .eq("tenant_id", tenantId).or(`name.ilike.%${t}%,phone.ilike.%${t}%`).limit(8);
      return data || [];
    },
  });
  const { data: sizes = [] } = useQuery({
    queryKey: ["water-sizes-order", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await sb.from("products").select("id,name,price,litres,container_litres").eq("tenant_id", tenantId).eq("is_active", true)
      .or("litres.not.is.null,container_litres.not.is.null")).data || [],
  });
  // Refill sizes (by size), then empty bottles / jerricans.
  const refills = sizes.filter((s: any) => Number(s.litres) > 0).sort((a: any, b: any) => Number(a.litres) - Number(b.litres));
  const containers = sizes.filter((s: any) => !(Number(s.litres) > 0)).sort((a: any, b: any) => Number(a.container_litres) - Number(b.container_litres));

  const lines = sizes.filter((s: any) => (qty[s.id] || 0) > 0);
  const total = lines.reduce((a: number, s: any) => a + Number(s.price) * qty[s.id], 0);
  const saved = cust && cust.lat != null && cust.lng != null ? { lat: Number(cust.lat), lng: Number(cust.lng) } : null;
  const where = useSaved && saved ? saved : point;
  const set = (id: string, n: number) => setQty((x) => ({ ...x, [id]: Math.max(0, Math.min(500, n)) }));
  const ready = (cust || (newCust && name.trim() && phone.trim())) && lines.some((s: any) => Number(s.litres) > 0) && where;

  const pickCustomer = (c: any) => {
    setCust(c); setNewCust(false); setQ("");
    setUseSaved(c.lat != null);
    setArea(c.area || ""); setBuilding(c.building || c.address || ""); setLandmark(c.landmark || "");
  };

  const submit = async () => {
    setBusy(true);
    try {
      let customerId = cust?.id;
      const details = { area: area || null, building: building || null, landmark: landmark || null, address: [area, building].filter(Boolean).join(", ") || null };
      if (!customerId) {
        const { data, error } = await sb.from("customers").insert({
          tenant_id: tenantId, name: name.trim(), phone: phone.trim(), ...details,
          ...(where ? { lat: where.lat, lng: where.lng } : {}),
        }).select("id").single();
        if (error) throw error;
        customerId = data.id;
      } else if (!saved && where) {
        // First pin for this customer: keep it for next time.
        await sb.from("customers").update({ lat: where.lat, lng: where.lng, ...details }).eq("id", customerId);
      }
      const { data: order, error } = await sb.rpc("water_staff_place_order", {
        p_customer: customerId,
        p_items: lines.map((s: any) => ({ product_id: s.id, quantity: qty[s.id] })),
        p_lat: where!.lat, p_lng: where!.lng,
        p_address: details.address, p_landmark: landmark || null, p_notes: notes || null,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["water-orders"] });
      toast({ title: `Order #${order.order_no} created`, description: "Assign a rider to send it out." });
      onCreated(order.id);
    } catch (e: any) {
      toast({ title: "Could not create the order", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} size="xl" icon={Droplets} title="New delivery order" locked={busy}
      footer={<>
        <div className="mr-auto hidden text-sm sm:block">Total <span className="font-display text-lg font-bold">{formatKES(total)}</span></div>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!ready || busy} onClick={submit}>{busy ? "Saving…" : "Create order"}</Button>
      </>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="Customer">
            {cust ? (
              <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
                <div><p className="font-medium">{cust.name}</p><p className="text-xs text-muted-foreground">{cust.phone}</p></div>
                <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setCust(null)}>Change</button>
              </div>
            ) : newCust ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <input className="fi" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoFocus />
                <input className="fi" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" inputMode="tel" />
                <button type="button" className="text-left text-xs font-medium text-primary hover:underline" onClick={() => setNewCust(false)}>Search existing instead</button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input className="fi pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone…" autoFocus />
                </div>
                {customers.length > 0 && (
                  <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                    {customers.map((c: any) => (
                      <li key={c.id}><button type="button" className="flex w-full justify-between px-3 py-2 text-left hover:bg-muted/60" onClick={() => pickCustomer(c)}>
                        <span>{c.name}</span><span className="text-muted-foreground">{c.phone}</span></button></li>
                    ))}
                  </ul>
                )}
                <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => { setNewCust(true); setUseSaved(false); }}>
                  <UserPlus className="h-3.5 w-3.5" /> New customer
                </button>
              </div>
            )}
          </Field>

          <Field label="What to deliver">
            <div className="grid grid-cols-2 gap-2">
              {refills.map((s: any) => {
                const n = qty[s.id] || 0;
                return (
                  <div key={s.id} className={`flex items-center justify-between rounded-xl border px-3 py-2 ${n ? "border-primary bg-primary/5" : "border-border"}`}>
                    <div><p className="font-semibold">{formatLitres(Number(s.litres))}</p><p className="text-xs text-muted-foreground">{formatKES(Number(s.price))}</p></div>
                    <div className="flex items-center gap-1">
                      <button type="button" className="icon-btn h-7 w-7" disabled={!n} onClick={() => set(s.id, n - 1)} aria-label="Less"><Minus className="h-3.5 w-3.5" /></button>
                      <span className="w-6 text-center tabular-nums">{n}</span>
                      <button type="button" className="icon-btn h-7 w-7" onClick={() => set(s.id, n + 1)} aria-label="More"><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                );
              })}
              {refills.length === 0 && <p className="col-span-2 text-sm text-muted-foreground">Add refill sizes on the Refill sizes & items page first.</p>}
            </div>
          </Field>
          {containers.length > 0 && (
            <Field label="Bottles / jerricans" hint="Only if the customer needs a container">
              <div className="grid grid-cols-2 gap-2">
                {containers.map((s: any) => {
                  const n = qty[s.id] || 0;
                  return (
                    <div key={s.id} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${n ? "border-primary bg-primary/5" : "border-border"}`}>
                      <div className="min-w-0"><p className="truncate text-sm font-semibold">{s.name}</p><p className="text-xs text-muted-foreground">{formatKES(Number(s.price))}</p></div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button type="button" className="icon-btn h-7 w-7" disabled={!n} onClick={() => set(s.id, n - 1)} aria-label="Less"><Minus className="h-3.5 w-3.5" /></button>
                        <span className="w-6 text-center tabular-nums">{n}</span>
                        <button type="button" className="icon-btn h-7 w-7" onClick={() => set(s.id, n + 1)} aria-label="More"><Plus className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Field>
          )}
          <Field label="Note for the rider" hint="Optional"><input className="fi" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">Deliver to</p>
          {saved && (
            <div className="flex gap-2 text-sm">
              <button type="button" className={`rounded-lg px-3 py-1.5 ${useSaved ? "bg-primary text-primary-foreground" : "bg-muted"}`} onClick={() => setUseSaved(true)}><MapPin className="mr-1 inline h-3.5 w-3.5" />Saved place</button>
              <button type="button" className={`rounded-lg px-3 py-1.5 ${!useSaved ? "bg-primary text-primary-foreground" : "bg-muted"}`} onClick={() => setUseSaved(false)}>Another place</button>
            </div>
          )}
          {!(useSaved && saved) && <LocationPicker value={point} onChange={setPoint} />}
          {useSaved && saved && <p className="rounded-xl bg-muted px-3 py-2 text-sm">{[cust?.area, cust?.building, cust?.landmark].filter(Boolean).join(" · ") || "Pinned on the map"}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="fi" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Estate / area" />
            <input className="fi" value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="House / apartment, floor" />
          </div>
          <input className="fi" value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Landmark" />
          {!useSaved && !point && <p className="text-xs text-muted-foreground">Ask the customer where they are and tap that spot on the map.</p>}
        </div>
      </div>
    </Modal>
  );
}
