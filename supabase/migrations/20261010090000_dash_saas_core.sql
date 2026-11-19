-- JMSURF DASH: SaaS core.
--  * Modules (app store): platform_modules (catalogue + prices) and
--    tenant_modules (what each company switched on).
--  * Multi-company: tenant_members, my_companies(), switch_company(),
--    create_company(), add_company_member().
--  * Platform context: the platform owner works as super_admin only while on
--    the super admin address (enter_platform); on a company address the role
--    is that company's role, so company screens never mix companies.
--  * Record engine: app_records + app_record_events (+ numbering).
--  * Sign-up trigger on auth.users (missing on the cloned database).

-- ── Modules ──────────────────────────────────────────────────────────────
create table if not exists public.platform_modules (
  key text primary key,
  name text not null,
  category text not null default 'Apps',
  description text,
  price_monthly numeric(12,2) not null default 0,
  included boolean not null default false,
  is_active boolean not null default true,
  sort int not null default 100,
  updated_at timestamptz not null default now()
);
alter table public.platform_modules enable row level security;
drop policy if exists platform_modules_read on public.platform_modules;
create policy platform_modules_read on public.platform_modules for select using (true);
drop policy if exists platform_modules_admin on public.platform_modules;
create policy platform_modules_admin on public.platform_modules for all
  using (public.has_role(auth.uid(), 'super_admin')) with check (public.has_role(auth.uid(), 'super_admin'));
grant select on public.platform_modules to anon, authenticated;

create table if not exists public.tenant_modules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  module_key text not null references public.platform_modules(key) on update cascade,
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'cancelled', 'comped')),
  price_monthly numeric(12,2) not null default 0,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  activated_by uuid,
  activated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, module_key)
);
create index if not exists tenant_modules_tenant_idx on public.tenant_modules (tenant_id);
alter table public.tenant_modules enable row level security;
drop policy if exists tenant_modules_select on public.tenant_modules;
create policy tenant_modules_select on public.tenant_modules for select
  using (tenant_id = public.current_user_tenant_id() or public.has_role(auth.uid(), 'super_admin'));
drop policy if exists tenant_modules_admin on public.tenant_modules;
create policy tenant_modules_admin on public.tenant_modules for all
  using (public.has_role(auth.uid(), 'super_admin')) with check (public.has_role(auth.uid(), 'super_admin'));
grant select on public.tenant_modules to authenticated;

-- Plans can bundle every module (the "All-in-One" plan).
alter table public.plans add column if not exists all_modules boolean not null default false;
alter table public.plans add column if not exists included_modules text[] not null default '{}';
alter table public.plans add column if not exists description text;
alter table public.plans add column if not exists sort int not null default 100;

