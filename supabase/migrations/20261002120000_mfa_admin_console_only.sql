-- 2026-10-02: the authenticator code is asked for by the admin console (/admin)
-- only. Shop pages must work for every signed-in account, the platform owner
-- included, so has_role no longer looks at the session level (reverts the
-- check added in 20260929100000_owner_requires_mfa.sql). The admin console
-- still refuses to open until the session has passed the code (AdminLayout),
-- and the server still requires it for the admin-only endpoints (isAdminApi).
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$function$;
