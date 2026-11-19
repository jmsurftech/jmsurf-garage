-- JMSURF DASH: sales rep commission.
-- One row per sale a rep made (till sales and invoices), with the commission
-- worked out per item category and how much of it is earned (money collected).

/** Commission % for a rep and an item category: rep+category, any rep+category, rep default, else 0. */
create or replace function public.commission_pct(p_tenant uuid, p_rep uuid, p_category text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select pct from public.commission_rules where tenant_id = p_tenant and rep_id = p_rep and category = p_category limit 1),
    (select pct from public.commission_rules where tenant_id = p_tenant and rep_id is null and category = p_category limit 1),
    (select pct from public.commission_rules where tenant_id = p_tenant and rep_id = p_rep and category is null limit 1),
    (select default_commission_pct from public.sales_reps where user_id = p_rep and tenant_id = p_tenant),
    (select pct from public.commission_rules where tenant_id = p_tenant and rep_id is null and category is null limit 1),
    0)
$$;

create or replace function public.rep_sales(p_from date, p_to date, p_rep uuid default null)
returns table (
  rep_id uuid, rep_name text, source text, ref_id uuid, ref text, sale_date date, customer_id uuid, customer_name text,
  customer_phone text, amount numeric, paid numeric, balance numeric, due_date date, status text, commission numeric, commission_earned numeric
) language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id();
begin
  if t is null then raise exception 'No shop for this account'; end if;
  -- A sales rep only ever sees their own sales.
  if public.has_role(auth.uid(), 'sales_person') and not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')) then
    p_rep := auth.uid();
  end if;
  return query
  with tx as (
    select x.*, i.id as inv_id, i.amount_paid as inv_paid, i.total as inv_total, i.status as inv_status
      from public.transactions x
      left join public.invoices i on i.id = x.invoice_id
     where x.tenant_id = t and x.sales_rep_id is not null and x.status = 'completed'
       and (x.created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
       and (p_rep is null or x.sales_rep_id = p_rep)
  ), tx_lines as (
    select tx.id, sum(coalesce((it->>'price')::numeric, 0) * coalesce((it->>'quantity')::numeric, 1)
                      * public.commission_pct(t, tx.sales_rep_id, coalesce(p.category, s.category)) / 100) as comm
      from tx
      cross join lateral jsonb_array_elements(coalesce(tx.items, '[]'::jsonb)) it
      left join public.products p on p.id::text = coalesce(it->>'product_id', it->>'id')
      left join public.services s on s.id::text = coalesce(it->>'product_id', it->>'id')
     group by tx.id
  ), inv as (
    select i.* from public.invoices i
     where i.tenant_id = t and i.salesperson_id is not null and i.source <> 'pos' and i.status not in ('draft', 'void')
       and i.issue_date between p_from and p_to and (p_rep is null or i.salesperson_id = p_rep)
  ), inv_lines as (
    select inv.id, sum(coalesce((it->>'amount')::numeric, coalesce((it->>'rate')::numeric, (it->>'price')::numeric, 0) * coalesce((it->>'quantity')::numeric, 1))
                       * public.commission_pct(t, inv.salesperson_id, coalesce(p.category, s.category)) / 100) as comm
      from inv
      cross join lateral jsonb_array_elements(coalesce(inv.items, '[]'::jsonb)) it
      left join public.products p on p.id::text = coalesce(it->>'item_id', it->>'product_id')
      left join public.services s on s.id::text = coalesce(it->>'item_id', it->>'product_id')
     group by inv.id
  )
  select tx.sales_rep_id, coalesce(tx.sales_rep_name, r.display_name, pr.display_name), 'pos'::text, tx.id,
         coalesce(inv_number.n, 'Sale ' || left(tx.id::text, 8)), (tx.created_at at time zone 'Africa/Nairobi')::date,
         tx.customer_id, tx.customer_name, c.phone, tx.total,
         case when tx.inv_id is null then tx.total else coalesce(tx.inv_paid, 0) end,
         case when tx.inv_id is null then 0 else greatest(coalesce(tx.inv_total, tx.total) - coalesce(tx.inv_paid, 0), 0) end,
         tx.due_date,
         case when tx.inv_id is null then 'paid' else tx.inv_status end,
         round(coalesce(l.comm, 0), 2),
         round(coalesce(l.comm, 0) * case when tx.inv_id is null or coalesce(tx.inv_total, 0) = 0 then 1 else least(coalesce(tx.inv_paid, 0) / tx.inv_total, 1) end, 2)
    from tx
    left join tx_lines l on l.id = tx.id
    left join public.sales_reps r on r.user_id = tx.sales_rep_id
    left join public.profiles pr on pr.user_id = tx.sales_rep_id
    left join public.customers c on c.id = tx.customer_id
    left join lateral (select invoice_number as n from public.invoices where id = tx.inv_id) inv_number on true
  union all
  select inv.salesperson_id, coalesce(inv.salesperson_name, r.display_name, pr.display_name), 'invoice', inv.id, inv.invoice_number, inv.issue_date,
         inv.customer_id, inv.customer_name, coalesce(inv.customer_phone, c.phone), inv.total, inv.amount_paid,
         greatest(inv.total - inv.amount_paid, 0), inv.due_date, inv.status,
         round(coalesce(l.comm, 0), 2),
         round(coalesce(l.comm, 0) * case when inv.total = 0 then 1 else least(inv.amount_paid / inv.total, 1) end, 2)
    from inv
    left join inv_lines l on l.id = inv.id
    left join public.sales_reps r on r.user_id = inv.salesperson_id
    left join public.profiles pr on pr.user_id = inv.salesperson_id
    left join public.customers c on c.id = inv.customer_id;
end $$;
revoke all on function public.rep_sales(date, date, uuid) from public, anon;
grant execute on function public.rep_sales(date, date, uuid) to authenticated;
revoke all on function public.commission_pct(uuid, uuid, text) from public, anon;
grant execute on function public.commission_pct(uuid, uuid, text) to authenticated;
