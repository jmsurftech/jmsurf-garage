-- Move-in by API: the server pulls a company's data from its previous cloud
-- accounting system in the background (migration_jobs), stages every record as
-- a flat row (migration_rows), and the browser then imports the staged rows with
-- the same engine as the file import. Only the server writes jobs and rows.
create table if not exists public.migration_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null default 'books_api',
  org_id text,
  org_name text,
  kinds text[] not null default '{}',
  with_lines boolean not null default true,
  status text not null default 'fetching' check (status in ('fetching', 'paused', 'fetched', 'imported', 'failed', 'cancelled')),
  cursor jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  api_calls integer not null default 0,
  resume_after timestamptz,
  error text,
  import_log jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  imported_at timestamptz
);
create index if not exists migration_jobs_tenant_idx on public.migration_jobs (tenant_id, created_at desc);
create index if not exists migration_jobs_status_idx on public.migration_jobs (status) where status in ('fetching', 'paused');

create table if not exists public.migration_rows (
  id bigserial primary key,
  job_id uuid not null references public.migration_jobs(id) on delete cascade,
  tenant_id uuid not null,
  kind text not null,
  doc_id text not null,
  ext_id text not null,
  row jsonb not null,
  unique (job_id, kind, ext_id)
);
create index if not exists migration_rows_job_idx on public.migration_rows (job_id, kind, id);
create index if not exists migration_rows_doc_idx on public.migration_rows (job_id, kind, doc_id);

alter table public.migration_jobs enable row level security;
alter table public.migration_rows enable row level security;
revoke all on public.migration_jobs, public.migration_rows from anon, authenticated;
grant select on public.migration_jobs, public.migration_rows to authenticated;

drop policy if exists migration_jobs_select on public.migration_jobs;
create policy migration_jobs_select on public.migration_jobs for select to authenticated
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager') or public.has_role(auth.uid(), 'super_admin')));
drop policy if exists migration_rows_select on public.migration_rows;
create policy migration_rows_select on public.migration_rows for select to authenticated
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager') or public.has_role(auth.uid(), 'super_admin')));
