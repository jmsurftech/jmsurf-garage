-- 2026-09-29: an owner account with an authenticator app only has owner
-- powers in a session that passed the code check (aal2). Before, the
-- password alone was enough because nothing looked at the session level.
-- Only the caller's own role is affected; checks about other users, the app
-- server (service key, no auth.uid()) and database jobs behave as before.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
  AND NOT (
    _role = 'super_admin'
    AND coalesce(_user_id = auth.uid(), false)
    AND coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
    AND EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = _user_id AND f.status = 'verified')
  )
$function$;

-- For the app server: does this account have an authenticator app switched on?
CREATE OR REPLACE FUNCTION public.user_has_mfa(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p_user_id AND f.status = 'verified')
$$;
REVOKE ALL ON FUNCTION public.user_has_mfa(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_mfa(uuid) TO service_role;
