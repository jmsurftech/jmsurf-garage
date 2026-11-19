/**
 * Water delivery orders, shared by the reception page and the rider screen.
 * Orders change only through the database functions water_order_action /
 * water_order_charge; payment prompts reuse the till's payment routes.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useBusinessSettings } from "@/hooks/useData";
import { useTenant } from "@/hooks/useTenant";
import { darajaMpesaPrompt, jmsurfMpesaPrompt, posMpesaPrompt } from "@/lib/serverPayments";

const sb: any = supabase;

export type OrderStatus = "new" | "accepted" | "assigned" | "on_the_way" | "delivered" | "paid" | "cancelled";

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: "info" | "warning" | "primary" | "success" | "danger" | "muted" }> = {
  new: { label: "New", tone: "danger" },
  accepted: { label: "Accepted", tone: "warning" },
  assigned: { label: "Rider assigned", tone: "primary" },
  on_the_way: { label: "On the way", tone: "info" },
  delivered: { label: "Awaiting payment", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export interface WaterOrder {
  id: string;
  order_no: number;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  items: { product_id: string; name: string; litres: number; price: number; quantity: number }[];
  subtotal: number;
  total: number;
  litres_total: number;
  lat: number | null;
  lng: number | null;
  address: string | null;
  landmark: string | null;
  notes: string | null;
  status: OrderStatus;
  rider_id: string | null;
  rider_name: string | null;
  transaction_id: string | null;
  payment_method: string | null;
  cancel_reason: string | null;
  created_at: string;
  accepted_at: string | null;
  assigned_at: string | null;
  picked_at: string | null;
  delivered_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  rider_lat?: number | null;
  rider_lng?: number | null;
  rider_seen_at?: string | null;
}

/** Where the rider was last seen (only while delivering, and only if recent). */
export const riderPoint = (o: Pick<WaterOrder, "rider_lat" | "rider_lng" | "rider_seen_at" | "status">) =>
  o.rider_lat != null && o.rider_lng != null && ["assigned", "on_the_way", "delivered"].includes(o.status)
    && o.rider_seen_at && Date.now() - new Date(o.rider_seen_at).getTime() < 30 * 60_000
    ? { lat: Number(o.rider_lat), lng: Number(o.rider_lng) } : null;

