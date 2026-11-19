-- Batch and serial number tracking (2026-10-15)
--  * Items can require batches and/or serial numbers (products.track_batches / track_serials).
--  * A purchase receive line can arrive in several batches, and with serial numbers.
--  * Invoice lines can name the batches (and quantities) and serial numbers they sell; lines
--    without named batches still take the earliest expiry first. What each invoice took is kept
--    on invoices.lots_applied, so editing, voiding or deleting the invoice puts the exact lots back.
--  * Serial numbers have a history: received on, sold on (invoice, customer), returned.

alter table public.products add column if not exists track_batches boolean not null default false;
alter table public.products add column if not exists track_serials boolean not null default false;
alter table public.invoices add column if not exists lots_applied jsonb;

-- ── Serial numbers ─────────────────────────────────────────────────────────
create table if not exists public.product_serials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  serial_number text not null,
  batch_number text,
  status text not null default 'in_stock' check (status in ('in_stock', 'sold', 'returned', 'damaged', 'written_off')),
  unit_cost numeric(16,4),
  received_ref_type text, received_ref_id uuid, received_ref_number text, received_at timestamptz not null default now(),
  invoice_id uuid, -- no FK: the invoice delete trigger releases the serials itself
  invoice_number text,
  customer_id uuid,
  customer_name text,
  sold_at timestamptz,
  warranty_until date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, product_id, serial_number)
);
create index if not exists product_serials_lookup_idx on public.product_serials (tenant_id, serial_number);
create index if not exists product_serials_stock_idx on public.product_serials (product_id, location_id, status);
create index if not exists product_serials_invoice_idx on public.product_serials (invoice_id);

alter table public.product_serials enable row level security;
drop policy if exists product_serials_read on public.product_serials;
create policy product_serials_read on public.product_serials for select to authenticated
  using (tenant_id = public.current_user_tenant_id());
drop policy if exists product_serials_write on public.product_serials;
create policy product_serials_write on public.product_serials for all to authenticated
  using (public._wh_can(tenant_id)) with check (public._wh_can(tenant_id));
grant select, insert, update, delete on public.product_serials to authenticated;

/** Adds serial numbers to stock (receives, opening stock). Raises if one is already in stock. */
create or replace function public.serials_add(p_tenant uuid, p_product uuid, p_location uuid, p_serials jsonb, p_batch text default null,
  p_cost numeric default null, p_ref_type text default null, p_ref_id uuid default null, p_ref_number text default null)
returns int language plpgsql security definer set search_path = public as $$
declare s text; n int := 0; v public.product_serials%rowtype;
begin
  for s in select distinct trim(x) from jsonb_array_elements_text(coalesce(p_serials, '[]'::jsonb)) x where trim(x) <> '' loop
    select * into v from public.product_serials where tenant_id = p_tenant and product_id = p_product and serial_number = s for update;
    if found then
      if v.status = 'in_stock' then raise exception 'Serial number % is already in stock', s; end if;
      update public.product_serials set status = 'in_stock', location_id = p_location, batch_number = coalesce(nullif(p_batch, ''), batch_number),
        unit_cost = coalesce(p_cost, unit_cost), received_ref_type = p_ref_type, received_ref_id = p_ref_id, received_ref_number = p_ref_number,
        received_at = now(), invoice_id = null, invoice_number = null, customer_id = null, customer_name = null, sold_at = null, updated_at = now()
       where id = v.id;
    else
      insert into public.product_serials (tenant_id, product_id, location_id, serial_number, batch_number, unit_cost, received_ref_type, received_ref_id, received_ref_number)
      values (p_tenant, p_product, p_location, s, nullif(p_batch, ''), p_cost, p_ref_type, p_ref_id, p_ref_number);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.serials_add(uuid, uuid, uuid, jsonb, text, numeric, text, uuid, text) from public, anon, authenticated;

/** Opening stock / receipts without a PO for serial-tracked items (stock + serials in one go). */
create or replace function public.wh_receive_serials(p_location uuid, p_product uuid, p_serials jsonb, p_batch text default null, p_expiry date default null, p_reason text default 'restock')
returns int language plpgsql security definer set search_path = public as $$
declare t uuid; n int;
begin
  select tenant_id into t from public.locations where id = p_location;
  if not public._wh_can(t) then raise exception 'You are not allowed to receive stock here'; end if;
  n := public.serials_add(t, p_product, p_location, p_serials, p_batch, null, 'stock_in', null, null);
  if n > 0 then
    perform public.stock_move(t, p_product, p_location, n, p_reason, auth.uid());
    perform public.lot_add(t, p_product, p_location, p_batch, p_expiry, null, n);
  end if;
  return n;
