-- purchase receives (2026-10-06)
--  * Lines that did not arrive are recorded: "coming later" (with an expected date and a
--    reminder), or "not coming / damaged" (cancelled off the order).
--  * Vendor credits for goods billed but not delivered or returned; applied to bills.
--  * Delivery reminders for purchase orders past their expected date.

alter table public.purchase_items
  add column if not exists cancelled_quantity numeric not null default 0,
  add column if not exists short_reason text;
alter table public.purchase_receives
  add column if not exists shortfall jsonb not null default '[]'::jsonb,
  add column if not exists expected_rest_on date,
  add column if not exists supplier_notified_at timestamptz,
  add column if not exists document_id uuid;
alter table public.purchases add column if not exists delivery_alerted_on date;

create or replace function public.doc_prefix_default(p_kind text)
 returns text language sql immutable as $$
  select case p_kind
    when 'quote' then 'QT-' when 'invoice' then 'INV-' when 'payment' then 'PR-' when 'receipt' then 'SR-'
    when 'credit_note' then 'CN-' when 'po' then 'PO-' when 'bill' then 'BILL-' when 'requisition' then 'REQ-'
    when 'delivery_note' then 'DN-' when 'packing_list' then 'PL-' when 'lead' then 'LD-' when 'web_order' then 'WEB-' when 'employee' then 'EMP-'
    when 'payroll' then 'PAY-' when 'purchase_receive' then 'GRN-' when 'expense' then 'EXP-' when 'supplier_payment' then 'SP-'
    when 'adjustment' then 'ADJ-' when 'deal' then 'DEAL-' when 'vendor_credit' then 'VC-' else upper(left(p_kind, 3)) || '-' end
$$;

-- ------------------------------------------------------------------ receive
/** Receives goods on a purchase order. Lines may not exceed what is still to come
    (ordered − received − cancelled). */
create or replace function public.receive_purchase(p_purchase uuid, p_lines jsonb, p_update_cost boolean default true)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare po public.purchases%rowtype; l jsonb; it public.purchase_items%rowtype; _qty numeric; _before numeric; _after numeric;
        _lines int := 0; _left numeric; _items jsonb := '[]'::jsonb; _num text; _name text; _rid uuid;
begin
  select * into po from public.purchases where id = p_purchase for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not public._can_manage_purchases(po.tenant_id) then raise exception 'You are not allowed to receive stock'; end if;
  if po.status in ('received', 'cancelled') then raise exception 'Nothing is left to receive on this order'; end if;
  if po.approval_status = 'pending' then raise exception 'This order is waiting for approval'; end if;
  if po.approval_status = 'rejected' then raise exception 'This order was rejected'; end if;
  if po.location_id is null then raise exception 'This order has no branch'; end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    _qty := coalesce((l->>'quantity')::numeric, 0);
    continue when _qty = 0;
    select * into it from public.purchase_items where id = (l->>'item_id')::uuid and purchase_id = p_purchase for update;
    if not found then raise exception 'A line does not belong to this order'; end if;
    if _qty < 0 or _qty > it.quantity - it.received_quantity - it.cancelled_quantity + 0.0001 then
      raise exception 'Receiving % but only % of this line is still to come', _qty, it.quantity - it.received_quantity - it.cancelled_quantity;
    end if;
    if it.variant_id is not null then
      select stock into _before from public.product_variants where id = it.variant_id for update;
      _after := coalesce(_before, 0) + _qty;
      update public.product_variants set stock = _after,
        cost_price = case when p_update_cost and it.unit_cost > 0 then it.unit_cost else cost_price end where id = it.variant_id;
    else
      insert into public.product_stocks (product_id, location_id, stock) values (it.product_id, po.location_id, 0) on conflict (product_id, location_id) do nothing;
      select stock into _before from public.product_stocks where product_id = it.product_id and location_id = po.location_id for update;
      _after := coalesce(_before, 0) + _qty;
      update public.product_stocks set stock = _after where product_id = it.product_id and location_id = po.location_id;
    end if;
    if p_update_cost and it.unit_cost > 0 then update public.products set cost_price = it.unit_cost where id = it.product_id; end if;
    insert into public.stock_adjustments (product_id, variant_id, location_id, quantity_change, stock_before, stock_after, reason, adjusted_by)
    values (it.product_id, it.variant_id, po.location_id, _qty, coalesce(_before, 0), _after, 'purchase_received', auth.uid());
    update public.purchase_items set received_quantity = received_quantity + _qty where id = it.id;
    _items := _items || jsonb_build_object('item_id', it.id, 'product_id', it.product_id, 'name', (select name from public.products where id = it.product_id), 'quantity', _qty, 'ordered', it.quantity, 'unit_cost', it.unit_cost);
    _lines := _lines + 1;
  end loop;
  if _lines = 0 then raise exception 'Choose at least one item and quantity to receive'; end if;

  select coalesce(sum(quantity - received_quantity - cancelled_quantity), 0) into _left from public.purchase_items where purchase_id = p_purchase;
  update public.purchases set status = case when _left <= 0.0001 then 'received' else 'partially_received' end, received_at = now() where id = p_purchase;
  _num := public.next_doc_number('purchase_receive', po.tenant_id);
  select display_name into _name from public.profiles where user_id = auth.uid();
  insert into public.purchase_receives (tenant_id, receive_number, purchase_id, supplier_id, supplier_name, items, created_by_name)
  values (po.tenant_id, _num, po.id, po.supplier_id, po.supplier_name, _items, _name) returning id into _rid;
  return jsonb_build_object('lines', _lines, 'status', case when _left <= 0.0001 then 'received' else 'partially_received' end, 'remaining', _left, 'receive_id', _rid, 'receive_number', _num);
