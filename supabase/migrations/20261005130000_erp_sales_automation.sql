-- JMSURF DASH, part 3: what happens automatically after a sale.
--  * customers get first/last purchase dates
--  * items with a repurchase interval schedule a reminder for the customer
--  * a POS credit sale becomes an invoice (debts, due dates and alerts run on invoices)
--  * find-or-create a customer by phone (first-time customers at the till / shop)

/** Same phone, any format: last 9 digits (07xx…, +2547xx…, 2547xx…). */
create or replace function public.phone_key(p text) returns text language sql immutable as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9)
$$;
create index if not exists customers_phone_key_idx on public.customers (tenant_id, public.phone_key(phone));

/**
 * The customer with this phone number in the caller's shop, created on the spot
 * when they are new. Returns the customer id.
 */
create or replace function public.customer_find_or_create(p_phone text, p_name text default null, p_source text default 'pos', p_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id(); k text := public.phone_key(p_phone); cid uuid; nice text;
begin
  if t is null then raise exception 'No shop for this account'; end if;
  if length(k) < 9 then raise exception 'Enter a full phone number'; end if;
  select id into cid from public.customers where tenant_id = t and public.phone_key(phone) = k order by created_at limit 1;
  if cid is not null then
    if coalesce(trim(p_name), '') <> '' then
      update public.customers set name = trim(p_name) where id = cid and (name is null or name ~ '^Customer [0-9 ]+$');
    end if;
    return cid;
  end if;
  nice := '0' || substr(k, 1, 3) || ' ' || substr(k, 4, 3) || ' ' || substr(k, 7, 3);
  insert into public.customers (tenant_id, name, phone, email, source)
    values (t, coalesce(nullif(trim(p_name), ''), 'Customer ' || nice), '0' || k, nullif(trim(coalesce(p_email, '')), ''), coalesce(p_source, 'pos'))
    returning id into cid;
  return cid;
end $$;
revoke all on function public.customer_find_or_create(text, text, text, text) from public, anon;
grant execute on function public.customer_find_or_create(text, text, text, text) to authenticated, service_role;

/** After a completed sale: purchase dates and repurchase reminders. */
create or replace function public.after_sale_completed() returns trigger
language plpgsql security definer set search_path = public as $$
declare it jsonb; pid uuid; days int; pname text;
begin
  if new.status <> 'completed' or new.customer_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'completed' and old.customer_id is not distinct from new.customer_id then return new; end if;

  update public.customers set
    first_purchase_at = coalesce(first_purchase_at, new.created_at),
    last_purchase_at = greatest(coalesce(last_purchase_at, new.created_at), new.created_at)
  where id = new.customer_id;

  for it in select value from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) loop
    begin
      pid := nullif(coalesce(it->>'product_id', it->>'id'), '')::uuid;
    exception when others then pid := null;
    end;
    continue when pid is null;
    select repurchase_days, name into days, pname from public.products where id = pid;
    if days is null then
      select repurchase_days, name into days, pname from public.services where id = pid;
    end if;
    continue when days is null or days <= 0;
    insert into public.customer_reminders (tenant_id, customer_id, kind, product_id, product_name, transaction_id, due_date, title, sales_rep_id, created_by)
      values (new.tenant_id, new.customer_id, 'repurchase', pid, coalesce(pname, it->>'name'), new.id,
              (new.created_at at time zone 'Africa/Nairobi')::date + days,
              'Time to restock ' || coalesce(pname, it->>'name'), new.sales_rep_id, new.cashier_id)
      on conflict do nothing;
  end loop;
  return new;
end $$;
drop trigger if exists after_sale_completed on public.transactions;
create trigger after_sale_completed after insert or update of status, customer_id on public.transactions
  for each row execute function public.after_sale_completed();

/**
 * A credit (pay later) sale becomes an invoice so it appears under Debts with
 * its due date. Idempotent: one invoice per sale.
 */
