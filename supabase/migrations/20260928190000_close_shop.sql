-- A shop owner can close (archive) their own shop. Nothing is deleted: the
-- shop is archived exactly like the platform owner does, sign-in stops, and
-- the platform owner can restore it. The reason is kept for follow-up.

CREATE TABLE IF NOT EXISTS public.shop_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  closed_by uuid,
  closed_by_name text,
  closed_by_email text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shop_closures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_closures_owner_read ON public.shop_closures;
CREATE POLICY shop_closures_owner_read ON public.shop_closures FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));
REVOKE ALL ON public.shop_closures FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.shop_closures FROM authenticated;
GRANT SELECT ON public.shop_closures TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_tenant_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'super_admin') THEN
    RETURN NEW;
  END IF;
  -- close_my_shop may archive the caller's own shop, and change nothing else.
  IF current_setting('app.shop_close', true) = '1'
     AND OLD.id = public.current_user_tenant_id()
     AND NEW.deleted_at IS NOT NULL AND NEW.is_active = false
     AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id
     AND NEW.activation_fee_paid_at IS NOT DISTINCT FROM OLD.activation_fee_paid_at THEN
    RETURN NEW;
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.activation_fee_paid_at IS DISTINCT FROM OLD.activation_fee_paid_at THEN
    RAISE EXCEPTION 'Only the platform owner can change the shop status or owner';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_my_shop(p_confirm_slug text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _tenant uuid := public.current_user_tenant_id(); t public.tenants%ROWTYPE; _name text; _email text;
BEGIN
  IF _uid IS NULL OR _tenant IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF NOT public.has_role(_uid, 'admin') THEN RAISE EXCEPTION 'Only the shop owner can close the shop'; END IF;
  SELECT * INTO t FROM public.tenants WHERE id = _tenant FOR UPDATE;
  IF NOT FOUND OR t.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'This shop is already closed'; END IF;
  IF lower(trim(coalesce(p_confirm_slug, ''))) <> lower(coalesce(t.slug, '')) THEN
    RAISE EXCEPTION 'Type your store address (%) exactly to confirm', t.slug;
  END IF;

  PERFORM set_config('app.shop_close', '1', true);
  UPDATE public.tenants SET deleted_at = now(), is_active = false WHERE id = t.id;
  PERFORM set_config('app.shop_close', '', true);
  UPDATE public.subscriptions SET status = 'cancelled' WHERE tenant_id = t.id AND status IN ('active', 'trial', 'trialing', 'paused', 'past_due');

  SELECT display_name INTO _name FROM public.profiles WHERE user_id = _uid;
  SELECT email INTO _email FROM auth.users WHERE id = _uid;
  INSERT INTO public.shop_closures (tenant_id, closed_by, closed_by_name, closed_by_email, reason)
  VALUES (t.id, _uid, _name, _email, nullif(trim(p_reason), ''));
  RETURN jsonb_build_object('closed', true, 'slug', t.slug);
END $$;
REVOKE ALL ON FUNCTION public.close_my_shop(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_my_shop(text, text) TO authenticated;
