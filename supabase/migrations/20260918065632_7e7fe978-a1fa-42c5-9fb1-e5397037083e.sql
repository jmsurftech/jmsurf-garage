ALTER VIEW public.business_settings_safe SET (security_invoker = on);

DROP POLICY IF EXISTS "biz_settings_tenant_staff_safe_read" ON public.business_settings;
CREATE POLICY "biz_settings_tenant_staff_safe_read"
ON public.business_settings
FOR SELECT
TO authenticated
USING (
  tenant_id = public.current_user_tenant_id()
  OR public.has_role(auth.uid(), 'super_admin')
);

REVOKE SELECT ON public.business_settings FROM authenticated;
GRANT SELECT (
  id, tenant_id, business_name, business_email, business_phone, business_address,
  tax_pin, receipt_header, receipt_footer, default_vat_rate, daily_sales_target,
  payment_provider, use_platform_mpesa, mpesa_environment, mpesa_shortcode,
  mpesa_till_number, mpesa_transaction_type, mpesa_account_reference,
  barcode_format, barcode_label_width, barcode_label_height, barcode_show_name,
  barcode_show_price, smtp_host, smtp_port, smtp_username, smtp_from_email,
  smtp_from_name, smtp_encryption, created_at, updated_at, updated_by,
  paystack_public_key
) ON public.business_settings TO authenticated;
GRANT ALL ON public.business_settings TO service_role;

ALTER FUNCTION public.sync_plan_subscriptions(uuid) SECURITY INVOKER;