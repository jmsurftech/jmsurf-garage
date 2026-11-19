
-- Drop overly broad public SELECT policies on storage.objects (if any) and add scoped ones.
-- We keep buckets public so direct URL reads still work. We just stop anon listing.

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname IN (
        'Public read tenant-logos','Public read product-images','Public read taxonomy-images',
        'tenant-logos public read','product-images public read','taxonomy-images public read',
        'Allow public read on tenant-logos','Allow public read on product-images','Allow public read on taxonomy-images',
        'Authenticated list tenant-logos','Authenticated list product-images','Authenticated list taxonomy-images'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- Authenticated users can list/select files in these buckets (anon cannot list).
CREATE POLICY "Authenticated list tenant-logos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'tenant-logos');

CREATE POLICY "Authenticated list product-images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'product-images');

CREATE POLICY "Authenticated list taxonomy-images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'taxonomy-images');

-- Authenticated users (admin/manager/super_admin) can upload/update/delete in these buckets.
CREATE POLICY "Authenticated write tenant-logos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'tenant-logos' AND (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'super_admin')
));

CREATE POLICY "Authenticated update tenant-logos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'tenant-logos' AND (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'super_admin')
));

CREATE POLICY "Authenticated delete tenant-logos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'tenant-logos' AND (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'super_admin')
));

CREATE POLICY "Authenticated write product-images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'product-images' AND (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'super_admin')
));

CREATE POLICY "Authenticated update product-images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'product-images' AND (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'super_admin')
));

CREATE POLICY "Authenticated delete product-images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'product-images' AND (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'super_admin')
));

CREATE POLICY "Authenticated write taxonomy-images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'taxonomy-images' AND (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'super_admin')
));

CREATE POLICY "Authenticated update taxonomy-images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'taxonomy-images' AND (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'super_admin')
));

CREATE POLICY "Authenticated delete taxonomy-images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'taxonomy-images' AND (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'super_admin')
));
