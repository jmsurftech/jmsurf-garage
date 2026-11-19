ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS has_mpesa_consumer_key boolean GENERATED ALWAYS AS (NULLIF(BTRIM(mpesa_consumer_key), '') IS NOT NULL) STORED,
  ADD COLUMN IF NOT EXISTS has_mpesa_consumer_secret boolean GENERATED ALWAYS AS (NULLIF(BTRIM(mpesa_consumer_secret), '') IS NOT NULL) STORED,
  ADD COLUMN IF NOT EXISTS has_mpesa_passkey boolean GENERATED ALWAYS AS (NULLIF(BTRIM(mpesa_passkey), '') IS NOT NULL) STORED,
  ADD COLUMN IF NOT EXISTS has_paystack_secret_key boolean GENERATED ALWAYS AS (NULLIF(BTRIM(paystack_secret_key), '') IS NOT NULL) STORED;

CREATE OR REPLACE VIEW public.business_settings_safe
WITH (security_invoker = true)
AS
SELECT
  id,
  tenant_id,
  business_name,
  business_email,
  business_phone,
  business_address,
  tax_pin,
  receipt_header,
  receipt_footer,
  default_vat_rate,
  daily_sales_target,
  payment_provider,
  mpesa_environment,
  mpesa_shortcode,
  mpesa_till_number,
  mpesa_transaction_type,
  mpesa_account_reference,
  barcode_format,
  barcode_label_width,
  barcode_label_height,
  barcode_show_name,
  barcode_show_price,
  smtp_host,
  smtp_port,
  smtp_username,
  smtp_from_email,
  smtp_from_name,
  smtp_encryption,
  created_at,
  updated_at,
  updated_by,
  use_platform_mpesa,
  has_mpesa_consumer_key,
  has_mpesa_consumer_secret,
  has_mpesa_passkey,
  paystack_public_key,
  has_paystack_secret_key
FROM public.business_settings
WHERE tenant_id = public.current_user_tenant_id()
   OR public.has_role(auth.uid(), 'super_admin');

REVOKE ALL ON public.business_settings_safe FROM anon;
GRANT SELECT ON public.business_settings_safe TO authenticated;
GRANT SELECT ON public.business_settings_safe TO service_role;
GRANT SELECT (
  has_mpesa_consumer_key,
  has_mpesa_consumer_secret,
  has_mpesa_passkey,
  has_paystack_secret_key
) ON public.business_settings TO authenticated;