-- JMSURF Garage moves to jmsurfgarage.co.ke (2026-11-21).
--  * No company subdomains: a company's slug is an internal id, made by the database from the
--    business name at sign-up (cannot be chosen or changed by the company). Its customer pages
--    live at app.jmsurfgarage.co.ke/<slug>/…, so words used by the app's own paths are reserved.
--  * Custom domain, the JMSURF ISP way: a company pays KES 300 once (M-Pesa via JMSURF PAY, or the
--    platform owner unlocks it free), then connects one domain (plus its www alias when it is the
--    main domain). A row goes pending -> active when public DNS shows only the A record to our server.

-- 1. Reserved words and the slug maker ------------------------------------------------------------

create or replace function public.garage_reserved_slugs()
returns text[] language sql immutable as $$
  select array[
    'www','admin','app','dash','api','pay','mail','mx','smtp','imap','pop','webmail','cpanel','whm',
    'ftp','cdn','static','assets','img','images','files','blog','docs','portal','my',
    'help','support','status','dev','staging','preview','test','demo',
    'notify','email','mailer','auth','login','register','signup','aggregator',
    'webhook','webhooks','ns','ns1','ns2','autodiscover','autoconfig','jmsurf-admin',
    'dashboard','pos','inventory','customers','sales','purchases','payments','email-logs','reports',
    'ai-analysis','ai','staff','settings','delivery-confirm','stock-transfer','purchase-orders','suppliers',
    'invoices','quotes','expenses','bills','services','mpesa-history','credit-balances','unsubscribe',
    'audit-log','404','order','rider','water','tickets','whats-new','subscription-expired','billing',
    'reset-password','staff-login','customer-login','signin','account','shop','about','contact','cart',
    'checkout','book','events','learn','careers','join','sign','contract','oauth','terms','privacy',
    'photo-credits','pricing','features','solutions','crm','calendar','marketing','finance','approvals',
    'profile','hrm','me','documents','warehouse','branches','accounting','companies','notebook',
    'contracts','garage','garage-menu','modules','import','migrate','callcentre','apps','sales-reps',
    'e','t','fleet','check','yard','preorder','well-known','shop-brand'
  ]::text[]
$$;

