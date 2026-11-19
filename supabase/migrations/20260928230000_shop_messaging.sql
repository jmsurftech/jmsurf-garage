-- SMS (SendBulkSMS) and WhatsApp (APIWAP) sending for shops.
-- Each channel is off, uses the shop's own provider key, or uses JMSURF's
-- account (set by the platform owner). JMSURF SMS is prepaid: each SMS part
-- uses one unit from tenant_sms_settings.balance_units.
-- Keys are write-only from the browser; only the app server reads them.

CREATE TABLE IF NOT EXISTS public.tenant_messaging (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
  sms_mode text NOT NULL DEFAULT 'off' CHECK (sms_mode IN ('off', 'platform', 'own')),
  sms_api_key text,
  sms_sender_id text,
  wa_mode text NOT NULL DEFAULT 'off' CHECK (wa_mode IN ('off', 'platform', 'own')),
  wa_api_key text,
  auto_receipt_sms boolean NOT NULL DEFAULT false,
  auto_receipt_whatsapp boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.tenant_messaging ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_messaging_super ON public.tenant_messaging;
CREATE POLICY tenant_messaging_super ON public.tenant_messaging FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));
REVOKE ALL ON public.tenant_messaging FROM anon, authenticated;

/** What the shop sees: modes and whether keys are saved, never the keys. */
CREATE OR REPLACE FUNCTION public.get_messaging_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _t uuid := public.current_user_tenant_id(); m public.tenant_messaging%ROWTYPE; s public.tenant_sms_settings%ROWTYPE; p jsonb;
BEGIN
  IF auth.uid() IS NULL OR _t IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO m FROM public.tenant_messaging WHERE tenant_id = _t;
  SELECT * INTO s FROM public.tenant_sms_settings WHERE tenant_id = _t;
  SELECT value INTO p FROM public.platform_settings WHERE key = 'messaging';
  RETURN jsonb_build_object(
    'sms_mode', coalesce(m.sms_mode, 'off'),
    'sms_sender_id', coalesce(m.sms_sender_id, ''),
    'has_sms_key', coalesce(m.sms_api_key, '') <> '',
    'wa_mode', coalesce(m.wa_mode, 'off'),
    'has_wa_key', coalesce(m.wa_api_key, '') <> '',
    'auto_receipt_sms', coalesce(m.auto_receipt_sms, false),
    'auto_receipt_whatsapp', coalesce(m.auto_receipt_whatsapp, false),
    'platform_sms_available', coalesce((p->>'sms_enabled')::boolean, false) AND coalesce(p->>'sendbulksms_api_key', '') <> '',
    'platform_wa_available', coalesce((p->>'wa_enabled')::boolean, false) AND coalesce(p->>'apiwap_api_key', '') <> '',
    'sms_units', coalesce(s.balance_units, 0),
    'sms_price', coalesce(s.price_per_sms, nullif(p->>'price_per_sms', '')::numeric, 1.5),
    'sms_total_sent', coalesce(s.total_sent, 0)
  );
END $$;
REVOKE ALL ON FUNCTION public.get_messaging_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_messaging_settings() TO authenticated;

