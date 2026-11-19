CREATE POLICY "Authenticated read product-images"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'product-images');

CREATE POLICY "Authenticated read tenant-logos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'tenant-logos');

CREATE POLICY "Authenticated read taxonomy-images"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'taxonomy-images');