-- Remove the overly-broad public select policy added in the previous migration
DROP POLICY IF EXISTS tenants_public_lookup ON public.tenants;

-- Use security_definer mode on the view so it can read tenants on behalf of anon/authenticated
-- without exposing the underlying table directly. The view selects ONLY safe public fields.
ALTER VIEW public.tenants_public SET (security_invoker = false);

GRANT SELECT ON public.tenants_public TO anon, authenticated;

-- Document the exception: the security_definer linter warning is intentional here because
-- this view is the sole public lookup surface for store slugs and exposes only id, slug,
-- logo_url, and business_name. The underlying tenants table remains protected by RLS.
COMMENT ON VIEW public.tenants_public IS
  'Public store directory. Intentionally security_definer to allow anon slug lookup at /login while keeping the tenants table private. Exposes only id, slug, logo_url, business_name.';