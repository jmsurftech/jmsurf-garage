-- JMSURF CALL CENTRE (2026-10-10):
--   * a company's dashboard theme (colour preset and default light/dark)
--   * per-agent call forwarding (always / when away or offline → another agent or a mobile)
--   * the browser phone's SautiKit identity and when it last registered (inbound ringing)
--   * closed stations: archived 3 months after the plan ended, restorable for 6 months, then purged
alter table public.cc_settings add column if not exists theme jsonb not null default '{}'::jsonb;
alter table public.cc_agents add column if not exists forward jsonb not null default '{}'::jsonb;
alter table public.cc_agents add column if not exists sk_identity text;
alter table public.cc_agents add column if not exists sk_registered_at timestamptz;
alter table public.cc_subscriptions add column if not exists archived_at timestamptz;

-- Paying again restores a closed (archived, not yet purged) station.
create or replace function public.cc_apply_payment(p_payment uuid, p_receipt text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p public.cc_payments; s public.cc_subscriptions; start_at timestamptz;
begin
  select * into p from public.cc_payments where id = p_payment for update;
  if p.id is null or p.status = 'completed' then return; end if;
  update public.cc_payments set status = 'completed', paid_at = now(), receipt = coalesce(p_receipt, receipt) where id = p.id;
  if p.purpose = 'number' then return; end if;
  if p.purpose = 'topup' then
    perform public.cc_wallet_post(p.tenant_id, 'topup', p.amount, p.id::text, 'M-Pesa top-up ' || coalesce(p_receipt, ''), null, p.created_by);
    insert into public.platform_alert_queue (event, title, body, link)
    select 'payment', 'Call centre top-up: ' || t.business_name, 'KES ' || to_char(p.amount, 'FM999,999,990'), '/admin' from public.tenants t where t.id = p.tenant_id;
    return;
  end if;
  s := public.cc_subscription_for(p.tenant_id);
  start_at := greatest(coalesce(s.current_period_end, now()), now());
  update public.cc_subscriptions set status = 'active', plan_id = coalesce(p.plan_id, plan_id), agents = greatest(p.agents, 1), archived_at = null,
    current_period_end = start_at + make_interval(months => p.months), updated_at = now() where tenant_id = p.tenant_id;
  update public.cc_settings set enabled = true where tenant_id = p.tenant_id and s.archived_at is not null;
  update public.cc_numbers set paid_until = greatest(coalesce(paid_until, now()), now()) + make_interval(months => p.months)
   where tenant_id = p.tenant_id and status = 'assigned' and id::text in (select jsonb_array_elements_text(coalesce(p.meta->'numbers', '[]'::jsonb)));
  perform public.cc_sync_module(p.tenant_id);
  insert into public.platform_alert_queue (event, title, body, link)
  select 'payment', 'Call centre payment: ' || t.business_name, 'KES ' || to_char(p.amount, 'FM999,999,990') || ' · ' || p.months || ' month(s)', '/admin'
  from public.tenants t where t.id = p.tenant_id;
end $$;
