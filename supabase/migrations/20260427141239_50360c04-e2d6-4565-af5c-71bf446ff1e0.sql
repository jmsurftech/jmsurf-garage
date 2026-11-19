-- Final cleanup for remaining security linter warnings.

-- Remove broad storage listing/read policies that allow bucket enumeration.
-- Existing public object URLs continue to work because the buckets themselves remain public.
DROP POLICY IF EXISTS "Authenticated list product-images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated list taxonomy-images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated list tenant-logos" ON storage.objects;
DROP POLICY IF EXISTS "Public read product-images files" ON storage.objects;
DROP POLICY IF EXISTS "Public read tenant-logos files" ON storage.objects;
DROP POLICY IF EXISTS taxonomy_images_public_read ON storage.objects;

-- Lock down remaining SECURITY DEFINER helper functions from direct client execution.
REVOKE EXECUTE ON FUNCTION public.current_user_tenant_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_tenant_id() TO service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO service_role;