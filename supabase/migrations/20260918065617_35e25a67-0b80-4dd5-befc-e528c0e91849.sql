CREATE OR REPLACE VIEW public.business_settings_safe
WITH (security_invoker = false)
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
  (NULLIF(BTRIM(mpesa_consumer_key), '') IS NOT NULL) AS has_mpesa_consumer_key,
  (NULLIF(BTRIM(mpesa_consumer_secret), '') IS NOT NULL) AS has_mpesa_consumer_secret,
  (NULLIF(BTRIM(mpesa_passkey), '') IS NOT NULL) AS has_mpesa_passkey,
  paystack_public_key,
  (NULLIF(BTRIM(paystack_secret_key), '') IS NOT NULL) AS has_paystack_secret_key
FROM public.business_settings
WHERE tenant_id = public.current_user_tenant_id()
   OR public.has_role(auth.uid(), 'super_admin');

REVOKE ALL ON public.business_settings_safe FROM anon;
GRANT SELECT ON public.business_settings_safe TO authenticated;
GRANT SELECT ON public.business_settings_safe TO service_role;

ALTER TABLE public.payhero_transactions
  ADD COLUMN IF NOT EXISTS payhero_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount numeric;

ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS fee_deducted numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount numeric;

CREATE OR REPLACE FUNCTION public.allowed_feature_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT ARRAY[
    'sales','purchases','roles','communication','smtp_email',
    'sms','whatsapp','theme','session','reports','staff',
    'inventory_transfer','dashboard','customers','suppliers',
    'invoices','quotes','bills','expenses','payments','audit_logs'
  ]::text[];
$function$;

GRANT EXECUTE ON FUNCTION public.sync_plan_subscriptions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_plan_subscriptions(uuid) TO service_role;