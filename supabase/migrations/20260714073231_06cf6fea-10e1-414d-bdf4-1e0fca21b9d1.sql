
DROP POLICY IF EXISTS "td_anon_read_approved" ON public.tenant_domains;

DROP POLICY IF EXISTS "Authenticated read taxonomy-images" ON storage.objects;
CREATE POLICY "taxonomy_images_tenant_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'taxonomy-images'
  AND (storage.foldername(name))[1] = (public.current_user_tenant_id())::text
);
