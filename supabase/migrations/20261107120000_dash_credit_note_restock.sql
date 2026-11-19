-- Credit notes for goods that came back now put the items back into stock and
-- move their cost out of cost of sales (Dr Inventory, Cr Cost of goods sold),
-- the way an invoice takes them out. Only when the credit note says so
-- (restock = true; the form ticks it for "Goods returned" / "Order cancelled"),
-- so price corrections, damaged goods and imported history never move stock.

alter table public.credit_notes add column if not exists restock boolean not null default false;
alter table public.credit_notes add column if not exists stock_applied jsonb;

create or replace function public.credit_note_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_live boolean; v_loc uuid; v_old jsonb; v_new jsonb := '{}'::jsonb; k text; d numeric; r record;
begin
  -- The trigger's own write-back of stock_applied below.
  if pg_trigger_depth() > 1 then return coalesce(NEW, OLD); end if;
  if TG_OP = 'DELETE' then
    if OLD.stock_applied is not null then
      perform public._wh_ref('credit_note', OLD.id, OLD.credit_note_number);
      for k, d in select key, value::numeric from jsonb_each_text(OLD.stock_applied - '_loc') loop
        perform public.stock_move(OLD.tenant_id, k::uuid, (OLD.stock_applied->>'_loc')::uuid, -d, 'credit note removed', auth.uid());
      end loop;
    end if;
    return OLD;
  end if;
  v_old := coalesce(NEW.stock_applied, '{}'::jsonb);
  v_live := NEW.restock and NEW.status not in ('draft', 'void') and coalesce(NEW.approval_status, 'approved') <> 'pending';
  if not v_live and v_old = '{}'::jsonb then return NEW; end if;
  v_loc := coalesce((v_old->>'_loc')::uuid, NEW.location_id,
    (select id from public.locations where tenant_id = NEW.tenant_id order by is_main desc nulls last, created_at limit 1));
  if v_live then
    for r in select * from public.doc_item_quantities(NEW.items) loop
      v_new := v_new || jsonb_build_object(r.product_id::text, r.qty);
    end loop;
  end if;
  perform public._wh_ref('credit_note', NEW.id, NEW.credit_note_number);
  for k in select distinct key from (select jsonb_object_keys(v_old - '_loc') as key union select jsonb_object_keys(v_new)) x loop
    d := coalesce((v_new->>k)::numeric, 0) - coalesce((v_old->>k)::numeric, 0);
    if d <> 0 then
      perform public.stock_move(NEW.tenant_id, k::uuid, v_loc, d, case when d > 0 then 'return' else 'credit note changed' end, auth.uid());
    end if;
  end loop;
  update public.credit_notes set stock_applied = case when v_new = '{}'::jsonb then null else v_new || jsonb_build_object('_loc', v_loc) end
   where id = NEW.id;
  return NEW;
end $$;

drop trigger if exists credit_notes_stock on public.credit_notes;
create trigger credit_notes_stock after insert or update of status, items, restock, approval_status, location_id on public.credit_notes
  for each row execute function public.credit_note_stock();
drop trigger if exists credit_notes_stock_delete on public.credit_notes;
create trigger credit_notes_stock_delete after delete on public.credit_notes
  for each row execute function public.credit_note_stock();

create or replace function public.acc_post_credit_note(r credit_notes)
returns void language plpgsql security definer set search_path = public as $$
declare v_lines jsonb; v_cost numeric;
begin
  if r.status in ('draft', 'void') or coalesce(r.approval_status, 'approved') = 'pending' then
    perform public.acc_post(r.tenant_id, 'credit_note', r.id, r.issue_date, r.credit_note_number, null, '[]'::jsonb); return;
  end if;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'sales_returns'), 'debit', coalesce(r.total, 0) - coalesce(r.tax, 0), 'description', coalesce(r.reason, 'Credit note')),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'vat_out'), 'debit', coalesce(r.tax, 0), 'description', 'VAT reversed'),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'ar'), 'credit', r.total, 'description', 'Credit note ' || coalesce(r.credit_note_number, ''), 'contact_type', 'customer', 'contact_id', r.customer_id));
  -- Goods back on the shelf: their cost comes off cost of sales.
  if r.restock then
    v_cost := public.acc_items_cost(r.items);
    if v_cost > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'inventory'), 'debit', v_cost, 'description', 'Stock returned'),
        jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'cogs'), 'credit', v_cost, 'description', 'Cost of goods returned'));
    end if;
  end if;
  perform public.acc_post(r.tenant_id, 'credit_note', r.id, coalesce(r.issue_date, r.created_at::date), r.credit_note_number, r.customer_name, v_lines);
end $$;
