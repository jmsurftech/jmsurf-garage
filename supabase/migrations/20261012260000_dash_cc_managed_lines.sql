-- JMSURF CALL CENTRE managed lines: companies never touch Africa's Talking.
-- JMSURF holds one master Africa's Talking account, owns a pool of numbers and gives one
-- to each company. Calls and SMS are charged to the company's prepaid wallet (topped up by
-- M-Pesa through JMSURF Pay) at Africa's Talking's cost plus JMSURF's margin.
-- "Bring your own Africa's Talking account" stays available (line_mode = 'own').

-- Which kind of line a company uses. New companies get JMSURF lines.
alter table public.cc_settings add column if not exists line_mode text not null default 'managed' check (line_mode in ('managed', 'own'));
update public.cc_settings set line_mode = 'own' where at_username is not null and at_username <> '' and line_mode = 'managed'
  and exists (select 1 from public.integration_secrets i where i.tenant_id = cc_settings.tenant_id and i.name = 'callcentre_at_api_key');
grant select (line_mode) on public.cc_settings to authenticated;

-- Secrets only the servers read (master Africa's Talking key, platform callback key). No browser access at all.
create table if not exists public.cc_platform_secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.cc_platform_secrets enable row level security;
revoke all on public.cc_platform_secrets from anon, authenticated;
insert into public.cc_platform_secrets (name, value)
values ('callback_key', encode(gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;

-- Prices (JMSURF's margin on top of Africa's Talking's cost).
insert into public.platform_settings (key, value)
values ('callcentre_rates', jsonb_build_object('markup_pct', 30, 'fallback_per_minute', 4, 'sms_price', 1.5, 'number_monthly', 500, 'low_balance', 200, 'at_username', ''))
on conflict (key) do nothing;

-- The number pool.
create table if not exists public.cc_numbers (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  kind text not null default 'mobile' check (kind in ('mobile', 'landline', 'tollfree', 'other')),
  status text not null default 'available' check (status in ('available', 'assigned', 'retired')),
  tenant_id uuid references public.tenants(id) on delete set null,
  monthly_fee numeric(12,2),
  assigned_at timestamptz,
  next_charge_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists cc_numbers_tenant_idx on public.cc_numbers (tenant_id);
alter table public.cc_numbers enable row level security;
drop policy if exists cc_numbers_read on public.cc_numbers;
create policy cc_numbers_read on public.cc_numbers for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());
drop policy if exists cc_numbers_owner on public.cc_numbers;
create policy cc_numbers_owner on public.cc_numbers for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

-- A company asking JMSURF for a number.
create table if not exists public.cc_number_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  kind text not null default 'mobile',
  notes text,
  status text not null default 'pending' check (status in ('pending', 'done', 'rejected', 'cancelled')),
  number_id uuid references public.cc_numbers(id) on delete set null,
  reply text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
alter table public.cc_number_requests enable row level security;
drop policy if exists cc_number_requests_read on public.cc_number_requests;
create policy cc_number_requests_read on public.cc_number_requests for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());
drop policy if exists cc_number_requests_ask on public.cc_number_requests;
create policy cc_number_requests_ask on public.cc_number_requests for insert to authenticated
  with check (tenant_id = public.current_user_tenant_id() and status = 'pending' and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));
drop policy if exists cc_number_requests_owner on public.cc_number_requests;
create policy cc_number_requests_owner on public.cc_number_requests for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Wallets and their ledger. Only the servers change them.
create table if not exists public.cc_wallets (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  balance numeric(12,2) not null default 0,
  low_alert numeric(12,2) not null default 200,
  low_alerted_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.cc_wallets enable row level security;
drop policy if exists cc_wallets_read on public.cc_wallets;
create policy cc_wallets_read on public.cc_wallets for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());

create table if not exists public.cc_wallet_tx (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('topup', 'call', 'sms', 'number', 'adjust', 'refund')),
  amount numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  cost numeric(12,4),
  ref text,
  detail text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists cc_wallet_tx_once on public.cc_wallet_tx (tenant_id, kind, ref) where ref is not null;
create index if not exists cc_wallet_tx_tenant_idx on public.cc_wallet_tx (tenant_id, created_at desc);
alter table public.cc_wallet_tx enable row level security;
drop policy if exists cc_wallet_tx_read on public.cc_wallet_tx;
create policy cc_wallet_tx_read on public.cc_wallet_tx for select to authenticated using (tenant_id = public.current_user_tenant_id() or public.is_platform_admin());

/** Adds (+) or charges (-) a company's wallet once per (kind, ref); returns the new balance. */
create or replace function public.cc_wallet_post(p_tenant uuid, p_kind text, p_amount numeric, p_ref text, p_detail text, p_cost numeric default null, p_by uuid default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare w public.cc_wallets; nb numeric;
begin
  if p_ref is not null and exists (select 1 from public.cc_wallet_tx where tenant_id = p_tenant and kind = p_kind and ref = p_ref) then
    return (select balance from public.cc_wallets where tenant_id = p_tenant);
  end if;
  insert into public.cc_wallets (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  select * into w from public.cc_wallets where tenant_id = p_tenant for update;
  nb := round(w.balance + p_amount, 2);
  update public.cc_wallets set balance = nb, updated_at = now(),
    low_alerted_at = case when nb > w.low_alert then null else low_alerted_at end
  where tenant_id = p_tenant;
  insert into public.cc_wallet_tx (tenant_id, kind, amount, balance_after, cost, ref, detail, created_by)
  values (p_tenant, p_kind, round(p_amount, 2), nb, p_cost, p_ref, left(p_detail, 300), p_by);
  -- Running low: tell the company once (until it is topped up again).
  if p_amount < 0 and nb <= w.low_alert and w.low_alerted_at is null then
    update public.cc_wallets set low_alerted_at = now() where tenant_id = p_tenant;
    insert into public.shop_notifications (tenant_id, kind, title, body, link, sent_at)
    values (p_tenant, 'billing', case when nb <= 0 then 'Call centre balance is empty' else 'Call centre balance is low' end,
            'Balance KES ' || to_char(nb, 'FM999,999,990.00') || '. Top up in Call Centre → Billing so calls keep going.', '/callcentre', now());
  end if;
  return nb;
end $$;
revoke all on function public.cc_wallet_post(uuid, text, numeric, text, text, numeric, uuid) from public, anon, authenticated;
grant execute on function public.cc_wallet_post(uuid, text, numeric, text, text, numeric, uuid) to service_role;

/** Platform owner: add or remove credit by hand (cash, bank, goodwill). */
create or replace function public.cc_admin_adjust_wallet(p_tenant uuid, p_amount numeric, p_reason text) returns numeric
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this'; end if;
  if coalesce(p_amount, 0) = 0 then raise exception 'Enter an amount'; end if;
  return public.cc_wallet_post(p_tenant, 'adjust', p_amount, null, coalesce(nullif(p_reason, ''), 'Adjusted by JMSURF'), null, auth.uid());
end $$;
grant execute on function public.cc_admin_adjust_wallet(uuid, numeric, text) to authenticated;

/** Platform owner: give a pool number to a company (or take it back with p_tenant null). */
create or replace function public.cc_admin_assign_number(p_number uuid, p_tenant uuid, p_request uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare n public.cc_numbers;
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this'; end if;
  select * into n from public.cc_numbers where id = p_number for update;
  if n.id is null then raise exception 'Number not found'; end if;
  if p_tenant is null then
    update public.cc_settings set at_number = null where tenant_id = n.tenant_id and at_number = n.number and line_mode = 'managed';
    update public.cc_numbers set status = 'available', tenant_id = null, assigned_at = null, next_charge_at = null where id = n.id;
    return;
  end if;
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
  insert into public.shop_notifications (tenant_id, kind, title, body, link, sent_at)
  values (p_tenant, 'call', 'Your call centre number is ready: ' || n.number, 'Calls to this number now ring your agents.', '/callcentre', now());
end $$;
grant execute on function public.cc_admin_assign_number(uuid, uuid, uuid) to authenticated;

-- Wallet top-ups ride on the existing M-Pesa payments table.
alter table public.cc_payments add column if not exists purpose text not null default 'plan' check (purpose in ('plan', 'topup'));
create or replace function public.cc_apply_payment(p_payment uuid, p_receipt text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.cc_payments; s public.cc_subscriptions; start_at timestamptz;
begin
  select * into p from public.cc_payments where id = p_payment for update;
  if p.id is null or p.status = 'completed' then return; end if;
  update public.cc_payments set status = 'completed', paid_at = now(), receipt = coalesce(p_receipt, receipt) where id = p.id;
  if p.purpose = 'topup' then
    perform public.cc_wallet_post(p.tenant_id, 'topup', p.amount, p.id::text, 'M-Pesa top-up ' || coalesce(p_receipt, ''), null, p.created_by);
    insert into public.platform_alert_queue (event, title, body, link)
    select 'payment', 'Call centre top-up: ' || t.business_name, 'KES ' || to_char(p.amount, 'FM999,999,990'), '/admin' from public.tenants t where t.id = p.tenant_id;
    return;
  end if;
  s := public.cc_subscription_for(p.tenant_id);
  start_at := greatest(coalesce(s.current_period_end, now()), now());
  update public.cc_subscriptions set status = 'active', plan_id = coalesce(p.plan_id, plan_id), agents = greatest(p.agents, 1),
    current_period_end = start_at + make_interval(months => p.months), updated_at = now() where tenant_id = p.tenant_id;
  perform public.cc_sync_module(p.tenant_id);
  insert into public.platform_alert_queue (event, title, body, link)
  select 'payment', 'Call centre payment: ' || t.business_name, 'KES ' || to_char(p.amount, 'FM999,999,990') || ' · ' || p.months || ' month(s)', '/admin'
  from public.tenants t where t.id = p.tenant_id;
end $$;

-- Rows of these tables stay inside their company.
do $$ declare t text; begin
  foreach t in array array['cc_number_requests', 'cc_wallets', 'cc_wallet_tx'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_tenant_fixed', t);
    execute format('create trigger %I before update of tenant_id on public.%I for each row execute function public.cc_tenant_fixed()', t || '_tenant_fixed', t);
  end loop;
end $$;
