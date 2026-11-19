-- 1) Cashiers must be able to read their shop's payment settings for STK pushes
DROP POLICY IF EXISTS biz_settings_select ON public.business_settings;
CREATE POLICY biz_settings_select ON public.business_settings FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_user_tenant_id()
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

-- 2) Tenant members need to read AND write their own shop's M-Pesa payment records,
--    otherwise status polling stalls forever for anyone who is not a super admin.
DROP POLICY IF EXISTS pht_select ON public.payhero_transactions;
CREATE POLICY pht_select ON public.payhero_transactions
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(),'super_admin'::app_role));

DROP POLICY IF EXISTS pht_tenant_insert ON public.payhero_transactions;
CREATE POLICY pht_tenant_insert ON public.payhero_transactions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(),'super_admin'::app_role));

DROP POLICY IF EXISTS pht_tenant_update ON public.payhero_transactions;
CREATE POLICY pht_tenant_update ON public.payhero_transactions
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(),'super_admin'::app_role))
  WITH CHECK (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(),'super_admin'::app_role));

-- Tenant members also need the payout channel row created/updated on first prompt.
DROP POLICY IF EXISTS tpc_select ON public.tenant_payout_channels;
CREATE POLICY tpc_select ON public.tenant_payout_channels
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(),'super_admin'::app_role));

GRANT SELECT, INSERT, UPDATE ON public.payhero_transactions TO authenticated;
GRANT ALL ON public.payhero_transactions TO service_role;
GRANT SELECT ON public.business_settings TO authenticated;
GRANT SELECT ON public.tenant_payout_channels TO authenticated;

-- 3) Authoritative account removal that does not depend on an admin API key.
CREATE OR REPLACE FUNCTION public.delete_user_account(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _is_super boolean;
  _is_admin boolean;
  _caller_tenant uuid;
  _target_tenant uuid;
  _email text;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Please sign in again';
  END IF;
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Which account should be removed?';
  END IF;
  IF _user_id = _caller THEN
    RAISE EXCEPTION 'You cannot remove your own account';
  END IF;

  _is_super := public.has_role(_caller, 'super_admin');
  _is_admin := public.has_role(_caller, 'admin');
  IF NOT (_is_super OR _is_admin) THEN
    RAISE EXCEPTION 'You do not have permission to remove accounts';
  END IF;

  SELECT tenant_id INTO _caller_tenant FROM public.profiles WHERE user_id = _caller LIMIT 1;
  SELECT tenant_id INTO _target_tenant FROM public.profiles WHERE user_id = _user_id LIMIT 1;

  IF NOT _is_super THEN
    IF _caller_tenant IS NULL OR _target_tenant IS DISTINCT FROM _caller_tenant THEN
      RAISE EXCEPTION 'You can only remove staff in your own shop';
    END IF;
    IF public.has_role(_user_id, 'super_admin') THEN
      RAISE EXCEPTION 'You cannot remove that account';
    END IF;
  END IF;

  SELECT email INTO _email FROM auth.users WHERE id = _user_id;

  DELETE FROM public.user_locations WHERE user_id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE user_id = _user_id;
  DELETE FROM auth.users WHERE id = _user_id;

  RETURN jsonb_build_object('success', true, 'user_id', _user_id, 'email', _email);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_account(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_user_account(uuid) TO authenticated;