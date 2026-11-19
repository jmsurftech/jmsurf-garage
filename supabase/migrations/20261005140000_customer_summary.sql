-- Per-customer totals for the Customers list, detail page and customer portal.
create or replace view public.customer_summary with (security_invoker = true) as
  select c.id as customer_id, c.tenant_id,
         coalesce(t.total_purchases, 0) as total_purchases,
         coalesce(t.purchase_count, 0) as purchase_count,
         t.last_purchase_at,
         coalesce(d.receivables, 0) as receivables,
         coalesce(d.overdue, 0) as overdue
    from public.customers c
    left join lateral (
      select sum(x.total) filter (where x.status = 'completed') as total_purchases,
             count(*) filter (where x.status = 'completed') as purchase_count,
             max(x.created_at) filter (where x.status = 'completed') as last_purchase_at
        from public.transactions x where x.customer_id = c.id
    ) t on true
    left join lateral (
      select sum(i.total - i.amount_paid) as receivables,
             sum(i.total - i.amount_paid) filter (where i.due_date < current_date) as overdue
        from public.invoices i
       where i.customer_id = c.id and i.status not in ('draft', 'void', 'paid') and i.total - i.amount_paid > 0.005
    ) d on true;
grant select on public.customer_summary to authenticated;
create index if not exists transactions_customer_idx on public.transactions (customer_id, status);
