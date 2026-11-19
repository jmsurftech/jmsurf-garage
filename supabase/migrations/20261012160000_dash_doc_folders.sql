-- Documents → My folders: company folders (nested) that files can be filed in.
create table if not exists public.doc_folders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  parent_id uuid references public.doc_folders(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists doc_folders_parent_idx on public.doc_folders (tenant_id, parent_id);
alter table public.doc_folders enable row level security;
drop policy if exists doc_folders_tenant on public.doc_folders;
create policy doc_folders_tenant on public.doc_folders for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
alter table public.documents add column if not exists folder_id uuid references public.doc_folders(id) on delete set null;
create index if not exists documents_folder_idx on public.documents (folder_id);