create or replace function public.garage_slugify(p_name text)
returns text language sql immutable as $$
  select trim(both '-' from left(trim(both '-' from regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g')), 40))
$$;

/** A free company id from a business name: "Acme Motors" -> acme-motors, else acme-motors-x7k2. */
create or replace function public.garage_new_slug(p_name text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  _base text := public.garage_slugify(p_name);
  _s text;
  _i int := 0;
begin
  if length(_base) < 2 then _base := 'garage'; end if;
  _s := _base;
  loop
    if _s ~ '^[a-z0-9][a-z0-9-]{1,62}$'
       and not (_s = any (public.garage_reserved_slugs()))
       and not exists (select 1 from public.tenants where lower(slug) = _s)
       and not exists (select 1 from public.tenant_slug_history where slug = _s) then
      return _s;
    end if;
    _i := _i + 1;
    if _i > 60 then raise exception 'Could not make a company id'; end if;
    _s := trim(both '-' from left(_base, 34)) || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4 + (_i / 20));
  end loop;
end $$;
revoke all on function public.garage_new_slug(text) from public, anon, authenticated;

/**
 * Every new company gets its slug here. At sign-up (inside the auth.users trigger) it always comes
 * from the business name, whatever the sign-up form sent; the platform's own demo keeps "demo".
 * A platform-owner insert may name a free, valid, unreserved slug; anything else is replaced.
 */
create or replace function public.tenants_auto_slug()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _given text := lower(trim(coalesce(new.slug, '')));
  _demo boolean := _given = 'demo' and lower(coalesce(new.business_email, '')) = 'demo@jmsurf.co.ke'
                   and not exists (select 1 from public.tenants where lower(slug) = 'demo');
begin
  if _demo then new.slug := 'demo'; return new; end if;
  if pg_trigger_depth() > 1
     or _given !~ '^[a-z0-9][a-z0-9-]{1,62}$'
     or _given = any (public.garage_reserved_slugs())
     or exists (select 1 from public.tenants where lower(slug) = _given) then
    new.slug := public.garage_new_slug(new.business_name);
  else
    new.slug := _given;
  end if;
  return new;
end $$;
drop trigger if exists tenants_auto_slug on public.tenants;
create trigger tenants_auto_slug before insert on public.tenants
for each row execute function public.tenants_auto_slug();

-- 2. Custom domain: paid once per company --------------------------------------------------------

insert into public.platform_settings (key, value)
values ('custom_domain', jsonb_build_object('price_kes', 300))
on conflict (key) do nothing;

alter table public.tenants
  add column if not exists custom_domain_paid_at timestamptz,
  add column if not exists custom_domain_paid_via text;

-- Companies (not the platform owner) can no longer change their slug or mark the domain paid.
create or replace function public.guard_tenant_changes()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null or public.has_role(auth.uid(), 'super_admin') then
    return new;
  end if;
  -- close_my_shop may archive the caller's own shop, and change nothing else.
  if current_setting('app.shop_close', true) = '1'
     and old.id = public.current_user_tenant_id()
     and new.deleted_at is not null and new.is_active = false
     and new.owner_user_id is not distinct from old.owner_user_id
     and new.activation_fee_paid_at is not distinct from old.activation_fee_paid_at
     and new.slug is not distinct from old.slug
     and new.custom_domain_paid_at is not distinct from old.custom_domain_paid_at then
    return new;
  end if;
  -- garage_domain_unlock (platform owner) changes the domain payment only.
  if current_setting('app.domain_unlock', true) = '1'
     and new.is_active is not distinct from old.is_active and new.deleted_at is not distinct from old.deleted_at
     and new.owner_user_id is not distinct from old.owner_user_id and new.slug is not distinct from old.slug
     and new.activation_fee_paid_at is not distinct from old.activation_fee_paid_at then
    return new;
  end if;
  if new.is_active is distinct from old.is_active
     or new.deleted_at is distinct from old.deleted_at
     or new.owner_user_id is distinct from old.owner_user_id
     or new.activation_fee_paid_at is distinct from old.activation_fee_paid_at
     or new.slug is distinct from old.slug
     or new.custom_domain_paid_at is distinct from old.custom_domain_paid_at
     or new.custom_domain_paid_via is distinct from old.custom_domain_paid_via then
    raise exception 'Only the platform owner can change the shop status, owner, id or domain payment';
  end if;
  return new;
end;
$function$;

-- Companies that already have a working domain keep it without paying again.
update public.tenants t set custom_domain_paid_at = coalesce(t.custom_domain_paid_at, now()), custom_domain_paid_via = coalesce(t.custom_domain_paid_via, 'existing')
 where t.custom_domain_paid_at is null
   and exists (select 1 from public.tenant_domains d where d.tenant_id = t.id and d.kind = 'custom' and d.status in ('approved', 'active'));

create table if not exists public.garage_domain_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  phone text not null,
  reference text,
  receipt text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'cancelled')),
  detail text,
  created_by uuid,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists garage_domain_payments_tenant on public.garage_domain_payments (tenant_id, created_at desc);
create index if not exists garage_domain_payments_pending on public.garage_domain_payments (status, created_at) where status = 'pending';
alter table public.garage_domain_payments enable row level security;
drop policy if exists garage_domain_payments_read on public.garage_domain_payments;
create policy garage_domain_payments_read on public.garage_domain_payments for select to authenticated
  using (tenant_id = (select p.tenant_id from public.profiles p where p.user_id = auth.uid()));

/** Marks a completed domain payment and unlocks the company's custom domain, once (safe to call again). */
create or replace function public.garage_domain_paid(p_payment uuid, p_receipt text)
returns boolean language plpgsql security definer set search_path = public as $$
declare p public.garage_domain_payments;
begin
  update public.garage_domain_payments set status = 'completed', receipt = p_receipt, paid_at = now()
   where id = p_payment and status = 'pending' returning * into p;
  if p.id is null then return false; end if;
  update public.tenants set custom_domain_paid_at = coalesce(custom_domain_paid_at, now()),
         custom_domain_paid_via = coalesce(custom_domain_paid_via, 'mpesa')
   where id = p.tenant_id;
  return true;
end $$;
revoke all on function public.garage_domain_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.garage_domain_paid(uuid, text) to service_role;

/** Platform owner: unlock (or lock again) a company's custom domain without payment. */
create or replace function public.garage_domain_unlock(p_tenant uuid, p_unlock boolean default true)
returns boolean language plpgsql security definer set search_path = public as $$
declare _n int;
begin
  if not (public.has_role(auth.uid(), 'super_admin') or public.is_platform_admin()) then
    raise exception 'Only the platform owner can do this';
  end if;
  perform set_config('app.domain_unlock', '1', true);
  update public.tenants
     set custom_domain_paid_at = case when p_unlock then coalesce(custom_domain_paid_at, now()) else null end,
         custom_domain_paid_via = case when p_unlock then coalesce(custom_domain_paid_via, 'free') else null end
   where id = p_tenant;
  get diagnostics _n = row_count;
  perform set_config('app.domain_unlock', '', true);
  return _n > 0;
end $$;
revoke all on function public.garage_domain_unlock(uuid, boolean) from public, anon;
grant execute on function public.garage_domain_unlock(uuid, boolean) to authenticated;

-- 3. tenant_domains: verify token, www alias, check results ---------------------------------------

alter table public.tenant_domains
  add column if not exists verify_token text,
  add column if not exists alias_host text,
  add column if not exists alias_ok boolean not null default false,
  add column if not exists checked_at timestamptz,
  add column if not exists check_detail text;
update public.tenant_domains set verify_token = md5(random()::text || id::text) || md5(random()::text || clock_timestamp()::text)
 where verify_token is null;
alter table public.tenant_domains alter column verify_token set default (md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text));
alter table public.tenant_domains alter column verify_token set not null;
create unique index if not exists tenant_domains_verify_token_unique on public.tenant_domains (verify_token);
create unique index if not exists tenant_domains_alias_unique on public.tenant_domains (lower(alias_host)) where alias_host is not null;

