-- Who uses each company's system: sign-ins (from the sign-in server's own log), time in the system
-- and who is online now (a heartbeat every two minutes from each open, visible tab).

create table if not exists public.user_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  path text,
  user_agent text
);
create index if not exists user_presence_seen_idx on public.user_presence (last_seen_at desc);

create table if not exists public.user_usage_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day date not null,
  minutes integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, tenant_id, day)
);
create index if not exists user_usage_days_tenant_idx on public.user_usage_days (tenant_id, day);

alter table public.user_presence enable row level security;
alter table public.user_usage_days enable row level security;
-- Read and written only through the functions below.

/** Heartbeat from an open tab: online now, and minutes used today in the current company. */
create or replace function public.touch_presence(p_path text default null, p_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
declare _t uuid := public.current_user_tenant_id(); _day date := (now() at time zone 'Africa/Nairobi')::date;
begin
  if auth.uid() is null then return; end if;
  insert into public.user_presence (user_id, tenant_id, last_seen_at, started_at, path, user_agent)
  values (auth.uid(), _t, now(), now(), left(p_path, 200), left(p_agent, 300))
  on conflict (user_id) do update set
    started_at = case when user_presence.last_seen_at < now() - interval '10 minutes' then now() else user_presence.started_at end,
    tenant_id = excluded.tenant_id, last_seen_at = now(), path = excluded.path, user_agent = coalesce(excluded.user_agent, user_presence.user_agent);
  if _t is null then return; end if;
  -- Two minutes per beat, counted once even with several tabs open.
  insert into public.user_usage_days (user_id, tenant_id, day, minutes) values (auth.uid(), _t, _day, 2)
  on conflict (user_id, tenant_id, day) do update set
    minutes = user_usage_days.minutes + case when user_usage_days.last_seen_at < now() - interval '90 seconds' then 2 else 0 end,
    last_seen_at = case when user_usage_days.last_seen_at < now() - interval '90 seconds' then now() else user_usage_days.last_seen_at end;
end $$;
revoke all on function public.touch_presence(text, text) from public, anon;
grant execute on function public.touch_presence(text, text) to authenticated;

/** Sign-ins per person (the sign-in server's log), excluding token refreshes. */
create or replace function public.platform_login_stats(p_since timestamptz)
returns table (user_id uuid, logins integer, last_login timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select (e.payload->>'actor_id')::uuid, count(*)::int, max(e.created_at)
    from auth.audit_log_entries e
   where e.payload->>'action' = 'login' and e.created_at >= p_since
     and (e.payload->>'actor_id') ~ '^[0-9a-f-]{36}$'
   group by 1
$$;
revoke all on function public.platform_login_stats(timestamptz) from public, anon, authenticated;

/** Every company: how many of its people signed in and used it in the period, and who is on now. */
create or replace function public.admin_usage_companies(p_days integer default 30)
returns table (tenant_id uuid, business_name text, slug text, people integer, active_people integer, logins integer,
               last_login timestamptz, last_seen timestamptz, online_now integer, minutes integer, days_used integer)
language plpgsql stable security definer set search_path = public as $$
declare _since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can see this'; end if;
  return query
  with m as (
    select m.tenant_id, m.user_id from public.tenant_members m
     where m.status = 'active' and not exists (select 1 from public.platform_admins a where a.user_id = m.user_id)
  ), l as (select * from public.platform_login_stats(_since)),
  u as (
    select d.tenant_id, d.user_id, sum(d.minutes)::int mins, count(distinct d.day)::int days, max(d.last_seen_at) seen
      from public.user_usage_days d where d.last_seen_at >= _since group by 1, 2
  ), td as (
    select d.tenant_id, count(distinct d.day)::int days from public.user_usage_days d where d.last_seen_at >= _since group by 1
  )
  select t.id, t.business_name, t.slug,
         count(distinct m.user_id)::int,
         count(distinct m.user_id) filter (where l.user_id is not null or u.user_id is not null)::int,
         coalesce(sum(l.logins), 0)::int,
         max(l.last_login),
         greatest(max(u.seen), max(p.last_seen_at) filter (where p.tenant_id = t.id)),
         count(distinct p.user_id) filter (where p.tenant_id = t.id and p.last_seen_at > now() - interval '5 minutes')::int,
         coalesce(sum(u.mins), 0)::int,
         coalesce(max(td.days), 0)::int
    from public.tenants t
    left join td on td.tenant_id = t.id
    left join m on m.tenant_id = t.id
    left join l on l.user_id = m.user_id
    left join u on u.tenant_id = t.id and u.user_id = m.user_id
    left join public.user_presence p on p.user_id = m.user_id
   where t.deleted_at is null
   group by t.id, t.business_name, t.slug;
end $$;
revoke all on function public.admin_usage_companies(integer) from public, anon;
grant execute on function public.admin_usage_companies(integer) to authenticated;

/** One company's people: sign-ins, days and time used, last seen, online now. */
create or replace function public.admin_usage_people(p_tenant uuid, p_days integer default 30)
returns table (user_id uuid, display_name text, email text, role text, is_owner boolean, logins integer, last_login timestamptz,
               last_seen timestamptz, online boolean, here_now boolean, path text, user_agent text, minutes integer, days_used integer)
language plpgsql stable security definer set search_path = public as $$
declare _since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can see this'; end if;
  return query
  select m.user_id, p.display_name, u.email::text, m.role::text, m.is_owner,
         coalesce(l.logins, 0), l.last_login,
         greatest(d.seen, case when pr.tenant_id = p_tenant then pr.last_seen_at end, s.last_refresh),
         coalesce(pr.last_seen_at > now() - interval '5 minutes', false),
         coalesce(pr.last_seen_at > now() - interval '5 minutes' and pr.tenant_id = p_tenant, false),
         pr.path, pr.user_agent, coalesce(d.mins, 0), coalesce(d.days, 0)
    from public.tenant_members m
    left join auth.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
    left join public.platform_login_stats(_since) l on l.user_id = m.user_id
    left join public.user_presence pr on pr.user_id = m.user_id
    left join lateral (select sum(x.minutes)::int mins, count(distinct x.day)::int days, max(x.last_seen_at) seen
                         from public.user_usage_days x where x.user_id = m.user_id and x.tenant_id = p_tenant and x.last_seen_at >= _since) d on true
    left join lateral (select max(coalesce(z.refreshed_at::timestamptz, z.updated_at)) last_refresh from auth.sessions z where z.user_id = m.user_id) s on true
   where m.tenant_id = p_tenant and m.status = 'active'
     and not exists (select 1 from public.platform_admins a where a.user_id = m.user_id)
   order by 9 desc, 8 desc nulls last;
end $$;
revoke all on function public.admin_usage_people(uuid, integer) from public, anon;
grant execute on function public.admin_usage_people(uuid, integer) to authenticated;

/** Everyone online now (last heartbeat within five minutes), across all companies. */
create or replace function public.admin_online_now()
returns table (user_id uuid, display_name text, email text, tenant_id uuid, business_name text, slug text, path text, user_agent text, started_at timestamptz, last_seen_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can see this'; end if;
  return query
  select pr.user_id, p.display_name, u.email::text, pr.tenant_id, t.business_name, t.slug, pr.path, pr.user_agent, pr.started_at, pr.last_seen_at
    from public.user_presence pr
    left join auth.users u on u.id = pr.user_id
    left join public.profiles p on p.user_id = pr.user_id
    left join public.tenants t on t.id = pr.tenant_id
   where pr.last_seen_at > now() - interval '5 minutes'
     and not exists (select 1 from public.platform_admins a where a.user_id = pr.user_id)
   order by t.business_name, p.display_name;
end $$;
revoke all on function public.admin_online_now() from public, anon;
grant execute on function public.admin_online_now() to authenticated;
