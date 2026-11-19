-- JMSURF DASH: online shop orders.
-- The web shop (server shop.js, service key) creates an online order and a
-- pending sale. When the sale completes (M-Pesa confirmed, or staff record the
-- payment) the database deducts stock like any till sale and the order is paid.

create table if not exists public.online_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_no text,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  phone text not null,
  email text,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  delivery_fee numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'processing', 'ready', 'out_for_delivery', 'delivered', 'completed', 'cancelled')),
  payment_method text not null default 'mpesa',      -- mpesa | pay_on_delivery | bank_transfer
  transaction_id uuid references public.transactions(id) on delete set null,
  delivery_method text not null default 'pickup',    -- pickup | delivery
  address text,
  notes text,
  public_token text not null default encode(gen_random_bytes(18), 'hex'),
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists online_orders_tenant_idx on public.online_orders (tenant_id, status, created_at desc);
create index if not exists online_orders_customer_idx on public.online_orders (customer_id);

alter table public.online_orders enable row level security;
drop policy if exists online_orders_read on public.online_orders;
create policy online_orders_read on public.online_orders for select to authenticated using (tenant_id = public.current_user_tenant_id());
drop policy if exists online_orders_update on public.online_orders;
create policy online_orders_update on public.online_orders for update to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
grant select, update on public.online_orders to authenticated;

/** The web order follows its sale: completed sale -> paid order (+ staff alert). */
create or replace function public.online_order_follow_sale() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.online_orders;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.online_orders set status = case when status = 'pending_payment' then 'paid' else status end,
      paid_at = coalesce(paid_at, now()), updated_at = now()
    where transaction_id = new.id returning * into o;
    if o.id is not null then
      insert into public.shop_notifications (tenant_id, kind, title, body, link, entity_type, entity_id)
      values (o.tenant_id, 'order', 'New paid online order ' || coalesce(o.order_no, ''),
              o.customer_name || ' paid KES ' || to_char(o.total, 'FM999,999,990') || ' (' || o.delivery_method || ').',
              '/sales/online-orders', 'online_order', o.id);
    end if;
  elsif new.status in ('failed', 'cancelled') and old.status = 'pending' then
    update public.online_orders set updated_at = now() where transaction_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists online_order_follow_sale on public.transactions;
create trigger online_order_follow_sale after update of status on public.transactions
  for each row execute function public.online_order_follow_sale();

/** Staff alert for orders placed as "pay on delivery". */
create or replace function public.online_order_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.payment_method <> 'mpesa' then
    insert into public.shop_notifications (tenant_id, kind, title, body, link, entity_type, entity_id)
    values (new.tenant_id, 'order', 'New online order ' || coalesce(new.order_no, ''),
            new.customer_name || ' ordered KES ' || to_char(new.total, 'FM999,999,990') || ', pays ' || replace(new.payment_method, '_', ' ') || '.',
            '/sales/online-orders', 'online_order', new.id);
  end if;
  return null;
end $$;
drop trigger if exists online_order_created on public.online_orders;
create trigger online_order_created after insert on public.online_orders for each row execute function public.online_order_created();

alter publication supabase_realtime add table public.online_orders;

/** Server-only twin of customer_find_or_create for the web shop (no staff session). */
create or replace function public.customer_find_or_create_for(p_tenant uuid, p_phone text, p_name text default null, p_email text default null, p_source text default 'shop')
returns uuid language plpgsql security definer set search_path = public as $$
declare k text := public.phone_key(p_phone); cid uuid; nice text;
begin
  if length(k) < 9 then raise exception 'Enter a full phone number'; end if;
  select id into cid from public.customers where tenant_id = p_tenant and public.phone_key(phone) = k order by created_at limit 1;
  if cid is not null then
    if coalesce(trim(p_name), '') <> '' then
      update public.customers set name = trim(p_name) where id = cid and (name is null or name ~ '^Customer [0-9 ]+$');
    end if;
    return cid;
  end if;
  nice := '0' || substr(k, 1, 3) || ' ' || substr(k, 4, 3) || ' ' || substr(k, 7, 3);
  insert into public.customers (tenant_id, name, phone, email, source)
    values (p_tenant, coalesce(nullif(trim(p_name), ''), 'Customer ' || nice), '0' || k, nullif(trim(coalesce(p_email, '')), ''), coalesce(p_source, 'shop'))
    returning id into cid;
  return cid;
end $$;
revoke all on function public.customer_find_or_create_for(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.customer_find_or_create_for(uuid, text, text, text, text) to service_role;

create or replace function public.doc_prefix_default(p_kind text) returns text
language sql immutable as $$
  select case p_kind
    when 'quote' then 'QT-' when 'invoice' then 'INV-' when 'payment' then 'PR-' when 'receipt' then 'SR-'
    when 'credit_note' then 'CN-' when 'po' then 'PO-' when 'bill' then 'BILL-' when 'requisition' then 'REQ-'
    when 'delivery_note' then 'DN-' when 'lead' then 'LD-' when 'web_order' then 'WEB-' else upper(left(p_kind, 3)) || '-' end
$$;
