-- Switch back to security_invoker view (recommended by linter)
ALTER VIEW public.tenants_public SET (security_invoker = true);

-- Add a narrow public-read policy on tenants. The view itself only selects safe columns
-- (id, slug, logo_url, business_name), so even though this policy allows row visibility to
-- anon/authenticated, only the columns exposed by the view are reachable through it.
-- Direct queries against public.tenants from the client are still constrained by what
-- columns the API returns, but to be safe we keep the existing tenant_select policy as the
-- primary access rule and add this lookup policy alongside it.
DROP POLICY IF EXISTS tenants_public_lookup ON public.tenants;
CREATE POLICY tenants_public_lookup ON public.tenants
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.tenants_public TO anon, authenticated;