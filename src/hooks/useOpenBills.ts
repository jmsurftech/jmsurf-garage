import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import type { PickedItem } from "@/components/ItemPicker";

export interface BillLine extends PickedItem {
  quantity: number;
}

export interface OpenBill {
  id: string;
  tenant_id: string;
  location_id: string | null;
  bill_number: string | null;
  label: string;
  customer_id: string | null;
  customer_name: string | null;
  items: BillLine[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  amount_paid: number;
  status: "open" | "paid" | "void";
  opened_by: string | null;
  opened_by_name: string | null;
  printed_at: string | null;
  closed_at: string | null;
  transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

const sb: any = supabase;

// Never let a missing or malformed stored value turn a bill total into NaN.
export function safeNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function computeTotals(items: BillLine[], vatInclusive = true) {
  const subtotal = items.reduce((s, i) => s + safeNum(i.price) * safeNum(i.quantity, 1), 0);
  // vat is assumed to already be included in item prices (matches POS convention);
  // approximate the VAT portion per line using each item's vat_rate.
  const tax = items.reduce((s, i) => {
    const rate = safeNum(i.vat_rate);
    const lineTotal = safeNum(i.price) * safeNum(i.quantity, 1);
    return s + (rate > 0 ? lineTotal - lineTotal / (1 + rate / 100) : 0);
  }, 0);
  return { subtotal, tax, total: subtotal };
}

export { computeTotals };

export function useOpenBills(statusFilter: "open" | "paid_today" | "all" = "open") {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["open-bills", tenantId, statusFilter],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = sb.from("open_bills").select("*").eq("tenant_id", tenantId);
      if (statusFilter === "open") {
        q = q.eq("status", "open");
      } else if (statusFilter === "paid_today") {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        q = q.eq("status", "paid").gte("closed_at", start.toISOString());
      }
      q = q.order("created_at", { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as OpenBill[];
    },
  });
}

export function useOpenBill(id: string | null) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["open-bill", id],
    enabled: !!id && !!tenantId,
    queryFn: async () => {
      const { data, error } = await sb.from("open_bills").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as OpenBill | null;
    },
    refetchInterval: 5000,
  });
}

export function useCreateOpenBill() {
  const tenantId = useTenantId();
  const { user, profile } = useAuth() as any;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ label, locationId }: { label: string; locationId: string | null }) => {
      const billNumber = `TAB-${Date.now().toString().slice(-6)}`;
      const { data, error } = await sb
        .from("open_bills")
        .insert({
          tenant_id: tenantId,
          location_id: locationId,
          label,
          bill_number: billNumber,
          items: [],
          subtotal: 0,
          tax: 0,
          discount: 0,
          total: 0,
          amount_paid: 0,
          status: "open",
          opened_by: user?.id || null,
          opened_by_name: profile?.display_name || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as OpenBill;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["open-bills"] });
    },
  });
}

export function useUpdateBillItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bill, items }: { bill: OpenBill; items: BillLine[] }) => {
      const { subtotal, tax, total } = computeTotals(items);
      const { error } = await sb
        .from("open_bills")
        .update({ items, subtotal, tax, total, updated_at: new Date().toISOString() })
        .eq("id", bill.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["open-bill", vars.bill.id] });
      qc.invalidateQueries({ queryKey: ["open-bills"] });
    },
  });
}

export function useVoidBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (billId: string) => {
      const { error } = await sb
        .from("open_bills")
        .update({ status: "void", closed_at: new Date().toISOString() })
        .eq("id", billId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["open-bills"] });
    },
  });
}

export function useSettleBill() {
  const tenantId = useTenantId();
  const { user, profile } = useAuth() as any;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      bill,
      amount,
      method,
      reference,
      locationId,
    }: {
      bill: OpenBill;
      amount: number;
      method: string;
      reference?: string;
      locationId: string | null;
    }) => {
      const newAmountPaid = Number(bill.amount_paid) + Number(amount);
      const balance = Number(bill.total) - newAmountPaid;
      const fullyPaid = balance <= 0.5;

      let transactionId: string | null = bill.transaction_id;

      if (fullyPaid && !bill.transaction_id) {
        // Create the sale transaction mirroring POS, then deduct stock.
        const txData: any = {
          items: bill.items,
          subtotal: bill.subtotal,
          tax: bill.tax,
          discount: bill.discount || 0,
          total: bill.total,
          payment_method: method === "split" ? "split" : method,
          customer_id: bill.customer_id,
          customer_name: bill.customer_name || bill.label || "Walk-in",
          cashier_id: user?.id,
          cashier_name: profile?.display_name || "Unknown",
          status: "completed",
          location_id: locationId,
          tenant_id: tenantId,
          stock_by_server: true,
        };
        const { data: txRow, error: txErr } = await sb.from("transactions").insert(txData).select().single();
        if (txErr) throw txErr;
        transactionId = txRow.id;
        // Stock for the bill's lines is reduced by the database when the
        // completed sale is saved (trigger apply_sale_stock).
      }

      const { error: payErr } = await sb.from("bill_payments").insert({
        tenant_id: tenantId,
        bill_id: bill.id,
        amount,
        method,
        reference: reference || null,
        received_by: user?.id || null,
        transaction_id: fullyPaid ? transactionId : null,
      });
      if (payErr) throw payErr;

      const { error: updErr } = await sb
        .from("open_bills")
        .update({
          amount_paid: newAmountPaid,
          status: fullyPaid ? "paid" : "open",
          closed_at: fullyPaid ? new Date().toISOString() : null,
          transaction_id: transactionId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", bill.id);
      if (updErr) throw updErr;

      return { fullyPaid, balance: Math.max(0, balance) };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["open-bill", vars.bill.id] });
      qc.invalidateQueries({ queryKey: ["open-bills"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["product-stocks"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
}
