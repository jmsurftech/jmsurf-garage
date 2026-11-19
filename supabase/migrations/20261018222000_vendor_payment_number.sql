-- Payments made as in Zoho: a payment number and the account it was paid through. One payment spread over several
-- bills keeps one number on each of its rows.
alter table public.supplier_payments add column if not exists payment_number text;
alter table public.supplier_payments add column if not exists paid_through text;

-- One payment to a vendor spread over their bills (the split chosen on screen).
create or replace function public.record_vendor_payment(p_supplier uuid, p_amount numeric, p_method text, p_reference text default null, p_paid_on date default current_date,
  p_notes text default null, p_paid_through text default null, p_allocations jsonb default '[]'::jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id(); num text; a jsonb; applied numeric := 0; take numeric; started timestamptz := now(); who text;
begin
  if t is null or not public._can_manage_purchases(t) then raise exception 'You are not allowed to record payments'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  if not exists (select 1 from public.suppliers where id = p_supplier and tenant_id = t) then raise exception 'Vendor not found'; end if;
  select coalesce(sum(greatest(0, (x ->> 'amount')::numeric)), 0) into applied from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) x;
  if applied > p_amount + 0.005 then raise exception 'The bills add up to more than the payment'; end if;
  num := public.next_doc_number('supplier_payment', t);
  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    take := round(greatest(0, (a ->> 'amount')::numeric), 2);
    continue when take <= 0;
    if not exists (select 1 from public.bills where id = (a ->> 'bill_id')::uuid and tenant_id = t and supplier_id = p_supplier) then raise exception 'A bill in the split belongs to another vendor'; end if;
    perform public.record_bill_payment((a ->> 'bill_id')::uuid, take, p_method, p_reference, p_paid_on, p_notes);
  end loop;
  -- Every payment row belongs to a bill: the payment is spread over bills in full.
  if p_amount - applied > 0.005 then raise exception 'Spread the whole payment over the vendor''s bills (% is not applied)', round(p_amount - applied, 2); end if;
  update public.supplier_payments set payment_number = num, paid_through = nullif(trim(p_paid_through), '')
   where tenant_id = t and supplier_id = p_supplier and recorded_by is not distinct from auth.uid() and created_at >= started and payment_number is null;
  return num;
end $$;
grant execute on function public.record_vendor_payment(uuid, numeric, text, text, date, text, text, jsonb) to authenticated;
