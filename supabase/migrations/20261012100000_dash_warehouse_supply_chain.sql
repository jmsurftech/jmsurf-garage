-- Warehousing, supply chain, samples and branches.
--
-- Locations are branches or warehouses (a warehouse can belong to a branch).
-- Warehouses have bins. Stock per location stays in product_stocks; batch /
-- expiry lots (optionally per bin) live in product_batches. Every movement is
-- written to stock_adjustments with its document reference. Stock leaving a
-- location takes the earliest-expiring lots first (FEFO) unless a batch is named.
--
-- Packages (packing slips) and shipments (delivery notes) carry items,
-- quantities, batches and expiry dates, never prices. Transfer orders move
-- stock between locations through "in transit". Reorder rules suggest what to
-- buy. RFQs collect supplier quotes for comparison; landed costs spread
-- freight and duty over received goods. Samples go out at zero value and are
-- costed to a Samples & promotions expense.

-- ── Locations as branches and warehouses ───────────────────────────────────
alter table public.locations add column if not exists location_type text not null default 'branch';
alter table public.locations drop constraint if exists locations_location_type_check;
alter table public.locations add constraint locations_location_type_check check (location_type in ('branch', 'warehouse', 'store', 'transit'));
alter table public.locations add column if not exists parent_id uuid references public.locations(id) on delete set null;
alter table public.locations add column if not exists manager_id uuid;
alter table public.locations add column if not exists phone text;
alter table public.locations add column if not exists email text;

create table if not exists public.user_branches (
  user_id uuid not null,
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  is_manager boolean not null default false,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, location_id)
);

-- Documents carry the branch they belong to.
do $$ declare t text; begin
  foreach t in array array['invoices', 'quotes', 'sales_orders', 'credit_notes', 'payments_received', 'bills', 'supplier_payments', 'hr_employees', 'crm_leads'] loop
    execute format('alter table public.%I add column if not exists location_id uuid references public.locations(id) on delete set null', t);
    execute format('create index if not exists %I on public.%I (tenant_id, location_id)', t || '_branch_idx', t);
  end loop;
end $$;

/** The branch a new document belongs to: the person's primary branch, else the main one. */
create or replace function public.default_branch(p_tenant uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select ub.location_id from public.user_branches ub join public.locations l on l.id = ub.location_id
      where ub.user_id = auth.uid() and l.tenant_id = p_tenant order by ub.is_primary desc limit 1),
    (select id from public.locations where tenant_id = p_tenant and is_active order by is_main desc nulls last, created_at limit 1))
$$;
create or replace function public.set_default_branch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.location_id is null and NEW.tenant_id is not null then NEW.location_id := public.default_branch(NEW.tenant_id); end if;
  return NEW;
end $$;
do $$ declare t text; begin
  foreach t in array array['invoices', 'quotes', 'sales_orders', 'credit_notes', 'payments_received', 'bills', 'supplier_payments', 'crm_leads'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_default_branch', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.set_default_branch()', t || '_default_branch', t);
  end loop;
end $$;

-- ── Bins and lots ──────────────────────────────────────────────────────────
create table if not exists public.wh_bins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  code text not null,
  zone text, aisle text, rack text, level text,
  bin_type text not null default 'storage' check (bin_type in ('storage', 'receiving', 'dispatch', 'quarantine', 'returns')),
  capacity numeric,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (location_id, code)
);

alter table public.product_batches add column if not exists bin_id uuid references public.wh_bins(id) on delete set null;
alter table public.product_batches add column if not exists unit_cost numeric(16,4);
alter table public.product_batches add column if not exists status text not null default 'available';
alter table public.stock_adjustments add column if not exists batch_number text;
alter table public.stock_adjustments add column if not exists expiry_date date;
alter table public.stock_adjustments add column if not exists bin_id uuid;
alter table public.stock_adjustments add column if not exists ref_type text;
alter table public.stock_adjustments add column if not exists ref_id uuid;
alter table public.stock_adjustments add column if not exists ref_number text;
alter table public.stock_adjustments add column if not exists tenant_id uuid;
create index if not exists stock_adjustments_ref_idx on public.stock_adjustments (ref_type, ref_id);
create index if not exists product_batches_fefo_idx on public.product_batches (product_id, location_id, expiry_date nulls last);

