-- JMSURF CALL CENTRE admin console (2026-10-10):
--   * numbers are handed out by one internal function, used by the admin (cc_admin_assign_number)
--     and by the server when a company takes a free JMSURF number itself (cc_take_number)
--   * notes the platform owner keeps on a company
--   * an activity log of what the platform owner changed (written by the call centre server)

create or replace function public.cc_assign_number_internal(p_number uuid, p_tenant uuid, p_request uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare n public.cc_numbers;
begin
  select * into n from public.cc_numbers where id = p_number for update;
  if n.id is null then raise exception 'Number not found'; end if;
  if p_tenant is null then
    update public.cc_settings set at_number = null where tenant_id = n.tenant_id and at_number = n.number and line_mode = 'managed';
    update public.cc_numbers set status = 'available', tenant_id = null, assigned_at = null, next_charge_at = null where id = n.id;
    return;
  end if;
  if n.status = 'retired' then raise exception 'That number is retired'; end if;
  if n.status = 'assigned' and n.tenant_id is distinct from p_tenant then raise exception 'That number belongs to another company. Take it back first.'; end if;
  if exists (select 1 from public.cc_settings where at_number = n.number and tenant_id <> p_tenant) then raise exception 'That number is connected to another company'; end if;
  -- One JMSURF number per company: the previous one goes back to the pool.
  update public.cc_numbers set status = 'available', tenant_id = null, assigned_at = null, next_charge_at = null where tenant_id = p_tenant and id <> n.id;
  update public.cc_numbers set status = 'assigned', tenant_id = p_tenant, assigned_at = coalesce(assigned_at, now()), next_charge_at = coalesce(next_charge_at, now()) where id = n.id;
  insert into public.cc_settings (tenant_id, at_number, line_mode, enabled) values (p_tenant, n.number, 'managed', true)
  on conflict (tenant_id) do update set at_number = excluded.at_number, line_mode = 'managed', updated_at = now();
  insert into public.cc_wallets (tenant_id) values (p_tenant) on conflict do nothing;
  if p_request is not null then
    update public.cc_number_requests set status = 'done', number_id = n.id, decided_at = now() where id = p_request and tenant_id = p_tenant;
  end if;
  -- Any other open request of this company is answered by this number too.
  update public.cc_number_requests set status = 'done', number_id = n.id, decided_at = now() where tenant_id = p_tenant and status = 'pending';
  insert into public.shop_notifications (tenant_id, kind, title, body, link, sent_at)
  values (p_tenant, 'call', 'Your call centre number is ready: ' || n.number, 'Calls to this number now ring your agents.', '/callcentre', now());
end $$;

create or replace function public.cc_admin_assign_number(p_number uuid, p_tenant uuid, p_request uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this'; end if;
  perform public.cc_assign_number_internal(p_number, p_tenant, p_request);
end $$;

/** A company takes the next free JMSURF number of a kind (any kind when none of that kind is free). Server only. */
create or replace function public.cc_take_number(p_tenant uuid, p_kind text default null)
returns public.cc_numbers language plpgsql security definer set search_path = public as $$
declare n public.cc_numbers;
begin
  select * into n from public.cc_numbers where tenant_id = p_tenant and status = 'assigned' limit 1;
  if n.id is not null then return n; end if;
  select * into n from public.cc_numbers where status = 'available' and (p_kind is null or kind = p_kind)
   order by created_at limit 1 for update skip locked;
  if n.id is null and p_kind is not null then
    select * into n from public.cc_numbers where status = 'available' order by created_at limit 1 for update skip locked;
  end if;
  if n.id is null then return null; end if;
  perform public.cc_assign_number_internal(n.id, p_tenant, null);
  select * into n from public.cc_numbers where id = n.id;
  return n;
end $$;

revoke all on function public.cc_assign_number_internal(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.cc_take_number(uuid, text) from public, anon, authenticated;
grant execute on function public.cc_assign_number_internal(uuid, uuid, uuid) to service_role;
grant execute on function public.cc_take_number(uuid, text) to service_role;

alter table public.cc_subscriptions add column if not exists admin_notes text;

create table if not exists public.cc_admin_log (
  id uuid primary key default gen_random_uuid(),
  actor uuid,
  actor_email text,
  tenant_id uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cc_admin_log_tenant on public.cc_admin_log (tenant_id, created_at desc);
create index if not exists cc_admin_log_time on public.cc_admin_log (created_at desc);
alter table public.cc_admin_log enable row level security;
drop policy if exists cc_admin_log_owner on public.cc_admin_log;
create policy cc_admin_log_owner on public.cc_admin_log for select using (public.is_platform_admin());
revoke all on public.cc_admin_log from anon, authenticated;
grant select on public.cc_admin_log to authenticated;
grant all on public.cc_admin_log to service_role;
