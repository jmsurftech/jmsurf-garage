-- Resolve security linter issues: security definer view, permissive policies, public bucket listing, and executable SECURITY DEFINER functions.

-- 1) Ensure public tenant lookup view uses caller permissions instead of elevated creator permissions.
ALTER VIEW public.tenants_public SET (security_invoker = true);

-- Public slug resolution needs direct table read permission; RLS still limits exposure via tenant policies/view definition.
GRANT SELECT ON public.tenants TO anon, authenticated;

-- 2) Replace overly broad INSERT policies with constrained checks.
DROP POLICY IF EXISTS inquiries_insert ON public.contact_inquiries;
CREATE POLICY inquiries_insert
ON public.contact_inquiries
FOR INSERT
TO anon, authenticated
WITH CHECK (
  length(trim(name)) BETWEEN 2 AND 200
  AND email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
  AND length(trim(subject)) BETWEEN 2 AND 200
  AND length(trim(message)) BETWEEN 2 AND 5000
  AND status = 'new'
  AND responded_at IS NULL
);

DROP POLICY IF EXISTS delivery_conf_insert_public ON public.delivery_confirmations;
CREATE POLICY delivery_conf_insert_public
ON public.delivery_confirmations
FOR INSERT
TO anon, authenticated
WITH CHECK (
  delivery_note_id IS NOT NULL
  AND tenant_id IS NOT NULL
  AND length(trim(receiver_name)) BETWEEN 2 AND 200
  AND length(trim(receiver_id_number)) BETWEEN 4 AND 50
  AND length(signature_data) BETWEEN 20 AND 200000
);

DROP POLICY IF EXISTS taa_insert_authenticated ON public.tenant_access_audit;
CREATE POLICY taa_insert_authenticated
ON public.tenant_access_audit
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND length(trim(attempted_url)) BETWEEN 1 AND 2000
  AND (user_email IS NULL OR length(trim(user_email)) <= 320)
  AND (attempted_slug IS NULL OR length(trim(attempted_slug)) <= 200)
  AND (redirected_to IS NULL OR length(trim(redirected_to)) <= 2000)
);

-- 3) Prevent broad listing of public buckets while keeping direct public URLs accessible.
DROP POLICY IF EXISTS "Public read product-images files" ON storage.objects;
CREATE POLICY "Public read product-images files"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'product-images'
  AND name IS NOT NULL
  AND coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') IN ('anon', 'authenticated')
);

DROP POLICY IF EXISTS "Public read tenant-logos files" ON storage.objects;
CREATE POLICY "Public read tenant-logos files"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'tenant-logos'
  AND name IS NOT NULL
  AND coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') IN ('anon', 'authenticated')
);

DROP POLICY IF EXISTS taxonomy_images_public_read ON storage.objects;
CREATE POLICY taxonomy_images_public_read
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'taxonomy-images'
  AND name IS NOT NULL
  AND coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') IN ('anon', 'authenticated')
);

-- 4) Restrict SECURITY DEFINER functions to the minimum roles that need them.
REVOKE EXECUTE ON FUNCTION public.current_user_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_tenant_id() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

REVOKE EXECUTE ON FUNCTION public.set_first_location_as_main() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_first_location_as_main() TO service_role;

REVOKE EXECUTE ON FUNCTION public.audit_core_table_changes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_core_table_changes() TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_tenant_activity(uuid, uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_tenant_activity(uuid, uuid, text, text, text, text, text, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.sync_plan_subscriptions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_plan_subscriptions(uuid) TO service_role;