-- JMSURF CALL CENTRE as a SaaS of its own:
--  * its own plans, subscriptions and payments (M-Pesa through JMSURF Pay), not
--    on the JMSURF DASH bill; a paid subscription switches the Call Centre on in
--    the company's DASH automatically (free there: it is paid here);
--  * outbound call lists and blocked numbers;
-- and, for every JMSURF product's sign-up, "how did you hear about us" and the
-- other sign-up answers go to the platform CRM (platform_leads).

-- ---- Plans, subscriptions, payments ------------------------------------------------
create table if not exists public.cc_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price_monthly numeric(12,2) not null default 0,
  agents_included int not null default 2,
  extra_agent_price numeric(12,2) not null default 0,
  features text[] not null default '{}',
  sort int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.cc_plans enable row level security;
drop policy if exists cc_plans_read on public.cc_plans;
create policy cc_plans_read on public.cc_plans for select to anon, authenticated using (is_active or public.is_platform_admin());
drop policy if exists cc_plans_owner on public.cc_plans;
create policy cc_plans_owner on public.cc_plans for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

insert into public.cc_plans (name, description, price_monthly, agents_included, extra_agent_price, features, sort)
select * from (values
  ('Starter', 'One line for a small team', 2500::numeric, 2, 800::numeric, array['Phone menu (IVR) and 1 queue', 'Browser phones for 2 agents', 'Call recording', 'Missed-call SMS and callbacks', 'Reports'], 1),
  ('Business', 'Queues, wallboard and messages', 6000::numeric, 5, 700::numeric, array['Everything in Starter', '5 agents included', 'Unlimited queues', 'Live wallboard', 'SMS conversations', 'Outbound call lists'], 2),
  ('Contact Centre', 'For busy support and sales teams', 15000::numeric, 15, 600::numeric, array['Everything in Business', '15 agents included', 'Priority support', 'Screen pop from JMSURF DASH', 'Advanced reports'], 3)
) v(name, description, price_monthly, agents_included, extra_agent_price, features, sort)
where not exists (select 1 from public.cc_plans);

create table if not exists public.cc_subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan_id uuid references public.cc_plans(id) on delete set null,
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'cancelled', 'comped')),
  agents int not null default 2,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.cc_subscriptions enable row level security;
drop policy if exists cc_subscriptions_read on public.cc_subscriptions;
create policy cc_subscriptions_read on public.cc_subscriptions for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());

create table if not exists public.cc_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid references public.cc_plans(id) on delete set null,
  months int not null default 1,
  agents int not null default 2,
  amount numeric(12,2) not null,
  phone text,
  gateway text not null default 'jmsurf',
  reference text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'cancelled')),
  receipt text,
  detail text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists cc_payments_tenant_idx on public.cc_payments (tenant_id, created_at desc);
alter table public.cc_payments enable row level security;
drop policy if exists cc_payments_read on public.cc_payments;
create policy cc_payments_read on public.cc_payments for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());

/** A company's call centre subscription, created as a 14-day trial the first time. */
create or replace function public.cc_subscription_for(p_tenant uuid) returns public.cc_subscriptions
language plpgsql security definer set search_path = public as $$
declare s public.cc_subscriptions; bundle boolean;
begin
  select * into s from public.cc_subscriptions where tenant_id = p_tenant;
  if s.tenant_id is not null then return s; end if;
  -- Companies on an all-apps DASH plan keep the call centre included.
  select coalesce(p.all_modules, false) into bundle from public.subscriptions x left join public.plans p on p.id = x.plan_id
   where x.tenant_id = p_tenant order by x.created_at desc limit 1;
  insert into public.cc_subscriptions (tenant_id, plan_id, status, trial_ends_at)
  values (p_tenant, (select id from public.cc_plans where is_active order by sort limit 1), case when bundle then 'comped' else 'trial' end, now() + interval '14 days')
  on conflict (tenant_id) do nothing;
  select * into s from public.cc_subscriptions where tenant_id = p_tenant;
  perform public.cc_sync_module(p_tenant);
  return s;
