-- Services have no stock: they no longer show as low stock on the dashboard or count towards stock value.
create or replace function public.dash_home(
  p_tenant uuid, p_from date, p_to date, p_prev_from date, p_prev_to date,
  p_since date, p_today date, p_week date, p_setup boolean default false
)
returns jsonb language sql stable security invoker set search_path = public as $$
  with
  open_bills as (
    select id, bill_number, due_date, amount, coalesce(amount_paid, 0) amount_paid
    from bills where tenant_id = p_tenant and status not in ('draft', 'void', 'paid')),
  stock as (
    select id, name, unit, coalesce(stock, 0) stock, coalesce(reorder_level, 0) reorder_level, cost_price, price
    from products where tenant_id = p_tenant and is_active = true and coalesce(product_type, '') <> 'service'),
  debts as (
    select invoice_id, invoice_number, customer_name, due_date, balance, days_overdue
    from debts_view where tenant_id = p_tenant),
  funnel_range as (
    select p_from::timestamptz lo, (p_to::text || 'T23:59:59')::timestamptz hi),
  -- Same month keys as the rows' own dates (sales: UTC, as the app received them).
  flows as (
    select to_char(payment_date, 'YYYY-MM') ym, amount money_in, 0::numeric money_out from payments_received where tenant_id = p_tenant and payment_date >= p_since
    union all
    select to_char(created_at at time zone 'UTC', 'YYYY-MM'), total, 0 from transactions where tenant_id = p_tenant and status = 'completed' and created_at >= p_since::timestamptz and payment_method <> 'credit'
    union all
    select to_char(paid_on, 'YYYY-MM'), 0, amount from supplier_payments where tenant_id = p_tenant and paid_on >= p_since
    union all
    select to_char(expense_date, 'YYYY-MM'), 0, amount from expenses where tenant_id = p_tenant and expense_date >= p_since)
  select jsonb_build_object(
    'payables', (select coalesce(sum(amount - amount_paid), 0) from open_bills),
    'stock_value', (select coalesce(sum(greatest(stock, 0) * coalesce(nullif(cost_price, 0), nullif(price, 0), 0)), 0) from stock),
    'approvals', (select count(*) from approval_requests where tenant_id = p_tenant and status = 'pending'),
    'web_orders', (select count(*) from online_orders where tenant_id = p_tenant and status in ('pending_payment', 'paid', 'processing', 'ready', 'out_for_delivery')),
    'overdue_list', (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from (select * from debts where days_overdue > 0 order by balance desc limit 5) d),
    'bills_due', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from (select id, bill_number, due_date, amount, amount_paid from open_bills where due_date <= p_week order by due_date limit 5) b),
    'owed', (select coalesce(sum(balance), 0) from debts),
    'overdue', (select coalesce(sum(balance) filter (where days_overdue > 0), 0) from debts),
    'reminders_due', (select count(*) from customer_reminders where tenant_id = p_tenant and status = 'scheduled' and due_date <= p_today),
    'low_stock_count', (select count(*) from stock where stock <= reorder_level),
    'low_stock', (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from (select id, name, stock, unit from stock where stock <= reorder_level order by stock limit 20) l),
    'funnel', (select jsonb_build_object(
      'quotes', (select count(*) from quotes, funnel_range r where tenant_id = p_tenant and created_at >= r.lo and created_at <= r.hi),
      'orders', (select count(*) from sales_orders, funnel_range r where tenant_id = p_tenant and created_at >= r.lo and created_at <= r.hi),
      'invoices', (select count(*) from invoices, funnel_range r where tenant_id = p_tenant and created_at >= r.lo and created_at <= r.hi and status <> 'void'),
      'paid', (select count(*) from invoices, funnel_range r where tenant_id = p_tenant and created_at >= r.lo and created_at <= r.hi and status = 'paid'))),
    'recent_invoices', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from (
      select id, invoice_number, customer_name, total, status, created_at from invoices
      where tenant_id = p_tenant and status <> 'void'
      order by issue_date desc nulls last, invoice_number desc, created_at desc limit 6) i),
    'recent_sales', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select id, customer_name, total, status, created_at from transactions
      where tenant_id = p_tenant order by created_at desc limit 6) t),
    'flows', (select coalesce(jsonb_agg(jsonb_build_object('ym', ym, 'in', money_in, 'out', money_out)), '[]'::jsonb) from (
      select ym, sum(money_in) money_in, sum(money_out) money_out from flows group by ym) f),
    'expenses', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'value', value)), '[]'::jsonb) from (
      select coalesce(nullif(category_name, ''), 'Other') as name, sum(amount) as value from expenses
      where tenant_id = p_tenant and expense_date >= p_since group by 1 order by 2 desc limit 6) e),
    'prev_revenue', (select coalesce(sum(revenue), 0) from public.sales_lines(p_prev_from, p_prev_to)),
    'get_started', case when p_setup then (select jsonb_build_object(
      'company', exists (select 1 from tenants where id = p_tenant and logo_url is not null and logo_url <> '')
        or exists (select 1 from business_settings where tenant_id = p_tenant and (coalesce(business_phone, '') <> '' or coalesce(tax_pin, '') <> '')),
      'data', exists (select 1 from customers),
      'modules', exists (select 1 from tenant_modules),
      'team', (select count(*) from (select 1 from profiles where tenant_id = p_tenant limit 2) x) > 1,
      'payments', exists (select 1 from business_settings where tenant_id = p_tenant and coalesce(payment_provider, 'none') not in ('', 'none')),
      'invoice', exists (select 1 from invoices))) end
  );
$$;
revoke all on function public.dash_home(uuid, date, date, date, date, date, date, date, boolean) from public, anon;
grant execute on function public.dash_home(uuid, date, date, date, date, date, date, date, boolean) to authenticated;
