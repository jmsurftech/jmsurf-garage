-- JMSURF MAIL launch on jmsurfmail.co.ke: USD prices for customers abroad (Paystack),
-- payment currency/provider, and email verification codes for sign-up.

alter table public.mail_plans add column if not exists price_usd numeric(12,2) not null default 0;
update public.mail_plans set price_usd = case code when 'starter' then 9 when 'business' then 25 when 'scale' then 65 else 0 end
where price_usd = 0;

alter table public.mail_payments add column if not exists currency text not null default 'KES';
alter table public.mail_payments add column if not exists provider text not null default 'mpesa';
alter table public.mail_payments add column if not exists email text;
alter table public.mail_payments alter column phone drop not null;
do $$ begin
  alter table public.mail_payments add constraint mail_payments_currency_chk check (currency in ('KES', 'USD'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.mail_payments add constraint mail_payments_provider_chk check (provider in ('mpesa', 'paystack'));
exception when duplicate_object then null; end $$;
create unique index if not exists mail_payments_reference_uq on public.mail_payments (reference) where reference is not null;

-- One-time codes the JMSURF Mail server emails at sign-up (server only: no policies).
create table if not exists public.mail_email_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  purpose text not null default 'signup' check (purpose in ('signup')),
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mail_email_codes_user_idx on public.mail_email_codes (user_id, created_at desc);
alter table public.mail_email_codes enable row level security;
revoke all on public.mail_email_codes from anon, authenticated;

-- The payment alert shows the right currency.
create or replace function public.mail_apply_payment(p_payment uuid, p_receipt text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
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
  select 'payment', 'JMSURF Mail payment: ' || t.business_name,
    p.currency || ' ' || to_char(p.amount, 'FM999,999,990.00') || ' · ' || p.months || ' month(s) · ' || case p.provider when 'paystack' then 'card' else 'M-Pesa' end, '/admin'
  from public.tenants t where t.id = p.tenant_id;
end $function$;
revoke execute on function public.mail_apply_payment(uuid, text) from public, anon, authenticated;

-- Server-only lookup of a login by email (sign-up, codes, password reset).
create or replace function public.mail_user_by_email(p_email text)
returns table (id uuid, confirmed boolean)
language sql stable security definer set search_path to 'public', 'auth' as $$
  select u.id, (u.email_confirmed_at is not null) from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1
$$;
revoke execute on function public.mail_user_by_email(text) from public, anon, authenticated;

-- Limit messages point at the new address.
CREATE OR REPLACE FUNCTION public.mail_take_quota(p_tenant uuid, p_count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    return jsonb_build_object('ok', false, 'error', format('Daily limit of %s emails reached on the %s plan. Upgrade at https://app.jmsurfmail.co.ke/app/billing', plan.daily_cap, plan.name));
  end if;
  if month_sent + p_count > plan.emails_monthly then
    return jsonb_build_object('ok', false, 'error', format('Monthly allowance of %s emails used on the %s plan. Upgrade at https://app.jmsurfmail.co.ke/app/billing', plan.emails_monthly, plan.name));
  end if;
  insert into public.mail_usage (tenant_id, day, sent) values (p_tenant, current_date, p_count)
  on conflict (tenant_id, day) do update set sent = public.mail_usage.sent + p_count;
  return jsonb_build_object('ok', true, 'plan', plan.code, 'month_sent', month_sent + p_count, 'month_allowance', plan.emails_monthly);
end $function$

;