end $$;

/** Keeps the Call Centre switch in DASH in step with the call centre subscription (never on the DASH bill). */
create or replace function public.cc_sync_module(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.cc_subscriptions; live boolean;
begin
  select * into s from public.cc_subscriptions where tenant_id = p_tenant;
  if s.tenant_id is null then return; end if;
  live := s.status = 'comped' or (s.status = 'active' and coalesce(s.current_period_end, now()) > now()) or (s.status = 'trial' and coalesce(s.trial_ends_at, now()) > now());
  insert into public.tenant_modules (tenant_id, module_key, status, price_monthly, trial_ends_at, current_period_end)
  values (p_tenant, 'callcentre', case when live then 'comped' else 'cancelled' end, 0, null, s.current_period_end)
  on conflict (tenant_id, module_key) do update set status = excluded.status, price_monthly = 0, current_period_end = excluded.current_period_end,
    cancelled_at = case when excluded.status = 'cancelled' then now() else null end, updated_at = now();
end $$;

/** A completed payment: extends the subscription and switches the Call Centre on in DASH. */
create or replace function public.cc_apply_payment(p_payment uuid, p_receipt text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.cc_payments; s public.cc_subscriptions; start_at timestamptz;
begin
  select * into p from public.cc_payments where id = p_payment for update;
  if p.id is null or p.status = 'completed' then return; end if;
  update public.cc_payments set status = 'completed', paid_at = now(), receipt = coalesce(p_receipt, receipt) where id = p.id;
  s := public.cc_subscription_for(p.tenant_id);
  start_at := greatest(coalesce(s.current_period_end, now()), now());
  update public.cc_subscriptions set status = 'active', plan_id = coalesce(p.plan_id, plan_id), agents = greatest(p.agents, 1),
    current_period_end = start_at + make_interval(months => p.months), updated_at = now() where tenant_id = p.tenant_id;
  perform public.cc_sync_module(p.tenant_id);
  insert into public.platform_alert_queue (event, title, body, link)
  select 'payment', 'Call centre payment: ' || t.business_name, 'KES ' || to_char(p.amount, 'FM999,999,990') || ' · ' || p.months || ' month(s)', '/admin'
  from public.tenants t where t.id = p.tenant_id;
end $$;

/** Daily: lapsed subscriptions switch the Call Centre off in DASH. */
create or replace function public.cc_expire_subscriptions() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select tenant_id from public.cc_subscriptions
           where (status = 'active' and current_period_end < now()) or (status = 'trial' and trial_ends_at < now()) loop
    update public.cc_subscriptions set status = 'past_due', updated_at = now() where tenant_id = r.tenant_id;
    perform public.cc_sync_module(r.tenant_id);
    n := n + 1;
  end loop;
  return n;
end $$;

/** Platform owner: change a company's call centre subscription by hand. */
create or replace function public.cc_admin_set_subscription(p_tenant uuid, p_status text, p_plan uuid, p_months int, p_agents int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this'; end if;
  perform public.cc_subscription_for(p_tenant);
  update public.cc_subscriptions set
    status = coalesce(p_status, status), plan_id = coalesce(p_plan, plan_id), agents = coalesce(p_agents, agents),
    current_period_end = case when coalesce(p_months, 0) > 0 then greatest(coalesce(current_period_end, now()), now()) + make_interval(months => p_months) else current_period_end end,
    trial_ends_at = case when p_status = 'trial' and coalesce(p_months, 0) > 0 then now() + make_interval(days => p_months * 30) else trial_ends_at end,
    updated_at = now()
  where tenant_id = p_tenant;
  perform public.cc_sync_module(p_tenant);
end $$;
grant execute on function public.cc_admin_set_subscription(uuid, text, uuid, int, int) to authenticated;
revoke all on function public.cc_apply_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.cc_apply_payment(uuid, text) to service_role;
grant execute on function public.cc_subscription_for(uuid) to authenticated, service_role;

-- New call centre companies start their trial in their call centre subscription.
create or replace function public.cc_trial_on_module() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.module_key = 'callcentre' and not exists (select 1 from public.cc_subscriptions where tenant_id = NEW.tenant_id) then
    insert into public.cc_subscriptions (tenant_id, plan_id, status, trial_ends_at)
    values (NEW.tenant_id, (select id from public.cc_plans where is_active order by sort limit 1), 'trial', now() + interval '14 days')
    on conflict do nothing;
  end if;
  return NEW;
end $$;
drop trigger if exists cc_trial_on_module on public.tenant_modules;
create trigger cc_trial_on_module after insert on public.tenant_modules for each row execute function public.cc_trial_on_module();

-- ---- Outbound call lists and blocked numbers -------------------------------------
create table if not exists public.cc_call_lists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  name text not null,
  purpose text,
  script text,
  status text not null default 'active' check (status in ('active', 'paused', 'done')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.cc_call_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.cc_call_lists(id) on delete cascade,
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  name text,
  phone text not null,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'no_answer', 'callback', 'done', 'skipped')),
  outcome text,
  notes text,
  attempts int not null default 0,
  agent_id uuid references public.cc_agents(id) on delete set null,
  last_called_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cc_call_list_items_list_idx on public.cc_call_list_items (list_id, status);
create table if not exists public.cc_blocked_numbers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  number text not null,
  reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tenant_id, number)
);
do $$ declare t text; begin
  foreach t in array array['cc_call_lists', 'cc_call_list_items', 'cc_blocked_numbers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant', t);
    execute format('create policy %I on public.%I for all to authenticated using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id())', t || '_tenant', t);
  end loop;
