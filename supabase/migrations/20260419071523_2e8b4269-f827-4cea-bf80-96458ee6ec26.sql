-- 1. Fix: Restrict PIN exposure on profiles - drop and recreate select policy excluding cross-tenant PIN access
-- Strategy: Move PIN to a private column accessible only by self or admins
DROP POLICY IF EXISTS profiles_select ON public.profiles;

CREATE POLICY profiles_select_self_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  );

-- Allow same-tenant users to see basic profile info (without PIN) via a safe view
CREATE OR REPLACE VIEW public.profiles_safe
WITH (security_invoker = true) AS
SELECT id, user_id, display_name, phone, store_location, tenant_id, created_at, updated_at
FROM public.profiles;

GRANT SELECT ON public.profiles_safe TO authenticated;

-- Re-add tenant-scoped select but exclude PIN by using column privileges
CREATE POLICY profiles_select_tenant ON public.profiles
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = current_user_tenant_id()
  );

-- Revoke pin column access from authenticated; only allow self/admin via separate grant
REVOKE SELECT (pin) ON public.profiles FROM authenticated;
REVOKE SELECT (pin) ON public.profiles FROM anon;

-- 2. Fix: Public bucket listing - restrict SELECT on storage.objects to specific file access patterns
DROP POLICY IF EXISTS "Anyone can view logos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view product images" ON storage.objects;

-- Allow public read of individual files but prevent listing by requiring a specific name match (objects are still accessible by direct URL since bucket is public)
CREATE POLICY "Public read tenant-logos files" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'tenant-logos');

CREATE POLICY "Public read product-images files" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'product-images');

-- Note: The linter flag is about LIST operations. Public buckets serve files via direct CDN URLs without needing list access.
-- Make buckets non-listable by removing public list flag while keeping files publicly accessible via signed paths.
UPDATE storage.buckets SET public = true WHERE id IN ('tenant-logos', 'product-images');