create or replace function public.pos_credit_invoice(p_transaction uuid, p_due date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare tx public.transactions; inv uuid; c public.customers; due date; items jsonb;
begin
  select * into tx from public.transactions where id = p_transaction;
  if not found then raise exception 'Sale not found'; end if;
  if tx.tenant_id <> public.current_user_tenant_id() and auth.uid() is not null then raise exception 'Not allowed'; end if;
  if tx.customer_id is null then raise exception 'A credit sale needs a customer'; end if;
  select id into inv from public.invoices where transaction_id = tx.id limit 1;
  if inv is not null then return inv; end if;
  select * into c from public.customers where id = tx.customer_id;
  due := coalesce(p_due, tx.due_date, current_date + greatest(coalesce(c.credit_days, 0), 0));
  select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', coalesce(i->>'product_id', i->>'id'), 'type', 'product', 'name', i->>'name',
      'quantity', coalesce((i->>'quantity')::numeric, 1), 'rate', coalesce((i->>'price')::numeric, 0),
      'price', coalesce((i->>'price')::numeric, 0), 'discount', 0, 'tax_rate', 0,
      'amount', coalesce((i->>'quantity')::numeric, 1) * coalesce((i->>'price')::numeric, 0))), '[]'::jsonb)
    into items from jsonb_array_elements(coalesce(tx.items, '[]'::jsonb)) i;
  insert into public.invoices (tenant_id, invoice_number, customer_id, customer_name, customer_email, customer_phone, items,
      subtotal, tax, discount, total, status, issue_date, due_date, payment_terms, salesperson_id, salesperson_name,
      reference, source, transaction_id, created_by, customer_notes)
    values (tx.tenant_id, public.next_doc_number('invoice', tx.tenant_id), tx.customer_id, coalesce(c.name, tx.customer_name), c.email, c.phone, items,
      coalesce(tx.subtotal, tx.total), 0, coalesce(tx.discount, 0), tx.total, 'sent',
      (tx.created_at at time zone 'Africa/Nairobi')::date, due, 'Credit sale', tx.sales_rep_id, tx.sales_rep_name,
      'POS ' || left(tx.id::text, 8), 'pos', tx.id, tx.cashier_id, 'Goods taken on credit at the shop.')
    returning id into inv;
  update public.transactions set invoice_id = inv, due_date = due where id = tx.id;
  return inv;
end $$;
revoke all on function public.pos_credit_invoice(uuid, date) from public, anon;
grant execute on function public.pos_credit_invoice(uuid, date) to authenticated, service_role;

-- A customer's old shop-ledger balance shrinks when they pay a POS credit invoice.
create or replace function public.payment_allocations_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
declare src text; cust uuid;
begin
  select source, customer_id into src, cust from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if src = 'pos' and cust is not null then
    if tg_op = 'INSERT' then update public.customers set balance = greatest(coalesce(balance, 0) - new.amount, 0) where id = cust;
    elsif tg_op = 'DELETE' then update public.customers set balance = coalesce(balance, 0) + old.amount where id = cust;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists payment_allocations_ledger on public.payment_allocations;
create trigger payment_allocations_ledger after insert or delete on public.payment_allocations
  for each row execute function public.payment_allocations_ledger();

/** Debts: every unpaid invoice with how long it has been owed. */
create or replace view public.debts_view with (security_invoker = true) as
  select i.id as invoice_id, i.tenant_id, i.invoice_number, i.customer_id, i.customer_name, i.customer_phone,
         i.issue_date, i.due_date, i.total, i.amount_paid, i.total - i.amount_paid as balance, i.status, i.source,
         i.salesperson_id, i.salesperson_name, i.transaction_id,
         (current_date - i.issue_date) as age_days,
         case when i.due_date is null then 0 else (current_date - i.due_date) end as days_overdue
    from public.invoices i
   where i.status not in ('draft', 'void', 'paid') and i.total - i.amount_paid > 0.005;
grant select on public.debts_view to authenticated;