/** Owner/manager saves the shop's choices. A null key keeps the saved one; '' removes it. */
CREATE OR REPLACE FUNCTION public.save_messaging_settings(
  p_sms_mode text, p_sms_api_key text, p_sms_sender_id text,
  p_wa_mode text, p_wa_api_key text,
  p_auto_receipt_sms boolean DEFAULT false, p_auto_receipt_whatsapp boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _t uuid := public.current_user_tenant_id(); _sender text := nullif(trim(coalesce(p_sms_sender_id, '')), '');
BEGIN
  IF _uid IS NULL OR _t IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'manager')) THEN
    RAISE EXCEPTION 'Only the shop owner or a manager can change messaging';
  END IF;
  IF p_sms_mode NOT IN ('off', 'platform', 'own') OR p_wa_mode NOT IN ('off', 'platform', 'own') THEN RAISE EXCEPTION 'Unknown option'; END IF;
  IF _sender IS NOT NULL AND _sender !~ '^[A-Za-z0-9 ]{1,11}$' THEN RAISE EXCEPTION 'Sender ID: up to 11 letters or numbers'; END IF;
  IF p_sms_api_key IS NOT NULL AND trim(p_sms_api_key) <> '' AND trim(p_sms_api_key) !~ '^bsms_(test|live)_[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'That does not look like a SendBulkSMS API key (it starts with bsms_live_ or bsms_test_)';
  END IF;

  INSERT INTO public.tenant_messaging AS tm (tenant_id, sms_mode, sms_api_key, sms_sender_id, wa_mode, wa_api_key, auto_receipt_sms, auto_receipt_whatsapp, updated_at, updated_by)
  VALUES (_t, p_sms_mode, nullif(trim(p_sms_api_key), ''), _sender, p_wa_mode, nullif(trim(p_wa_api_key), ''), coalesce(p_auto_receipt_sms, false), coalesce(p_auto_receipt_whatsapp, false), now(), _uid)
  ON CONFLICT (tenant_id) DO UPDATE SET
    sms_mode = excluded.sms_mode,
    sms_api_key = CASE WHEN p_sms_api_key IS NULL THEN tm.sms_api_key ELSE nullif(trim(p_sms_api_key), '') END,
    sms_sender_id = excluded.sms_sender_id,
    wa_mode = excluded.wa_mode,
    wa_api_key = CASE WHEN p_wa_api_key IS NULL THEN tm.wa_api_key ELSE nullif(trim(p_wa_api_key), '') END,
    auto_receipt_sms = excluded.auto_receipt_sms,
    auto_receipt_whatsapp = excluded.auto_receipt_whatsapp,
    updated_at = now(), updated_by = _uid;
  RETURN public.get_messaging_settings();
END $$;
REVOKE ALL ON FUNCTION public.save_messaging_settings(text, text, text, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_messaging_settings(text, text, text, text, text, boolean, boolean) TO authenticated;

/** App server only: takes prepaid SMS units; false when the shop has too few. */
CREATE OR REPLACE FUNCTION public.consume_sms_units(p_tenant uuid, p_units integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _n integer;
BEGIN
  UPDATE public.tenant_sms_settings
     SET balance_units = balance_units - p_units, total_sent = total_sent + p_units, updated_at = now()
   WHERE tenant_id = p_tenant AND balance_units >= p_units;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n > 0;
END $$;

/** App server only: gives units back when the provider rejects a message. */
CREATE OR REPLACE FUNCTION public.refund_sms_units(p_tenant uuid, p_units integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.tenant_sms_settings
     SET balance_units = balance_units + p_units, total_sent = greatest(0, total_sent - p_units), updated_at = now()
   WHERE tenant_id = p_tenant;
$$;
REVOKE ALL ON FUNCTION public.consume_sms_units(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_sms_units(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_sms_units(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_sms_units(uuid, integer) TO service_role;

/** Platform owner adds prepaid SMS units to a shop and records the top-up. */
CREATE OR REPLACE FUNCTION public.admin_add_sms_units(p_tenant uuid, p_units integer, p_amount numeric DEFAULT 0, p_reference text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _bal integer; _price numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'Only the platform owner can add SMS units'; END IF;
  IF coalesce(p_units, 0) = 0 THEN RAISE EXCEPTION 'Enter the number of units'; END IF;
  INSERT INTO public.tenant_sms_settings (tenant_id, is_active, balance_units)
  VALUES (p_tenant, true, greatest(0, p_units))
  ON CONFLICT (tenant_id) DO UPDATE SET balance_units = greatest(0, tenant_sms_settings.balance_units + p_units), is_active = true, updated_at = now()
  RETURNING balance_units, price_per_sms INTO _bal, _price;
  INSERT INTO public.tenant_sms_topups (tenant_id, units_added, amount_paid, price_per_sms, reference, recorded_by)
  VALUES (p_tenant, p_units, coalesce(p_amount, 0), coalesce(_price, 0), coalesce(p_reference, ''), auth.uid());
  RETURN _bal;
END $$;
REVOKE ALL ON FUNCTION public.admin_add_sms_units(uuid, integer, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_sms_units(uuid, integer, numeric, text) TO authenticated;
