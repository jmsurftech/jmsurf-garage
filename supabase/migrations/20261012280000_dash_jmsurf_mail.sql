-- JMSURF MAIL (mail.jmsurf.co.ke): transactional email as a service.
-- Companies (the same JMSURF companies and logins as DASH) verify their sending domains,
-- create API keys and send through the JMSURF Mail API. Delivery goes through JMSURF's
-- provider (Brevo) with the company's own SMTP as an optional fallback. Plans are paid by
-- M-Pesa through JMSURF Pay. Every table is private to its company (RLS); the mail server
-- (service role) does the writes that need care (keys, sending, usage, billing).

-- ---- plans & subscriptions ------------------------------------------------
create table if not exists public.mail_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  price_monthly numeric(12,2) not null default 0,
  emails_monthly int not null,
  daily_cap int,
  domains int not null default 1,
  features text[] not null default '{}',
  sort int not null default 0,
  is_active boolean not null default true,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.mail_plans enable row level security;
drop policy if exists mail_plans_read on public.mail_plans;
create policy mail_plans_read on public.mail_plans for select to anon, authenticated using ((is_active and is_public) or public.is_platform_admin());
drop policy if exists mail_plans_owner on public.mail_plans;
create policy mail_plans_owner on public.mail_plans for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

insert into public.mail_plans (code, name, description, price_monthly, emails_monthly, daily_cap, domains, features, sort, is_public) values
  ('free', 'Free', 'Try it and send your first emails', 0, 1000, 100, 1, array['1,000 emails a month (100 a day)', '1 sending domain', 'REST API and webhooks', 'Delivery logs for 7 days'], 1, true),
  ('starter', 'Starter', 'For a growing business', 990, 15000, null, 3, array['15,000 emails a month', '3 sending domains', 'Open and click tracking', 'Delivery logs for 30 days', 'Email support'], 2, true),
  ('business', 'Business', 'For busy apps and online shops', 2990, 60000, null, 10, array['60,000 emails a month', '10 sending domains', 'Your own SMTP as backup', 'Delivery logs for 90 days', 'Priority support'], 3, true),
  ('scale', 'Scale', 'High volume senders', 7990, 250000, null, 50, array['250,000 emails a month', '50 sending domains', 'Everything in Business', 'Logs for 1 year', 'Dedicated onboarding'], 4, true),
  ('internal', 'JMSURF internal', 'JMSURF''s own systems', 0, 100000000, null, 100, array['JMSURF systems'], 99, false)
on conflict (code) do nothing;

create table if not exists public.mail_subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan_id uuid references public.mail_plans(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'past_due', 'cancelled', 'suspended')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mail_subscriptions enable row level security;
drop policy if exists mail_subscriptions_read on public.mail_subscriptions;
create policy mail_subscriptions_read on public.mail_subscriptions for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());

create table if not exists public.mail_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid references public.mail_plans(id) on delete set null,
  months int not null default 1,
  amount numeric(12,2) not null,
  phone text,
  reference text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'cancelled')),
  receipt text,
  detail text,
  created_by uuid,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists mail_payments_tenant_idx on public.mail_payments (tenant_id, created_at desc);
alter table public.mail_payments enable row level security;
drop policy if exists mail_payments_read on public.mail_payments;
create policy mail_payments_read on public.mail_payments for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());

-- ---- domains, keys, webhooks, settings --------------------------------------
create table if not exists public.mail_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null unique,
  status text not null default 'pending' check (status in ('pending', 'verified', 'failed')),
  dns jsonb not null default '[]'::jsonb,
  provider_ref text,
  last_checked_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mail_domains_tenant_idx on public.mail_domains (tenant_id);
alter table public.mail_domains enable row level security;
drop policy if exists mail_domains_read on public.mail_domains;
create policy mail_domains_read on public.mail_domains for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());

