DROP VIEW IF EXISTS public.tenants_public;
CREATE VIEW public.tenants_public
WITH (security_invoker=off) AS
  SELECT id, slug, logo_url, business_name
  FROM public.tenants
  WHERE slug IS NOT NULL AND is_active = true;