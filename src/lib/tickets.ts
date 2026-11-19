/**
 * Support tickets of a shop. Staff (riders, cashiers…) and a water shop's
 * online customers open them; admins, managers and cashiers answer. All
 * changes go through the database functions ticket_open / ticket_reply /
 * ticket_update / ticket_mark_read; customers use water.js.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";

const sb: any = supabase;

export type TicketStatus = "open" | "in_progress" | "waiting" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export const TICKET_STATUS: Record<TicketStatus, { label: string; tone: "info" | "warning" | "primary" | "success" | "danger" | "muted" }> = {
  open: { label: "Open", tone: "danger" },
  in_progress: { label: "In progress", tone: "warning" },
  waiting: { label: "Waiting for reply", tone: "info" },
  resolved: { label: "Resolved", tone: "success" },
  closed: { label: "Closed", tone: "muted" },
};
export const TICKET_PRIORITY: Record<TicketPriority, { label: string; tone: "info" | "warning" | "primary" | "success" | "danger" | "muted" }> = {
  low: { label: "Low", tone: "muted" },
  normal: { label: "Normal", tone: "info" },
  high: { label: "High", tone: "warning" },
  urgent: { label: "Urgent", tone: "danger" },
};
export const TICKET_CATEGORIES: { value: string; label: string }[] = [
  { value: "delivery", label: "Delivery" },
  { value: "water_quality", label: "Water quality" },
  { value: "payment", label: "Payment" },
  { value: "rider", label: "Rider" },
  { value: "customer", label: "Customer" },
  { value: "equipment", label: "Equipment / bike" },
  { value: "stock", label: "Stock / tanks" },
  { value: "account", label: "Account" },
  { value: "general", label: "General" },
];
export const categoryLabel = (v: string) => TICKET_CATEGORIES.find((c) => c.value === v)?.label || v.replace(/_/g, " ");

export interface Ticket {
  id: string;
  tenant_id: string;
  ticket_no: number;
  source: "customer" | "staff";
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_by: string | null;
  created_by_name: string | null;
  order_id: string | null;
  subject: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_to: string | null;
  assigned_name: string | null;
  last_message_at: string;
  last_message_by: "requester" | "shop";
  unread_by_shop: boolean;
  unread_by_requester: boolean;
  resolved_at: string | null;
  created_at: string;
}
export interface TicketMessage {
  id: string;
  ticket_id: string;
  author_kind: "customer" | "staff" | "system";
  author_id: string | null;
  author_name: string | null;
  body: string;
  internal: boolean;
  created_at: string;
}

/** Admins, managers and cashiers answer tickets. */
export const isTicketHandler = (role?: string | null) => ["admin", "manager", "cashier", "super_admin"].includes(String(role || ""));

function useTicketsLive(on: boolean, tenantId: string | null | undefined, name: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!on || !tenantId) return;
    const ch = supabase.channel(`tickets-${name}-${tenantId}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "support_tickets", filter: `tenant_id=eq.${tenantId}` }, () => {
        qc.invalidateQueries({ queryKey: ["tickets", tenantId] });
        qc.invalidateQueries({ queryKey: ["ticket-messages"] });
        qc.invalidateQueries({ queryKey: ["tickets-count", tenantId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [on, tenantId, name, qc]);
}

/** Tickets the signed-in person can see (all of the shop's for handlers, their own otherwise). */
export function useTickets(opts: { mine?: boolean; enabled?: boolean } = {}) {
  const tenantId = useTenantId();
  const { user } = useAuth();
  const on = (opts.enabled ?? true) && !!tenantId;
  useTicketsLive(on, tenantId, opts.mine ? "mine" : "list");
  return useQuery({
    queryKey: ["tickets", tenantId, opts.mine ? user?.id : "all"],
    enabled: on,
    refetchInterval: 120_000,
    queryFn: async (): Promise<Ticket[]> => {
      let q = sb.from("support_tickets").select("*").eq("tenant_id", tenantId).order("last_message_at", { ascending: false }).limit(500);
      if (opts.mine) q = q.eq("created_by", user?.id);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });
}

export function useTicketMessages(ticketId: string | null) {
  return useQuery({
    queryKey: ["ticket-messages", ticketId],
    enabled: !!ticketId,
    refetchInterval: 60_000,
    queryFn: async (): Promise<TicketMessage[]> => {
      const { data, error } = await sb.from("support_ticket_messages").select("*").eq("ticket_id", ticketId).order("created_at");
      if (error) throw error;
      return data || [];
    },
  });
}

/** Sidebar badge: tickets waiting for the shop (handlers) or unread replies (everyone else). */
export function useOpenTicketCount(enabled: boolean) {
  const tenantId = useTenantId();
  const { user, role } = useAuth() as any;
  const handler = isTicketHandler(role);
  const on = enabled && !!tenantId && !!user;
  useTicketsLive(on, tenantId, "count");
  const { data = 0 } = useQuery({
    queryKey: ["tickets-count", tenantId, handler ? "shop" : user?.id],
    enabled: on,
    refetchInterval: 300_000,
    queryFn: async () => {
      let q = sb.from("support_tickets").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
      q = handler ? q.eq("unread_by_shop", true) : q.eq("created_by", user.id).eq("unread_by_requester", true);
      const { count, error } = await q;
      if (error) return 0; // tickets not set up yet on this database
      return count || 0;
    },
  });
  return data;
}

const call = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};

export const openTicket = (t: { subject: string; body: string; category?: string; priority?: TicketPriority; customerId?: string | null; orderId?: string | null }) =>
  call("ticket_open", {
    p_subject: t.subject, p_body: t.body, p_category: t.category || "general", p_priority: t.priority || "normal",
    p_customer: t.customerId || null, p_order: t.orderId || null,
  }) as Promise<Ticket>;

export const replyTicket = (ticketId: string, body: string, internal = false, status: TicketStatus | null = null) =>
  call("ticket_reply", { p_ticket: ticketId, p_body: body, p_internal: internal, p_status: status }) as Promise<Ticket>;

export const updateTicket = (ticketId: string, patch: { status?: TicketStatus; priority?: TicketPriority; assign?: string | null; unassign?: boolean }) =>
  call("ticket_update", {
    p_ticket: ticketId, p_status: patch.status ?? null, p_priority: patch.priority ?? null,
    p_assign: patch.assign ?? null, p_unassign: !!patch.unassign,
  }) as Promise<Ticket>;

export const markTicketRead = (ticketId: string) => call("ticket_mark_read", { p_ticket: ticketId }).catch(() => undefined);