end $function$;

/** receive: what arrived goes into stock; what did not is either expected later
    (date + reminder) or cancelled off the order (not available / damaged). */
create or replace function public.receive_purchase_v2(p_purchase uuid, p_lines jsonb, p_shortfall jsonb default '[]'::jsonb,
  p_received_date date default null, p_notes text default null, p_expected date default null, p_update_cost boolean default true)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare po public.purchases%rowtype; r jsonb := null; s jsonb; it public.purchase_items%rowtype; _qty numeric; _left numeric; _recv numeric;
        _later boolean := false; _short jsonb := '[]'::jsonb; _rid uuid;
begin
  select * into po from public.purchases where id = p_purchase;
  if not found then raise exception 'Purchase order not found'; end if;
  if not public._can_manage_purchases(po.tenant_id) then raise exception 'You are not allowed to receive stock'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x where coalesce((x->>'quantity')::numeric, 0) > 0) then
    r := public.receive_purchase(p_purchase, p_lines, p_update_cost);
    _rid := (r->>'receive_id')::uuid;
  end if;

  for s in select * from jsonb_array_elements(coalesce(p_shortfall, '[]'::jsonb)) loop
    _qty := coalesce((s->>'quantity')::numeric, 0);
    continue when _qty <= 0;
    select * into it from public.purchase_items where id = (s->>'item_id')::uuid and purchase_id = p_purchase for update;
    if not found then raise exception 'A short line does not belong to this order'; end if;
    _qty := least(_qty, it.quantity - it.received_quantity - it.cancelled_quantity);
    continue when _qty <= 0;
    if (s->>'action') in ('cancel', 'damaged') then
      update public.purchase_items set cancelled_quantity = cancelled_quantity + _qty,
        short_reason = coalesce(nullif(s->>'reason', ''), case when s->>'action' = 'damaged' then 'Damaged / rejected' else 'Not available' end) where id = it.id;
    else
      _later := true;
    end if;
    _short := _short || jsonb_build_object('item_id', it.id, 'name', (select name from public.products where id = it.product_id), 'quantity', _qty,
      'unit_cost', it.unit_cost, 'action', coalesce(s->>'action', 'later'), 'reason', s->>'reason');
  end loop;

  if _rid is null and jsonb_array_length(_short) = 0 then raise exception 'Enter what was received, or what did not arrive'; end if;
  if _rid is null then
    insert into public.purchase_receives (tenant_id, receive_number, purchase_id, supplier_id, supplier_name, items, created_by_name)
    values (po.tenant_id, public.next_doc_number('purchase_receive', po.tenant_id), po.id, po.supplier_id, po.supplier_name, '[]'::jsonb,
      (select display_name from public.profiles where user_id = auth.uid())) returning id into _rid;
  end if;
  update public.purchase_receives set shortfall = _short, received_date = coalesce(p_received_date, received_date),
    notes = nullif(trim(coalesce(p_notes, '')), ''), expected_rest_on = case when _later then p_expected else null end where id = _rid;

  select coalesce(sum(quantity - received_quantity - cancelled_quantity), 0), coalesce(sum(received_quantity), 0) into _left, _recv
    from public.purchase_items where purchase_id = p_purchase;
  update public.purchases set
    status = case when _left > 0.0001 then (case when _recv > 0 then 'partially_received' else status end) when _recv > 0 then 'received' else 'cancelled' end,
    expected_date = case when _later and p_expected is not null then p_expected else expected_date end,
    delivery_alerted_on = null
   where id = p_purchase;
  if _later and p_expected is not null then
    insert into public.calendar_events (tenant_id, title, description, start_at, all_day, kind, color, created_by)
    values (po.tenant_id, 'Delivery due: ' || coalesce(po.po_number, 'purchase order') || ' · ' || coalesce(po.supplier_name, ''),
      'Items still to come from the supplier after a partial delivery.', (p_expected::timestamp at time zone 'Africa/Nairobi'), true, 'delivery', '#f59e0b', auth.uid());
  end if;
  return jsonb_build_object('receive_id', _rid, 'receive_number', (select receive_number from public.purchase_receives where id = _rid), 'remaining', _left, 'shortfall', _short);
