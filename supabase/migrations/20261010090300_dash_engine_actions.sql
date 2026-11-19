-- JMSURF DASH record-engine actions that touch the books:
--  * mrp_produce(mo): a manufacturing order consumes its components and adds
--    the finished product to stock (main location), costing the order.
--  * project_invoice(project): draft invoice from unbilled billable time,
--    reached milestones and re-billable project costs.

create or replace function public.mrp_stock_move(p_tenant uuid, p_loc uuid, p_product uuid, p_delta numeric, p_reason text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_before numeric; v_after numeric; v_name text; v_stock numeric;
begin
  select name, coalesce(stock, 0) into v_name, v_stock from public.products where id = p_product and tenant_id = p_tenant;
  if v_name is null then raise exception 'An item on this order is not in your catalogue'; end if;
  insert into public.product_stocks (product_id, location_id, stock)
    select p_product, p_loc,
      case when exists (select 1 from public.product_stocks where product_id = p_product) then 0 else greatest(0, v_stock) end
    on conflict (product_id, location_id) do nothing;
  select stock into v_before from public.product_stocks where product_id = p_product and location_id = p_loc for update;
  v_after := v_before + p_delta;
  if v_after < 0 then raise exception 'Not enough % in stock (need %, have %)', v_name, -p_delta, v_before; end if;
  update public.product_stocks set stock = v_after where product_id = p_product and location_id = p_loc;
  insert into public.stock_adjustments (product_id, location_id, quantity_change, stock_before, stock_after, reason, adjusted_by)
  values (p_product, p_loc, p_delta, v_before, v_after, left(p_reason, 200), auth.uid());
  return v_after;
end $$;
revoke all on function public.mrp_stock_move(uuid, uuid, uuid, numeric, text) from public, anon, authenticated;

create or replace function public.mrp_produce(p_mo uuid)
returns public.app_records language plpgsql security definer set search_path = public as $$
declare
  mo public.app_records;
  bom public.app_records;
  v_loc uuid;
  c jsonb;
  v_factor numeric;
  v_need numeric;
  v_cost numeric := 0;
  v_unit_cost numeric;
begin
  select * into mo from public.app_records where id = p_mo and app = 'manufacturing' and kind = 'mo' for update;
  if mo.id is null or mo.tenant_id <> public.current_user_tenant_id() then raise exception 'Manufacturing order not found'; end if;
  if not public.tenant_module_active(mo.tenant_id, 'manufacturing') then raise exception 'Manufacturing is switched off'; end if;
  if mo.stage = 'done' then raise exception 'This order was already produced'; end if;
  if mo.product_id is null or coalesce(mo.quantity, 0) <= 0 then raise exception 'Set the product and quantity first'; end if;

  if coalesce(mo.data->>'bom', '') <> '' then
    select * into bom from public.app_records where id = (mo.data->>'bom')::uuid and tenant_id = mo.tenant_id;
  end if;
  if bom.id is null then
    select * into bom from public.app_records
     where tenant_id = mo.tenant_id and app = 'manufacturing' and kind = 'bom' and product_id = mo.product_id and coalesce(stage, 'active') = 'active' and not archived
     order by updated_at desc limit 1;
  end if;
  if bom.id is null then raise exception 'No bill of materials for this product. Create one first.'; end if;

  v_loc := (select id from public.locations where tenant_id = mo.tenant_id order by is_main desc, created_at limit 1);
  v_factor := mo.quantity / greatest(coalesce(bom.quantity, 1), 0.0001);

  for c in select * from jsonb_array_elements(coalesce(bom.data->'components', '[]'::jsonb)) loop
    continue when coalesce(c->>'product_id', '') = '' or coalesce((c->>'qty')::numeric, 0) = 0;
    v_need := round((c->>'qty')::numeric * v_factor, 3);
    perform public.mrp_stock_move(mo.tenant_id, v_loc, (c->>'product_id')::uuid, -v_need, coalesce(mo.number, 'MO') || ' consumed');
    v_cost := v_cost + v_need * coalesce((select cost_price from public.products where id = (c->>'product_id')::uuid), 0);
  end loop;
  v_cost := v_cost + coalesce(bom.amount, 0) * v_factor;

  perform public.mrp_stock_move(mo.tenant_id, v_loc, mo.product_id, mo.quantity, coalesce(mo.number, 'MO') || ' produced');
  -- The finished product's cost follows the latest production cost.
  v_unit_cost := round(v_cost / mo.quantity, 2);
  if v_unit_cost > 0 then update public.products set cost_price = v_unit_cost where id = mo.product_id; end if;

  update public.app_records set stage = 'done', amount = round(v_cost, 2),
    data = data || jsonb_build_object('produced_at', now(), 'bom', bom.id, 'unit_cost', v_unit_cost)
  where id = mo.id returning * into mo;
  insert into public.app_record_events (tenant_id, record_id, kind, body)
  values (mo.tenant_id, mo.id, 'system', format('Produced %s. Components consumed; cost %s.', mo.quantity, round(v_cost, 2)));
  return mo;
end $$;
grant execute on function public.mrp_produce(uuid) to authenticated;

create or replace function public.project_invoice(p_project uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  pr public.app_records;
  r record;
  v_items jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_rate numeric;
  v_inv uuid;
  v_cust record;
  v_ids uuid[] := '{}';
begin
  select * into pr from public.app_records where id = p_project and app = 'projects' and kind = 'project';
  if pr.id is null or pr.tenant_id <> public.current_user_tenant_id() then raise exception 'Project not found'; end if;
  if pr.customer_id is null then raise exception 'Set the project customer first'; end if;
  v_rate := coalesce(nullif(pr.data->>'rate', '')::numeric, 0);

  for r in select * from public.app_records
           where tenant_id = pr.tenant_id and parent_id = pr.id and not archived
             and ((kind = 'timesheet' and coalesce(stage, 'draft') <> 'invoiced' and coalesce((data->>'billable')::boolean, true))
               or (kind = 'milestone' and stage = 'reached' and coalesce(data->>'invoiced', '') = '' and coalesce(amount, 0) > 0)
               or (kind = 'project_expense' and coalesce(stage, 'unbilled') = 'unbilled' and coalesce((data->>'billable')::boolean, false)))
  loop
    if r.kind = 'timesheet' then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'name', 'Time: ' || r.title, 'quantity', coalesce(r.quantity, 0),
        'rate', case when coalesce(r.amount, 0) > 0 and coalesce(r.quantity, 0) > 0 then round(r.amount / r.quantity, 2) else v_rate end,
        'price', case when coalesce(r.amount, 0) > 0 and coalesce(r.quantity, 0) > 0 then round(r.amount / r.quantity, 2) else v_rate end,
        'amount', coalesce(nullif(r.amount, 0), coalesce(r.quantity, 0) * v_rate), 'discount', 0, 'tax_rate', 0));
      v_total := v_total + coalesce(nullif(r.amount, 0), coalesce(r.quantity, 0) * v_rate);
    else
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'name', case when r.kind = 'milestone' then 'Milestone: ' else 'Cost: ' end || r.title, 'quantity', 1,
        'rate', r.amount, 'price', r.amount, 'amount', r.amount, 'discount', 0, 'tax_rate', 0));
      v_total := v_total + coalesce(r.amount, 0);
    end if;
    v_ids := v_ids || r.id;
  end loop;
  if jsonb_array_length(v_items) = 0 then raise exception 'Nothing to invoice yet: no unbilled billable time, reached milestones or re-billable costs.'; end if;

  select name, email, phone into v_cust from public.customers where id = pr.customer_id;
  insert into public.invoices (tenant_id, invoice_number, customer_id, customer_name, customer_email, customer_phone, items, subtotal, tax, discount, total,
                               status, issue_date, due_date, subject, reference, created_by, source)
  values (pr.tenant_id, public.next_doc_number('invoice', pr.tenant_id), pr.customer_id, v_cust.name, v_cust.email, v_cust.phone, v_items,
          round(v_total, 2), 0, 0, round(v_total, 2), 'draft', current_date, current_date + 14, 'Project: ' || pr.title, pr.number, auth.uid(), 'project')
  returning id into v_inv;

  update public.app_records set
    stage = case when kind = 'timesheet' then 'invoiced' when kind = 'project_expense' then 'billed' else stage end,
    data = data || jsonb_build_object('invoiced', v_inv)
  where id = any (v_ids);
  insert into public.app_record_events (tenant_id, record_id, kind, body, data)
  values (pr.tenant_id, pr.id, 'system', format('Invoice drafted for %s line(s), total %s.', jsonb_array_length(v_items), round(v_total, 2)), jsonb_build_object('invoice_id', v_inv));
  return v_inv;
end $$;
grant execute on function public.project_invoice(uuid) to authenticated;
