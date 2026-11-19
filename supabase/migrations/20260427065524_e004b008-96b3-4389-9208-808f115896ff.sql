-- Create public bucket for category/subcategory images
insert into storage.buckets (id, name, public)
values ('taxonomy-images', 'taxonomy-images', true)
on conflict (id) do nothing;

-- Public read
create policy "taxonomy_images_public_read"
on storage.objects for select
to public
using (bucket_id = 'taxonomy-images');

-- Tenant admins/managers can upload to their tenant folder
create policy "taxonomy_images_tenant_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'taxonomy-images'
  and (storage.foldername(name))[1] = (public.current_user_tenant_id())::text
  and (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
);

create policy "taxonomy_images_tenant_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'taxonomy-images'
  and (storage.foldername(name))[1] = (public.current_user_tenant_id())::text
)
with check (
  bucket_id = 'taxonomy-images'
  and (storage.foldername(name))[1] = (public.current_user_tenant_id())::text
);

create policy "taxonomy_images_tenant_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'taxonomy-images'
  and (storage.foldername(name))[1] = (public.current_user_tenant_id())::text
);