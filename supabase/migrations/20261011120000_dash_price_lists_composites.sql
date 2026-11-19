-- Price lists, composite items (kits) and invoices that move stock.
--
-- Price lists: a percentage up or down on every item, or a rate per item.
-- A customer can have one; their quotes, sales orders and invoices use it.
--
-- Composite items: a product made of components. Selling it (invoice or point
-- of sale) takes the components out of stock; it has no stock of its own.
--
-- Invoices: once an invoice is issued (not draft, void or awaiting approval)
-- its stocked items leave the main location; voiding or deleting it puts them
-- back; editing an issued invoice re-applies the difference. Invoices from the
-- point of sale (transaction_id) and imported history (source 'import') are
-- left alone because their stock already moved.

create table if not exists public.price_lists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  name text not null,
  kind text not null default 'percent' check (kind in ('percent', 'items')),
  percent numeric(7,3) not null default 0,
  round_to numeric(12,2) not null default 0,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.price_list_items (
  price_list_id uuid not null references public.price_lists(id) on delete cascade,
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  rate numeric(16,2) not null,
  primary key (price_list_id, product_id)
);
alter table public.customers add column if not exists price_list_id uuid references public.price_lists(id) on delete set null;

alter table public.products add column if not exists is_composite boolean not null default false;
create table if not exists public.composite_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  component_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unique (product_id, component_id),
  check (product_id <> component_id)
);

do $$ declare t text; begin
  foreach t in array array['price_lists', 'price_list_items', 'composite_components'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = public.current_user_tenant_id())', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_manage', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))
      with check (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))$p$, t || '_manage', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

/** Moves stock of one product at a location (negative = out). Composite items move their components. */
create or replace function public.stock_move(p_tenant uuid, p_product uuid, p_location uuid, p_delta numeric, p_reason text, p_user uuid, p_depth int default 0)
returns void language plpgsql security definer set search_path = public as $$
declare v_before numeric; v_after numeric; v_type text; v_comp boolean; c record;
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
  insert into public.stock_adjustments (product_id, location_id, quantity_change, stock_before, stock_after, reason, adjusted_by)
  values (p_product, p_location, p_delta, coalesce(v_before, 0), v_after, p_reason, p_user);
end $$;
revoke all on function public.stock_move(uuid, uuid, uuid, numeric, text, uuid, int) from public, anon, authenticated;

/** Quantity of each stocked product on a document's lines. */
create or replace function public.doc_item_quantities(p_items jsonb)
returns table (product_id uuid, qty numeric) language sql stable set search_path = public as $$
  select (coalesce(nullif(i->>'item_id', ''), nullif(i->>'product_id', '')))::uuid, sum(coalesce(nullif(i->>'quantity', '')::numeric, 0))
  from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) i
  where coalesce(nullif(i->>'item_id', ''), nullif(i->>'product_id', '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and coalesce(i->>'type', 'product') <> 'service'
  group by 1
$$;

alter table public.invoices add column if not exists stock_location_id uuid references public.locations(id) on delete set null;
alter table public.invoices add column if not exists stock_applied jsonb;

create or replace function public.invoice_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_live boolean; v_loc uuid; v_old jsonb; v_new jsonb := '{}'::jsonb; k text; d numeric; r record;
begin
  if TG_OP = 'DELETE' then
    if OLD.stock_applied is not null then
      for k, d in select key, value::numeric from jsonb_each_text(OLD.stock_applied - '_loc') loop
        perform public.stock_move(OLD.tenant_id, k::uuid, (OLD.stock_applied->>'_loc')::uuid, d, 'return', auth.uid());
      end loop;
    end if;
    return OLD;
  end if;
  if NEW.transaction_id is not null or coalesce(NEW.source, '') in ('import', 'zoho', 'pos') then return NEW; end if;
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
revoke all on function public.invoice_stock() from public, anon, authenticated;
drop trigger if exists invoices_stock on public.invoices;
create trigger invoices_stock after insert or update of status, items, approval_status on public.invoices
  for each row when (pg_trigger_depth() < 2) execute function public.invoice_stock();
drop trigger if exists invoices_stock_delete on public.invoices;
create trigger invoices_stock_delete after delete on public.invoices
  for each row execute function public.invoice_stock();

-- Cost of goods for composite items is the cost of their components.
create or replace function public.product_unit_cost(p_product uuid, p_depth int default 0)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v numeric := 0; c record; p record;
begin
  select coalesce(product_type, 'product') as t, is_composite, coalesce(cost_price, 0) as cost into p from public.products where id = p_product;
  if not found or p.t = 'service' then return 0; end if;
  if not p.is_composite or p_depth > 4 then return p.cost; end if;
  for c in select component_id, quantity from public.composite_components where product_id = p_product loop
    v := v + c.quantity * public.product_unit_cost(c.component_id, p_depth + 1);
  end loop;
  return v;
end $$;
create or replace function public.acc_items_cost(p_items jsonb)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(q.qty * public.product_unit_cost(q.product_id)), 0) from public.doc_item_quantities(p_items) q
$$;


-- Point of sale: a composite item sold at the till takes its components out.
create or replace function public.composite_sale_fix() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.reason = 'sale' and exists (select 1 from public.products where id = NEW.product_id and is_composite) then
    -- Undo the composite's own movement and move its components instead.
    update public.product_stocks set stock = NEW.stock_before where product_id = NEW.product_id and location_id = NEW.location_id;
    perform public.stock_move(p.tenant_id, NEW.product_id, NEW.location_id, NEW.quantity_change, 'sale', NEW.adjusted_by) from public.products p where p.id = NEW.product_id;
    delete from public.stock_adjustments where id = NEW.id;
  end if;
  return null;
end $$;
revoke all on function public.composite_sale_fix() from public, anon, authenticated;
drop trigger if exists stock_adjustments_composite on public.stock_adjustments;
create trigger stock_adjustments_composite after insert on public.stock_adjustments
  for each row when (pg_trigger_depth() < 2) execute function public.composite_sale_fix();

/** The rate for an item on a customer's price list (null = normal price). */
create or replace function public.price_for(p_customer uuid, p_product uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare pl record; base numeric; v numeric;
begin
  select l.* into pl from public.customers c join public.price_lists l on l.id = c.price_list_id
  where c.id = p_customer and c.tenant_id = public.current_user_tenant_id() and l.is_active;
  if not found then return null; end if;
  if pl.kind = 'items' then return (select rate from public.price_list_items where price_list_id = pl.id and product_id = p_product); end if;
  select price into base from public.products where id = p_product and tenant_id = pl.tenant_id;
  if base is null then return null; end if;
  v := base * (1 + pl.percent / 100);
  if pl.round_to > 0 then v := round(v / pl.round_to) * pl.round_to; end if;
  return round(v, 2);
end $$;
grant execute on function public.price_for(uuid, uuid) to authenticated;
