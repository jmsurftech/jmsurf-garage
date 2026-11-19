-- Record payment with the split chosen on screen: how much goes to each invoice.
-- Anything not applied to an invoice stays with the customer as credit (unapplied).
create or replace function public.record_customer_payment_split(
  p_customer uuid, p_amount numeric, p_method text, p_reference text default null, p_notes text default null,
  p_date date default current_date, p_allocations jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.current_user_tenant_id();
  pay_id uuid; a jsonb; inv record; take numeric; applied numeric := 0; cname text; who text;
begin
  if t is null then raise exception 'No shop for this account'; end if;
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager') or public.has_role(auth.uid(), 'cashier')) then
    raise exception 'Not allowed';
  end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  select name into cname from public.customers where id = p_customer and tenant_id = t;
  if cname is null then raise exception 'Customer not found'; end if;
  -- The split can never be more than the money received.
  select coalesce(sum(greatest(0, (x ->> 'amount')::numeric)), 0) into applied from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) x;
  if applied > p_amount + 0.005 then raise exception 'The amounts applied to invoices (%) are more than the payment (%)', applied, p_amount; end if;
  select display_name into who from public.profiles where user_id = auth.uid();
  insert into public.payments_received (tenant_id, payment_number, customer_id, customer_name, payment_date, amount, method, reference, notes, received_by, received_by_name)
    values (t, public.next_doc_number('payment', t), p_customer, cname, coalesce(p_date, current_date), p_amount, coalesce(nullif(p_method, ''), 'cash'), p_reference, p_notes, auth.uid(), who)
    returning id into pay_id;
  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    take := round(greatest(0, (a ->> 'amount')::numeric), 2);
    continue when take <= 0;
    select id, invoice_number, total - amount_paid as due into inv from public.invoices
     where id = (a ->> 'invoice_id')::uuid and tenant_id = t and customer_id = p_customer and status not in ('draft', 'void');
    if not found then raise exception 'An invoice in the split does not belong to this customer'; end if;
    if take > inv.due + 0.005 then raise exception 'Invoice % owes %, less than %', inv.invoice_number, round(inv.due, 2), take; end if;
    insert into public.payment_allocations (tenant_id, payment_id, invoice_id, amount) values (t, pay_id, inv.id, take);
  end loop;
  return pay_id;
end $$;
grant execute on function public.record_customer_payment_split(uuid, numeric, text, text, text, date, jsonb) to authenticated;
