import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessSettings } from "@/hooks/useData";
import { useTenantId } from "@/hooks/useTenantId";
import { resolveTax } from "@/lib/tax";

/**
 * Does this company charge VAT? Follows its VAT registration (System → Taxes,
 * business_settings.tax_settings.registered), the same switch invoices, bills and
 * reports use, so the till, receipts and product forms agree with them on every
 * device. (It used to be a per-browser switch that was off on every new device,
 * so till sales of VAT-registered shops were recorded without VAT.)
 */
export function useVatEnabled() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { data: biz } = useBusinessSettings();
  const tax = resolveTax((biz as any)?.tax_settings, biz);

  const setVatEnabled = useCallback(async (next: boolean) => {
    if (!tenantId) return;
    const t = { ...tax, registered: next };
    await (supabase as any).from("business_settings").update({
      tax_settings: t, default_vat_rate: next ? t.defaultRate : 0,
    }).eq("tenant_id", tenantId);
    void qc.invalidateQueries({ queryKey: ["business-settings", tenantId] });
  }, [tenantId, tax, qc]);

  return { vatEnabled: tax.registered, setVatEnabled };
}
