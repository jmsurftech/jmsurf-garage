-- Platform admin: full management of any login (role, two-step sign-in, sessions), and a record of what
-- admins did. Every function checks is_platform_admin() itself; nothing is open to companies.
create table if not exists public.platform_admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid default auth.uid(),
  action text not null,
  target_type text not null,
  target_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists platform_admin_actions_created_idx on public.platform_admin_actions (created_at desc);
alter table public.platform_admin_actions enable row level security;
drop policy if exists platform_admin_actions_read on public.platform_admin_actions;
create policy platform_admin_actions_read on public.platform_admin_actions for select to authenticated using (public.is_platform_admin());
revoke insert, update, delete on public.platform_admin_actions from anon, authenticated;

create or replace function public.admin_set_user_role(p_user uuid, p_role public.app_role)
returns void language plpgsql security definer set search_path to 'public' as $$
declare old text;
begin
  if not public.is_platform_admin() then raise exception 'Only JMSURF platform owners can do this'; end if;
  select string_agg(role::text, ',') into old from public.user_roles where user_id = p_user;
  delete from public.user_roles where user_id = p_user and role <> p_role;
  insert into public.user_roles (user_id, role) select p_user, p_role where not exists (select 1 from public.user_roles where user_id = p_user and role = p_role);
  insert into public.platform_admin_actions (action, target_type, target_id, detail) values ('set_role', 'user', p_user, jsonb_build_object('from', old, 'to', p_role));
end $$;

create or replace function public.admin_reset_user_mfa(p_user uuid)
returns int language plpgsql security definer set search_path to 'public', 'auth' as $$
declare n int;
begin
  if not public.is_platform_admin() then raise exception 'Only JMSURF platform owners can do this'; end if;
  delete from auth.mfa_factors where user_id = p_user;
  get diagnostics n = row_count;
  insert into public.platform_admin_actions (action, target_type, target_id, detail) values ('reset_mfa', 'user', p_user, jsonb_build_object('factors_removed', n));
  return n;
end $$;

create or replace function public.admin_sign_out_user(p_user uuid)
returns int language plpgsql security definer set search_path to 'public', 'auth' as $$
declare n int;
begin
  if not public.is_platform_admin() then raise exception 'Only JMSURF platform owners can do this'; end if;
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  insert into public.platform_admin_actions (action, target_type, target_id, detail) values ('sign_out_everywhere', 'user', p_user, jsonb_build_object('sessions_ended', n));
  return n;
end $$;

-- Two-step status and last sign-in for the Users list.
create or replace function public.admin_user_security()
returns table (user_id uuid, mfa boolean, last_sign_in timestamptz, sessions int)
language sql stable security definer set search_path to 'public', 'auth' as $$
  select u.id,
         exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
         u.last_sign_in_at,
         (select count(*)::int from auth.sessions s where s.user_id = u.id)
  from auth.users u
  where public.is_platform_admin()
$$;

revoke execute on function public.admin_set_user_role(uuid, public.app_role), public.admin_reset_user_mfa(uuid), public.admin_sign_out_user(uuid), public.admin_user_security() from public, anon;
grant execute on function public.admin_set_user_role(uuid, public.app_role), public.admin_reset_user_mfa(uuid), public.admin_sign_out_user(uuid), public.admin_user_security() to authenticated;
