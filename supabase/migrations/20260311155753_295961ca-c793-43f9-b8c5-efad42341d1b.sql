
-- 1. Create a secure view for anon tenant lookup (only safe columns)
CREATE OR REPLACE VIEW public.tenants_public AS
SELECT id, slug, logo_url, business_name
FROM public.tenants
WHERE slug IS NOT NULL AND is_active = true;

-- Grant anon access to the view
GRANT SELECT ON public.tenants_public TO anon;

-- 2. Drop the overly permissive anon SELECT policy on tenants
DROP POLICY IF EXISTS "tenants_anon_slug" ON public.tenants;

-- 3. Restrict business_settings SELECT to admin/manager/super_admin only
DROP POLICY IF EXISTS "biz_settings_select" ON public.business_settings;
CREATE POLICY "biz_settings_select" ON public.business_settings
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) 
    OR has_role(auth.uid(), 'manager'::app_role) 
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );

-- 4. Create a safe view for non-admin staff to read non-sensitive business settings
CREATE OR REPLACE VIEW public.business_settings_safe AS
SELECT id, tenant_id, business_name, business_email, business_phone, business_address,
       tax_pin, receipt_header, receipt_footer, default_vat_rate, daily_sales_target,
       payment_provider, mpesa_environment, mpesa_shortcode, mpesa_till_number,
       mpesa_transaction_type, mpesa_account_reference,
       barcode_format, barcode_label_width, barcode_label_height, barcode_show_name, barcode_show_price,
       smtp_host, smtp_port, smtp_username, smtp_from_email, smtp_from_name, smtp_encryption,
       created_at, updated_at, updated_by
FROM public.business_settings;

GRANT SELECT ON public.business_settings_safe TO authenticated;

-- 5. Fix purchase_items cross-tenant exposure: restrict SELECT to tenant-scoped
DROP POLICY IF EXISTS "purch_items_select" ON public.purchase_items;
CREATE POLICY "purch_items_select" ON public.purchase_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.purchases p
      WHERE p.id = purchase_items.purchase_id
      AND (p.tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role))
    )
  );
