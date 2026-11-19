-- The public demo showed a loss and negative cash: its opening stock never reached
-- the ledger and every bank account started at zero. demo_books() (run by the
-- server right after demo_reset) posts opening balances and six months of till
-- takings, cost of sales and running costs, so the books look like a real,
-- healthy trading company. Journals use fixed ids, so running it twice is safe.

create or replace function public.demo_books() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_t uuid := (select id from public.tenants where slug = 'demo' limit 1);
  acc_bank uuid; acc_mpesa uuid; acc_cash uuid; acc_stock uuid; acc_equity uuid; acc_sales uuid; acc_cogs uuid; acc_net uuid; acc_fuel uuid;
  open_stock numeric; m int; d date; s numeric; n int := 0;
  acc_of text := 'select id from public.chart_of_accounts where tenant_id = $1 and name = $2 limit 1';
  sid uuid;
begin
  if v_t is null then return 'no demo company'; end if;
  execute acc_of into acc_bank using v_t, 'Bank account';
  execute acc_of into acc_mpesa using v_t, 'M-Pesa';
  execute acc_of into acc_cash using v_t, 'Cash on hand';
  execute acc_of into acc_stock using v_t, 'Inventory asset';
  execute acc_of into acc_equity using v_t, 'Opening balance equity';
  execute acc_of into acc_sales using v_t, 'Sales';
  execute acc_of into acc_cogs using v_t, 'Cost of goods sold';
  execute acc_of into acc_net using v_t, 'Internet';
  execute acc_of into acc_fuel using v_t, 'Fuel';
  if acc_bank is null or acc_mpesa is null or acc_cash is null or acc_stock is null or acc_equity is null or acc_sales is null or acc_cogs is null then
    return 'demo chart of accounts incomplete';
  end if;

  -- A test account once left in the demo by a move-in check.
  delete from public.chart_of_accounts a where a.tenant_id = v_t and a.name = 'MoveIn Test Bank'
    and not exists (select 1 from public.journal_lines l where l.account_id = a.id);

  -- Opening balances, the day before the first month shown. Stock at cost from the demo items.
  open_stock := greatest(coalesce((select sum(greatest(stock, 0) * coalesce(cost_price, 0)) from public.products where tenant_id = v_t), 0), 0) + 40000;
  d := (date_trunc('month', current_date) - interval '6 months')::date - 1;
  sid := md5('demo-opening')::uuid;
  perform public.acc_post(v_t, 'demo_opening', sid, d, 'OPENING', 'Opening balances', jsonb_build_array(
    jsonb_build_object('account_id', acc_bank, 'debit', 420000, 'description', 'Opening balance'),
    jsonb_build_object('account_id', acc_mpesa, 'debit', 85000, 'description', 'Opening balance'),
    jsonb_build_object('account_id', acc_cash, 'debit', 18000, 'description', 'Opening balance'),
    jsonb_build_object('account_id', acc_stock, 'debit', open_stock, 'description', 'Opening stock'),
    jsonb_build_object('account_id', acc_equity, 'credit', 523000 + open_stock, 'description', 'Opening balances')));

  -- Six months of till takings (M-Pesa and cash), their cost, banking and running costs.
  for m in 1..6 loop
    d := (date_trunc('month', current_date) - make_interval(months => 7 - m))::date + 24;
    s := 160000 + 18000 * ((m * 7) % 5);
    sid := md5('demo-sales-' || m)::uuid;
    perform public.acc_post(v_t, 'demo_sales', sid, d, 'TILL-' || to_char(d, 'YYYYMM'), 'Till takings for ' || to_char(d, 'FMMonth YYYY'), jsonb_build_array(
      jsonb_build_object('account_id', acc_mpesa, 'debit', round(s * 0.7), 'description', 'M-Pesa takings'),
      jsonb_build_object('account_id', acc_cash, 'debit', s - round(s * 0.7), 'description', 'Cash takings'),
      jsonb_build_object('account_id', acc_sales, 'credit', s, 'description', 'Till sales'),
      jsonb_build_object('account_id', acc_cogs, 'debit', round(s * 0.58), 'description', 'Cost of goods sold'),
      jsonb_build_object('account_id', acc_stock, 'credit', round(s * 0.58), 'description', 'Stock sold')));
    sid := md5('demo-costs-' || m)::uuid;
    perform public.acc_post(v_t, 'demo_costs', sid, d + 2, 'BANK-' || to_char(d, 'YYYYMM'), 'Banking and running costs', jsonb_build_array(
      jsonb_build_object('account_id', acc_bank, 'debit', round(s * 0.55), 'description', 'M-Pesa swept to bank'),
      jsonb_build_object('account_id', acc_mpesa, 'credit', round(s * 0.55), 'description', 'M-Pesa swept to bank'),
      jsonb_build_object('account_id', acc_bank, 'debit', s - round(s * 0.7) - 2000, 'description', 'Till cash banked'),
      jsonb_build_object('account_id', acc_cash, 'credit', s - round(s * 0.7) - 2000, 'description', 'Till cash banked'),
      jsonb_build_object('account_id', coalesce(acc_net, acc_cogs), 'debit', 5000, 'description', 'Internet'),
      jsonb_build_object('account_id', coalesce(acc_fuel, acc_cogs), 'debit', 9000, 'description', 'Delivery fuel'),
      jsonb_build_object('account_id', acc_bank, 'credit', 14000, 'description', 'Running costs')));
    -- Restock so the stock account stays healthy.
    sid := md5('demo-restock-' || m)::uuid;
    perform public.acc_post(v_t, 'demo_restock', sid, d + 3, 'RESTOCK-' || to_char(d, 'YYYYMM'), 'Stock bought for cash', jsonb_build_array(
      jsonb_build_object('account_id', acc_stock, 'debit', round(s * 0.5), 'description', 'Restock'),
      jsonb_build_object('account_id', acc_bank, 'credit', round(s * 0.5), 'description', 'Restock')));
    n := n + 1;
  end loop;
  -- CRM: the pipeline opens on "My pipeline", so give the sample deals to the demo login, spread over stages.
  update public.crm_leads l set
    salesperson_id = coalesce(l.salesperson_id, (select p.user_id from public.profiles p where p.tenant_id = v_t order by p.created_at limit 1)),
    stage_id = coalesce(l.stage_id, (select st.id from public.crm_stages st where st.tenant_id = v_t
      order by st.sequence offset (case when l.probability >= 50 then 2 when l.probability >= 20 then 1 else 0 end) limit 1))
  where l.tenant_id = v_t;
  -- Its package shows the real All-in-One price and limits (prospects read the Billing page).
  update public.subscriptions s set price = p.price_monthly, max_users = p.max_users, max_locations = p.max_locations, plan_name = p.name
    from public.plans p where s.tenant_id = v_t and p.id = s.plan_id;
  return 'demo books: opening + ' || n || ' months';
end $$;
revoke all on function public.demo_books() from public, anon, authenticated;
grant execute on function public.demo_books() to service_role;