-- One word for "serving": older rows said approved.
update public.tenant_domains set status = 'active', activated_at = coalesce(activated_at, approved_at, now())
 where kind = 'custom' and status = 'approved';

create or replace view public.tenant_domains_public with (security_invoker = true) as
select td.host, td.kind, t.slug, t.id as tenant_id, t.business_name, t.logo_url
  from public.tenant_domains td join public.tenants t on t.id = td.tenant_id
 where td.status in ('approved', 'active') and t.is_active = true and t.deleted_at is null;

-- Companies only request a domain through the server (paid check, one per company).
drop policy if exists td_insert on public.tenant_domains;

-- 4. "Add a company" (an owner's further company): the id comes from the name too; only the
--    platform owner may still name one (checked and made unique by tenants_auto_slug).
create or replace function public.create_company(p_name text, p_slug text, p_country text default 'KE', p_currency text default 'KES', p_owner_email text default null, p_plan uuid default null)
returns uuid language plpgsql security definer set search_path = public as $function$
declare
  _owner uuid := auth.uid();
  _tenant uuid;
  _slug text := case when public.is_platform_admin() then lower(regexp_replace(coalesce(p_slug, ''), '[^a-z0-9-]+', '-', 'gi')) else '' end;
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
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Enter the company name'; end if;

  select * into _prev from public.tenants where owner_user_id = _owner and deleted_at is null and nullif(trim(contact_name), '') is not null order by created_at limit 1;

  insert into public.tenants (business_name, owner_user_id, slug, activation_fee_paid_at, contact_email, contact_name, contact_phone, business_email)
  values (trim(p_name), _owner, nullif(_slug, ''), now(),
          coalesce(nullif(_prev.contact_email, ''), (select email from auth.users where id = _owner)),
          coalesce(nullif(_prev.contact_name, ''), (select display_name from public.profiles where user_id = _owner), (select email from auth.users where id = _owner)),
          nullif(_prev.contact_phone, ''),
          (select email from auth.users where id = _owner))
  returning id into _tenant;
  insert into public.business_settings (tenant_id, business_name, country, currency)
  values (_tenant, trim(p_name), upper(coalesce(p_country, 'KE')), upper(coalesce(p_currency, 'KES')));
  select * into _plan from public.plans where is_active and (id = p_plan or p_plan is null) order by (id = p_plan) desc nulls last, price_monthly limit 1;
  insert into public.subscriptions (tenant_id, plan_id, plan_name, billing_cycle, max_users, max_locations, price, status, trial_ends_at, current_period_start, current_period_end)
  values (_tenant, _plan.id, coalesce(_plan.name, 'Starter'), 'monthly', coalesce(_plan.max_users, 3), coalesce(_plan.max_locations, 1), coalesce(_plan.price_monthly, 0),
          'trialing', now() + make_interval(days => coalesce(_plan.trial_days, 14)), now(), now() + make_interval(days => coalesce(_plan.trial_days, 14)));
  insert into public.tenant_members (tenant_id, user_id, role, is_owner, invited_by) values (_tenant, _owner, 'admin', true, auth.uid())
  on conflict (tenant_id, user_id) do update set role = 'admin', is_owner = true;
  return _tenant;
end $function$;

-- 5. Closing a company is confirmed with its name (the slug is no longer shown to anyone).
create or replace function public.close_my_shop_by_name(p_confirm_name text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare _slug text;
begin
  select slug into _slug from public.tenants where id = public.current_user_tenant_id();
  if _slug is null then raise exception 'Sign in first'; end if;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(coalesce((select business_name from public.tenants where id = public.current_user_tenant_id()), ''))) then
    raise exception 'Type your company name exactly to confirm';
  end if;
  return public.close_my_shop(_slug, p_reason);
end $$;
revoke all on function public.close_my_shop_by_name(text, text) from public, anon;
grant execute on function public.close_my_shop_by_name(text, text) to authenticated;