create table if not exists public.mail_api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  scope text not null default 'full' check (scope in ('full', 'send')),
  domain_id uuid references public.mail_domains(id) on delete set null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists mail_api_keys_tenant_idx on public.mail_api_keys (tenant_id);
alter table public.mail_api_keys enable row level security;
-- The hash never leaves the server: the browser reads the other columns only.
revoke select on public.mail_api_keys from anon, authenticated;
grant select (id, tenant_id, name, prefix, scope, domain_id, last_used_at, revoked_at, created_at) on public.mail_api_keys to authenticated;
drop policy if exists mail_api_keys_read on public.mail_api_keys;
create policy mail_api_keys_read on public.mail_api_keys for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());

create table if not exists public.mail_webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  url text not null,
  events text[] not null default array['delivered', 'bounced', 'complained', 'opened', 'clicked', 'failed'],
  secret text not null default encode(gen_random_bytes(24), 'hex'),
  is_active boolean not null default true,
  last_status int,
  last_error text,
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.mail_webhooks enable row level security;
drop policy if exists mail_webhooks_tenant on public.mail_webhooks;
create policy mail_webhooks_tenant on public.mail_webhooks for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))
  with check (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));

-- Optional backup SMTP per company (password kept server-side only).
create table if not exists public.mail_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  smtp_host text,
  smtp_port int,
  smtp_user text,
  smtp_secure boolean not null default true,
  smtp_password text,
  default_from text,
  track_opens boolean not null default true,
  track_clicks boolean not null default true,
  alert_phone text,
  alert_email text,
  updated_at timestamptz not null default now()
);
alter table public.mail_settings enable row level security;
revoke select on public.mail_settings from anon, authenticated;
grant select (tenant_id, smtp_host, smtp_port, smtp_user, smtp_secure, default_from, track_opens, track_clicks, alert_phone, alert_email, updated_at) on public.mail_settings to authenticated;
drop policy if exists mail_settings_read on public.mail_settings;
create policy mail_settings_read on public.mail_settings for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());

-- ---- messages, events, suppressions, usage ---------------------------------
create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  api_key_id uuid references public.mail_api_keys(id) on delete set null,
  from_email text not null,
  from_name text,
  to_emails text[] not null,
  cc text[],
  bcc text[],
  reply_to text,
  subject text not null,
  tags text[] not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'blocked')),
  route text,
  provider_id text,
  error text,
  opened_at timestamptz,
  clicked_at timestamptz,
  size_bytes int,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mail_messages_tenant_idx on public.mail_messages (tenant_id, created_at desc);
create index if not exists mail_messages_provider_idx on public.mail_messages (provider_id);
create unique index if not exists mail_messages_idem on public.mail_messages (tenant_id, idempotency_key) where idempotency_key is not null;
alter table public.mail_messages enable row level security;
drop policy if exists mail_messages_read on public.mail_messages;
create policy mail_messages_read on public.mail_messages for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());

create table if not exists public.mail_events (
  id bigserial primary key,
  message_id uuid references public.mail_messages(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  type text not null,
  recipient text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists mail_events_message_idx on public.mail_events (message_id);
create index if not exists mail_events_tenant_idx on public.mail_events (tenant_id, created_at desc);
alter table public.mail_events enable row level security;
drop policy if exists mail_events_read on public.mail_events;
create policy mail_events_read on public.mail_events for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());

create table if not exists public.mail_suppressions (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  reason text not null default 'bounce' check (reason in ('bounce', 'complaint', 'unsubscribe', 'manual')),
  detail text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, email)
);
alter table public.mail_suppressions enable row level security;
drop policy if exists mail_suppressions_read on public.mail_suppressions;
create policy mail_suppressions_read on public.mail_suppressions for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());
drop policy if exists mail_suppressions_remove on public.mail_suppressions;
create policy mail_suppressions_remove on public.mail_suppressions for delete to authenticated
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));

create table if not exists public.mail_usage (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day date not null,
  sent int not null default 0,
  primary key (tenant_id, day)
);
alter table public.mail_usage enable row level security;
drop policy if exists mail_usage_read on public.mail_usage;
create policy mail_usage_read on public.mail_usage for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());

