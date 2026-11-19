
-- Fix views to use SECURITY INVOKER (default for views, but explicit is better)
ALTER VIEW public.tenants_public SET (security_invoker = on);
ALTER VIEW public.business_settings_safe SET (security_invoker = on);
