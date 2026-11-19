-- Restore tenants_public as security_definer view so anon/authenticated can resolve store slugs at /login.
-- The view exposes only safe public fields (id, slug, logo_url, business_name); RLS on the underlying
-- tenants table still blocks direct access. Grant explicit SELECT on the view.

ALTER VIEW public.tenants_public SET (security_invoker = false);

GRANT SELECT ON public.tenants_public TO anon, authenticated;