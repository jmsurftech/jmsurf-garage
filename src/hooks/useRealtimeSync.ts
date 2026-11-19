import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";

/**
 * Keeps every shop screen live without refreshing the browser.
 *
 * One connection listens for changes to this shop's rows and refreshes only
 * the cached lists that show them. Row-level security limits each subscriber
 * to its own shop, so tables without a tenant_id column are safe unfiltered.
 *
 * Every table listed here must exist and be in the supabase_realtime
 * publication: an unknown table makes the server reject the whole channel.
 */
/** keys: exact query names to refresh; stems: refresh every query whose name starts with one of these. */
type Watch = { table: string; keys: string[]; byTenant: boolean; stems?: string[] };

const SALES_KEYS = ["transactions", "recent-completed-tx", "shifts", "cash-register-open", "cash-register-history"];
const STOCK_KEYS = ["product-stocks", "products", "product-variants", "stock-adjustments", "products-unit-map", "water-catalogue", "water-sizes"];
const WATER_KEYS = ["water-tanks", "water-sizes", "water-catalogue", "water-moves", "product-stocks", "products"];

const WATCHED: Watch[] = [
  { table: "transactions", keys: [...SALES_KEYS, ...STOCK_KEYS, "customers", "open-bills"], byTenant: true },
  { table: "products", keys: STOCK_KEYS, byTenant: true },
  { table: "product_stocks", keys: STOCK_KEYS, byTenant: false },
  { table: "product_variants", keys: STOCK_KEYS, byTenant: true },
  { table: "stock_adjustments", keys: ["stock-adjustments", "report-stock-adjustments"], byTenant: false },
  { table: "product_categories", keys: ["product_categories"], byTenant: true },
  { table: "product_batches", keys: ["product_batches"], byTenant: true },
  { table: "customers", keys: ["customers", "customer", "customer-accounts"], byTenant: true, stems: ["crm-hub"] },
  { table: "expenses", keys: ["expenses", "expenses-reports", "expenses-dashboard", "report-expenses-bills"], byTenant: true },
  { table: "bills", keys: ["bills", "report-expenses-bills"], byTenant: true },
  { table: "bill_payments", keys: ["bills"], byTenant: true },
  { table: "open_bills", keys: ["open-bills", "open-bill"], byTenant: true },
  { table: "empties_ledger", keys: ["empties"], byTenant: true },
  { table: "services", keys: ["services"], byTenant: true },
  { table: "purchases", keys: ["purchases", "report-purchases", "purchase_items_summary"], byTenant: true },
  { table: "shifts", keys: ["shifts"], byTenant: true },
  { table: "cash_register", keys: ["cash-register-open", "cash-register-history"], byTenant: true },
  { table: "layaways", keys: ["layaways"], byTenant: true },
  { table: "quotes", keys: ["quotes"], byTenant: true, stems: ["crm-hub"] },
  { table: "invoices", keys: ["invoices", "invoices-for-packing"], byTenant: true, stems: ["crm-hub"] },
  { table: "suppliers", keys: ["suppliers"], byTenant: true },
  { table: "locations", keys: ["locations", "user-locations", "all-user-locations"], byTenant: true },
  { table: "business_settings", keys: ["business-settings"], byTenant: true },
  { table: "delivery_notes", keys: ["delivery-notes"], byTenant: true },
  { table: "packing_lists", keys: ["packing-lists", "packing-lists-packed"], byTenant: true },
  { table: "variant_exchanges", keys: ["variant-exchanges"], byTenant: true },
  // Water refill shops (all four tables are in the supabase_realtime publication).
  { table: "water_tanks", keys: WATER_KEYS, byTenant: true },
  { table: "water_orders", keys: ["water-orders", "water-orders-new", "rider-sale"], byTenant: true },
  { table: "support_tickets", keys: ["tickets", "tickets-count", "ticket-messages"], byTenant: true },
  { table: "shop_notifications", keys: ["shop-notifications", "notifications"], byTenant: true },
  // Books documents, CRM, HRM, Contracts, Sign & Stamp, Approvals and Documents: every module reads the same
  // customers, vendors, items and staff, so a change anywhere shows everywhere (also in modules switched on later).
  { table: "sales_orders", keys: ["zdocs", "sales-lines"], byTenant: true, stems: ["sales-order", "crm-hub"] },
  { table: "credit_notes", keys: ["credit-notes", "customer-ledger", "customer-account"], byTenant: true },
  { table: "payments_received", keys: ["payments-received", "invoices", "zdocs", "customer-ledger", "customer-account", "doc-payments"], byTenant: true, stems: ["crm-hub"] },
  { table: "purchase_receives", keys: ["purchase-receives", "po-receives", "receive-po", "receive-po-lite", "landed-receives", ...STOCK_KEYS], byTenant: true },
  { table: "vendor_credits", keys: ["vendor-credits", "vc-suppliers"], byTenant: true },
  { table: "supplier_payments", keys: ["supplier-payments", "bill-payments", "bills", "supplier-money"], byTenant: true },
  { table: "bank_transactions", keys: ["bank-lines"], byTenant: true, stems: ["bank"] },
  { table: "chart_of_accounts", keys: ["coa", "acc-ledger"], byTenant: true },
  { table: "crm_leads", keys: ["platform-leads"], byTenant: true, stems: ["crm-lead", "lead-", "crm-hub"] },
  { table: "crm_deals", keys: [], byTenant: true, stems: ["crm-deal", "crm-hub"] },
  { table: "crm_activities", keys: ["lead-acts"], byTenant: true, stems: ["crm-activit", "crm-chatter", "crm-hub"] },
  { table: "crm_contacts", keys: [], byTenant: true, stems: ["crm-hub"] },
  { table: "crm_notes", keys: [], byTenant: true, stems: ["crm-hub"] },
  { table: "hr_employees", keys: ["exp-employees", "staff", "contract-parties", "sales-reps"], byTenant: true, stems: ["hr-"] },
  { table: "hr_leave_requests", keys: [], byTenant: true, stems: ["hr-leave", "hr-emp-leave", "hr-on-leave", "hr-overview"] },
  { table: "contracts", keys: [], byTenant: true, stems: ["contract"] },
  { table: "contract_events", keys: [], byTenant: true, stems: ["contract-events"] },
  { table: "contract_issues", keys: [], byTenant: true, stems: ["contract-issues", "contract-open-breaches"] },
  { table: "signature_requests", keys: ["signature-requests", "doc-model"], byTenant: true, stems: ["doc-signature"] },
  { table: "user_signatures", keys: ["user-signatures", "doc-model"], byTenant: true },
  { table: "approval_requests", keys: [], byTenant: true, stems: ["approvals"] },
  { table: "documents", keys: ["documents", "doc-folders"], byTenant: true },
  { table: "online_orders", keys: ["online-orders", "web-order"], byTenant: true },
  { table: "app_records", keys: [], byTenant: true, stems: ["app-"] },
];
const STEM_OF = new Map(WATCHED.map((w) => [w.table, w.stems || []]));

