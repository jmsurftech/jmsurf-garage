-- Each shop trades in its own currency (default Kenyan shilling so nothing
-- changes for existing shops). Exposed through the staff-readable safe view.
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KES';

DO $$ BEGIN
  ALTER TABLE public.business_settings
    ADD CONSTRAINT business_settings_currency_format CHECK (currency ~ '^[A-Z]{3}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
    bs.updated_by,
    CASE bs.payment_provider
      WHEN 'jmsurf' THEN EXISTS (SELECT 1 FROM public.sendmoney_tenants st WHERE st.tenant_id = bs.tenant_id)
      WHEN 'mpesa' THEN (m.payhero_channel OR coalesce(nullif(bs.mpesa_till_number, ''), bs.mpesa_shortcode, '') ~ '^[0-9]{5,7}$')
      WHEN 'payhero' THEN (m.payhero_channel OR coalesce(nullif(bs.mpesa_till_number, ''), bs.mpesa_shortcode, '') ~ '^[0-9]{5,7}$')
      WHEN 'bank' THEN m.payhero_channel
      WHEN 'daraja' THEN (coalesce(bs.mpesa_consumer_key, '') <> '' AND coalesce(bs.mpesa_consumer_secret, '') <> ''
                          AND coalesce(bs.mpesa_passkey, '') <> '' AND coalesce(bs.mpesa_shortcode, '') <> '')
      WHEN 'paystack' THEN coalesce(bs.paystack_secret_key, '') <> ''
      ELSE false
    END AS mpesa_ready,
    bs.currency
FROM public.business_settings bs
CROSS JOIN LATERAL (
  SELECT (public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'manager'::public.app_role)
       OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) AS manager,
         EXISTS (SELECT 1 FROM public.tenant_payout_channels c
                 WHERE c.tenant_id = bs.tenant_id AND c.is_active AND c.payhero_channel_id IS NOT NULL) AS payhero_channel
) m
WHERE auth.uid() IS NOT NULL
  AND (bs.tenant_id = public.current_user_tenant_id()
       OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

REVOKE ALL ON public.business_settings_safe FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.business_settings_safe FROM authenticated;
GRANT SELECT ON public.business_settings_safe TO authenticated;