/** Puts stock into a lot (batch / expiry / bin) without touching location totals. */
create or replace function public.lot_add(p_tenant uuid, p_product uuid, p_location uuid, p_batch text, p_expiry date, p_bin uuid, p_qty numeric, p_cost numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if coalesce(p_qty, 0) <= 0 or p_location is null then return; end if;
  select id into v from public.product_batches
   where product_id = p_product and location_id = p_location and coalesce(batch_number, '') = coalesce(p_batch, '')
     and expiry_date is not distinct from p_expiry and bin_id is not distinct from p_bin limit 1;
  if v is null then
    insert into public.product_batches (tenant_id, product_id, location_id, batch_number, expiry_date, bin_id, quantity, unit_cost, received_at)
    values (p_tenant, p_product, p_location, nullif(p_batch, ''), p_expiry, p_bin, p_qty, p_cost, now());
  else
    update public.product_batches set quantity = quantity + p_qty, updated_at = now() where id = v;
  end if;
end $$;

/** Takes stock out of lots: the named batch first, then earliest expiry (FEFO). Returns what was taken. */
create or replace function public.lot_take(p_product uuid, p_location uuid, p_qty numeric, p_batch text default null, p_bin uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare left_ numeric := p_qty; r record; take numeric; out jsonb := '[]'::jsonb;
begin
  if coalesce(p_qty, 0) <= 0 then return out; end if;
  for r in select id, batch_number, expiry_date, bin_id, quantity from public.product_batches
            where product_id = p_product and location_id = p_location and quantity > 0 and status = 'available'
              and (p_bin is null or bin_id = p_bin)
            order by (coalesce(batch_number, '') = coalesce(p_batch, '__none__')) desc, expiry_date nulls last, received_at
            for update loop
    exit when left_ <= 0;
    take := least(left_, r.quantity);
    update public.product_batches set quantity = quantity - take, updated_at = now() where id = r.id;
    out := out || jsonb_build_object('batch', r.batch_number, 'expiry', r.expiry_date, 'bin_id', r.bin_id, 'qty', take);
    left_ := left_ - take;
  end loop;
  return out;
end $$;

-- stock_move (price lists migration) now also keeps lots in step (FEFO out) and
-- records the reference of the document that moved the stock.
create or replace function public.stock_move(p_tenant uuid, p_product uuid, p_location uuid, p_delta numeric, p_reason text, p_user uuid, p_depth int default 0)
returns void language plpgsql security definer set search_path = public as $$
declare v_before numeric; v_after numeric; v_type text; v_comp boolean; c record; lots jsonb;
begin
  if p_delta is null or p_delta = 0 or p_location is null then return; end if;
  if p_depth > 4 then raise exception 'Composite items nest too deeply'; end if;
  select coalesce(product_type, 'product'), is_composite into v_type, v_comp from public.products where id = p_product and tenant_id = p_tenant for update;
  if not found or v_type = 'service' then return; end if;
  if v_comp then
    for c in select component_id, quantity from public.composite_components where product_id = p_product loop
      perform public.stock_move(p_tenant, c.component_id, p_location, p_delta * c.quantity, p_reason, p_user, p_depth + 1);
    end loop;
    return;
  end if;
  insert into public.product_stocks (product_id, location_id, stock)
    select p_product, p_location, case when exists (select 1 from public.product_stocks where product_id = p_product) then 0 else greatest(0, coalesce(pr.stock, 0)) end
    from public.products pr where pr.id = p_product
  on conflict (product_id, location_id) do nothing;
  select stock into v_before from public.product_stocks where product_id = p_product and location_id = p_location for update;
  v_after := round(coalesce(v_before, 0) + p_delta, 3);
  update public.product_stocks set stock = v_after where product_id = p_product and location_id = p_location;
  if p_delta < 0 and coalesce(current_setting('dash.lots_done', true), '') <> 'on' then
    lots := public.lot_take(p_product, p_location, -p_delta, nullif(current_setting('dash.batch', true), ''));
  end if;
  insert into public.stock_adjustments (product_id, location_id, quantity_change, stock_before, stock_after, reason, adjusted_by, tenant_id, ref_type, ref_id, ref_number, batch_number)
  values (p_product, p_location, p_delta, coalesce(v_before, 0), v_after, p_reason, p_user, p_tenant,
    nullif(current_setting('dash.ref_type', true), ''), nullif(current_setting('dash.ref_id', true), '')::uuid, nullif(current_setting('dash.ref_number', true), ''),
    case when lots is not null and jsonb_array_length(lots) = 1 then lots->0->>'batch' end);
end $$;
revoke all on function public.stock_move(uuid, uuid, uuid, numeric, text, uuid, int) from public, anon, authenticated;
revoke all on function public.lot_add(uuid, uuid, uuid, text, date, uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public.lot_take(uuid, uuid, numeric, text, uuid) from public, anon, authenticated;

create or replace function public._wh_ref(p_type text, p_id uuid, p_number text) returns void
language plpgsql set search_path = public as $$
begin
  perform set_config('dash.ref_type', coalesce(p_type, ''), true);
  perform set_config('dash.ref_id', coalesce(p_id::text, ''), true);
  perform set_config('dash.ref_number', coalesce(p_number, ''), true);
end $$;

create or replace function public._wh_can(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_tenant = public.current_user_tenant_id() and exists (select 1 from public.user_roles where user_id = auth.uid() and role::text in ('admin', 'manager', 'stock_manager', 'cashier'))
$$;

/** Lots a pick would take (FEFO), for the picking screen. */
create or replace function public.wh_suggest(p_product uuid, p_location uuid, p_qty numeric)
returns table (batch_number text, expiry_date date, bin_code text, available numeric, take numeric)
language plpgsql stable security definer set search_path = public as $$
declare left_ numeric := p_qty; r record;
begin
  for r in select b.batch_number, b.expiry_date, w.code, b.quantity from public.product_batches b left join public.wh_bins w on w.id = b.bin_id
            join public.products p on p.id = b.product_id
           where b.product_id = p_product and b.location_id = p_location and b.quantity > 0 and b.status = 'available' and p.tenant_id = public.current_user_tenant_id()
           order by b.expiry_date nulls last, b.received_at loop
    exit when left_ <= 0;
    batch_number := r.batch_number; expiry_date := r.expiry_date; bin_code := r.code; available := r.quantity; take := least(left_, r.quantity);
    left_ := left_ - take;
    return next;
  end loop;
end $$;
grant execute on function public.wh_suggest(uuid, uuid, numeric) to authenticated;

/** Receive stock into a location with batch / expiry / bin (opening stock, returns, production, receipts without a PO). */
create or replace function public.wh_receive(p_location uuid, p_lines jsonb, p_reason text default 'restock', p_ref_type text default null, p_ref_id uuid default null, p_ref_number text default null)
returns int language plpgsql security definer set search_path = public as $$
declare t uuid; l jsonb; n int := 0; q numeric;
begin
  select tenant_id into t from public.locations where id = p_location;
  if not public._wh_can(t) then raise exception 'You are not allowed to receive stock here'; end if;
  perform public._wh_ref(p_ref_type, p_ref_id, p_ref_number);
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    q := coalesce((l->>'quantity')::numeric, 0);
    continue when q <= 0;
    perform public.stock_move(t, (l->>'product_id')::uuid, p_location, q, p_reason, auth.uid());
    perform public.lot_add(t, (l->>'product_id')::uuid, p_location, l->>'batch_number', nullif(l->>'expiry_date', '')::date, nullif(l->>'bin_id', '')::uuid, q, nullif(l->>'unit_cost', '')::numeric);
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.wh_receive(uuid, jsonb, text, text, uuid, text) to authenticated;

/** Purchase receive with batch, expiry and bin per line (wraps receive_purchase). */
create or replace function public.receive_purchase_lots(p_purchase uuid, p_lines jsonb, p_update_cost boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; po public.purchases%rowtype; l jsonb; it public.purchase_items%rowtype; q numeric;
begin
  select * into po from public.purchases where id = p_purchase;
  r := public.receive_purchase(p_purchase, p_lines, p_update_cost);
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    q := coalesce((l->>'quantity')::numeric, 0);
    continue when q <= 0;
    select * into it from public.purchase_items where id = (l->>'item_id')::uuid;
    perform public.lot_add(po.tenant_id, it.product_id, po.location_id, l->>'batch_number', nullif(l->>'expiry_date', '')::date, nullif(l->>'bin_id', '')::uuid, q, it.unit_cost);
  end loop;
  update public.stock_adjustments set ref_type = 'purchase_receive', ref_id = (r->>'receive_id')::uuid, ref_number = r->>'receive_number', tenant_id = po.tenant_id
   where reason = 'purchase_received' and ref_id is null and created_at > now() - interval '1 minute' and location_id = po.location_id;
  update public.purchase_receives set items = (
    select jsonb_agg(x || coalesce((select jsonb_build_object('batch_number', y->>'batch_number', 'expiry_date', y->>'expiry_date') from jsonb_array_elements(p_lines) y where y->>'item_id' = x->>'item_id' limit 1), '{}'::jsonb))
    from jsonb_array_elements(items) x) where id = (r->>'receive_id')::uuid;
  return r;
end $$;
grant execute on function public.receive_purchase_lots(uuid, jsonb, boolean) to authenticated;

-- ── Transfer orders ────────────────────────────────────────────────────────
create table if not exists public.wh_transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  number text,
  from_location_id uuid not null references public.locations(id),
  to_location_id uuid not null references public.locations(id),
  status text not null default 'draft' check (status in ('draft', 'in_transit', 'received', 'cancelled')),
  lines jsonb not null default '[]'::jsonb,
  notes text,
  shipped_at timestamptz, received_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (from_location_id <> to_location_id)
);

/** Ship a transfer: stock leaves the source (lots FEFO); the lots taken travel with it. */
create or replace function public.wh_transfer_ship(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.wh_transfers; l jsonb; q numeric; taken jsonb; out_lines jsonb := '[]'::jsonb;
begin
  select * into t from public.wh_transfers where id = p_id for update;
  if not found or not public._wh_can(t.tenant_id) then raise exception 'Transfer not found'; end if;
  if t.status <> 'draft' then raise exception 'This transfer was already sent'; end if;
  if t.number is null then t.number := public.next_doc_number('transfer', t.tenant_id); end if;
  perform public._wh_ref('transfer', t.id, t.number);
  perform set_config('dash.lots_done', 'on', true);
  for l in select * from jsonb_array_elements(t.lines) loop
    q := coalesce((l->>'quantity')::numeric, 0);
    continue when q <= 0;
    taken := public.lot_take((l->>'product_id')::uuid, t.from_location_id, q, nullif(l->>'batch_number', ''));
    perform public.stock_move(t.tenant_id, (l->>'product_id')::uuid, t.from_location_id, -q, 'transfer_out', auth.uid());
    out_lines := out_lines || (l || jsonb_build_object('lots', taken));
  end loop;
  perform set_config('dash.lots_done', '', true);
  update public.wh_transfers set status = 'in_transit', shipped_at = now(), number = t.number, lines = out_lines where id = p_id;
end $$;

/** Receive a transfer at the destination (with the same lots). */
create or replace function public.wh_transfer_receive(p_id uuid, p_bin uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare t public.wh_transfers; l jsonb; lot jsonb; q numeric; moved numeric;
begin
  select * into t from public.wh_transfers where id = p_id for update;
  if not found or not public._wh_can(t.tenant_id) then raise exception 'Transfer not found'; end if;
  if t.status <> 'in_transit' then raise exception 'Only a transfer in transit can be received'; end if;
  perform public._wh_ref('transfer', t.id, t.number);
  for l in select * from jsonb_array_elements(t.lines) loop
    q := coalesce((l->>'quantity')::numeric, 0);
    continue when q <= 0;
    perform public.stock_move(t.tenant_id, (l->>'product_id')::uuid, t.to_location_id, q, 'transfer_in', auth.uid());
    moved := 0;
    for lot in select * from jsonb_array_elements(coalesce(l->'lots', '[]'::jsonb)) loop
      perform public.lot_add(t.tenant_id, (l->>'product_id')::uuid, t.to_location_id, lot->>'batch', nullif(lot->>'expiry', '')::date, p_bin, (lot->>'qty')::numeric);
      moved := moved + (lot->>'qty')::numeric;
    end loop;
    if moved < q then perform public.lot_add(t.tenant_id, (l->>'product_id')::uuid, t.to_location_id, null, null, p_bin, q - moved); end if;
  end loop;
  update public.wh_transfers set status = 'received', received_at = now() where id = p_id;
end $$;
grant execute on function public.wh_transfer_ship(uuid) to authenticated;
grant execute on function public.wh_transfer_receive(uuid, uuid) to authenticated;

-- ── Packages (packing slips) and shipments (delivery notes) ────────────────
create table if not exists public.wh_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  number text,
  source_type text not null check (source_type in ('invoice', 'sales_order', 'manual')),
  source_id uuid,
  source_number text,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,
  location_id uuid references public.locations(id) on delete set null,
  status text not null default 'packed' check (status in ('packed', 'shipped', 'delivered', 'cancelled')),
  lines jsonb not null default '[]'::jsonb,
  weight_kg numeric, dimensions text, notes text,
  packed_by uuid default auth.uid(), packed_by_name text,
  created_at timestamptz not null default now()
);
alter table public.delivery_notes add column if not exists package_id uuid references public.wh_packages(id) on delete set null;
alter table public.delivery_notes add column if not exists carrier text;
alter table public.delivery_notes add column if not exists tracking_number text;
alter table public.delivery_notes add column if not exists ship_date date;
alter table public.delivery_notes add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.delivery_notes add column if not exists received_by text;
alter table public.delivery_notes add column if not exists source_number text;

/** Quantity already packed per product for a sales document. */
create or replace function public.wh_packed(p_source_type text, p_source uuid)
returns table (product_id uuid, name text, packed numeric)
language sql stable security definer set search_path = public as $$
  select (l->>'product_id')::uuid, max(l->>'name'), sum((l->>'quantity')::numeric)
  from public.wh_packages p, jsonb_array_elements(p.lines) l
  where p.source_type = p_source_type and p.source_id = p_source and p.status <> 'cancelled' and p.tenant_id = public.current_user_tenant_id()
  group by 1
$$;
grant execute on function public.wh_packed(text, uuid) to authenticated;

-- ── Reorder rules ──────────────────────────────────────────────────────────
create table if not exists public.wh_reorder_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  min_qty numeric not null default 0,
  max_qty numeric not null default 0,
  supplier_id uuid references public.suppliers(id) on delete set null,
  lead_days integer not null default 7,
  unique (product_id, location_id)
);

/** What to buy: items at or below their minimum (rule, or the item's reorder level). */
create or replace function public.reorder_suggestions(p_location uuid default null)
returns table (product_id uuid, name text, sku text, location_id uuid, location_name text, on_hand numeric, on_order numeric, min_qty numeric, max_qty numeric, suggest numeric, supplier_id uuid, supplier_name text, unit_cost numeric)
language sql stable security definer set search_path = public as $$
  with stock as (
    select ps.product_id, ps.location_id, ps.stock,
           coalesce(r.min_qty, nullif(ps.reorder_level, 0), nullif(p.reorder_level, 0)) as min_q,
           coalesce(nullif(r.max_qty, 0), coalesce(r.min_qty, nullif(ps.reorder_level, 0), nullif(p.reorder_level, 0)) * 2) as max_q,
           r.supplier_id, p.name, p.sku, p.cost_price
    from public.product_stocks ps join public.products p on p.id = ps.product_id
    left join public.wh_reorder_rules r on r.product_id = ps.product_id and r.location_id = ps.location_id
    where p.tenant_id = public.current_user_tenant_id() and p.is_active and coalesce(p.product_type, 'product') <> 'service' and not p.is_composite
      and (p_location is null or ps.location_id = p_location)
  ), ordered as (
    select pi.product_id, po.location_id, sum(pi.quantity - pi.received_quantity - pi.cancelled_quantity) as q
    from public.purchase_items pi join public.purchases po on po.id = pi.purchase_id
    where po.tenant_id = public.current_user_tenant_id() and po.status in ('ordered', 'sent', 'partially_received', 'pending', 'draft')
    group by 1, 2
  )
  select s.product_id, s.name, s.sku, s.location_id, l.name, s.stock, coalesce(o.q, 0), s.min_q, s.max_q,
         greatest(0, s.max_q - s.stock - coalesce(o.q, 0)),
         coalesce(s.supplier_id, (select po.supplier_id from public.purchase_items pi join public.purchases po on po.id = pi.purchase_id where pi.product_id = s.product_id order by po.created_at desc limit 1)),
         (select name from public.suppliers where id = coalesce(s.supplier_id, (select po.supplier_id from public.purchase_items pi join public.purchases po on po.id = pi.purchase_id where pi.product_id = s.product_id order by po.created_at desc limit 1))),
         s.cost_price
  from stock s join public.locations l on l.id = s.location_id left join ordered o on o.product_id = s.product_id and o.location_id = s.location_id
  where s.min_q is not null and s.stock + coalesce(o.q, 0) <= s.min_q
  order by l.name, s.name
$$;
grant execute on function public.reorder_suggestions(uuid) to authenticated;

-- ── RFQs and supplier quotes ───────────────────────────────────────────────
create table if not exists public.rfqs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  number text,
  title text,
  requisition_id uuid,
  location_id uuid references public.locations(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'quoted', 'awarded', 'closed', 'cancelled')),
  lines jsonb not null default '[]'::jsonb,
  needed_by date,
  supplier_ids uuid[] not null default '{}',
  awarded_supplier_id uuid,
  purchase_id uuid,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.rfq_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  supplier_name text,
  lines jsonb not null default '[]'::jsonb,
  lead_days integer,
  valid_until date,
  delivery_terms text,
  total numeric(16,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  unique (rfq_id, supplier_id)
);

-- ── Landed costs ───────────────────────────────────────────────────────────
create table if not exists public.landed_costs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  number text,
  receive_id uuid references public.purchase_receives(id) on delete set null,
  purchase_id uuid references public.purchases(id) on delete set null,
  charges jsonb not null default '[]'::jsonb,   -- [{name, amount}]
  method text not null default 'value' check (method in ('value', 'quantity')),
  status text not null default 'draft' check (status in ('draft', 'applied')),
  allocation jsonb,
  total numeric(16,2) not null default 0,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

/**
 * Spreads landed costs over the goods of a purchase receive (by value or
 * quantity), raises each item's average cost and posts the charges to the
 * inventory account (credit Accounts Payable, so the carrier's bill settles it).
 */
create or replace function public.apply_landed_cost(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lc public.landed_costs; rcv public.purchase_receives; it jsonb; base numeric := 0; share numeric; v_total numeric; alloc jsonb := '[]'::jsonb;
        q numeric; onhand numeric; add_per_unit numeric;
begin
  select * into lc from public.landed_costs where id = p_id for update;
  if not found or not public._wh_can(lc.tenant_id) then raise exception 'Landed cost not found'; end if;
  if lc.status = 'applied' then raise exception 'Already applied'; end if;
  select * into rcv from public.purchase_receives where id = lc.receive_id;
  if not found then raise exception 'Choose the goods received this cost belongs to'; end if;
  v_total := (select coalesce(sum((c->>'amount')::numeric), 0) from jsonb_array_elements(lc.charges) c);
  if v_total <= 0 then raise exception 'Add the charges first'; end if;
  for it in select * from jsonb_array_elements(rcv.items) loop
    base := base + case when lc.method = 'quantity' then (it->>'quantity')::numeric else (it->>'quantity')::numeric * coalesce((it->>'unit_cost')::numeric, 0) end;
  end loop;
  if base <= 0 then raise exception 'The receive has no quantities or costs to spread over'; end if;
  for it in select * from jsonb_array_elements(rcv.items) loop
    q := (it->>'quantity')::numeric;
    share := round(v_total * (case when lc.method = 'quantity' then q else q * coalesce((it->>'unit_cost')::numeric, 0) end) / base, 2);
    select coalesce(sum(stock), 0) into onhand from public.product_stocks where product_id = (it->>'product_id')::uuid;
    add_per_unit := share / greatest(onhand, q, 1);
    update public.products set cost_price = round(coalesce(cost_price, 0) + add_per_unit, 4) where id = (it->>'product_id')::uuid;
    alloc := alloc || jsonb_build_object('product_id', it->>'product_id', 'name', it->>'name', 'quantity', q, 'share', share, 'per_unit', round(share / greatest(q, 1), 4));
  end loop;
  if lc.number is null then lc.number := public.next_doc_number('landed_cost', lc.tenant_id); end if;
  perform public.acc_post(lc.tenant_id, 'landed_cost', lc.id, current_date, lc.number, 'Landed cost ' || coalesce(rcv.receive_number, ''), jsonb_build_array(
    jsonb_build_object('account_id', public.acc_key(lc.tenant_id, 'inventory'), 'debit', v_total, 'description', 'Landed costs'),
    jsonb_build_object('account_id', public.acc_key(lc.tenant_id, 'ap'), 'credit', v_total, 'description', 'Freight, duty and clearing')));
  update public.landed_costs set status = 'applied', applied_at = now(), allocation = alloc, total = v_total, number = lc.number where id = p_id;
  return alloc;
end $$;
grant execute on function public.apply_landed_cost(uuid) to authenticated;

-- ── Samples (zero value) ───────────────────────────────────────────────────
create table if not exists public.sample_issues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  number text,
  issue_date date not null default current_date,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,
  lead_id uuid,
  salesperson_id uuid,
  salesperson_name text,
  location_id uuid references public.locations(id) on delete set null,
  purpose text,
  status text not null default 'draft' check (status in ('draft', 'issued', 'returned', 'converted', 'cancelled')),
  lines jsonb not null default '[]'::jsonb,   -- [{product_id, name, unit, quantity, batch_number, unit_cost}]
  total_cost numeric(16,2) not null default 0,
  follow_up_on date,
  invoice_id uuid,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

/** Issues a sample: stock leaves at zero value and its cost goes to Samples & promotions. */
create or replace function public.sample_issue(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sample_issues; l jsonb; q numeric; cost numeric := 0; c numeric; v_lines jsonb := '[]'::jsonb;
begin
  select * into s from public.sample_issues where id = p_id for update;
  if not found or not public._wh_can(s.tenant_id) then raise exception 'Sample not found'; end if;
  if s.status <> 'draft' then raise exception 'This sample was already issued'; end if;
  if s.location_id is null then s.location_id := public.default_branch(s.tenant_id); end if;
  if s.number is null then s.number := public.next_doc_number('sample', s.tenant_id); end if;
  perform public._wh_ref('sample', s.id, s.number);
  for l in select * from jsonb_array_elements(s.lines) loop
    q := coalesce((l->>'quantity')::numeric, 0);
    continue when q <= 0;
    c := public.product_unit_cost((l->>'product_id')::uuid);
    perform set_config('dash.batch', coalesce(l->>'batch_number', ''), true);
    perform public.stock_move(s.tenant_id, (l->>'product_id')::uuid, s.location_id, -q, 'sample', auth.uid());
    cost := cost + q * c;
    v_lines := v_lines || (l || jsonb_build_object('unit_cost', c));
  end loop;
  perform set_config('dash.batch', '', true);
  if cost > 0 then
    perform public.acc_post(s.tenant_id, 'sample', s.id, s.issue_date, s.number, 'Samples to ' || coalesce(s.customer_name, ''), jsonb_build_array(
      jsonb_build_object('account_id', public.acc_expense_account(s.tenant_id, 'Samples & promotions'), 'debit', round(cost, 2), 'description', 'Samples issued'),
      jsonb_build_object('account_id', public.acc_key(s.tenant_id, 'inventory'), 'credit', round(cost, 2), 'description', 'Stock out (samples)')));
  end if;
  update public.sample_issues set status = 'issued', number = s.number, location_id = s.location_id, lines = v_lines, total_cost = round(cost, 2) where id = p_id;
end $$;
grant execute on function public.sample_issue(uuid) to authenticated;

/** Samples given back: stock returns and the cost is reversed. */
create or replace function public.sample_return(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sample_issues; l jsonb;
begin
  select * into s from public.sample_issues where id = p_id for update;
  if not found or not public._wh_can(s.tenant_id) then raise exception 'Sample not found'; end if;
  if s.status <> 'issued' then raise exception 'Only an issued sample can be returned'; end if;
  perform public._wh_ref('sample_return', s.id, s.number);
  for l in select * from jsonb_array_elements(s.lines) loop
    perform public.stock_move(s.tenant_id, (l->>'product_id')::uuid, s.location_id, (l->>'quantity')::numeric, 'return', auth.uid());
    perform public.lot_add(s.tenant_id, (l->>'product_id')::uuid, s.location_id, l->>'batch_number', null, null, (l->>'quantity')::numeric);
  end loop;
  perform public.acc_post(s.tenant_id, 'sample', s.id, current_date, s.number, 'Samples returned', '[]'::jsonb);
  update public.sample_issues set status = 'returned' where id = p_id;
end $$;
grant execute on function public.sample_return(uuid) to authenticated;

-- ── Numbering ──────────────────────────────────────────────────────────────
create or replace function public.doc_prefix_default(p_kind text)
returns text language sql immutable as $$
  select case p_kind
    when 'quote' then 'QT-' when 'invoice' then 'INV-' when 'payment' then 'PR-' when 'receipt' then 'SR-'
    when 'credit_note' then 'CN-' when 'po' then 'PO-' when 'bill' then 'BILL-' when 'requisition' then 'REQ-'
    when 'delivery_note' then 'DN-' when 'packing_list' then 'PL-' when 'lead' then 'LD-' when 'web_order' then 'WEB-' when 'employee' then 'EMP-'
    when 'payroll' then 'PAY-' when 'purchase_receive' then 'GRN-' when 'expense' then 'EXP-' when 'supplier_payment' then 'SP-'
    when 'adjustment' then 'ADJ-' when 'deal' then 'DEAL-' when 'vendor_credit' then 'VC-' when 'sales_order' then 'SO-' when 'journal' then 'MJ-'
    when 'package' then 'PKG-' when 'shipment' then 'SHP-' when 'transfer' then 'TO-' when 'rfq' then 'RFQ-' when 'landed_cost' then 'LC-'
    when 'sample' then 'SMP-'
    else upper(left(p_kind, 3)) || '-' end
$$;

-- ── Security ───────────────────────────────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array['user_branches', 'wh_bins', 'wh_transfers', 'wh_packages', 'wh_reorder_rules', 'rfqs', 'rfq_quotes', 'landed_costs', 'sample_issues'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = public.current_user_tenant_id())', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (tenant_id = public.current_user_tenant_id() and exists (select 1 from public.user_roles where user_id = auth.uid() and role::text in ('admin', 'manager', 'stock_manager', 'cashier', 'sales_person')))
      with check (tenant_id = public.current_user_tenant_id() and exists (select 1 from public.user_roles where user_id = auth.uid() and role::text in ('admin', 'manager', 'stock_manager', 'cashier', 'sales_person')))$p$, t || '_write', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
-- Branch assignments are for admins only.
drop policy if exists user_branches_write on public.user_branches;
create policy user_branches_write on public.user_branches for all to authenticated
  using (tenant_id = public.current_user_tenant_id() and public.has_role(auth.uid(), 'admin'))
  with check (tenant_id = public.current_user_tenant_id() and public.has_role(auth.uid(), 'admin'));
revoke all on function public._wh_ref(text, uuid, text) from public, anon, authenticated;

-- Invoice stock movements carry the invoice number.
create or replace function public.invoice_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_live boolean; v_loc uuid; v_old jsonb; v_new jsonb := '{}'::jsonb; k text; d numeric; r record;
begin
  if TG_OP = 'DELETE' then
    perform public._wh_ref('invoice', OLD.id, OLD.invoice_number);
    if OLD.stock_applied is not null then
      for k, d in select key, value::numeric from jsonb_each_text(OLD.stock_applied - '_loc') loop
        perform public.stock_move(OLD.tenant_id, k::uuid, (OLD.stock_applied->>'_loc')::uuid, d, 'return', auth.uid());
      end loop;
    end if;
    return OLD;
  end if;
  if NEW.transaction_id is not null or coalesce(NEW.source, '') in ('import', 'zoho', 'pos') then return NEW; end if;
  perform public._wh_ref('invoice', NEW.id, NEW.invoice_number);
  v_live := NEW.status not in ('draft', 'void', 'cancelled') and coalesce(NEW.approval_status, 'approved') <> 'pending';
  v_old := coalesce(NEW.stock_applied, '{}'::jsonb);
  v_loc := coalesce((v_old->>'_loc')::uuid, NEW.stock_location_id,
    (select id from public.locations where tenant_id = NEW.tenant_id order by is_main desc nulls last, created_at limit 1));
  if v_live then
    for r in select * from public.doc_item_quantities(NEW.items) loop
      v_new := v_new || jsonb_build_object(r.product_id::text, r.qty);
    end loop;
  end if;
  -- Apply the difference between what is out now and what should be.
  for k in select distinct key from (select jsonb_object_keys(v_old - '_loc') as key union select jsonb_object_keys(v_new)) x loop
    d := coalesce((v_new->>k)::numeric, 0) - coalesce((v_old->>k)::numeric, 0);
    if d <> 0 then perform public.stock_move(NEW.tenant_id, k::uuid, v_loc, -d, case when d > 0 then 'sale' else 'return' end, auth.uid()); end if;
  end loop;
  if v_new = '{}'::jsonb and v_old = '{}'::jsonb then return NEW; end if;
  update public.invoices set stock_applied = case when v_new = '{}'::jsonb then null else v_new || jsonb_build_object('_loc', v_loc) end where id = NEW.id;
  return NEW;
end $$;

-- New rows belong to the signed-in company unless given.
do $$ declare t text; begin
  foreach t in array array['delivery_notes', 'locations', 'purchases', 'product_batches', 'packing_lists', 'stock_adjustments'] loop
    execute format('alter table public.%I alter column tenant_id set default public.current_user_tenant_id()', t);
  end loop;
end $$;

/** After a purchase receive: records batch / expiry / bin per line as lots and tags the stock movements. */
create or replace function public.record_receive_lots(p_receive uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.purchase_receives; po public.purchases; l jsonb; it public.purchase_items; q numeric;
begin
  select * into r from public.purchase_receives where id = p_receive;
  if not found or not public._wh_can(r.tenant_id) then raise exception 'Receive not found'; end if;
  select * into po from public.purchases where id = r.purchase_id;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    q := coalesce((l->>'quantity')::numeric, 0);
    continue when q <= 0;
    select * into it from public.purchase_items where id = (l->>'item_id')::uuid and purchase_id = po.id;
    continue when not found;
    perform public.lot_add(r.tenant_id, it.product_id, po.location_id, l->>'batch_number', nullif(l->>'expiry_date', '')::date, nullif(l->>'bin_id', '')::uuid, q, it.unit_cost);
  end loop;
  update public.stock_adjustments set ref_type = 'purchase_receive', ref_id = r.id, ref_number = r.receive_number, tenant_id = r.tenant_id
   where reason = 'purchase_received' and ref_id is null and location_id = po.location_id and created_at > now() - interval '10 minutes';
  update public.purchase_receives set items = (
    select coalesce(jsonb_agg(x || coalesce((select jsonb_build_object('batch_number', y->>'batch_number', 'expiry_date', y->>'expiry_date') from jsonb_array_elements(p_lines) y where y->>'item_id' = x->>'item_id' limit 1), '{}'::jsonb)), '[]'::jsonb)
    from jsonb_array_elements(items) x) where id = r.id;
end $$;
grant execute on function public.record_receive_lots(uuid, jsonb) to authenticated;
