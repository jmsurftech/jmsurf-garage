-- JMSURF DASH: one row per item sold, for the dashboard and reports.
-- Till / online sales (completed transactions) plus invoices raised outside the
-- till (quotes, manual). POS credit invoices are not counted twice.
create or replace function public.sales_lines(p_from date, p_to date)
returns table (
  sale_date date, sale_hour int, source text, ref_id uuid, customer_id uuid, customer_name text,
  rep_id uuid, rep_name text, item_id uuid, item_name text, category text, subcategory text, brand text,
  qty numeric, revenue numeric, cost numeric, payment_method text
) language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id();
begin
  if t is null then raise exception 'No shop for this account'; end if;
  return query
  select (x.created_at at time zone 'Africa/Nairobi')::date,
         extract(hour from x.created_at at time zone 'Africa/Nairobi')::int,
         case when x.payment_method = 'online' then 'online' else 'pos' end,
         x.id, x.customer_id, coalesce(x.customer_name, 'Walk-in'), x.sales_rep_id, x.sales_rep_name,
         coalesce(p.id, s.id), coalesce(it->>'name', p.name, s.name),
         coalesce(nullif(p.category, ''), nullif(s.category, ''), 'Uncategorised'), nullif(p.subcategory, ''), p.brand,
         coalesce((it->>'quantity')::numeric, 1),
         coalesce((it->>'price')::numeric, 0) * coalesce((it->>'quantity')::numeric, 1)
           * case when coalesce(x.subtotal, 0) > 0 then least(greatest(x.total / x.subtotal, 0), 1) else 1 end,
         coalesce((it->>'cost_price')::numeric, p.cost_price, s.cost_price, 0) * coalesce((it->>'quantity')::numeric, 1),
         x.payment_method
    from public.transactions x
    cross join lateral jsonb_array_elements(coalesce(x.items, '[]'::jsonb)) it
    left join public.products p on p.id::text = coalesce(it->>'product_id', it->>'id')
    left join public.services s on s.id::text = coalesce(it->>'product_id', it->>'id')
   where x.tenant_id = t and x.status = 'completed'
     and (x.created_at at time zone 'Africa/Nairobi')::date between p_from and p_to
  union all
  select i.issue_date, 12, 'invoice', i.id, i.customer_id, i.customer_name, i.salesperson_id, i.salesperson_name,
         coalesce(p.id, s.id), coalesce(it->>'name', p.name, s.name),
         coalesce(nullif(p.category, ''), nullif(s.category, ''), 'Uncategorised'), nullif(p.subcategory, ''), p.brand,
         coalesce((it->>'quantity')::numeric, 1),
         coalesce((it->>'amount')::numeric, coalesce((it->>'rate')::numeric, (it->>'price')::numeric, 0) * coalesce((it->>'quantity')::numeric, 1)),
         coalesce(p.cost_price, s.cost_price, 0) * coalesce((it->>'quantity')::numeric, 1),
         'invoice'
    from public.invoices i
    cross join lateral jsonb_array_elements(coalesce(i.items, '[]'::jsonb)) it
    left join public.products p on p.id::text = coalesce(it->>'item_id', it->>'product_id')
    left join public.services s on s.id::text = coalesce(it->>'item_id', it->>'product_id')
   where i.tenant_id = t and i.source <> 'pos' and i.status not in ('draft', 'void')
     and i.issue_date between p_from and p_to;
end $$;
revoke all on function public.sales_lines(date, date) from public, anon;
grant execute on function public.sales_lines(date, date) to authenticated;
