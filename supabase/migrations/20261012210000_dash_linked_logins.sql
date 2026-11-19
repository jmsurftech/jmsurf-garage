-- Multi-company access:
--  * one login in several companies (tenant_members), given by the platform owner here
--    or by a company owner (Companies & users);
--  * linked logins: two logins (different emails) of the same person see each
--    other's companies in the company switcher and switch with a one-time code.
--    Linked by the platform owner, or by the person proving both passwords.

create table if not exists public.account_links (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);
alter table public.account_links enable row level security;
drop policy if exists account_links_mine on public.account_links;
create policy account_links_mine on public.account_links for select to authenticated
  using (auth.uid() in (user_a, user_b) or public.is_platform_admin());

/** Logins linked to this one (both directions). */
create or replace function public._linked_users(p_user uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select case when user_a = p_user then user_b else user_a end from public.account_links where p_user in (user_a, user_b)
$$;

/** Companies of my linked logins, for the company switcher. */
create or replace function public.my_linked_companies()
returns table (linked_user_id uuid, linked_email text, tenant_id uuid, slug text, business_name text, logo_url text, role text)
language sql stable security definer set search_path = public, auth as $$
  select l, u.email::text, t.id, t.slug, t.business_name, t.logo_url, m.role::text
  from public._linked_users(auth.uid()) l
  join auth.users u on u.id = l
  join public.tenant_members m on m.user_id = l and m.status = 'active'
  join public.tenants t on t.id = m.tenant_id and t.deleted_at is null and t.is_active
  order by u.email, t.business_name
$$;
grant execute on function public.my_linked_companies() to authenticated;

/** My linked logins (for My profile). */
create or replace function public.my_linked_logins() returns table (user_id uuid, email text, linked_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text, a.created_at from public.account_links a
  join auth.users u on u.id = case when a.user_a = auth.uid() then a.user_b else a.user_a end
  where auth.uid() in (a.user_a, a.user_b)
$$;
grant execute on function public.my_linked_logins() to authenticated;

create or replace function public.unlink_login(p_other uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.account_links where (user_a, user_b) = (least(auth.uid(), p_other), greatest(auth.uid(), p_other))
$$;
grant execute on function public.unlink_login(uuid) to authenticated;

/** Server only: makes a company the active one for a login (switching to a linked login). */
create or replace function public.switch_company_for(p_user uuid, p_tenant uuid) returns text
language plpgsql security definer set search_path = public as $$
declare _m public.tenant_members; _slug text;
begin
  select m.* into _m from public.tenant_members m join public.tenants t on t.id = m.tenant_id
   where m.tenant_id = p_tenant and m.user_id = p_user and m.status = 'active' and t.deleted_at is null and t.is_active;
  if _m.id is null then raise exception 'That login is not in that company'; end if;
  perform set_config('dash.switching', 'on', true);
  update public.profiles set tenant_id = p_tenant, updated_at = now() where user_id = p_user;
  delete from public.user_roles where user_id = p_user and role <> _m.role;
  insert into public.user_roles (user_id, role) values (p_user, _m.role) on conflict do nothing;
  update public.tenant_members set last_used_at = now() where id = _m.id;
  select slug into _slug from public.tenants where id = p_tenant;
  return _slug;
end $$;
revoke all on function public.switch_company_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.switch_company_for(uuid, uuid) to service_role;

-- ---- Platform owner: give access and link logins -------------------------------

/** A login's companies and linked logins (Admin → Users → Access). */
create or replace function public.admin_user_access(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this'; end if;
  return jsonb_build_object(
    'companies', coalesce((select jsonb_agg(jsonb_build_object('tenant_id', t.id, 'business_name', t.business_name, 'slug', t.slug, 'role', m.role, 'is_owner', m.is_owner, 'status', m.status) order by t.business_name)
      from public.tenant_members m join public.tenants t on t.id = m.tenant_id where m.user_id = p_user), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(jsonb_build_object('user_id', u.id, 'email', u.email)) from public._linked_users(p_user) l join auth.users u on u.id = l), '[]'::jsonb)
  );
end $$;
grant execute on function public.admin_user_access(uuid) to authenticated;

/** Adds a login to a company with a role, changes the role, or removes the access (p_role null). */
create or replace function public.admin_set_company_access(p_user uuid, p_tenant uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this'; end if;
  if p_role is null then
    if exists (select 1 from public.tenant_members where user_id = p_user and tenant_id = p_tenant and is_owner) then raise exception 'The owner cannot be removed from their company'; end if;
    delete from public.tenant_members where user_id = p_user and tenant_id = p_tenant;
    -- Their current company moves to another one they still have.
    update public.profiles set tenant_id = (select tenant_id from public.tenant_members where user_id = p_user and status = 'active' order by last_used_at desc nulls last limit 1)
     where user_id = p_user and tenant_id = p_tenant;
    return;
  end if;
  insert into public.tenant_members (tenant_id, user_id, role, invited_by, status)
  values (p_tenant, p_user, p_role::public.app_role, auth.uid(), 'active')
  on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active';
  update public.profiles set tenant_id = p_tenant where user_id = p_user and tenant_id is null;
end $$;
grant execute on function public.admin_set_company_access(uuid, uuid, text) to authenticated;

create or replace function public.admin_link_logins(p_a uuid, p_b uuid, p_link boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this'; end if;
  if p_a = p_b then raise exception 'Choose two different logins'; end if;
  if p_link then
    insert into public.account_links (user_a, user_b) values (least(p_a, p_b), greatest(p_a, p_b)) on conflict do nothing;
  else
    delete from public.account_links where (user_a, user_b) = (least(p_a, p_b), greatest(p_a, p_b));
  end if;
end $$;
grant execute on function public.admin_link_logins(uuid, uuid, boolean) to authenticated;

/** Finds a login by email (Admin → Access → link). */
create or replace function public.admin_find_login(p_email text) returns table (user_id uuid, email text, display_name text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this'; end if;
  return query select u.id, u.email::text, p.display_name from auth.users u left join public.profiles p on p.user_id = u.id
    where u.email ilike '%' || trim(p_email) || '%' order by u.email limit 10;
end $$;
grant execute on function public.admin_find_login(text) to authenticated;
