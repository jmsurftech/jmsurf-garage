
-- Allow public to look up tenants by slug (only expose safe fields via the app query)
CREATE POLICY "Public can lookup tenant by slug"
ON public.tenants FOR SELECT
TO anon
USING (slug IS NOT NULL AND is_active = true);