end $$;

-- ---- Sign-up answers in the platform CRM ------------------------------------------
alter table public.platform_leads add column if not exists product text not null default 'dash';
alter table public.platform_leads add column if not exists heard_from text;
alter table public.platform_leads add column if not exists details jsonb not null default '{}'::jsonb;
create index if not exists platform_leads_heard_idx on public.platform_leads (heard_from);

create or replace function public.platform_lead_from_tenant() returns trigger
language plpgsql security definer set search_path = public as $$
declare meta jsonb; product text;
begin
  select raw_user_meta_data into meta from auth.users where id = NEW.owner_user_id;
  meta := coalesce(meta, '{}'::jsonb);
  product := case when meta->>'signup_source' = 'callcentre' then 'callcentre' else 'dash' end;
  insert into public.platform_leads (name, company, email, phone, source, stage, tenant_id, product, heard_from, country, details, notes)
  values (coalesce(NEW.contact_name, NEW.business_name), NEW.business_name, coalesce(NEW.contact_email, NEW.business_email), coalesce(NEW.contact_phone, NEW.business_phone),
          'signup', 'trial', NEW.id, product, nullif(meta->>'heard_from', ''), coalesce(nullif(meta->>'country', ''), 'KE'),
          jsonb_strip_nulls(jsonb_build_object('heard_detail', meta->>'heard_detail', 'company_size', meta->>'company_size', 'industry', NEW.industry,
            'job_title', meta->>'job_title', 'agents', meta->>'agents', 'monthly_calls', meta->>'monthly_calls', 'goals', meta->'goals', 'website', meta->>'website')),
          'https://' || NEW.slug || '.jmsurfdash.co.ke')
  on conflict do nothing;
  insert into public.platform_alert_queue (event, title, body, link)
  values ('signup', 'New ' || case when product = 'callcentre' then 'call centre' else 'DASH' end || ' sign-up: ' || NEW.business_name,
          concat_ws(' · ', NEW.contact_name, NEW.contact_email, NEW.contact_phone, 'heard via ' || nullif(meta->>'heard_from', '')), '/admin/leads');
  return NEW;
exception when others then
  raise warning 'platform lead for tenant %: %', NEW.id, sqlerrm;
  return NEW;
end $$;