/** Screens that read directly (not through the query cache) listen for this. */
export const DATA_CHANGED_EVENT = "jmsurf:data-changed";

export function useRealtimeSync() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const pendingKeys = useRef<Set<string>>(new Set());
  const pendingTables = useRef<Set<string>>(new Set());
  const pendingStems = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!tenantId) return;

    const flush = () => {
      timer.current = null;
      const keys = new Set(pendingKeys.current);
      const tables = Array.from(pendingTables.current);
      const stems = Array.from(pendingStems.current);
      pendingStems.current.clear();
      pendingKeys.current.clear();
      pendingTables.current.clear();
      qc.invalidateQueries({
        predicate: (query) => {
          const root = String(query.queryKey[0] ?? "");
          return keys.has(root) || stems.some((st) => root.startsWith(st)) || root.startsWith("report-") || root.startsWith("reports-");
        },
      });
      window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { tables } }));
    };

    const queue = (table: string, keys: string[]) => {
      keys.forEach((k) => pendingKeys.current.add(k));
      (STEM_OF.get(table) || []).forEach((st) => pendingStems.current.add(st));
      pendingTables.current.add(table);
      if (timer.current) return;
      // A sale writes several tables at once: refresh once for the burst.
      timer.current = setTimeout(flush, 250);
    };

    const channel = supabase.channel(`tenant-sync-${tenantId}`);
    WATCHED.forEach(({ table, keys, byTenant }) => {
      channel.on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table,
          ...(byTenant ? { filter: `tenant_id=eq.${tenantId}` } : {}),
        },
        () => queue(table, keys),
      );
    });

    // Reconnect after sleep/offline, then catch up on anything missed.
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") return;
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("[realtime] channel", status);
      }
    });
    const catchUp = () => {
      if (document.visibilityState === "visible") WATCHED.forEach(({ table, keys }) => queue(table, keys));
    };
    window.addEventListener("online", catchUp);
    document.addEventListener("visibilitychange", catchUp);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      window.removeEventListener("online", catchUp);
      document.removeEventListener("visibilitychange", catchUp);
      supabase.removeChannel(channel);
    };
  }, [tenantId, qc]);
}
