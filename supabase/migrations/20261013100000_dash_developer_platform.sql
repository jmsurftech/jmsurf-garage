-- Developers & integrations: company API keys (public REST API /api/v1), outgoing webhooks
-- signed with HMAC, an event queue filled by triggers on the core records, and a delivery log.
-- Everything is private to its company. Keys are stored as SHA-256 hashes only.

create table if not exists public.erp_api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default array['read'],
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists erp_api_keys_tenant_idx on public.erp_api_keys (tenant_id);
alter table public.erp_api_keys enable row level security;
revoke all on public.erp_api_keys from anon, authenticated;
grant select (id, tenant_id, name, prefix, scopes, last_used_at, revoked_at, created_at) on public.erp_api_keys to authenticated;
drop policy if exists erp_api_keys_read on public.erp_api_keys;
create policy erp_api_keys_read on public.erp_api_keys for select to authenticated
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));

create table if not exists public.erp_webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  url text not null check (url ~ '^https://'),
  events text[] not null default array['invoice.created', 'invoice.paid', 'payment.received', 'customer.created'],
  secret text not null default encode(gen_random_bytes(24), 'hex'),
  is_active boolean not null default true,
  last_status int,
  last_error text,
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.erp_webhooks enable row level security;
drop policy if exists erp_webhooks_managers on public.erp_webhooks;
create policy erp_webhooks_managers on public.erp_webhooks for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))
  with check (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));

-- Events waiting to be delivered (server only).
create table if not exists public.erp_webhook_queue (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event text not null,
  entity_id uuid,
  payload jsonb not null,
  attempts int not null default 0,
  next_at timestamptz not null default now(),
  done_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists erp_webhook_queue_due_idx on public.erp_webhook_queue (next_at) where done_at is null;
alter table public.erp_webhook_queue enable row level security;
revoke all on public.erp_webhook_queue from anon, authenticated;

create table if not exists public.erp_webhook_deliveries (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  webhook_id uuid references public.erp_webhooks(id) on delete cascade,
  event text not null,
  status int,
  ms int,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists erp_webhook_deliveries_tenant_idx on public.erp_webhook_deliveries (tenant_id, created_at desc);
alter table public.erp_webhook_deliveries enable row level security;
drop policy if exists erp_webhook_deliveries_read on public.erp_webhook_deliveries;
create policy erp_webhook_deliveries_read on public.erp_webhook_deliveries for select to authenticated
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));

/** Queues a business event when the company has an active webhook listening for it. */
create or replace function public.erp_queue_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text; t text := TG_TABLE_NAME; row jsonb := to_jsonb(NEW); prev jsonb := case when TG_OP = 'UPDATE' then to_jsonb(OLD) else '{}'::jsonb end;
begin
  ev := case
    when t = 'invoices' and TG_OP = 'INSERT' then 'invoice.created'
    when t = 'invoices' and lower(coalesce(row->>'status', '')) = 'paid' and lower(coalesce(prev->>'status', '')) <> 'paid' then 'invoice.paid'
    when t = 'invoices' then 'invoice.updated'
    when t = 'payments_received' and TG_OP = 'INSERT' then 'payment.received'
    when t = 'customers' and TG_OP = 'INSERT' then 'customer.created'
    when t = 'customers' then 'customer.updated'
    when t = 'sales_orders' and TG_OP = 'INSERT' then 'order.created'
    when t = 'sales_orders' then 'order.updated'
    when t = 'quotes' and TG_OP = 'INSERT' then 'quote.created'
    when t = 'quotes' and lower(coalesce(row->>'status', '')) = 'accepted' and lower(coalesce(prev->>'status', '')) <> 'accepted' then 'quote.accepted'
    when t = 'products' and TG_OP = 'INSERT' then 'product.created'
    when t = 'products' then 'product.updated'
    when t = 'bills' and TG_OP = 'INSERT' then 'bill.created'
    else null end;
  if ev is null then return NEW; end if;
  if not exists (select 1 from public.erp_webhooks w where w.tenant_id = NEW.tenant_id and w.is_active and ev = any(w.events)) then return NEW; end if;
  insert into public.erp_webhook_queue (tenant_id, event, entity_id, payload) values (NEW.tenant_id, ev, NEW.id, row);
  return NEW;
exception when others then
  raise warning 'webhook queue (% %): %', t, TG_OP, sqlerrm;
  return NEW;
end $$;

do $$ declare t text; begin
  foreach t in array array['invoices', 'payments_received', 'customers', 'sales_orders', 'quotes', 'products', 'bills'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_webhooks', t);
    execute format('create trigger %I after insert or update on public.%I for each row execute function public.erp_queue_event()', t || '_webhooks', t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['erp_api_keys', 'erp_webhooks', 'erp_webhook_deliveries'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_tenant_fixed', t);
    execute format('create trigger %I before update of tenant_id on public.%I for each row execute function public.cc_tenant_fixed()', t || '_tenant_fixed', t);
  end loop;
end $$;
