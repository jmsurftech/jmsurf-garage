-- One person, several companies, a different role in each: the company role, branches and active / inactive
-- are kept per company (tenant_members) and brought into the profile when the person switches company.
alter table public.tenant_members add column if not exists company_role_id uuid references public.company_roles(id) on delete set null;
alter table public.tenant_members add column if not exists location_ids uuid[];

-- Changing the profile (in the company the person is working in) saves it for that company.
create or replace function public.sync_member_access_from_profile() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('dash.switching', true) = 'on' or new.tenant_id is null then return new; end if;
  if new.company_role_id is distinct from old.company_role_id or new.location_ids is distinct from old.location_ids or new.status is distinct from old.status then
    update public.tenant_members set company_role_id = new.company_role_id, location_ids = new.location_ids,
           status = case when new.status = 'inactive' then 'disabled' else 'active' end
     where tenant_id = new.tenant_id and user_id = new.user_id;
  end if;
  return new;
end $$;
drop trigger if exists sync_member_access_from_profile on public.profiles;
create trigger sync_member_access_from_profile after update on public.profiles for each row execute function public.sync_member_access_from_profile();

-- The access guard lets the company switch through (it copies the person's own membership, nothing more).
create or replace function public.profiles_guard_access() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('dash.switching', true) = 'on' then return new; end if;
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

-- Switching company brings that company's role, branches and status.
create or replace function public.switch_company(p_tenant uuid) returns text language plpgsql security definer set search_path = public as $$
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
  update public.profiles set tenant_id = p_tenant, company_role_id = _m.company_role_id, location_ids = _m.location_ids, status = 'active', updated_at = now() where user_id = auth.uid();
  delete from public.user_roles where user_id = auth.uid() and role <> _m.role;
  insert into public.user_roles (user_id, role) values (auth.uid(), _m.role) on conflict do nothing;
  -- The till and stock screens read user_locations: that company's branches.
  if _m.location_ids is not null and array_length(_m.location_ids, 1) > 0 then
    delete from public.user_locations where user_id = auth.uid();
    insert into public.user_locations (user_id, location_id, is_primary) select auth.uid(), x, ord = 1 from unnest(_m.location_ids) with ordinality as u(x, ord);
  end if;
  update public.tenant_members set last_used_at = now() where id = _m.id;
  select slug into _slug from public.tenants where id = p_tenant;
  return _slug;
end $$;

-- Everyone in the company (also people working in another of their companies right now), for Settings → Users.
create or replace function public.company_users() returns table (user_id uuid, display_name text, phone text, role text, is_owner boolean, member_status text,
  company_role_id uuid, location_ids uuid[], cost_per_hour numeric, address text, remarks text, invited_at timestamptz, created_at timestamptz, working_here boolean)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.display_name, p.phone, m.role::text, m.is_owner, m.status, m.company_role_id, m.location_ids, p.cost_per_hour, p.address, p.remarks, p.invited_at, m.created_at,
         p.tenant_id = m.tenant_id
    from public.tenant_members m left join public.profiles p on p.user_id = m.user_id
   where m.tenant_id = public.current_user_tenant_id()
     and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager') or public.has_role(auth.uid(), 'super_admin'))
$$;
grant execute on function public.company_users() to authenticated;
