-- Cashiers must know the shop's payment gateway to take M-Pesa. The safe view
-- ran with the caller's rights, and business_settings only lets admins and
-- managers read it, so cashiers got no row and the till fell back to the wrong
-- gateway (failed prompts at afterhours). The view now reads with its owner's
-- rights, limited to the caller's own shop. It never exposes secrets, and
-- email login details are shown to admins and managers only.
CREATE OR REPLACE VIEW public.business_settings_safe
WITH (security_invoker = false, security_barrier = true) AS
SELECT bs.id,
    bs.tenant_id,
    bs.business_name,
    bs.business_email,
    bs.business_phone,
    bs.business_address,
    bs.tax_pin,
    bs.receipt_header,
    bs.receipt_footer,
    bs.default_vat_rate,
    bs.daily_sales_target,
    bs.payment_provider,
    bs.mpesa_environment,
    bs.mpesa_shortcode,
    bs.mpesa_till_number,
    bs.mpesa_transaction_type,
    bs.mpesa_account_reference,
    bs.barcode_format,
    bs.barcode_label_width,
    bs.barcode_label_height,
    bs.barcode_show_name,
    bs.barcode_show_price,
    CASE WHEN m.manager THEN bs.smtp_host END AS smtp_host,
    CASE WHEN m.manager THEN bs.smtp_port END AS smtp_port,
    CASE WHEN m.manager THEN bs.smtp_username END AS smtp_username,
    CASE WHEN m.manager THEN bs.smtp_from_email END AS smtp_from_email,
    CASE WHEN m.manager THEN bs.smtp_from_name END AS smtp_from_name,
    CASE WHEN m.manager THEN bs.smtp_encryption END AS smtp_encryption,
    bs.created_at,
    bs.updated_at,
    bs.updated_by
FROM public.business_settings bs
CROSS JOIN LATERAL (
  SELECT (public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'manager'::public.app_role)
       OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) AS manager
) m
WHERE auth.uid() IS NOT NULL
  AND (bs.tenant_id = public.current_user_tenant_id()
       OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

REVOKE ALL ON public.business_settings_safe FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.business_settings_safe FROM authenticated;
GRANT SELECT ON public.business_settings_safe TO authenticated;
