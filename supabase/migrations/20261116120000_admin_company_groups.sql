-- Platform owner: one person in several companies, and one payment for several companies.

/** Everyone who can open a company (its members), with their login email. Platform owner only. */
create or replace function public.admin_company_people(p_tenant uuid)
returns table (user_id uuid, email text, display_name text, phone text, role text, is_owner boolean, status text,
               last_used_at timestamptz, created_at timestamptz, companies integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can see this'; end if;
  return query
    select m.user_id, u.email::text, p.display_name, p.phone, m.role::text, m.is_owner, m.status, m.last_used_at, m.created_at,
           (select count(*)::int from public.tenant_members x join public.tenants t on t.id = x.tenant_id
             where x.user_id = m.user_id and x.status = 'active' and t.deleted_at is null)
      from public.tenant_members m
      left join auth.users u on u.id = m.user_id
      left join public.profiles p on p.user_id = m.user_id
     where m.tenant_id = p_tenant
       -- The platform owner's own support visits are not people of the company.
       and not exists (select 1 from public.platform_admins a where a.user_id = m.user_id)
     order by m.is_owner desc, m.status, p.display_name nulls last;
end $$;
revoke all on function public.admin_company_people(uuid) from public, anon;
grant execute on function public.admin_company_people(uuid) to authenticated;

/**
 * One payment (one M-Pesa code or bank reference) for several companies. Each company gets
 * its own payment row (its share), and its package runs one more billing period: from its
 * current end date while it is still paid up, otherwise from today.
 * p_total: what was actually received; shared out by what each company owes. Null = the full amount.
 */
create or replace function public.admin_record_payment(p_tenants uuid[], p_reference text, p_total numeric default null, p_gateway text default 'manual')
returns table (tenant_id uuid, business_name text, amount numeric, paid_until timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  _s record; _due numeric; _share numeric; _left numeric; _end timestamptz; _n int; _i int := 0;
  _group uuid := gen_random_uuid(); _ref text := upper(trim(coalesce(p_reference, '')));
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can record payments'; end if;
  if _ref = '' then raise exception 'Enter the M-Pesa code or reference'; end if;
  if coalesce(array_length(p_tenants, 1), 0) = 0 then raise exception 'Choose at least one company'; end if;
  if p_total is not null and p_total < 0 then raise exception 'The amount cannot be negative'; end if;

  select coalesce(sum(x.due), 0), count(*) into _due, _n from (
    select distinct on (s.tenant_id) coalesce(s.price, 0) * (case s.billing_cycle when 'quarterly' then 3 when 'annually' then 12 else 1 end) as due
      from public.subscriptions s join public.tenants t on t.id = s.tenant_id
     where s.tenant_id = any(p_tenants) and t.deleted_at is null
     order by s.tenant_id, s.created_at desc) x;
  if _n = 0 then raise exception 'None of those companies has a package yet'; end if;
  _left := coalesce(p_total, _due);

  for _s in
    select distinct on (s.tenant_id) s.*, t.business_name as tname,
           case s.billing_cycle when 'quarterly' then 3 when 'annually' then 12 else 1 end as months
      from public.subscriptions s join public.tenants t on t.id = s.tenant_id
     where s.tenant_id = any(p_tenants) and t.deleted_at is null
     order by s.tenant_id, s.created_at desc
  loop
    _i := _i + 1;
    -- Each company's share of what was received (the last one takes the rounding).
    if _i = _n then _share := _left;
    elsif p_total is null then _share := coalesce(_s.price, 0) * _s.months;
    elsif _due > 0 then _share := round(p_total * (coalesce(_s.price, 0) * _s.months) / _due, 2);
    else _share := round(p_total / _n, 2);
    end if;
    _left := _left - _share;

    _end := (case when _s.status = 'active' and _s.current_period_end > now() then _s.current_period_end else now() end)
            + make_interval(months => _s.months);

    insert into public.subscription_payments (tenant_id, subscription_id, amount, gateway, status, reference, metadata)
    values (_s.tenant_id, _s.id, _share, coalesce(nullif(trim(p_gateway), ''), 'manual'), 'completed', _ref,
            jsonb_build_object('plan_name', _s.plan_name, 'billing_cycle', _s.billing_cycle, 'recorded_by', 'super_admin',
                               'group_id', _group, 'group_size', _n, 'group_total', coalesce(p_total, _due)));

    update public.subscriptions set status = 'active', paused_at = null, trial_ends_at = null,
           current_period_start = now(), current_period_end = _end, updated_at = now()
     where id = _s.id;
    update public.tenants set is_active = true where id = _s.tenant_id;

    tenant_id := _s.tenant_id; business_name := _s.tname; amount := _share; paid_until := _end;
    return next;
  end loop;
end $$;
revoke all on function public.admin_record_payment(uuid[], text, numeric, text) from public, anon;
grant execute on function public.admin_record_payment(uuid[], text, numeric, text) to authenticated;