end $$;
grant execute on function public.wh_receive_serials(uuid, uuid, jsonb, text, date, text) to authenticated;

-- ── Purchase receive: several batches per line, and serial numbers ───────────
/** After a purchase receive: records batches / expiry / bin per line as lots (a line may be split
 *  into several batches by sending the same item_id more than once) and serial numbers. */
create or replace function public.record_receive_lots(p_receive uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.purchase_receives; po public.purchases; l jsonb; it public.purchase_items; q numeric; pr public.products;
  got jsonb := '{}'::jsonb; k text; need numeric;
begin
  select * into r from public.purchase_receives where id = p_receive;
  if not found or not public._wh_can(r.tenant_id) then raise exception 'Receive not found'; end if;
  select * into po from public.purchases where id = r.purchase_id;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    q := coalesce((l->>'quantity')::numeric, 0);
    continue when q <= 0;
    select * into it from public.purchase_items where id = (l->>'item_id')::uuid and purchase_id = po.id;
    continue when not found;
    select * into pr from public.products where id = it.product_id;
    if pr.track_batches and coalesce(trim(l->>'batch_number'), '') = '' then raise exception '% needs a batch number', pr.name; end if;
    if pr.track_serials and jsonb_array_length(coalesce(l->'serials', '[]'::jsonb)) <> q then
      raise exception '% needs % serial number(s), % given', pr.name, q, jsonb_array_length(coalesce(l->'serials', '[]'::jsonb));
    end if;
    perform public.lot_add(r.tenant_id, it.product_id, po.location_id, l->>'batch_number', nullif(l->>'expiry_date', '')::date, nullif(l->>'bin_id', '')::uuid, q, it.unit_cost);
    if jsonb_array_length(coalesce(l->'serials', '[]'::jsonb)) > 0 then
      perform public.serials_add(r.tenant_id, it.product_id, po.location_id, l->'serials', l->>'batch_number', it.unit_cost, 'purchase_receive', r.id, r.receive_number);
    end if;
    got := jsonb_set(got, array[it.id::text], to_jsonb(coalesce((got->>it.id::text)::numeric, 0) + q));
  end loop;
  -- The batches must add up to what was received on the line.
  for k in select jsonb_object_keys(got) loop
    select coalesce((x->>'quantity')::numeric, 0) into need from jsonb_array_elements(r.items) x where x->>'item_id' = k limit 1;
    if need is not null and need > 0 and (got->>k)::numeric > need + 0.0001 then
      raise exception 'Batches add up to more than was received (% of %)', got->>k, need;
    end if;
  end loop;
  update public.stock_adjustments set ref_type = 'purchase_receive', ref_id = r.id, ref_number = r.receive_number, tenant_id = r.tenant_id
   where reason = 'purchase_received' and ref_id is null and location_id = po.location_id and created_at > now() - interval '10 minutes';
  update public.purchase_receives set items = (
    select coalesce(jsonb_agg(x || coalesce((
      select jsonb_build_object(
        'batch_number', (array_agg(y->>'batch_number') filter (where coalesce(y->>'batch_number', '') <> ''))[1],
        'expiry_date', (array_agg(y->>'expiry_date') filter (where coalesce(y->>'expiry_date', '') <> ''))[1],
        'lots', coalesce(jsonb_agg(jsonb_build_object('batch', y->>'batch_number', 'expiry', nullif(y->>'expiry_date', ''), 'qty', (y->>'quantity')::numeric))
                  filter (where coalesce(y->>'batch_number', '') <> '' or coalesce(y->>'expiry_date', '') <> ''), '[]'::jsonb),
        'serials', coalesce((select jsonb_agg(s) from jsonb_array_elements(p_lines) z, jsonb_array_elements_text(coalesce(z->'serials', '[]'::jsonb)) s where z->>'item_id' = x->>'item_id'), '[]'::jsonb))
      from jsonb_array_elements(p_lines) y where y->>'item_id' = x->>'item_id' and coalesce((y->>'quantity')::numeric, 0) > 0), '{}'::jsonb)), '[]'::jsonb)
    from jsonb_array_elements(items) x) where id = r.id;
end $$;
grant execute on function public.record_receive_lots(uuid, jsonb) to authenticated;

-- ── Invoices: named batches and serial numbers ─────────────────────────────
create or replace function public.invoice_stock()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_live boolean; v_loc uuid; v_old jsonb; v_new jsonb := '{}'::jsonb; k text; d numeric; r record;
  i jsonb; lot jsonb; left_ numeric; q numeric; taken jsonb; v_lots jsonb := '[]'::jsonb; v_comp boolean; s text; n int; v_pid uuid; v_track boolean;
begin
  if TG_OP = 'DELETE' then
    perform public._wh_ref('invoice', OLD.id, OLD.invoice_number);
    perform set_config('dash.lots_done', 'on', true);
    if OLD.stock_applied is not null then
      for k, d in select key, value::numeric from jsonb_each_text(OLD.stock_applied - '_loc') loop
        perform public.stock_move(OLD.tenant_id, k::uuid, (OLD.stock_applied->>'_loc')::uuid, d, 'return', auth.uid());
      end loop;
    end if;
    for lot in select * from jsonb_array_elements(coalesce(OLD.lots_applied, '[]'::jsonb)) loop
      perform public.lot_add(OLD.tenant_id, (lot->>'product_id')::uuid, (lot->>'location_id')::uuid, lot->>'batch', nullif(lot->>'expiry', '')::date, nullif(lot->>'bin_id', '')::uuid, (lot->>'qty')::numeric);
    end loop;
    perform set_config('dash.lots_done', '', true);
    update public.product_serials set status = 'in_stock', invoice_id = null, invoice_number = null, customer_id = null, customer_name = null, sold_at = null, updated_at = now()
     where invoice_id = OLD.id and status = 'sold';
    return OLD;
  end if;
  if NEW.transaction_id is not null or coalesce(NEW.source, '') in ('import', 'zoho', 'pos') then return NEW; end if;
  -- Stock leaves on shipment for this company (an invoice that already moved stock still settles normally).
  if NEW.stock_applied is null and public.inventory_setting(NEW.tenant_id, 'invoice_reduces_stock', 'true') = 'false' then return NEW; end if;
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

  -- Invoices issued before batch tracking took their lots inside stock_move; they keep doing so.
  v_track := NEW.lots_applied is not null or NEW.stock_applied is null;

  -- 1. Put back the lots this invoice took before (exactly those batches).
  for lot in select * from jsonb_array_elements(coalesce(NEW.lots_applied, '[]'::jsonb)) loop
    perform public.lot_add(NEW.tenant_id, (lot->>'product_id')::uuid, (lot->>'location_id')::uuid, lot->>'batch', nullif(lot->>'expiry', '')::date, nullif(lot->>'bin_id', '')::uuid, (lot->>'qty')::numeric);
  end loop;

  -- 2. Totals: apply the difference between what is out now and what should be (lots handled below).
  for k in select distinct key from (select jsonb_object_keys(v_old - '_loc') as key union select jsonb_object_keys(v_new)) x loop
    d := coalesce((v_new->>k)::numeric, 0) - coalesce((v_old->>k)::numeric, 0);
    if d <> 0 then
      select is_composite into v_comp from public.products where id = k::uuid;
      -- Composite items keep taking their components first-expiry-first inside stock_move.
      perform set_config('dash.lots_done', case when coalesce(v_comp, false) or not v_track then '' else 'on' end, true);
      perform public.stock_move(NEW.tenant_id, k::uuid, v_loc, -d, case when d > 0 then 'sale' else 'return' end, auth.uid());
    end if;
  end loop;
  perform set_config('dash.lots_done', '', true);

  -- 3. Take the lots for the invoice as it is now: named batches first, the rest earliest expiry first.
  if v_live and v_track then
    for i in select * from jsonb_array_elements(case when jsonb_typeof(NEW.items) = 'array' then NEW.items else '[]'::jsonb end) loop
      continue when coalesce(i->>'type', 'product') = 'service';
      continue when coalesce(nullif(i->>'item_id', ''), nullif(i->>'product_id', '')) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
      v_pid := coalesce(nullif(i->>'item_id', ''), nullif(i->>'product_id', ''))::uuid;
      select is_composite into v_comp from public.products where id = v_pid;
      continue when coalesce(v_comp, true);
      left_ := coalesce(nullif(i->>'quantity', '')::numeric, 0);
      for lot in select * from jsonb_array_elements(coalesce(i->'lots', '[]'::jsonb)) loop
        q := least(left_, coalesce((lot->>'qty')::numeric, 0));
        continue when q <= 0;
        taken := public.lot_take(v_pid, v_loc, q, coalesce(lot->>'batch', ''));
        v_lots := v_lots || (select coalesce(jsonb_agg(t || jsonb_build_object('product_id', v_pid, 'location_id', v_loc)), '[]'::jsonb) from jsonb_array_elements(taken) t);
        left_ := left_ - q;
      end loop;
      if left_ > 0 then
        taken := public.lot_take(v_pid, v_loc, left_, null);
        v_lots := v_lots || (select coalesce(jsonb_agg(t || jsonb_build_object('product_id', v_pid, 'location_id', v_loc)), '[]'::jsonb) from jsonb_array_elements(taken) t);
      end if;
    end loop;
  end if;

  -- 4. Serial numbers: release the ones this invoice held, then mark the listed ones sold.
  update public.product_serials set status = 'in_stock', invoice_id = null, invoice_number = null, customer_id = null, customer_name = null, sold_at = null, updated_at = now()
   where invoice_id = NEW.id and status = 'sold';
  if v_live then
    for i in select * from jsonb_array_elements(case when jsonb_typeof(NEW.items) = 'array' then NEW.items else '[]'::jsonb end) loop
      continue when jsonb_array_length(coalesce(i->'serials', '[]'::jsonb)) = 0;
      v_pid := coalesce(nullif(i->>'item_id', ''), nullif(i->>'product_id', ''))::uuid;
      for s in select distinct trim(x) from jsonb_array_elements_text(i->'serials') x where trim(x) <> '' loop
        update public.product_serials set status = 'sold', invoice_id = NEW.id, invoice_number = NEW.invoice_number, customer_id = NEW.customer_id,
          customer_name = NEW.customer_name, sold_at = now(), location_id = coalesce(location_id, v_loc), updated_at = now()
         where tenant_id = NEW.tenant_id and product_id = v_pid and serial_number = s and status in ('in_stock', 'returned');
        get diagnostics n = row_count;
        if n = 0 then raise exception 'Serial number % of % is not in stock', s, coalesce(i->>'name', 'this item'); end if;
      end loop;
    end loop;
  end if;

  if v_new = '{}'::jsonb and v_old = '{}'::jsonb and v_lots = '[]'::jsonb and NEW.lots_applied is null then return NEW; end if;
  update public.invoices set
    stock_applied = case when v_new = '{}'::jsonb then null else v_new || jsonb_build_object('_loc', v_loc) end,
    lots_applied = case when v_live and v_track and v_new <> '{}'::jsonb then v_lots end
   where id = NEW.id;
  return NEW;
end $function$;
revoke all on function public.invoice_stock() from public, anon, authenticated;

/** Batches in stock for an item at a location, earliest expiry first (invoice batch picker). */
create or replace function public.item_lots(p_product uuid, p_location uuid default null)
returns table (batch_number text, expiry_date date, available numeric, location_id uuid, location_name text)
language sql stable security definer set search_path = public as $$
  select b.batch_number, b.expiry_date, sum(b.quantity), b.location_id, l.name
    from public.product_batches b join public.products p on p.id = b.product_id left join public.locations l on l.id = b.location_id
   where b.product_id = p_product and b.quantity > 0 and b.status = 'available' and p.tenant_id = public.current_user_tenant_id()
     and (p_location is null or b.location_id = p_location)
   group by b.batch_number, b.expiry_date, b.location_id, l.name
   order by b.expiry_date nulls last, b.batch_number
$$;
grant execute on function public.item_lots(uuid, uuid) to authenticated;

/** Purchase receive with batches and serial numbers in one transaction: if a batch or serial
 *  number is wrong, nothing is received. p_lots: [{item_id, quantity, batch_number, expiry_date, bin_id, serials[]}]. */
create or replace function public.receive_purchase_tracked(p_purchase uuid, p_lines jsonb, p_lots jsonb, p_shortfall jsonb default '[]'::jsonb,
  p_received_date date default current_date, p_notes text default null, p_expected date default null, p_update_cost boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := public.receive_purchase_v2(p_purchase, p_lines, p_shortfall, p_received_date, p_notes, p_expected, p_update_cost);
  if r->>'receive_id' is not null then perform public.record_receive_lots((r->>'receive_id')::uuid, p_lots); end if;
  return r;
end $$;
grant execute on function public.receive_purchase_tracked(uuid, jsonb, jsonb, jsonb, date, text, date, boolean) to authenticated;

-- Batch reports read the item with each batch.
delete from public.product_batches b where not exists (select 1 from public.products p where p.id = b.product_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'product_batches_product_id_fkey') then
    alter table public.product_batches add constraint product_batches_product_id_fkey foreign key (product_id) references public.products(id) on delete cascade;
  end if;
end $$;
