-- Paid SMS credit (like JMSURF ISP): companies without their own SMS account send
-- through JMSURF's built-in SMS and spend prepaid SMS from tenant_sms_settings.balance_units.
-- They top up by M-Pesa (JMSURF PAY, platform settlement account); a completed
-- payment adds floor(amount / price) SMS. Price: platform_settings 'sms_pricing'.price_kes.

insert into public.platform_settings (key, value)
values ('sms_pricing', jsonb_build_object('price_kes', 0.80, 'min_topup_kes', 50))
on conflict (key) do nothing;

create table if not exists public.garage_sms_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  price_kes numeric(8,2) not null check (price_kes > 0),
  units integer not null check (units > 0),
  phone text not null,
  reference text,
  receipt text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'cancelled')),
  detail text,
  created_by uuid,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists garage_sms_payments_tenant on public.garage_sms_payments (tenant_id, created_at desc);
create index if not exists garage_sms_payments_pending on public.garage_sms_payments (status, created_at) where status = 'pending';
alter table public.garage_sms_payments enable row level security;
drop policy if exists garage_sms_payments_read on public.garage_sms_payments;
create policy garage_sms_payments_read on public.garage_sms_payments for select to authenticated
  using (tenant_id = (select p.tenant_id from public.profiles p where p.user_id = auth.uid()));

/** Adds the SMS of a completed top-up once (safe to call again). */
create or replace function public.garage_sms_credit(p_payment uuid, p_receipt text)
returns integer language plpgsql security definer set search_path = public as $$
declare p public.garage_sms_payments;
begin
  update public.garage_sms_payments set status = 'completed', receipt = p_receipt, paid_at = now()
   where id = p_payment and status = 'pending' returning * into p;
  if p.id is null then return 0; end if;
  insert into public.tenant_sms_settings (tenant_id, is_active, balance_units, price_per_sms)
  values (p.tenant_id, true, p.units, p.price_kes)
  on conflict (tenant_id) do update set balance_units = public.tenant_sms_settings.balance_units + excluded.balance_units,
    is_active = true, price_per_sms = excluded.price_per_sms, updated_at = now();
  insert into public.tenant_sms_topups (tenant_id, units_added, amount_paid, price_per_sms, reference, notes, recorded_by)
  values (p.tenant_id, p.units, p.amount, p.price_kes, p_receipt, 'M-Pesa top-up', p.created_by);
  update public.sms_topups set status = 'completed', updated_at = now() where tenant_id = p.tenant_id and topup_id = p.id::text;
  update public.tenant_messaging set low_balance_warned_at = null where tenant_id = p.tenant_id;
  return p.units;
end $$;
revoke all on function public.garage_sms_credit(uuid, text) from public, anon, authenticated;
grant execute on function public.garage_sms_credit(uuid, text) to service_role;

-- SMS is paid now: only the server may take or give back SMS (anyone could call these before).
revoke all on function public.consume_sms_units(uuid, integer) from public, anon, authenticated;
revoke all on function public.refund_sms_units(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_sms_units(uuid, integer) to service_role;
grant execute on function public.refund_sms_units(uuid, integer) to service_role;
