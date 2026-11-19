-- Fix: Allow all authenticated users to read their tenant's business settings
-- Cashiers need receipt_header, payment_provider, VAT rate etc. for POS
DROP POLICY IF EXISTS "biz_settings_select" ON public.business_settings;
CREATE POLICY "biz_settings_select" ON public.business_settings
  FOR SELECT TO authenticated
  USING (
    (tenant_id = current_user_tenant_id())
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );