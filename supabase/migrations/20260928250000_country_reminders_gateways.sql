-- 2026-09-28: payment methods fix, shop country, renewal reminders, more gateways.

-- 1. Sales paid with loyalty points or a credit note were refused by the
--    database (not in the allowed list). "online" is for the new gateways.
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_payment_method_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_payment_method_check CHECK (payment_method = ANY (ARRAY[
  'cash','mpesa','card','credit','split','mobile_money','bank_transfer','payhero','other','loyalty_points','credit_note','online']));

-- 2. Country of the shop (ISO code). Existing shops trade in Kenya unless their currency says otherwise.
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE public.business_settings DROP CONSTRAINT IF EXISTS business_settings_country_format;
ALTER TABLE public.business_settings ADD CONSTRAINT business_settings_country_format CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
UPDATE public.business_settings SET country = CASE currency
  WHEN 'KES' THEN 'KE' WHEN 'UGX' THEN 'UG' WHEN 'TZS' THEN 'TZ' WHEN 'RWF' THEN 'RW' WHEN 'ETB' THEN 'ET'
  WHEN 'SOS' THEN 'SO' WHEN 'NGN' THEN 'NG' WHEN 'GHS' THEN 'GH' WHEN 'ZAR' THEN 'ZA' WHEN 'ZMW' THEN 'ZM'
  WHEN 'MWK' THEN 'MW' WHEN 'BIF' THEN 'BI' WHEN 'SSP' THEN 'SS' ELSE 'KE' END
WHERE country IS NULL;

CREATE OR REPLACE VIEW public.business_settings_safe WITH (security_barrier = true, security_invoker = false) AS
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
        CASE
            WHEN m.manager THEN bs.smtp_host
            ELSE NULL::text
        END AS smtp_host,
        CASE
            WHEN m.manager THEN bs.smtp_port
            ELSE NULL::text
        END AS smtp_port,
        CASE
            WHEN m.manager THEN bs.smtp_username
            ELSE NULL::text
        END AS smtp_username,
        CASE
            WHEN m.manager THEN bs.smtp_from_email
            ELSE NULL::text
        END AS smtp_from_email,
        CASE
            WHEN m.manager THEN bs.smtp_from_name
            ELSE NULL::text
        END AS smtp_from_name,
        CASE
            WHEN m.manager THEN bs.smtp_encryption
            ELSE NULL::text
        END AS smtp_encryption,
    bs.created_at,
    bs.updated_at,
    bs.updated_by,
        CASE bs.payment_provider
            WHEN 'jmsurf'::text THEN (EXISTS ( SELECT 1
               FROM sendmoney_tenants st
              WHERE st.tenant_id = bs.tenant_id))
            WHEN 'mpesa'::text THEN m.payhero_channel OR COALESCE(NULLIF(bs.mpesa_till_number, ''::text), bs.mpesa_shortcode, ''::text) ~ '^[0-9]{5,7}$'::text
            WHEN 'payhero'::text THEN m.payhero_channel OR COALESCE(NULLIF(bs.mpesa_till_number, ''::text), bs.mpesa_shortcode, ''::text) ~ '^[0-9]{5,7}$'::text
            WHEN 'bank'::text THEN m.payhero_channel
            WHEN 'daraja'::text THEN COALESCE(bs.mpesa_consumer_key, ''::text) <> ''::text AND COALESCE(bs.mpesa_consumer_secret, ''::text) <> ''::text AND COALESCE(bs.mpesa_passkey, ''::text) <> ''::text AND COALESCE(bs.mpesa_shortcode, ''::text) <> ''::text
            WHEN 'paystack'::text THEN COALESCE(bs.paystack_secret_key, ''::text) <> ''::text
            ELSE false
        END AS mpesa_ready,
    bs.currency,
    bs.use_platform_smtp,
    bs.use_platform_mpesa,
    bs.stk_label_mode,
    bs.stk_label_override,
    bs.paystack_public_key,
    bs.idle_timeout_minutes,
    bs.session_warning_seconds,
    bs.daily_logout_time,
    COALESCE(bs.mpesa_consumer_key, ''::text) <> ''::text AS has_mpesa_consumer_key,
    COALESCE(bs.mpesa_consumer_secret, ''::text) <> ''::text AS has_mpesa_consumer_secret,
    COALESCE(bs.mpesa_passkey, ''::text) <> ''::text AS has_mpesa_passkey,
    COALESCE(bs.paystack_secret_key, ''::text) <> ''::text AS has_paystack_secret_key,
    COALESCE(bs.smtp_password, ''::text) <> ''::text AS has_smtp_password,
    bs.country
   FROM business_settings bs
     CROSS JOIN LATERAL ( SELECT has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role) AS manager,
            (EXISTS ( SELECT 1
                   FROM tenant_payout_channels c
                  WHERE c.tenant_id = bs.tenant_id AND c.is_active AND c.payhero_channel_id IS NOT NULL)) AS payhero_channel) m
  WHERE auth.uid() IS NOT NULL AND (bs.tenant_id = current_user_tenant_id() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant_id uuid;
  _slug text;
  _try_slug text;
  _suffix int;
  _btype public.business_type;
  _plan record;
  _country text;
  _currency text;
BEGIN
  BEGIN
    INSERT INTO public.profiles (user_id, display_name, tenant_id)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NULL)
    ON CONFLICT (user_id) DO UPDATE
    SET display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to create profile for %: %', NEW.id, SQLERRM;
  END;

  IF NEW.raw_user_meta_data->>'registration_type' = 'tenant' THEN
    BEGIN
      _slug := COALESCE(NEW.raw_user_meta_data->>'store_slug', '');
      _try_slug := NULLIF(_slug, '');
      _suffix := 1;
      WHILE _try_slug IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenants WHERE slug = _try_slug) LOOP
        _try_slug := _slug || '-' || _suffix;
        _suffix := _suffix + 1;
        EXIT WHEN _suffix > 50;
      END LOOP;

      BEGIN
        _btype := COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_type',''), 'general')::public.business_type;
      EXCEPTION WHEN OTHERS THEN
        _btype := 'general';
      END;

      INSERT INTO public.tenants (
        business_name, business_email, business_phone, business_address,
        industry, contact_name, contact_email, contact_phone, owner_user_id, slug,
        activation_fee_paid_at, business_type
      ) VALUES (
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_name',''), 'My Business'),
        NEW.raw_user_meta_data->>'business_email',
        NEW.raw_user_meta_data->>'business_phone',
        NEW.raw_user_meta_data->>'business_address',
        NEW.raw_user_meta_data->>'industry',
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'contact_name',''), NEW.email),
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'contact_email',''), NEW.email),
        NEW.raw_user_meta_data->>'contact_phone',
        NEW.id,
        _try_slug,
        now(),
        _btype
      ) RETURNING id INTO _tenant_id;

      UPDATE public.profiles SET tenant_id = _tenant_id WHERE user_id = NEW.id;
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;

      -- Country and currency chosen at registration (checked, with safe defaults).
      _country := upper(COALESCE(NEW.raw_user_meta_data->>'country', ''));
      IF _country !~ '^[A-Z]{2}$' THEN _country := 'KE'; END IF;
      _currency := upper(COALESCE(NEW.raw_user_meta_data->>'currency', ''));
      IF _currency !~ '^[A-Z]{3}$' THEN _currency := 'KES'; END IF;

      INSERT INTO public.business_settings (tenant_id, business_name, business_email, business_phone, business_address, country, currency)
      VALUES (
        _tenant_id,
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'business_name',''), 'My Business'),
        NEW.raw_user_meta_data->>'business_email',
        NEW.raw_user_meta_data->>'business_phone',
        NEW.raw_user_meta_data->>'business_address',
        _country,
        _currency
      );

      SELECT * INTO _plan FROM public.plans WHERE is_active = true ORDER BY price_monthly ASC LIMIT 1;
      INSERT INTO public.subscriptions (
        tenant_id, plan_id, plan_name, billing_cycle, max_users, max_locations, price,
        status, trial_ends_at, current_period_start, current_period_end
      ) VALUES (
        _tenant_id, _plan.id, COALESCE(_plan.name, 'Basic'), 'monthly',
        COALESCE(_plan.max_users, 3), COALESCE(_plan.max_locations, 1), 0,
        'trialing', now() + interval '14 days', now(), now() + interval '14 days'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed tenant setup for user %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Renewal reminders: one row per subscription period, stage and channel, so nothing is sent twice.
CREATE TABLE IF NOT EXISTS public.subscription_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  subscription_id uuid NOT NULL,
  period_end timestamptz NOT NULL,
  stage text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  recipient text,
  status text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, period_end, stage, channel)
);
CREATE INDEX IF NOT EXISTS subscription_reminders_recent ON public.subscription_reminders (created_at DESC);
ALTER TABLE public.subscription_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_reminders_owner ON public.subscription_reminders;
CREATE POLICY subscription_reminders_owner ON public.subscription_reminders FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));
REVOKE ALL ON public.subscription_reminders FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.subscription_reminders FROM authenticated;
GRANT SELECT ON public.subscription_reminders TO authenticated;

-- 4. Extra gateways a shop uses to take money (Flutterwave, Stripe, PayPal, Kopo Kopo, ...).
--    Keys are write-only from the browser; the app server reads them.
CREATE TABLE IF NOT EXISTS public.tenant_gateways (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  provider text NOT NULL CHECK (provider ~ '^[a-z0-9_]{2,30}$'),
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (tenant_id, provider)
);
ALTER TABLE public.tenant_gateways ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_gateways FROM anon, authenticated;

/** True for config keys that hold secrets (never returned to the browser). */
CREATE OR REPLACE FUNCTION public.gateway_key_is_secret(k text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT k ILIKE '%secret%' OR k ILIKE '%password%' OR k ILIKE '%token%'
      OR (k ILIKE '%key%' AND k NOT IN ('public_key', 'publishable_key'));
$$;

/** The shop's gateways without secrets: which fields are saved, and the non-secret values. */
CREATE OR REPLACE FUNCTION public.get_tenant_gateways()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _t uuid := public.current_user_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR _t IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'provider', g.provider,
      'enabled', g.enabled,
      'config', (SELECT coalesce(jsonb_object_agg(e.key, CASE WHEN public.gateway_key_is_secret(e.key) THEN to_jsonb(''::text) ELSE e.value END), '{}'::jsonb) FROM jsonb_each(g.config) e),
      'saved', (SELECT coalesce(jsonb_agg(e.key), '[]'::jsonb) FROM jsonb_each(g.config) e WHERE coalesce(e.value #>> '{}', '') <> '')
    ) ORDER BY g.provider)
    FROM public.tenant_gateways g WHERE g.tenant_id = _t
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_tenant_gateways() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_gateways() TO authenticated;

/** Owner/manager saves one gateway. Empty values keep what is saved; null removes a field. */
CREATE OR REPLACE FUNCTION public.save_tenant_gateway(p_provider text, p_enabled boolean, p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _t uuid := public.current_user_tenant_id(); _old jsonb; _new jsonb;
BEGIN
  IF _uid IS NULL OR _t IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'manager')) THEN RAISE EXCEPTION 'Only the shop owner or a manager can change payment gateways'; END IF;
  IF p_provider !~ '^[a-z0-9_]{2,30}$' THEN RAISE EXCEPTION 'Unknown gateway'; END IF;
  SELECT config INTO _old FROM public.tenant_gateways WHERE tenant_id = _t AND provider = p_provider;
  _old := coalesce(_old, '{}'::jsonb);
  -- Keep saved values for fields sent empty; drop fields sent as null.
  SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb) INTO _new FROM (
    SELECT e.key AS k, e.value AS v FROM jsonb_each(_old) e WHERE NOT (coalesce(p_config, '{}'::jsonb) ? e.key)
    UNION ALL
    SELECT e.key, CASE WHEN coalesce(e.value #>> '{}', '') = '' AND _old ? e.key THEN _old -> e.key ELSE e.value END
    FROM jsonb_each(coalesce(p_config, '{}'::jsonb)) e WHERE jsonb_typeof(e.value) <> 'null'
  ) x;
  INSERT INTO public.tenant_gateways (tenant_id, provider, enabled, config, updated_at, updated_by)
  VALUES (_t, p_provider, coalesce(p_enabled, false), _new, now(), _uid)
  ON CONFLICT (tenant_id, provider) DO UPDATE SET enabled = excluded.enabled, config = excluded.config, updated_at = now(), updated_by = _uid;
  RETURN public.get_tenant_gateways();
END $$;
REVOKE ALL ON FUNCTION public.save_tenant_gateway(text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_tenant_gateway(text, boolean, jsonb) TO authenticated;

-- 5. Every payment started through one of those gateways (shop sales and package fees).
CREATE TABLE IF NOT EXISTS public.gateway_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('sale', 'subscription')),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  target_id uuid NOT NULL,
  provider text NOT NULL,
  provider_ref text,
  checkout_url text,
  charge_amount numeric NOT NULL,
  charge_currency text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gateway_payments_target ON public.gateway_payments (target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gateway_payments_pending ON public.gateway_payments (created_at) WHERE status = 'pending';
ALTER TABLE public.gateway_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gateway_payments_read ON public.gateway_payments;
CREATE POLICY gateway_payments_read ON public.gateway_payments FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'::public.app_role));
REVOKE ALL ON public.gateway_payments FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.gateway_payments FROM authenticated;
GRANT SELECT ON public.gateway_payments TO authenticated;