end $function$;
revoke execute on function public.receive_purchase_v2(uuid, jsonb, jsonb, date, text, date, boolean) from public, anon;
grant execute on function public.receive_purchase_v2(uuid, jsonb, jsonb, date, text, date, boolean) to authenticated;

-- ------------------------------------------------------------------ vendor credits
create table if not exists public.vendor_credits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  credit_number text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_name text,
  purchase_id uuid references public.purchases(id) on delete set null,
  bill_id uuid references public.bills(id) on delete set null,
  receive_id uuid references public.purchase_receives(id) on delete set null,
  credit_date date not null default current_date,
  reason text,
  items jsonb not null default '[]'::jsonb,
  amount numeric not null check (amount > 0),
  amount_applied numeric not null default 0,
  amount_refunded numeric not null default 0,
  status text not null default 'open' check (status in ('draft', 'open', 'closed', 'void')),
  notes text,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists vendor_credits_tenant_idx on public.vendor_credits (tenant_id, credit_date desc);
alter table public.vendor_credits enable row level security;
drop policy if exists vendor_credits_rw on public.vendor_credits;
create policy vendor_credits_rw on public.vendor_credits for all to authenticated
  using (tenant_id = public.current_user_tenant_id()) with check (tenant_id = public.current_user_tenant_id());
revoke all on public.vendor_credits from anon;
create or replace function public._vendor_credit_number() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.credit_number is null or new.credit_number = '' then new.credit_number := public.next_doc_number('vendor_credit', new.tenant_id); end if;
  return new;
end $$;
drop trigger if exists vendor_credits_number on public.vendor_credits;
create trigger vendor_credits_number before insert on public.vendor_credits for each row execute function public._vendor_credit_number();

/** Uses (part of) a vendor credit to reduce what is owed on a bill. */
create or replace function public.apply_vendor_credit(p_credit uuid, p_bill uuid, p_amount numeric)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare c public.vendor_credits%rowtype; b public.bills%rowtype; _left numeric; _due numeric;
begin
  select * into c from public.vendor_credits where id = p_credit for update;
  if not found or c.tenant_id <> public.current_user_tenant_id() then raise exception 'Vendor credit not found'; end if;
  if c.status <> 'open' then raise exception 'This vendor credit is not open'; end if;
  select * into b from public.bills where id = p_bill;
  if not found or b.tenant_id <> c.tenant_id then raise exception 'Bill not found'; end if;
  if c.supplier_id is not null and b.supplier_id is not null and c.supplier_id <> b.supplier_id then raise exception 'That bill is from another supplier'; end if;
  _left := round(c.amount - c.amount_applied - c.amount_refunded, 2);
  _due := round(b.amount - b.amount_paid, 2);
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  if p_amount > _left + 0.009 then raise exception 'Only % of this credit is left', _left; end if;
  if p_amount > _due + 0.009 then raise exception 'Only % is owed on that bill', _due; end if;
  perform public.record_bill_payment(p_bill, p_amount, 'vendor_credit', c.credit_number, current_date, 'Vendor credit applied');
  update public.vendor_credits set amount_applied = amount_applied + round(p_amount, 2),
    status = case when amount - amount_applied - round(p_amount, 2) - amount_refunded <= 0.009 then 'closed' else status end where id = p_credit;
  return jsonb_build_object('applied', p_amount, 'left', _left - p_amount);
end $$;
revoke execute on function public.apply_vendor_credit(uuid, uuid, numeric) from public, anon;
grant execute on function public.apply_vendor_credit(uuid, uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
