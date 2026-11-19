-- System → Inventory → "Issued invoices take stock out". When a company switches it
-- off, stock leaves when a package is shipped (batch by batch, as packed) instead.

/** A company's inventory setting (System → Inventory), with a default. */
create or replace function public.inventory_setting(p_tenant uuid, p_key text, p_default text default null)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select erp_settings->'inventory'->>p_key from public.business_settings where tenant_id = p_tenant limit 1), p_default)
$$;
grant execute on function public.inventory_setting(uuid, text, text) to authenticated;

create or replace function public.invoice_stock()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  -- Apply the difference between what is out now and what should be.
  for k in select distinct key from (select jsonb_object_keys(v_old - '_loc') as key union select jsonb_object_keys(v_new)) x loop
    d := coalesce((v_new->>k)::numeric, 0) - coalesce((v_old->>k)::numeric, 0);
    if d <> 0 then perform public.stock_move(NEW.tenant_id, k::uuid, v_loc, -d, case when d > 0 then 'sale' else 'return' end, auth.uid()); end if;
  end loop;
  if v_new = '{}'::jsonb and v_old = '{}'::jsonb then return NEW; end if;
  update public.invoices set stock_applied = case when v_new = '{}'::jsonb then null else v_new || jsonb_build_object('_loc', v_loc) end where id = NEW.id;
  return NEW;
end $function$;

alter table public.wh_packages add column if not exists stock_taken boolean not null default false;

/** Shipping a package takes its stock out (the packed batches first) when invoices do not. */
create or replace function public.wh_package_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare l jsonb; lot jsonb; q numeric; left_ numeric;
begin
  if NEW.status = 'shipped' and OLD.status = 'packed' and not NEW.stock_taken
     and public.inventory_setting(NEW.tenant_id, 'invoice_reduces_stock', 'true') = 'false' then
    perform public._wh_ref('package', NEW.id, NEW.number);
    for l in select * from jsonb_array_elements(NEW.lines) loop
      left_ := coalesce((l->>'quantity')::numeric, 0);
      continue when left_ <= 0;
      for lot in select * from jsonb_array_elements(coalesce(l->'lots', '[]'::jsonb)) loop
        q := least(left_, coalesce((lot->>'qty')::numeric, 0));
        continue when q <= 0;
        perform set_config('dash.batch', coalesce(lot->>'batch', ''), true);
        perform public.stock_move(NEW.tenant_id, (l->>'product_id')::uuid, NEW.location_id, -q, 'sale', auth.uid());
        left_ := left_ - q;
      end loop;
      perform set_config('dash.batch', '', true);
      if left_ > 0 then perform public.stock_move(NEW.tenant_id, (l->>'product_id')::uuid, NEW.location_id, -left_, 'sale', auth.uid()); end if;
    end loop;
    NEW.stock_taken := true;
  elsif NEW.status = 'cancelled' and OLD.status <> 'cancelled' and NEW.stock_taken then
    perform public._wh_ref('package', NEW.id, NEW.number);
    for l in select * from jsonb_array_elements(NEW.lines) loop
      q := coalesce((l->>'quantity')::numeric, 0);
      continue when q <= 0;
      perform public.stock_move(NEW.tenant_id, (l->>'product_id')::uuid, NEW.location_id, q, 'return', auth.uid());
      for lot in select * from jsonb_array_elements(coalesce(l->'lots', '[]'::jsonb)) loop
        perform public.lot_add(NEW.tenant_id, (l->>'product_id')::uuid, NEW.location_id, lot->>'batch', nullif(lot->>'expiry', '')::date, nullif(lot->>'bin_id', '')::uuid, coalesce((lot->>'qty')::numeric, 0));
      end loop;
    end loop;
    NEW.stock_taken := false;
  end if;
  return NEW;
end $$;

drop trigger if exists wh_package_stock on public.wh_packages;
create trigger wh_package_stock before update of status on public.wh_packages
  for each row execute function public.wh_package_stock();
