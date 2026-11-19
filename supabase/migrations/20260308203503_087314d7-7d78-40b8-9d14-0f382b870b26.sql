
-- Add slug and logo_url to tenants
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS slug text UNIQUE;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS logo_url text;

-- Create storage bucket for tenant logos
INSERT INTO storage.buckets (id, name, public) VALUES ('tenant-logos', 'tenant-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for tenant logos
CREATE POLICY "Anyone can view logos" ON storage.objects FOR SELECT USING (bucket_id = 'tenant-logos');
CREATE POLICY "Authenticated users can upload logos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'tenant-logos');
CREATE POLICY "Authenticated users can update logos" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'tenant-logos');
CREATE POLICY "Authenticated users can delete logos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'tenant-logos');
