-- (Monthly figures in one pass over the year's lines.)
-- Dashboard "Books overview" (the other system's home dashboard): receivables and
-- payables by age, cash flow, income and expense by month, top expenses and bank
-- balances for the signed-in user's company. Runs with the caller's rights (RLS).
create or replace function public.dash_books_overview(p_year int default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  t uuid := public.current_user_tenant_id();
  y int := coalesce(p_year, extract(year from current_date)::int);
  y0 date := make_date(y, 1, 1); y1 date := make_date(y, 12, 31);
  res jsonb;
begin
  if t is null then return '{}'::jsonb; end if;
  with
  inv as (
    select greatest(total - amount_paid, 0) due, current_date - coalesce(due_date, issue_date, created_at::date) late
    from invoices where tenant_id = t and status not in ('draft', 'void', 'paid') and total - amount_paid > 0.005),
  bil as (
    select greatest(amount - amount_paid, 0) due, current_date - coalesce(due_date, bill_date) late
    from bills where tenant_id = t and status not in ('draft', 'void', 'paid') and amount - amount_paid > 0.005),
  lines as (
    select l.line_date, l.debit, l.credit, a.type, a.sub_type, a.name, a.id account_id
    from journal_lines l join chart_of_accounts a on a.id = l.account_id
    where l.tenant_id = t),
  months as (select generate_series(1, 12) m)
  select jsonb_build_object(
    'year', y,
    'receivables', (select jsonb_build_object(
        'total', coalesce(sum(due), 0), 'current', coalesce(sum(due) filter (where late <= 0), 0),
        'd1_15', coalesce(sum(due) filter (where late between 1 and 15), 0), 'd16_30', coalesce(sum(due) filter (where late between 16 and 30), 0),
        'd31_45', coalesce(sum(due) filter (where late between 31 and 45), 0), 'd45', coalesce(sum(due) filter (where late > 45), 0), 'count', count(*)) from inv),
    'payables', (select jsonb_build_object(
        'total', coalesce(sum(due), 0), 'current', coalesce(sum(due) filter (where late <= 0), 0),
        'd1_15', coalesce(sum(due) filter (where late between 1 and 15), 0), 'd16_30', coalesce(sum(due) filter (where late between 16 and 30), 0),
        'd31_45', coalesce(sum(due) filter (where late between 31 and 45), 0), 'd45', coalesce(sum(due) filter (where late > 45), 0), 'count', count(*)) from bil),
    'cash_start', (select coalesce(sum(debit - credit), 0) from lines where sub_type in ('bank', 'cash') and line_date < y0),
    'monthly', (select jsonb_agg(jsonb_build_object('m', mo.m, 'cash_in', coalesce(a.cash_in, 0), 'cash_out', coalesce(a.cash_out, 0),
        'income', coalesce(a.income, 0), 'expense', coalesce(a.expense, 0)) order by mo.m)
      from months mo left join (
        select extract(month from line_date)::int m,
          sum(debit) filter (where sub_type in ('bank', 'cash')) cash_in, sum(credit) filter (where sub_type in ('bank', 'cash')) cash_out,
          sum(credit - debit) filter (where type = 'income') income, sum(debit - credit) filter (where type = 'expense') expense
        from lines where line_date between y0 and y1 group by 1) a on a.m = mo.m),
    'top_expenses', (select coalesce(jsonb_agg(x order by x.amount desc), '[]'::jsonb) from (
        select name, sum(debit - credit) amount from lines where type = 'expense' and line_date between y0 and y1
        group by name having sum(debit - credit) > 0 order by 2 desc limit 6) x),
    'banks', (select coalesce(jsonb_agg(x order by x.balance desc), '[]'::jsonb) from (
        select a.name, a.sub_type, coalesce(sum(l.debit - l.credit), 0) balance
        from chart_of_accounts a left join journal_lines l on l.account_id = a.id
        where a.tenant_id = t and a.sub_type in ('bank', 'cash') and a.is_active
        group by a.id, a.name, a.sub_type) x)
  ) into res;
  return res;
end $$;
grant execute on function public.dash_books_overview(int) to authenticated;

create index if not exists journal_lines_tenant_date_idx on public.journal_lines (tenant_id, line_date);
create index if not exists products_tenant_active_name_idx on public.products (tenant_id, is_active, name);
