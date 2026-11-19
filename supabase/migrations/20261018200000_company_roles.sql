-- Roles each company makes for itself, with permissions down to each action (view, create, edit, delete, approve,
-- void, export…), what data the role sees (all, own, assigned customers) and the dashboard and reports it may open.
-- base_role is the database role given to its users (what row-level security checks).
create table if not exists public.company_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  base_role public.app_role not null default 'cashier',
  permissions jsonb not null default '{}'::jsonb,
  data_scope text not null default 'all' check (data_scope in ('all', 'own', 'assigned')),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);
alter table public.company_roles enable row level security;
drop policy if exists company_roles_read on public.company_roles;
create policy company_roles_read on public.company_roles for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.has_role(auth.uid(), 'super_admin'));
drop policy if exists company_roles_write on public.company_roles;
create policy company_roles_write on public.company_roles for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and public.has_role(auth.uid(), 'admin'))
  with check (tenant_id = public.current_user_tenant_id() and public.has_role(auth.uid(), 'admin') and base_role not in ('super_admin'));
grant select, insert, update, delete on public.company_roles to authenticated;

-- People: their company role, active / inactive, branches they may work in, and details (like Zoho's users).
alter table public.profiles add column if not exists company_role_id uuid references public.company_roles(id) on delete set null;
alter table public.profiles add column if not exists status text not null default 'active';
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check check (status in ('active', 'inactive'));
alter table public.profiles add column if not exists location_ids uuid[];
alter table public.profiles add column if not exists cost_per_hour numeric;
alter table public.profiles add column if not exists address text;
alter table public.profiles add column if not exists remarks text;
alter table public.profiles add column if not exists invited_at timestamptz;
alter table public.profiles add column if not exists invited_by uuid;

-- Nobody can change their own role, status or branches: only the company admin (or JMSURF) can.
create or replace function public.profiles_guard_access() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.company_role_id is distinct from old.company_role_id or new.status is distinct from old.status or new.location_ids is distinct from old.location_ids)
     and not public.has_role(auth.uid(), 'super_admin')
     and not (public.has_role(auth.uid(), 'admin') and old.tenant_id = public.current_user_tenant_id() and old.user_id <> auth.uid())
     and auth.uid() is not null then
    raise exception 'Only the company admin can change roles, status or branches';
  end if;
  if new.company_role_id is not null and not exists (select 1 from public.company_roles where id = new.company_role_id and tenant_id = new.tenant_id) then
    raise exception 'That role belongs to another company';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_access on public.profiles;
create trigger profiles_guard_access before update on public.profiles for each row execute function public.profiles_guard_access();

-- The signed-in person's own role and permissions (read by the app to show and hide what they may do).
create or replace function public.my_company_role() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'name', r.name, 'base_role', r.base_role, 'permissions', r.permissions, 'data_scope', r.data_scope, 'status', p.status, 'location_ids', p.location_ids)
    from public.profiles p left join public.company_roles r on r.id = p.company_role_id
   where p.user_id = auth.uid() limit 1
$$;
grant execute on function public.my_company_role() to authenticated;
