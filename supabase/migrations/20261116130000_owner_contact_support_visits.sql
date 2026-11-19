-- A company's user list leaves out the platform owner's support visits (unless they own it).
create or replace function public.company_users()
returns table (user_id uuid, display_name text, phone text, role text, is_owner boolean, member_status text, company_role_id uuid, location_ids uuid[],
               cost_per_hour numeric, address text, remarks text, invited_at timestamptz, created_at timestamptz, working_here boolean)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.display_name, p.phone, m.role::text, m.is_owner, m.status, m.company_role_id, m.location_ids, p.cost_per_hour, p.address, p.remarks, p.invited_at, m.created_at,
         p.tenant_id = m.tenant_id
    from public.tenant_members m left join public.profiles p on p.user_id = m.user_id
   where m.tenant_id = public.current_user_tenant_id()
     and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager') or public.has_role(auth.uid(), 'super_admin'))
     and (m.is_owner or not exists (select 1 from public.platform_admins a where a.user_id = m.user_id))
$$;

-- A further company of an existing owner takes the owner's contact details from their first company
-- (not the login's display name, which may be whoever set the login up).
create or replace function public.create_company(p_name text, p_slug text, p_country text default 'KE', p_currency text default 'KES', p_owner_email text default null, p_plan uuid default null)
returns uuid language plpgsql security definer set search_path = public as $function$
declare
  _owner uuid := auth.uid();
  _tenant uuid;
  _slug text := lower(regexp_replace(coalesce(p_slug, ''), '[^a-z0-9-]+', '-', 'gi'));
  _plan public.plans;
  _prev public.tenants;
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

  select * into _prev from public.tenants where owner_user_id = _owner and deleted_at is null and nullif(trim(contact_name), '') is not null order by created_at limit 1;

  insert into public.tenants (business_name, owner_user_id, slug, activation_fee_paid_at, contact_email, contact_name, contact_phone, business_email)
  values (coalesce(nullif(trim(p_name), ''), 'New company'), _owner, _slug, now(),
          coalesce(nullif(_prev.contact_email, ''), (select email from auth.users where id = _owner)),
          coalesce(nullif(_prev.contact_name, ''), (select display_name from public.profiles where user_id = _owner), (select email from auth.users where id = _owner)),
          nullif(_prev.contact_phone, ''),
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
end $function$;