/** Orders of the shop (or of one rider / customer), kept live. */
export function useWaterOrders(opts: { riderId?: string; customerId?: string; enabled?: boolean } = {}) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const on = (opts.enabled ?? true) && !!tenantId;
  const key = ["water-orders", tenantId, opts.riderId || "", opts.customerId || ""];
  useEffect(() => {
    if (!on) return;
    const ch = supabase.channel(`water-orders-${tenantId}-${opts.riderId || opts.customerId || "all"}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "water_orders", filter: `tenant_id=eq.${tenantId}` },
        () => qc.invalidateQueries({ queryKey: ["water-orders", tenantId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [on, tenantId, opts.riderId, opts.customerId, qc]);
  return useQuery({
    queryKey: key,
    enabled: on,
    refetchInterval: 60_000,
    queryFn: async (): Promise<WaterOrder[]> => {
      let q = sb.from("water_orders").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500);
      if (opts.riderId) q = q.eq("rider_id", opts.riderId);
      if (opts.customerId) q = q.eq("customer_id", opts.customerId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map((o: any) => ({ ...o, total: Number(o.total), subtotal: Number(o.subtotal), litres_total: Number(o.litres_total) }));
    },
  });
}

export function useOrderEvents(orderId: string | null) {
  return useQuery({
    queryKey: ["water-order-events", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await sb.from("water_order_events").select("*").eq("order_id", orderId).order("created_at");
      if (error) throw error;
      return data || [];
    },
  });
}

/** Riders of the shop (staff with the rider role). */
export function useRiders() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["riders", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data: profiles, error } = await sb.from("profiles").select("user_id, display_name, phone").eq("tenant_id", tenantId);
      if (error) throw error;
      const ids = (profiles || []).map((p: any) => p.user_id);
      if (!ids.length) return [];
      const { data: roles } = await sb.from("user_roles").select("user_id, role").in("user_id", ids).eq("role", "rider");
      const riderIds = new Set((roles || []).map((r: any) => r.user_id));
      return (profiles || []).filter((p: any) => riderIds.has(p.user_id)) as { user_id: string; display_name: string | null; phone: string | null }[];
    },
  });
}

export async function orderAction(orderId: string, action: "accept" | "assign" | "on_the_way" | "delivered" | "cancel", rider?: string | null, note?: string | null) {
  const { data, error } = await sb.rpc("water_order_action", { p_order: orderId, p_action: action, p_rider: rider ?? null, p_note: note ?? null });
  if (error) throw new Error(error.message);
  return data as WaterOrder;
}

/** Creates the order's sale. Cash completes it at once (the order closes as paid). */
export async function chargeOrder(orderId: string, method: "mpesa" | "cash") {
  const { data, error } = await sb.rpc("water_order_charge", { p_order: orderId, p_method: method });
  if (error) throw new Error(error.message);
  return data as { transaction_id: string; total: number; resumed?: boolean; phone?: string };
}

/** Sends the M-Pesa prompt for an order's pending sale through the shop's gateway. */
export function useOrderPrompt() {
  const { data: biz } = useBusinessSettings();
  const { tenant } = useTenant() as any;
  const tenantId = useTenantId();
  return async (sale: { transaction_id: string; total: number }, phone: string) => {
    const provider = (biz as any)?.payment_provider;
    const slug = tenant?.slug || null;
    if (provider === "jmsurf") {
      const { data, error } = await jmsurfMpesaPrompt({ tenant_id: tenantId, pos_transaction_id: sale.transaction_id, phone });
      if (error || !data?.success) throw new Error(error || "JMSURF PAY did not confirm the prompt");
      return;
    }
    if (provider === "daraja") {
      const { data, error } = await darajaMpesaPrompt({
        phone, amount: sale.total, tenant_slug: slug, tenant_id: tenantId, transaction_id: sale.transaction_id,
        account_ref: String((biz as any)?.mpesa_account_reference || (biz as any)?.business_name || slug || "WATER").slice(0, 12),
      });
      if (error || !data?.success) throw new Error(error || data?.error || "M-Pesa did not accept the prompt");
      return;
    }
    if (["mpesa", "payhero", "bank"].includes(provider)) {
      const { data, error } = await posMpesaPrompt({
        phone, amount: sale.total, tenant_id: tenantId, tenant_slug: slug, pos_transaction_id: sale.transaction_id,
        account_ref: String((biz as any)?.mpesa_account_reference || slug || "JMSURF").slice(0, 12), prompt_label: "jmsurf",
      });
      if (error || !data?.success) throw new Error(error || data?.error || "M-Pesa did not accept the prompt");
      return;
    }
    throw new Error("M-Pesa prompts are not set up for this shop. Take cash, or set up M-Pesa in Settings.");
  };
}

export const orderPoint = (o: Pick<WaterOrder, "lat" | "lng">) =>
  o.lat != null && o.lng != null ? { lat: Number(o.lat), lng: Number(o.lng) } : null;

export const itemsSummary = (o: Pick<WaterOrder, "items">) =>
  (o.items || []).map((i) => `${i.quantity} × ${i.name}`).join(", ");

/** Number of orders waiting to be accepted (sidebar badge), kept live. */
export function useNewOrderCount(enabled: boolean) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const on = enabled && !!tenantId;
  useEffect(() => {
    if (!on) return;
    const ch = supabase.channel(`water-orders-count-${tenantId}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "water_orders", filter: `tenant_id=eq.${tenantId}` },
        () => qc.invalidateQueries({ queryKey: ["water-orders-new", tenantId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [on, tenantId, qc]);
  const { data = 0 } = useQuery({
    queryKey: ["water-orders-new", tenantId],
    enabled: on,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { count } = await sb.from("water_orders").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "new");
      return count || 0;
    },
  });
  return data;
}
