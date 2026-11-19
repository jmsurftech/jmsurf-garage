-- Restore EXECUTE on RLS helper functions to authenticated users.
-- These are SECURITY DEFINER and are referenced inside RLS policies on
-- profiles, tenants, and many other tables. Revoking EXECUTE from
-- 'authenticated' caused "permission denied for function ..." errors
-- whenever a logged-in user tried to read their own data, breaking the
-- post-login redirect.

GRANT EXECUTE ON FUNCTION public.current_user_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
