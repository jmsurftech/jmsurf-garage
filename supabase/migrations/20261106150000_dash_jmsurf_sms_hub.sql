-- JMSURF SMS in JMSURF DASH: one SMS page with balance, M-Pesa top-ups and their
-- history, what each message cost, which messages use SMS / WhatsApp, and a
-- low-balance warning.
--
-- * email_logs gets the cost, SMS parts and the event (what the message was for).
-- * sms_topups keeps every top-up started from DASH (the app server writes it).
-- * tenant_messaging.low_balance_warned_at stops the warning repeating.
-- * save_sms_hub saves the sender ID and the automatic receipt channels.
-- Which events use SMS / WhatsApp is kept in business_settings.erp_settings.sms_uses.

alter table public.email_logs add column if not exists cost_kes numeric(12,2);
alter table public.email_logs add column if not exists parts integer;
alter table public.email_logs add column if not exists event text;
create index if not exists email_logs_tenant_channel_created_idx on public.email_logs (tenant_id, channel, created_at desc);

alter table public.tenant_messaging add column if not exists low_balance_warned_at timestamptz;

create table if not exists public.sms_topups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  topup_id text not null,
  amount_kes numeric(12,2) not null,
  phone text,
  status text not null default 'pending',
  sms_estimate integer,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, topup_id)
);
create index if not exists sms_topups_tenant_created_idx on public.sms_topups (tenant_id, created_at desc);
alter table public.sms_topups enable row level security;
drop policy if exists sms_topups_read on public.sms_topups;
create policy sms_topups_read on public.sms_topups for select to authenticated
  using (tenant_id = public.current_user_tenant_id());
revoke insert, update, delete on public.sms_topups from anon, authenticated;

/** Sender ID and automatic receipt channels, from System → SMS. */
create or replace function public.save_sms_hub(p_sender_id text, p_auto_receipt_sms boolean, p_auto_receipt_whatsapp boolean)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare _uid uuid := auth.uid(); _t uuid := public.current_user_tenant_id(); _sender text := nullif(trim(coalesce(p_sender_id, '')), '');
begin
  if _uid is null or _t is null then raise exception 'Sign in first'; end if;
  if not (public.has_role(_uid, 'admin') or public.has_role(_uid, 'manager')) then raise exception 'Only the owner or a manager can change SMS settings'; end if;
  if _sender is not null and length(_sender) > 15 then raise exception 'Sender ID: up to 11 letters (or a phone number)'; end if;
  insert into public.tenant_messaging as tm (tenant_id, sms_sender_id, auto_receipt_sms, auto_receipt_whatsapp, updated_at, updated_by)
  values (_t, _sender, coalesce(p_auto_receipt_sms, false), coalesce(p_auto_receipt_whatsapp, false), now(), _uid)
  on conflict (tenant_id) do update set
    sms_sender_id = excluded.sms_sender_id,
    auto_receipt_sms = excluded.auto_receipt_sms,
    auto_receipt_whatsapp = excluded.auto_receipt_whatsapp,
    updated_at = now(), updated_by = _uid;
end $$;
revoke all on function public.save_sms_hub(text, boolean, boolean) from public, anon;
grant execute on function public.save_sms_hub(text, boolean, boolean) to authenticated;