/** Counts sends for a company; refuses when the plan's day or month allowance is used up. */
create or replace function public.mail_take_quota(p_tenant uuid, p_count int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare plan public.mail_plans; s public.mail_subscriptions; today_sent int; month_sent int;
begin
  insert into public.mail_subscriptions (tenant_id, plan_id) values (p_tenant, (select id from public.mail_plans where code = 'free'))
  on conflict (tenant_id) do nothing;
  select * into s from public.mail_subscriptions where tenant_id = p_tenant;
  if s.status in ('suspended', 'cancelled') then return jsonb_build_object('ok', false, 'error', 'This account is suspended. Contact JMSURF support.'); end if;
  if s.status = 'active' and s.current_period_end is not null and s.current_period_end < now() then
    update public.mail_subscriptions set status = 'past_due', updated_at = now() where tenant_id = p_tenant;
    s.status := 'past_due';
  end if;
  -- A lapsed paid plan falls back to the free allowance.
  select * into plan from public.mail_plans where id = case when s.status = 'past_due' then (select id from public.mail_plans where code = 'free') else s.plan_id end;
  select coalesce(sum(sent), 0) into today_sent from public.mail_usage where tenant_id = p_tenant and day = current_date;
  select coalesce(sum(sent), 0) into month_sent from public.mail_usage where tenant_id = p_tenant and day >= date_trunc('month', current_date);
  if plan.daily_cap is not null and today_sent + p_count > plan.daily_cap then
    return jsonb_build_object('ok', false, 'error', format('Daily limit of %s emails reached on the %s plan. Upgrade at https://mail.jmsurf.co.ke/app/billing', plan.daily_cap, plan.name));
  end if;
  if month_sent + p_count > plan.emails_monthly then
    return jsonb_build_object('ok', false, 'error', format('Monthly allowance of %s emails used on the %s plan. Upgrade at https://mail.jmsurf.co.ke/app/billing', plan.emails_monthly, plan.name));
  end if;
  insert into public.mail_usage (tenant_id, day, sent) values (p_tenant, current_date, p_count)
  on conflict (tenant_id, day) do update set sent = public.mail_usage.sent + p_count;
  return jsonb_build_object('ok', true, 'plan', plan.code, 'month_sent', month_sent + p_count, 'month_allowance', plan.emails_monthly);
end $$;
revoke all on function public.mail_take_quota(uuid, int) from public, anon, authenticated;
grant execute on function public.mail_take_quota(uuid, int) to service_role;

/** A paid plan payment: activates (or extends) the subscription. */
create or replace function public.mail_apply_payment(p_payment uuid, p_receipt text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.mail_payments; s public.mail_subscriptions; start_at timestamptz;
begin
  select * into p from public.mail_payments where id = p_payment for update;
  if p.id is null or p.status = 'completed' then return; end if;
  update public.mail_payments set status = 'completed', paid_at = now(), receipt = coalesce(p_receipt, receipt) where id = p.id;
  insert into public.mail_subscriptions (tenant_id, plan_id) values (p.tenant_id, p.plan_id) on conflict (tenant_id) do nothing;
  select * into s from public.mail_subscriptions where tenant_id = p.tenant_id;
  start_at := case when s.plan_id = p.plan_id and s.status = 'active' and s.current_period_end > now() then s.current_period_end else now() end;
  update public.mail_subscriptions set plan_id = p.plan_id, status = 'active', current_period_end = start_at + make_interval(months => p.months), updated_at = now()
  where tenant_id = p.tenant_id;
  insert into public.platform_alert_queue (event, title, body, link)
  select 'payment', 'JMSURF Mail payment: ' || t.business_name, 'KES ' || to_char(p.amount, 'FM999,999,990') || ' · ' || p.months || ' month(s)', '/admin'
  from public.tenants t where t.id = p.tenant_id;
end $$;
revoke all on function public.mail_apply_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.mail_apply_payment(uuid, text) to service_role;

/** Platform owner: set a company's plan by hand. */
create or replace function public.mail_admin_set_plan(p_tenant uuid, p_plan uuid, p_status text, p_months int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this'; end if;
  insert into public.mail_subscriptions (tenant_id, plan_id) values (p_tenant, p_plan) on conflict (tenant_id) do nothing;
  update public.mail_subscriptions set plan_id = coalesce(p_plan, plan_id), status = coalesce(p_status, status),
    current_period_end = case when coalesce(p_months, 0) > 0 then greatest(coalesce(current_period_end, now()), now()) + make_interval(months => p_months) else current_period_end end,
    updated_at = now()
  where tenant_id = p_tenant;
end $$;
grant execute on function public.mail_admin_set_plan(uuid, uuid, text, int) to authenticated;

-- Rows stay inside their company.
do $$ declare t text; begin
  foreach t in array array['mail_subscriptions', 'mail_payments', 'mail_domains', 'mail_api_keys', 'mail_webhooks', 'mail_settings', 'mail_messages', 'mail_events', 'mail_suppressions', 'mail_usage'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_tenant_fixed', t);
    execute format('create trigger %I before update of tenant_id on public.%I for each row execute function public.cc_tenant_fixed()', t || '_tenant_fixed', t);
  end loop;
end $$;

-- JMSURF's own systems send as the platform company on the internal plan.
insert into public.mail_subscriptions (tenant_id, plan_id, status)
select public.platform_support_tenant(), (select id from public.mail_plans where code = 'internal'), 'active'
where public.platform_support_tenant() is not null
on conflict (tenant_id) do update set plan_id = excluded.plan_id, status = 'active';

-- Sign-ups from JMSURF Mail are tagged in Leads & CRM.
create or replace function public.platform_lead_from_tenant() returns trigger
language plpgsql security definer set search_path = public as $$
declare meta jsonb; product text;
begin
  select raw_user_meta_data into meta from auth.users where id = NEW.owner_user_id;
  meta := coalesce(meta, '{}'::jsonb);
  product := case meta->>'signup_source' when 'callcentre' then 'callcentre' when 'mail' then 'mail' else 'dash' end;
  insert into public.platform_leads (name, company, email, phone, source, stage, tenant_id, product, heard_from, country, details, notes)
  values (coalesce(NEW.contact_name, NEW.business_name), NEW.business_name, coalesce(NEW.contact_email, NEW.business_email), coalesce(NEW.contact_phone, NEW.business_phone),
          'signup', 'trial', NEW.id, product, nullif(meta->>'heard_from', ''), coalesce(nullif(meta->>'country', ''), 'KE'),
          jsonb_strip_nulls(jsonb_build_object('heard_detail', meta->>'heard_detail', 'company_size', meta->>'company_size', 'industry', NEW.industry,
            'job_title', meta->>'job_title', 'agents', meta->>'agents', 'monthly_calls', meta->>'monthly_calls', 'goals', meta->'goals', 'website', meta->>'website',
            'has_number', meta->>'has_number', 'country_name', meta->>'country_name', 'monthly_emails', meta->>'monthly_emails', 'use_case', meta->>'use_case')),
          'https://' || NEW.slug || '.jmsurfdash.co.ke')
  on conflict do nothing;
  insert into public.platform_alert_queue (event, title, body, link)
  values ('signup', 'New ' || case product when 'callcentre' then 'call centre' when 'mail' then 'JMSURF Mail' else 'DASH' end || ' sign-up: ' || NEW.business_name,
          concat_ws(' · ', NEW.contact_name, NEW.contact_email, NEW.contact_phone, 'heard via ' || nullif(meta->>'heard_from', '')), '/admin/leads');
  return NEW;
exception when others then
  raise warning 'platform lead for tenant %: %', NEW.id, sqlerrm;
  return NEW;
end $$;
