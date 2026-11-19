-- Notebook: each person's sticky notes (tasks of the day, ideas, follow-ups), with a
-- colour, a tag, pin, done, and an optional reminder by in-app alert, email and SMS.
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  title text,
  body text not null default '',
  color text not null default 'yellow' check (color in ('yellow', 'green', 'pink', 'purple', 'blue', 'orange', 'gray')),
  tag text,
  pinned boolean not null default false,
  done boolean not null default false,
  remind_at timestamptz,
  remind_by text[] not null default '{app}',
  reminded_at timestamptz,
  remind_error text,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_owner_idx on public.notes (tenant_id, user_id, updated_at desc);
create index if not exists notes_due_idx on public.notes (remind_at) where remind_at is not null and reminded_at is null;
alter table public.notes enable row level security;
drop policy if exists notes_own on public.notes;
create policy notes_own on public.notes for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and user_id = auth.uid())
  with check (tenant_id = public.current_user_tenant_id() and user_id = auth.uid());
grant select, insert, update, delete on public.notes to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notes') then
    alter publication supabase_realtime add table public.notes;
  end if;
end $$;
