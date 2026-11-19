-- Lets an admin confirm a staff login without waiting for an email link.
CREATE OR REPLACE FUNCTION public.confirm_user_email(_user_id uuid DEFAULT NULL, _email text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _is_super boolean;
  _is_admin boolean;
  _caller_tenant uuid;
  _target record;
  _target_tenant uuid;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Please sign in again';
  END IF;

  _is_super := public.has_role(_caller, 'super_admin');
  _is_admin := public.has_role(_caller, 'admin') OR public.has_role(_caller, 'manager');
  IF NOT (_is_super OR _is_admin) THEN
    RAISE EXCEPTION 'You do not have permission to verify accounts';
  END IF;

  SELECT tenant_id INTO _caller_tenant FROM public.profiles WHERE user_id = _caller LIMIT 1;

  SELECT u.id, u.email, u.email_confirmed_at INTO _target
  FROM auth.users u
  WHERE (_user_id IS NOT NULL AND u.id = _user_id)
     OR (_user_id IS NULL AND _email IS NOT NULL AND lower(u.email) = lower(_email))
  LIMIT 1;

  IF _target.id IS NULL THEN
    RAISE EXCEPTION 'No account found with those details';
  END IF;

  IF NOT _is_super THEN
    SELECT tenant_id INTO _target_tenant FROM public.profiles WHERE user_id = _target.id LIMIT 1;
    IF _caller_tenant IS NULL OR _target_tenant IS DISTINCT FROM _caller_tenant THEN
      RAISE EXCEPTION 'You can only verify accounts in your own shop';
    END IF;
  END IF;

  IF _target.email_confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'alreadyVerified', true, 'email', _target.email, 'user_id', _target.id);
  END IF;

  UPDATE auth.users
  SET email_confirmed_at = now(),
      updated_at = now()
  WHERE id = _target.id;

  RETURN jsonb_build_object('ok', true, 'alreadyVerified', false, 'email', _target.email, 'user_id', _target.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_user_email(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.confirm_user_email(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_user_email(uuid, text) TO service_role;

-- Staff logins are created by their shop owner, so they never need email verification.
UPDATE auth.users u
SET email_confirmed_at = now(),
    updated_at = now()
WHERE u.email_confirmed_at IS NULL
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id AND p.tenant_id IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.owner_user_id = u.id);