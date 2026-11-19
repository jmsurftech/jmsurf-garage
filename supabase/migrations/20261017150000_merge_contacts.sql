-- Merge duplicates: every record of the duplicate (invoices, payments, quotes, bills,
-- activities…) moves to the one kept, then the duplicate is removed.
create or replace function public.merge_contacts(p_kind text, p_keep uuid, p_merge uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_user_tenant_id();
  col text; tbl text; master text; moved int := 0; n int;
begin
  if p_kind not in ('customer', 'supplier') then raise exception 'Unknown contact type'; end if;
  if p_keep = p_merge then raise exception 'Pick two different records'; end if;
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Only an admin or manager can merge';
  end if;
  col := case p_kind when 'customer' then 'customer_id' else 'supplier_id' end;
  master := case p_kind when 'customer' then 'customers' else 'suppliers' end;
  execute format('select count(*) from public.%I where id in ($1, $2) and tenant_id = $3', master) into n using p_keep, p_merge, t;
  if n <> 2 then raise exception 'Both records must belong to this company'; end if;

  for tbl in
    select c.table_name from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = col and c.table_name <> master
  loop
    begin
      execute format('update public.%I set %I = $1 where %I = $2', tbl, col, col) using p_keep, p_merge;
      get diagnostics n = row_count; moved := moved + n;
    exception when unique_violation then
      -- One-per-contact rows (e.g. a portal account): the kept contact's row stays.
      execute format('delete from public.%I where %I = $1', tbl, col) using p_merge;
    end;
  end loop;

  if p_kind = 'customer' then
    update public.customers k set balance = coalesce(k.balance, 0) + coalesce(m.balance, 0),
      email = coalesce(k.email, m.email), alt_phone = coalesce(k.alt_phone, m.phone), kra_pin = coalesce(k.kra_pin, m.kra_pin),
      address = coalesce(k.address, m.address)
      from public.customers m where k.id = p_keep and m.id = p_merge;
    delete from public.customers where id = p_merge;
  else
    update public.suppliers k set email = coalesce(k.email, m.email), kra_pin = coalesce(k.kra_pin, m.kra_pin), address = coalesce(k.address, m.address)
      from public.suppliers m where k.id = p_keep and m.id = p_merge;
    delete from public.suppliers where id = p_merge;
  end if;
  return jsonb_build_object('moved', moved);
end $$;
grant execute on function public.merge_contacts(text, uuid, uuid) to authenticated;
