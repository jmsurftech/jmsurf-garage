-- Fix 1: delivery_confirmations anonymous insert must verify note belongs to tenant
DROP POLICY IF EXISTS delivery_conf_insert_public ON public.delivery_confirmations;

CREATE POLICY delivery_conf_insert_public
ON public.delivery_confirmations
FOR INSERT
TO anon, authenticated
WITH CHECK (
  delivery_note_id IS NOT NULL
  AND tenant_id IS NOT NULL
  AND length(btrim(receiver_name)) BETWEEN 2 AND 200
  AND length(btrim(receiver_id_number)) BETWEEN 4 AND 50
  AND length(signature_data) BETWEEN 20 AND 200000
  AND EXISTS (
    SELECT 1 FROM public.delivery_notes dn
    WHERE dn.id = delivery_confirmations.delivery_note_id
      AND dn.tenant_id = delivery_confirmations.tenant_id
  )
);

-- Fix 2: taxonomy-images storage UPDATE and DELETE must require admin/manager/super_admin
DROP POLICY IF EXISTS taxonomy_images_tenant_update ON storage.objects;
DROP POLICY IF EXISTS taxonomy_images_tenant_delete ON storage.objects;

CREATE POLICY taxonomy_images_tenant_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'taxonomy-images'
  AND (storage.foldername(name))[1] = (current_user_tenant_id())::text
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  )
)
WITH CHECK (
  bucket_id = 'taxonomy-images'
  AND (storage.foldername(name))[1] = (current_user_tenant_id())::text
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  )
);

CREATE POLICY taxonomy_images_tenant_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'taxonomy-images'
  AND (storage.foldername(name))[1] = (current_user_tenant_id())::text
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  )
);