/** True when a company may use a module right now. */
create or replace function public.tenant_module_active(p_tenant uuid, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    coalesce((select included from public.platform_modules where key = p_key), false)
    or exists (
      select 1 from public.subscriptions s join public.plans p on p.id = s.plan_id
      where s.tenant_id = p_tenant and (p.all_modules or p_key = any (p.included_modules))
    )
    or exists (
      select 1 from public.tenant_modules m
      where m.tenant_id = p_tenant and m.module_key = p_key
        and (m.status = 'comped'
          or (m.status = 'trial' and coalesce(m.trial_ends_at, now()) > now())
          or (m.status in ('active', 'past_due') and coalesce(m.current_period_end, now() + interval '1 day') > now() - interval '3 days'))
    )
$$;
grant execute on function public.tenant_module_active(uuid, text) to authenticated;

/** Modules the signed-in user's company can use (keys), for the sidebar. */
create or replace function public.my_modules()
returns table (module_key text, status text, trial_ends_at timestamptz, current_period_end timestamptz, price_monthly numeric)
language sql stable security definer set search_path = public as $$
  select pm.key,
         coalesce(tm.status, case when pm.included then 'included' else 'bundle' end),
         tm.trial_ends_at, tm.current_period_end, coalesce(tm.price_monthly, pm.price_monthly)
  from public.platform_modules pm
  left join public.tenant_modules tm on tm.module_key = pm.key and tm.tenant_id = public.current_user_tenant_id()
  where public.current_user_tenant_id() is not null
    and public.tenant_module_active(public.current_user_tenant_id(), pm.key)
$$;
grant execute on function public.my_modules() to authenticated;

/** Company admin switches a module on: a 14-day trial the first time, then billed with the subscription. */
create or replace function public.activate_module(p_key text)
returns public.tenant_modules language plpgsql security definer set search_path = public as $$
declare
  _tenant uuid := public.current_user_tenant_id();
  _mod public.platform_modules;
  _row public.tenant_modules;
  _period_end timestamptz;
begin
  if _tenant is null then raise exception 'No company selected'; end if;
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Only the company administrator can change modules';
  end if;
  select * into _mod from public.platform_modules where key = p_key and is_active;
  if _mod.key is null then raise exception 'Unknown module'; end if;
  if _mod.included then raise exception 'This module is already part of JMSURF BOOKS'; end if;
  select current_period_end into _period_end from public.subscriptions where tenant_id = _tenant order by created_at desc limit 1;

  select * into _row from public.tenant_modules where tenant_id = _tenant and module_key = p_key;
  if _row.id is null then
    insert into public.tenant_modules (tenant_id, module_key, status, price_monthly, trial_ends_at, activated_by)
    values (_tenant, p_key, 'trial', _mod.price_monthly, now() + interval '14 days', auth.uid())
    returning * into _row;
  elsif _row.status in ('cancelled') or (_row.status = 'trial' and _row.trial_ends_at <= now()) then
    update public.tenant_modules
       set status = 'active', price_monthly = _mod.price_monthly, cancelled_at = null,
           current_period_end = greatest(coalesce(_period_end, now()), now()), activated_by = auth.uid(),
           activated_at = now(), updated_at = now()
     where id = _row.id returning * into _row;
  end if;
  perform public.record_tenant_activity(_tenant, auth.uid(), null, null, 'module_activated', 'module', p_key, 'Switched on ' || _mod.name, '{}'::jsonb);
  return _row;
end $$;
grant execute on function public.activate_module(text) to authenticated;

create or replace function public.deactivate_module(p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare _tenant uuid := public.current_user_tenant_id();
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Only the company administrator can change modules';
  end if;
  update public.tenant_modules set status = 'cancelled', cancelled_at = now(), updated_at = now()
   where tenant_id = _tenant and module_key = p_key and status <> 'comped';
  perform public.record_tenant_activity(_tenant, auth.uid(), null, null, 'module_deactivated', 'module', p_key, 'Switched off ' || p_key, '{}'::jsonb);
end $$;
grant execute on function public.deactivate_module(text) to authenticated;

-- ── Multi-company ───────────────────────────────────────────────────────
create table if not exists public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'admin',
  is_owner boolean not null default false,
  status text not null default 'active' check (status in ('active', 'disabled')),
  invited_by uuid,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index if not exists tenant_members_user_idx on public.tenant_members (user_id);
alter table public.tenant_members enable row level security;
drop policy if exists tenant_members_select on public.tenant_members;
create policy tenant_members_select on public.tenant_members for select
  using (user_id = auth.uid() or tenant_id = public.current_user_tenant_id() or public.has_role(auth.uid(), 'super_admin'));
drop policy if exists tenant_members_admin on public.tenant_members;
create policy tenant_members_admin on public.tenant_members for all
  using (public.has_role(auth.uid(), 'super_admin')) with check (public.has_role(auth.uid(), 'super_admin'));
grant select on public.tenant_members to authenticated;

-- Platform owners (super admins), independent of the role in use right now.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
drop policy if exists platform_admins_self on public.platform_admins;
create policy platform_admins_self on public.platform_admins for select using (user_id = auth.uid());

-- Existing staff become members of their company.
insert into public.tenant_members (tenant_id, user_id, role, is_owner)
select p.tenant_id, p.user_id,
       coalesce((select r.role from public.user_roles r where r.user_id = p.user_id and r.role <> 'super_admin' order by r.role limit 1), 'cashier'),
       exists (select 1 from public.tenants t where t.id = p.tenant_id and t.owner_user_id = p.user_id)
from public.profiles p where p.tenant_id is not null
on conflict (tenant_id, user_id) do nothing;
insert into public.platform_admins (user_id)
select distinct user_id from public.user_roles where role = 'super_admin' on conflict do nothing;

-- Keep memberships in step with the existing staff flows (profiles / user_roles).
create or replace function public.sync_tenant_member_from_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.tenant_id is not null and current_setting('dash.switching', true) is distinct from 'on' then
    insert into public.tenant_members (tenant_id, user_id, role, is_owner)
    values (NEW.tenant_id, NEW.user_id,
            coalesce((select r.role from public.user_roles r where r.user_id = NEW.user_id and r.role <> 'super_admin' order by r.role limit 1), 'cashier'),
            exists (select 1 from public.tenants t where t.id = NEW.tenant_id and t.owner_user_id = NEW.user_id))
    on conflict (tenant_id, user_id) do nothing;
  end if;
  return NEW;
end $$;
drop trigger if exists sync_tenant_member_from_profile on public.profiles;
create trigger sync_tenant_member_from_profile after insert or update of tenant_id on public.profiles
  for each row execute function public.sync_tenant_member_from_profile();

create or replace function public.sync_tenant_member_from_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare _tenant uuid;
begin
  if current_setting('dash.switching', true) = 'on' or NEW.role = 'super_admin' then return NEW; end if;
  select tenant_id into _tenant from public.profiles where user_id = NEW.user_id;
  if _tenant is not null then
    insert into public.tenant_members (tenant_id, user_id, role) values (_tenant, NEW.user_id, NEW.role)
    on conflict (tenant_id, user_id) do update set role = excluded.role;
  end if;
  return NEW;
end $$;
drop trigger if exists sync_tenant_member_from_role on public.user_roles;
create trigger sync_tenant_member_from_role after insert or update of role on public.user_roles
  for each row execute function public.sync_tenant_member_from_role();

-- Switching company may move a profile between the caller's own companies.
create or replace function public.prevent_profile_tenant_move()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if NEW.tenant_id is distinct from OLD.tenant_id
     and auth.uid() is not null
     and current_setting('dash.switching', true) is distinct from 'on'
     and not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Profile tenant cannot be changed by a tenant user';
  end if;
  return NEW;
end $$;

/** Companies the signed-in user belongs to. */
create or replace function public.my_companies()
returns table (tenant_id uuid, slug text, business_name text, logo_url text, role public.app_role, is_owner boolean, is_current boolean, last_used_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.slug, t.business_name, t.logo_url, m.role, m.is_owner,
         t.id = (select p.tenant_id from public.profiles p where p.user_id = auth.uid()), m.last_used_at
  from public.tenant_members m join public.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid() and m.status = 'active' and t.deleted_at is null and t.is_active
  order by t.business_name
$$;
grant execute on function public.my_companies() to authenticated;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;
grant execute on function public.is_platform_admin() to authenticated;

/** Make a company the active one: data screens and the role follow it. */
create or replace function public.switch_company(p_tenant uuid)
returns text language plpgsql security definer set search_path = public as $$
declare _m public.tenant_members; _slug text;
begin
  select m.* into _m from public.tenant_members m join public.tenants t on t.id = m.tenant_id
   where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active' and t.deleted_at is null and t.is_active;
  if _m.id is null then
    -- Platform owners may open any company (support), as its administrator.
    if not public.is_platform_admin() then raise exception 'You are not a member of that company'; end if;
    insert into public.tenant_members (tenant_id, user_id, role) values (p_tenant, auth.uid(), 'admin')
    on conflict (tenant_id, user_id) do update set status = 'active' returning * into _m;
  end if;
  perform set_config('dash.switching', 'on', true);
  update public.profiles set tenant_id = p_tenant, updated_at = now() where user_id = auth.uid();
  delete from public.user_roles where user_id = auth.uid() and role <> _m.role;
  insert into public.user_roles (user_id, role) values (auth.uid(), _m.role) on conflict do nothing;
  update public.tenant_members set last_used_at = now() where id = _m.id;
  select slug into _slug from public.tenants where id = p_tenant;
  return _slug;
end $$;
grant execute on function public.switch_company(uuid) to authenticated;

/** The platform owner enters the super admin (platform) context. */
create or replace function public.enter_platform()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then return false; end if;
  perform set_config('dash.switching', 'on', true);
  insert into public.user_roles (user_id, role) values (auth.uid(), 'super_admin') on conflict do nothing;
  delete from public.user_roles where user_id = auth.uid() and role <> 'super_admin';
  return true;
end $$;
grant execute on function public.enter_platform() to authenticated;

/** Adds another company for the signed-in user (owner) or, for the platform owner, for anyone. */
create or replace function public.create_company(
  p_name text, p_slug text, p_country text default 'KE', p_currency text default 'KES',
  p_owner_email text default null, p_plan uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  _owner uuid := auth.uid();
  _tenant uuid;
  _slug text := lower(regexp_replace(coalesce(p_slug, ''), '[^a-z0-9-]+', '-', 'gi'));
  _plan public.plans;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_owner_email is not null and public.is_platform_admin() then
    select id into _owner from auth.users where lower(email) = lower(p_owner_email);
    if _owner is null then raise exception 'No account with that email'; end if;
  elsif not exists (select 1 from public.tenant_members where user_id = auth.uid() and is_owner) and not public.is_platform_admin() then
    raise exception 'Only a company owner can add companies';
  end if;
  if length(_slug) < 3 or _slug in ('www','app','dash','admin','api','mail','webmail','cpanel','ftp','status','help','docs','blog','login','register','portal')
    then raise exception 'Choose another address'; end if;
  if exists (select 1 from public.tenants where slug = _slug) then raise exception 'That address is taken'; end if;

  insert into public.tenants (business_name, owner_user_id, slug, activation_fee_paid_at, contact_email, contact_name, business_email)
  values (coalesce(nullif(trim(p_name), ''), 'New company'), _owner, _slug, now(), (select email from auth.users where id = _owner),
          coalesce((select display_name from public.profiles where user_id = _owner), (select email from auth.users where id = _owner)),
          (select email from auth.users where id = _owner))
  returning id into _tenant;
  insert into public.business_settings (tenant_id, business_name, country, currency)
  values (_tenant, coalesce(nullif(trim(p_name), ''), 'New company'), upper(coalesce(p_country, 'KE')), upper(coalesce(p_currency, 'KES')));
  select * into _plan from public.plans where is_active and (id = p_plan or p_plan is null) order by (id = p_plan) desc nulls last, price_monthly limit 1;
  insert into public.subscriptions (tenant_id, plan_id, plan_name, billing_cycle, max_users, max_locations, price, status, trial_ends_at, current_period_start, current_period_end)
  values (_tenant, _plan.id, coalesce(_plan.name, 'Starter'), 'monthly', coalesce(_plan.max_users, 3), coalesce(_plan.max_locations, 1), coalesce(_plan.price_monthly, 0),
          'trialing', now() + make_interval(days => coalesce(_plan.trial_days, 14)), now(), now() + make_interval(days => coalesce(_plan.trial_days, 14)));
  insert into public.tenant_members (tenant_id, user_id, role, is_owner, invited_by) values (_tenant, _owner, 'admin', true, auth.uid())
  on conflict (tenant_id, user_id) do update set role = 'admin', is_owner = true;
  return _tenant;
end $$;
grant execute on function public.create_company(text, text, text, text, text, uuid) to authenticated;

/** Gives an existing account access to a company (company admin or platform owner). */
create or replace function public.add_company_member(p_tenant uuid, p_email text, p_role public.app_role default 'manager')
returns uuid language plpgsql security definer set search_path = public as $$
declare _user uuid; _id uuid;
begin
  if not (public.is_platform_admin() or exists (
      select 1 from public.tenant_members where tenant_id = p_tenant and user_id = auth.uid() and role = 'admin' and status = 'active')) then
    raise exception 'Only the company administrator can add people';
  end if;
  if p_role = 'super_admin' then raise exception 'Not allowed'; end if;
  select id into _user from auth.users where lower(email) = lower(trim(p_email));
  if _user is null then raise exception 'No JMSURF DASH account uses that email yet. Add them as staff instead.'; end if;
  insert into public.tenant_members (tenant_id, user_id, role, invited_by) values (p_tenant, _user, p_role, auth.uid())
  on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active'
  returning id into _id;
  return _id;
end $$;
grant execute on function public.add_company_member(uuid, text, public.app_role) to authenticated;

create or replace function public.remove_company_member(p_tenant uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or exists (
      select 1 from public.tenant_members where tenant_id = p_tenant and user_id = auth.uid() and role = 'admin' and status = 'active')) then
    raise exception 'Only the company administrator can remove people';
  end if;
  if exists (select 1 from public.tenant_members where tenant_id = p_tenant and user_id = p_user and is_owner) then
    raise exception 'The owner cannot be removed';
  end if;
  update public.tenant_members set status = 'disabled' where tenant_id = p_tenant and user_id = p_user;
end $$;
grant execute on function public.remove_company_member(uuid, uuid) to authenticated;

-- ── Record engine ───────────────────────────────────────────────────────
create table if not exists public.app_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  app text not null,
  kind text not null,
  number text,
  title text not null default '',
  stage text,
  priority text,
  data jsonb not null default '{}'::jsonb,
  customer_id uuid,
  supplier_id uuid,
  employee_id uuid,
  product_id uuid,
  parent_id uuid references public.app_records(id) on delete set null,
  assigned_to uuid,
  amount numeric(16,2),
  quantity numeric(16,3),
  starts_at timestamptz,
  ends_at timestamptz,
  due_date date,
  tags text[] not null default '{}',
  sort double precision not null default 0,
  archived boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists app_records_kind_idx on public.app_records (tenant_id, app, kind, archived);
create index if not exists app_records_parent_idx on public.app_records (parent_id);
create index if not exists app_records_customer_idx on public.app_records (customer_id);
create index if not exists app_records_employee_idx on public.app_records (employee_id);

create table if not exists public.app_sequences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  app text not null,
  kind text not null,
  next_value bigint not null default 1,
  primary key (tenant_id, app, kind)
);
alter table public.app_sequences enable row level security;

create or replace function public.app_records_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare _prefix text; _n bigint;
begin
  if TG_OP = 'INSERT' then
    _prefix := NEW.data->>'_prefix';
    if NEW.number is null and coalesce(_prefix, '') <> '' then
      insert into public.app_sequences (tenant_id, app, kind, next_value) values (NEW.tenant_id, NEW.app, NEW.kind, 2)
      on conflict (tenant_id, app, kind) do update set next_value = public.app_sequences.next_value + 1
      returning next_value - 1 into _n;
      NEW.number := _prefix || lpad(_n::text, 5, '0');
    end if;
    NEW.data := NEW.data - '_prefix';
    NEW.created_by := coalesce(NEW.created_by, auth.uid());
  else
    NEW.tenant_id := OLD.tenant_id;
    NEW.app := OLD.app;
    NEW.data := NEW.data - '_prefix';
  end if;
  NEW.updated_at := now();
  return NEW;
end $$;
drop trigger if exists app_records_before on public.app_records;
create trigger app_records_before before insert or update on public.app_records
  for each row execute function public.app_records_before();

alter table public.app_records enable row level security;
drop policy if exists app_records_select on public.app_records;
create policy app_records_select on public.app_records for select
  using (tenant_id = public.current_user_tenant_id());
drop policy if exists app_records_insert on public.app_records;
create policy app_records_insert on public.app_records for insert
  with check (tenant_id = public.current_user_tenant_id()
    and public.tenant_module_active(tenant_id, case when app like 'studio:%' then 'studio' else app end));
drop policy if exists app_records_update on public.app_records;
create policy app_records_update on public.app_records for update
  using (tenant_id = public.current_user_tenant_id()
    and public.tenant_module_active(tenant_id, case when app like 'studio:%' then 'studio' else app end))
  with check (tenant_id = public.current_user_tenant_id());
drop policy if exists app_records_delete on public.app_records;
create policy app_records_delete on public.app_records for delete
  using (tenant_id = public.current_user_tenant_id()
    and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager') or created_by = auth.uid()));
grant select, insert, update, delete on public.app_records to authenticated;

create table if not exists public.app_record_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  record_id uuid not null references public.app_records(id) on delete cascade,
  kind text not null default 'comment' check (kind in ('comment', 'change', 'stage', 'file', 'system')),
  body text,
  data jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists app_record_events_record_idx on public.app_record_events (record_id, created_at);
alter table public.app_record_events enable row level security;
drop policy if exists app_record_events_rw on public.app_record_events;
create policy app_record_events_rw on public.app_record_events for all
  using (tenant_id = public.current_user_tenant_id())
  with check (tenant_id = public.current_user_tenant_id());
grant select, insert, update, delete on public.app_record_events to authenticated;

-- Studio: custom apps defined by the company (same shape as src/apps/types.ts).
create table if not exists public.app_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  app_key text not null,
  name text not null,
  icon text,
  color text,
  definition jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, app_key)
);
alter table public.app_definitions enable row level security;
drop policy if exists app_definitions_select on public.app_definitions;
create policy app_definitions_select on public.app_definitions for select using (tenant_id = public.current_user_tenant_id());
drop policy if exists app_definitions_write on public.app_definitions;
create policy app_definitions_write on public.app_definitions for all
  using (tenant_id = public.current_user_tenant_id() and public.has_role(auth.uid(), 'admin') and public.tenant_module_active(tenant_id, 'studio'))
  with check (tenant_id = public.current_user_tenant_id() and public.has_role(auth.uid(), 'admin') and public.tenant_module_active(tenant_id, 'studio'));
grant select, insert, update, delete on public.app_definitions to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.app_records; exception when others then null; end;
  begin alter publication supabase_realtime add table public.tenant_modules; exception when others then null; end;
end $$;

-- ── Sign-up: every new login gets a profile; company sign-ups get their company ──
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
