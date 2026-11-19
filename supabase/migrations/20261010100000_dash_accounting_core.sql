-- JMSURF BOOKS accounting core (classic double entry).
--  * chart_of_accounts (seeded per company, Kenyan defaults)
--  * journals + journal_lines: every document posts itself (invoices, payments
--    received, credit notes, bills, payments made, vendor credits, expenses,
--    POS sales, sale returns) and manual journals; reposted on every change.
--  * bank_transactions (statement lines to categorise / match), budgets
--  * transaction locking (business_settings.erp_settings.lock_date)
--  * report functions: account balances, trial balance, general ledger.
-- Posting never blocks a document: a failure is logged in accounting_errors.

create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  code text,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'income', 'expense')),
  sub_type text not null default 'other',
  system_key text,
  parent_id uuid references public.chart_of_accounts(id) on delete set null,
  description text,
  currency text,
  bank_name text,
  account_number text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, system_key)
);
create index if not exists coa_tenant_idx on public.chart_of_accounts (tenant_id, type);

create table if not exists public.journals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  journal_number text,
  journal_date date not null default current_date,
  reference text,
  notes text,
  status text not null default 'posted' check (status in ('draft', 'posted')),
  source_type text not null default 'manual',
  source_id uuid,
  currency text,
  total numeric(16,2) not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists journals_source_uidx on public.journals (tenant_id, source_type, source_id) where source_id is not null;
create index if not exists journals_date_idx on public.journals (tenant_id, journal_date);

create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.journals(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null references public.chart_of_accounts(id),
  description text,
  debit numeric(16,2) not null default 0 check (debit >= 0),
  credit numeric(16,2) not null default 0 check (credit >= 0),
  contact_type text,
  contact_id uuid,
  line_date date not null default current_date
);
create index if not exists journal_lines_account_idx on public.journal_lines (tenant_id, account_id, line_date);
create index if not exists journal_lines_journal_idx on public.journal_lines (journal_id);

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  account_id uuid not null references public.chart_of_accounts(id) on delete cascade,
  txn_date date not null,
  description text,
  reference text,
  payee text,
  amount numeric(16,2) not null,
  status text not null default 'uncategorized' check (status in ('uncategorized', 'categorized', 'matched', 'excluded')),
  journal_id uuid references public.journals(id) on delete set null,
  category_account_id uuid references public.chart_of_accounts(id) on delete set null,
  import_batch text,
  created_at timestamptz not null default now()
);
create index if not exists bank_tx_account_idx on public.bank_transactions (tenant_id, account_id, txn_date);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_user_tenant_id() references public.tenants(id) on delete cascade,
  name text not null,
  fiscal_year int not null,
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounting_errors (
  id bigint generated always as identity primary key,
  tenant_id uuid,
  source_type text,
  source_id uuid,
  message text,
  created_at timestamptz not null default now()
);

-- RLS: a company sees and edits its own books; system journals are written by the posting functions.
do $$
declare t text;
begin
  foreach t in array array['chart_of_accounts', 'journals', 'journal_lines', 'bank_transactions', 'budgets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (tenant_id = public.current_user_tenant_id())', t || '_select', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
drop policy if exists coa_write on public.chart_of_accounts;
create policy coa_write on public.chart_of_accounts for all
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))
  with check (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')));
grant insert, update, delete on public.chart_of_accounts to authenticated;
drop policy if exists bank_tx_write on public.bank_transactions;
create policy bank_tx_write on public.bank_transactions for all
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))
  with check (tenant_id = public.current_user_tenant_id());
grant insert, update, delete on public.bank_transactions to authenticated;
drop policy if exists budgets_write on public.budgets;
create policy budgets_write on public.budgets for all
  using (tenant_id = public.current_user_tenant_id() and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')))
  with check (tenant_id = public.current_user_tenant_id());
grant insert, update, delete on public.budgets to authenticated;
alter table public.accounting_errors enable row level security;
drop policy if exists accounting_errors_select on public.accounting_errors;
create policy accounting_errors_select on public.accounting_errors for select using (tenant_id = public.current_user_tenant_id());
grant select on public.accounting_errors to authenticated;

-- ── Default chart of accounts ────────────────────────────────────────────
create or replace function public.acc_seed(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.chart_of_accounts (tenant_id, code, name, type, sub_type, system_key) values
    (p_tenant, '1000', 'Cash on hand', 'asset', 'cash', 'cash'),
    (p_tenant, '1010', 'M-Pesa', 'asset', 'cash', 'mpesa'),
    (p_tenant, '1020', 'Bank account', 'asset', 'bank', 'bank'),
    (p_tenant, '1030', 'Undeposited funds', 'asset', 'other_current_asset', 'undeposited'),
    (p_tenant, '1100', 'Accounts receivable', 'asset', 'accounts_receivable', 'ar'),
    (p_tenant, '1200', 'Inventory asset', 'asset', 'inventory', 'inventory'),
    (p_tenant, '1300', 'Prepaid expenses', 'asset', 'other_current_asset', null),
    (p_tenant, '1310', 'VAT input (recoverable)', 'asset', 'other_current_asset', 'vat_in'),
    (p_tenant, '1320', 'Withholding tax receivable', 'asset', 'other_current_asset', 'wht_in'),
    (p_tenant, '1400', 'Employee advances', 'asset', 'other_current_asset', 'advances'),
    (p_tenant, '1500', 'Furniture & fittings', 'asset', 'fixed_asset', null),
    (p_tenant, '1510', 'Motor vehicles', 'asset', 'fixed_asset', null),
    (p_tenant, '1520', 'Computers & equipment', 'asset', 'fixed_asset', null),
    (p_tenant, '1590', 'Accumulated depreciation', 'asset', 'fixed_asset', 'acc_depreciation'),
    (p_tenant, '2000', 'Accounts payable', 'liability', 'accounts_payable', 'ap'),
    (p_tenant, '2100', 'VAT payable', 'liability', 'other_current_liability', 'vat_out'),
    (p_tenant, '2110', 'PAYE payable', 'liability', 'other_current_liability', 'paye'),
    (p_tenant, '2120', 'NSSF payable', 'liability', 'other_current_liability', 'nssf'),
    (p_tenant, '2130', 'SHIF payable', 'liability', 'other_current_liability', 'shif'),
    (p_tenant, '2140', 'Housing levy payable', 'liability', 'other_current_liability', 'housing_levy'),
    (p_tenant, '2150', 'Withholding tax payable', 'liability', 'other_current_liability', 'wht_out'),
    (p_tenant, '2160', 'Net salaries payable', 'liability', 'other_current_liability', 'salaries_payable'),
    (p_tenant, '2200', 'Accrued expenses', 'liability', 'other_current_liability', null),
    (p_tenant, '2300', 'Customer deposits', 'liability', 'other_current_liability', 'deposits'),
    (p_tenant, '2400', 'Loans', 'liability', 'long_term_liability', null),
    (p_tenant, '3000', 'Owner''s capital', 'equity', 'equity', 'capital'),
    (p_tenant, '3100', 'Opening balance equity', 'equity', 'equity', 'opening_equity'),
    (p_tenant, '3200', 'Retained earnings', 'equity', 'equity', 'retained'),
    (p_tenant, '3300', 'Drawings', 'equity', 'equity', 'drawings'),
    (p_tenant, '4000', 'Sales', 'income', 'income', 'sales'),
    (p_tenant, '4010', 'Service income', 'income', 'income', 'services'),
    (p_tenant, '4100', 'Sales returns & discounts', 'income', 'income', 'sales_returns'),
    (p_tenant, '4200', 'Other income', 'income', 'other_income', 'other_income'),
    (p_tenant, '4300', 'Discount received', 'income', 'other_income', 'discount_received'),
    (p_tenant, '5000', 'Cost of goods sold', 'expense', 'cost_of_goods_sold', 'cogs'),
    (p_tenant, '5010', 'Purchases', 'expense', 'cost_of_goods_sold', 'purchases'),
    (p_tenant, '6000', 'Salaries & wages', 'expense', 'expense', 'salaries'),
    (p_tenant, '6005', 'Employer NSSF & levies', 'expense', 'expense', 'employer_costs'),
    (p_tenant, '6010', 'Rent', 'expense', 'expense', null),
    (p_tenant, '6020', 'Utilities', 'expense', 'expense', null),
    (p_tenant, '6030', 'Transport', 'expense', 'expense', null),
    (p_tenant, '6040', 'Marketing', 'expense', 'expense', null),
    (p_tenant, '6050', 'Bank charges', 'expense', 'expense', 'bank_charges'),
    (p_tenant, '6060', 'M-Pesa charges', 'expense', 'expense', 'mpesa_charges'),
    (p_tenant, '6070', 'Repairs & maintenance', 'expense', 'expense', null),
    (p_tenant, '6080', 'Insurance', 'expense', 'expense', null),
    (p_tenant, '6090', 'Depreciation', 'expense', 'expense', 'depreciation'),
    (p_tenant, '6100', 'Office supplies', 'expense', 'expense', null),
    (p_tenant, '6110', 'Telephone & internet', 'expense', 'expense', null),
    (p_tenant, '6120', 'Professional fees', 'expense', 'expense', null),
    (p_tenant, '6130', 'Travel', 'expense', 'expense', null),
    (p_tenant, '6140', 'Licences & permits', 'expense', 'expense', null),
    (p_tenant, '6150', 'Taxes', 'expense', 'expense', null),
    (p_tenant, '6900', 'General expenses', 'expense', 'expense', 'general_expense'),
    (p_tenant, '6990', 'Rounding & exchange differences', 'expense', 'other_expense', 'rounding')
  on conflict do nothing;
end $$;

create or replace function public.acc_key(p_tenant uuid, p_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.chart_of_accounts where tenant_id = p_tenant and system_key = p_key;
  if v is null then
    perform public.acc_seed(p_tenant);
    select id into v from public.chart_of_accounts where tenant_id = p_tenant and system_key = p_key;
  end if;
  return v;
end $$;

/** Expense account by name (creates it the first time). */
create or replace function public.acc_expense_account(p_tenant uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; n text := nullif(trim(coalesce(p_name, '')), '');
begin
  if n is null then return public.acc_key(p_tenant, 'general_expense'); end if;
  select id into v from public.chart_of_accounts where tenant_id = p_tenant and type = 'expense' and lower(name) = lower(n) limit 1;
  if v is null then
    insert into public.chart_of_accounts (tenant_id, name, type, sub_type) values (p_tenant, n, 'expense', 'expense') returning id into v;
  end if;
  return v;
end $$;

/** Where money for a payment method lands. */
create or replace function public.acc_method_account(p_tenant uuid, p_method text)
returns uuid language plpgsql security definer set search_path = public as $$
declare m text := lower(coalesce(p_method, ''));
begin
  -- A bank account picked by id ("account:<uuid>").
  if m like 'account:%' then return (select id from public.chart_of_accounts where tenant_id = p_tenant and id::text = substr(m, 9)); end if;
  if m ~ 'mpesa|m-pesa|stk|till|paybill|mobile|airtel|mtn|momo' then return public.acc_key(p_tenant, 'mpesa'); end if;
  if m ~ 'cash' then return public.acc_key(p_tenant, 'cash'); end if;
  if m ~ 'bank|cheque|check|transfer|eft|rtgs|card|visa|pesalink|paystack|flutterwave|stripe|paypal|pesapal' then return public.acc_key(p_tenant, 'bank'); end if;
  return public.acc_key(p_tenant, 'undeposited');
end $$;

create or replace function public.acc_lock_date(p_tenant uuid)
returns date language sql stable security definer set search_path = public as $$
  select nullif(erp_settings->>'lock_date', '')::date from public.business_settings where tenant_id = p_tenant limit 1
$$;

/**
 * (Re)writes the journal of a source document. p_lines: [{account_id, debit,
 * credit, description, contact_type, contact_id}]. Empty lines = remove.
 */
create or replace function public.acc_post(p_tenant uuid, p_source_type text, p_source_id uuid, p_date date, p_ref text, p_notes text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_journal uuid;
  l jsonb;
  v_dr numeric := 0;
  v_cr numeric := 0;
  v_lock date := public.acc_lock_date(p_tenant);
  v_old date;
begin
  select id, journal_date into v_journal, v_old from public.journals where tenant_id = p_tenant and source_type = p_source_type and source_id = p_source_id;
  if v_lock is not null and (coalesce(p_date, current_date) <= v_lock or (v_old is not null and v_old <= v_lock)) then
    raise exception 'The books are locked up to %. Unlock them in Accountant → Transaction locking first.', v_lock;
  end if;
  if v_journal is not null then delete from public.journals where id = v_journal; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then return null; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_dr := v_dr + round(coalesce((l->>'debit')::numeric, 0), 2);
    v_cr := v_cr + round(coalesce((l->>'credit')::numeric, 0), 2);
  end loop;
  if v_dr = 0 and v_cr = 0 then return null; end if;
  -- Small rounding differences go to the rounding account.
  if abs(v_dr - v_cr) > 0 and abs(v_dr - v_cr) <= 1 then
    p_lines := p_lines || jsonb_build_array(jsonb_build_object('account_id', public.acc_key(p_tenant, 'rounding'),
      'debit', greatest(v_cr - v_dr, 0), 'credit', greatest(v_dr - v_cr, 0), 'description', 'Rounding'));
    v_dr := greatest(v_dr, v_cr);
  elsif v_dr <> v_cr then
    raise exception 'Journal for % % does not balance (debits %, credits %)', p_source_type, p_source_id, v_dr, v_cr;
  end if;
  insert into public.journals (tenant_id, journal_number, journal_date, reference, notes, status, source_type, source_id, total, created_by)
  values (p_tenant, null, coalesce(p_date, current_date), p_ref, p_notes, 'posted', p_source_type, p_source_id, v_dr, auth.uid())
  returning id into v_journal;
  insert into public.journal_lines (journal_id, tenant_id, account_id, description, debit, credit, contact_type, contact_id, line_date)
  select v_journal, p_tenant, (x->>'account_id')::uuid, x->>'description',
         round(coalesce((x->>'debit')::numeric, 0), 2), round(coalesce((x->>'credit')::numeric, 0), 2),
         x->>'contact_type', nullif(x->>'contact_id', '')::uuid, coalesce(p_date, current_date)
  from jsonb_array_elements(p_lines) x
  where coalesce((x->>'debit')::numeric, 0) <> 0 or coalesce((x->>'credit')::numeric, 0) <> 0;
  return v_journal;
end $$;

/** Cost of the stocked items on a document (quantity × cost price). */
create or replace function public.acc_items_cost(p_items jsonb)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(coalesce((i->>'quantity')::numeric, (i->>'qty')::numeric, 0) * coalesce(p.cost_price, 0)), 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  join public.products p on p.id::text = coalesce(i->>'item_id', i->>'product_id', i->>'id')
  where coalesce(p.product_type, 'product') <> 'service'
$$;

-- ── Posting per document ─────────────────────────────────────────────────
create or replace function public.acc_post_invoice(r public.invoices)
returns void language plpgsql security definer set search_path = public as $$
declare v_net numeric; v_cost numeric; v_lines jsonb;
begin
  if r.status in ('draft', 'void', 'cancelled') or coalesce(r.approval_status, 'approved') = 'pending' then
    perform public.acc_post(r.tenant_id, 'invoice', r.id, r.issue_date, r.invoice_number, null, '[]'::jsonb); return;
  end if;
  v_net := coalesce(r.total, 0) - coalesce(r.tax, 0);
  v_cost := public.acc_items_cost(r.items);
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'ar'), 'debit', r.total, 'description', 'Invoice ' || coalesce(r.invoice_number, ''), 'contact_type', 'customer', 'contact_id', r.customer_id),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'sales'), 'credit', v_net, 'description', coalesce(r.subject, 'Sales')),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'vat_out'), 'credit', coalesce(r.tax, 0), 'description', 'VAT'));
  if v_cost > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'cogs'), 'debit', v_cost, 'description', 'Cost of goods sold'),
      jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'inventory'), 'credit', v_cost, 'description', 'Stock out'));
  end if;
  perform public.acc_post(r.tenant_id, 'invoice', r.id, coalesce(r.issue_date, r.created_at::date), r.invoice_number, r.customer_name, v_lines);
end $$;

create or replace function public.acc_post_payment_received(r public.payments_received)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.acc_post(r.tenant_id, 'payment_received', r.id, r.payment_date, r.payment_number, r.customer_name, jsonb_build_array(
    jsonb_build_object('account_id', public.acc_method_account(r.tenant_id, r.method), 'debit', r.amount, 'description', 'Payment ' || coalesce(r.payment_number, '') || ' ' || coalesce(r.reference, '')),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'ar'), 'credit', r.amount, 'description', 'Payment received', 'contact_type', 'customer', 'contact_id', r.customer_id)));
end $$;

create or replace function public.acc_post_credit_note(r public.credit_notes)
returns void language plpgsql security definer set search_path = public as $$
begin
  if r.status in ('draft', 'void') or coalesce(r.approval_status, 'approved') = 'pending' then
    perform public.acc_post(r.tenant_id, 'credit_note', r.id, r.issue_date, r.credit_note_number, null, '[]'::jsonb); return;
  end if;
  perform public.acc_post(r.tenant_id, 'credit_note', r.id, coalesce(r.issue_date, r.created_at::date), r.credit_note_number, r.customer_name, jsonb_build_array(
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'sales_returns'), 'debit', coalesce(r.total, 0) - coalesce(r.tax, 0), 'description', coalesce(r.reason, 'Credit note')),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'vat_out'), 'debit', coalesce(r.tax, 0), 'description', 'VAT reversed'),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'ar'), 'credit', r.total, 'description', 'Credit note ' || coalesce(r.credit_note_number, ''), 'contact_type', 'customer', 'contact_id', r.customer_id)));
end $$;

create or replace function public.acc_post_bill(r public.bills)
returns void language plpgsql security definer set search_path = public as $$
declare v_net numeric; v_acc uuid;
begin
  if coalesce(r.status, '') in ('draft', 'void', 'cancelled') or coalesce(r.approval_status, 'approved') = 'pending' then
    perform public.acc_post(r.tenant_id, 'bill', r.id, r.bill_date, r.bill_number, null, '[]'::jsonb); return;
  end if;
  v_net := coalesce(r.amount, 0) - coalesce(r.tax, 0);
  v_acc := case when r.purchase_id is not null or lower(coalesce(r.category, '')) like '%stock%' then public.acc_key(r.tenant_id, 'inventory')
                else public.acc_expense_account(r.tenant_id, r.category) end;
  perform public.acc_post(r.tenant_id, 'bill', r.id, coalesce(r.bill_date, r.created_at::date), r.bill_number, r.name, jsonb_build_array(
    jsonb_build_object('account_id', v_acc, 'debit', v_net, 'description', coalesce(r.name, 'Bill')),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'vat_in'), 'debit', coalesce(r.tax, 0), 'description', 'VAT input'),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'ap'), 'credit', r.amount, 'description', 'Bill ' || coalesce(r.bill_number, ''), 'contact_type', 'supplier', 'contact_id', r.supplier_id)));
end $$;

create or replace function public.acc_post_supplier_payment(r public.supplier_payments)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.acc_post(r.tenant_id, 'payment_made', r.id, coalesce(r.paid_on, r.created_at::date), r.reference, r.notes, jsonb_build_array(
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'ap'), 'debit', r.amount, 'description', 'Payment made', 'contact_type', 'supplier', 'contact_id', r.supplier_id),
    jsonb_build_object('account_id', case when r.method = 'vendor_credit' then public.acc_key(r.tenant_id, 'purchases') else public.acc_method_account(r.tenant_id, r.method) end,
                       'credit', r.amount, 'description', coalesce(r.method, '') || ' ' || coalesce(r.reference, ''))));
end $$;

create or replace function public.acc_post_vendor_credit(r public.vendor_credits)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(r.status, '') in ('draft', 'void') then
    perform public.acc_post(r.tenant_id, 'vendor_credit', r.id, r.credit_date, r.credit_number, null, '[]'::jsonb); return;
  end if;
  -- Applying a vendor credit records a 'vendor_credit' supplier payment (Dr AP, Cr Purchases);
  -- the credit itself sits as a purchases reduction once applied, so only refunds post here.
  perform public.acc_post(r.tenant_id, 'vendor_credit', r.id, coalesce(r.credit_date, r.created_at::date), r.credit_number, r.reason,
    case when coalesce(r.amount_refunded, 0) > 0 then jsonb_build_array(
      jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'bank'), 'debit', r.amount_refunded, 'description', 'Vendor refund'),
      jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'purchases'), 'credit', r.amount_refunded, 'description', 'Vendor credit refunded'))
    else '[]'::jsonb end);
end $$;

create or replace function public.acc_post_expense(r public.expenses)
returns void language plpgsql security definer set search_path = public as $$
declare v_paid uuid;
begin
  if coalesce(r.approval_status, 'approved') in ('pending', 'rejected') then
    perform public.acc_post(r.tenant_id, 'expense', r.id, r.expense_date, r.expense_number, null, '[]'::jsonb); return;
  end if;
  v_paid := case when lower(coalesce(r.paid_through, '')) like '%payable%' or lower(coalesce(r.payment_method, '')) = 'credit'
                 then public.acc_key(r.tenant_id, 'ap')
                 else public.acc_method_account(r.tenant_id, coalesce(nullif(r.paid_through, ''), r.payment_method)) end;
  perform public.acc_post(r.tenant_id, 'expense', r.id, coalesce(r.expense_date, r.created_at::date), coalesce(r.expense_number, r.reference), r.description, jsonb_build_array(
    jsonb_build_object('account_id', public.acc_expense_account(r.tenant_id, r.category_name), 'debit', coalesce(r.amount, 0) - coalesce(r.tax_amount, 0), 'description', coalesce(r.description, r.category_name)),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'vat_in'), 'debit', coalesce(r.tax_amount, 0), 'description', 'VAT input'),
    jsonb_build_object('account_id', v_paid, 'credit', r.amount, 'description', coalesce(r.vendor_name, 'Expense'), 'contact_type', case when r.supplier_id is not null then 'supplier' end, 'contact_id', r.supplier_id)));
end $$;

/** POS / till sales (not invoice payments, which post as payments received). */
create or replace function public.acc_post_sale(r public.transactions)
returns void language plpgsql security definer set search_path = public as $$
declare v_cost numeric; v_lines jsonb; v_net numeric;
begin
  if r.status is distinct from 'completed' or r.invoice_id is not null or coalesce(r.total, 0) <= 0 then
    perform public.acc_post(r.tenant_id, 'sale', r.id, r.created_at::date, null, null, '[]'::jsonb); return;
  end if;
  v_net := coalesce(r.total, 0) - coalesce(r.tax, 0);
  v_cost := public.acc_items_cost(r.items);
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', case when r.payment_method in ('credit', 'on_account', 'debt') then public.acc_key(r.tenant_id, 'ar') else public.acc_method_account(r.tenant_id, r.payment_method) end,
                       'debit', r.total, 'description', 'Sale ' || coalesce(r.mpesa_ref, ''), 'contact_type', case when r.customer_id is not null then 'customer' end, 'contact_id', r.customer_id),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'sales'), 'credit', v_net, 'description', 'POS sale'),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'vat_out'), 'credit', coalesce(r.tax, 0), 'description', 'VAT'));
  if v_cost > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'cogs'), 'debit', v_cost, 'description', 'Cost of goods sold'),
      jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'inventory'), 'credit', v_cost, 'description', 'Stock out'));
  end if;
  perform public.acc_post(r.tenant_id, 'sale', r.id, r.created_at::date, null, r.customer_name, v_lines);
end $$;

-- One trigger function for every document table; failures are logged, never block the document.
create or replace function public.acc_document_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_tenant uuid;
begin
  begin
    if TG_OP = 'DELETE' then
      v_id := OLD.id; v_tenant := OLD.tenant_id;
      delete from public.journals where tenant_id = v_tenant and source_id = v_id and source_type = TG_ARGV[0];
      return OLD;
    end if;
    case TG_TABLE_NAME
      when 'invoices' then perform public.acc_post_invoice(NEW);
      when 'payments_received' then perform public.acc_post_payment_received(NEW);
      when 'credit_notes' then perform public.acc_post_credit_note(NEW);
      when 'bills' then perform public.acc_post_bill(NEW);
      when 'supplier_payments' then perform public.acc_post_supplier_payment(NEW);
      when 'vendor_credits' then perform public.acc_post_vendor_credit(NEW);
      when 'expenses' then perform public.acc_post_expense(NEW);
      when 'transactions' then perform public.acc_post_sale(NEW);
    end case;
  exception when others then
    if SQLERRM like 'The books are locked%' then raise; end if;
    insert into public.accounting_errors (tenant_id, source_type, source_id, message) values (NEW.tenant_id, TG_TABLE_NAME, NEW.id, left(SQLERRM, 500));
  end;
  return NEW;
end $$;

do $$
declare t text; k text;
begin
  for t, k in select * from (values ('invoices', 'invoice'), ('payments_received', 'payment_received'), ('credit_notes', 'credit_note'), ('bills', 'bill'),
                                      ('supplier_payments', 'payment_made'), ('vendor_credits', 'vendor_credit'), ('expenses', 'expense'), ('transactions', 'sale')) v(t, k) loop
    execute format('drop trigger if exists acc_post on public.%I', t);
    execute format('create trigger acc_post after insert or update or delete on public.%I for each row execute function public.acc_document_trigger(%L)', t, k);
  end loop;
end $$;

-- Every company gets the default chart of accounts.
do $$ declare t uuid; begin for t in select id from public.tenants loop perform public.acc_seed(t); end loop; end $$;
create or replace function public.acc_seed_new_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.acc_seed(NEW.id); return NEW; end $$;
drop trigger if exists acc_seed_new_tenant on public.tenants;
create trigger acc_seed_new_tenant after insert on public.tenants for each row execute function public.acc_seed_new_tenant();

-- ── Manual journals ──────────────────────────────────────────────────────
create or replace function public.acc_manual_journal(p_id uuid, p_date date, p_reference text, p_notes text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_user_tenant_id(); v_id uuid := coalesce(p_id, gen_random_uuid()); v_j uuid; l jsonb;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')) then raise exception 'Only administrators and managers can post journals'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if not exists (select 1 from public.chart_of_accounts where id = (l->>'account_id')::uuid and tenant_id = v_tenant) then raise exception 'Unknown account on a journal line'; end if;
  end loop;
  v_j := public.acc_post(v_tenant, 'manual', v_id, p_date, p_reference, p_notes, p_lines);
  if v_j is not null then
    update public.journals set journal_number = coalesce(journal_number, public.next_doc_number('journal', v_tenant)) where id = v_j;
  end if;
  return v_id;
end $$;
grant execute on function public.acc_manual_journal(uuid, date, text, text, jsonb) to authenticated;

create or replace function public.acc_delete_manual_journal(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')) then raise exception 'Not allowed'; end if;
  perform public.acc_post(public.current_user_tenant_id(), 'manual', p_id, null, null, null, '[]'::jsonb);
end $$;
grant execute on function public.acc_delete_manual_journal(uuid) to authenticated;

-- ── Banking: categorise a statement line ─────────────────────────────────
create or replace function public.acc_categorize_bank_line(p_line uuid, p_account uuid, p_exclude boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare b public.bank_transactions; v_tenant uuid := public.current_user_tenant_id();
begin
  select * into b from public.bank_transactions where id = p_line and tenant_id = v_tenant;
  if b.id is null then raise exception 'Statement line not found'; end if;
  if p_exclude then
    perform public.acc_post(v_tenant, 'bank_line', b.id, b.txn_date, null, null, '[]'::jsonb);
    update public.bank_transactions set status = 'excluded', journal_id = null where id = b.id; return;
  end if;
  perform public.acc_post(v_tenant, 'bank_line', b.id, b.txn_date, b.reference, coalesce(b.description, b.payee), jsonb_build_array(
    jsonb_build_object('account_id', b.account_id, 'debit', greatest(b.amount, 0), 'credit', greatest(-b.amount, 0), 'description', b.description),
    jsonb_build_object('account_id', p_account, 'debit', greatest(-b.amount, 0), 'credit', greatest(b.amount, 0), 'description', coalesce(b.payee, b.description))));
  update public.bank_transactions set status = 'categorized', category_account_id = p_account,
    journal_id = (select id from public.journals where tenant_id = v_tenant and source_type = 'bank_line' and source_id = b.id) where id = b.id;
end $$;
grant execute on function public.acc_categorize_bank_line(uuid, uuid, boolean) to authenticated;

-- ── Reports ──────────────────────────────────────────────────────────────
/** Per account: opening balance before p_from, movement in the period, closing. Debit-positive. */
create or replace function public.acc_balances(p_from date, p_to date)
returns table (account_id uuid, code text, name text, type text, sub_type text, opening numeric, debit numeric, credit numeric, closing numeric)
language sql stable security definer set search_path = public as $$
  select a.id, a.code, a.name, a.type, a.sub_type,
    coalesce(sum(l.debit - l.credit) filter (where l.line_date < p_from), 0),
    coalesce(sum(l.debit) filter (where l.line_date between p_from and p_to), 0),
    coalesce(sum(l.credit) filter (where l.line_date between p_from and p_to), 0),
    coalesce(sum(l.debit - l.credit) filter (where l.line_date <= p_to), 0)
  from public.chart_of_accounts a
  left join public.journal_lines l on l.account_id = a.id
  where a.tenant_id = public.current_user_tenant_id()
  group by a.id, a.code, a.name, a.type, a.sub_type
  order by a.code nulls last, a.name
$$;
grant execute on function public.acc_balances(date, date) to authenticated;

/** General ledger for one account. */
create or replace function public.acc_ledger(p_account uuid, p_from date, p_to date)
returns table (line_date date, journal_id uuid, source_type text, source_id uuid, reference text, description text, contact_id uuid, debit numeric, credit numeric)
language sql stable security definer set search_path = public as $$
  select l.line_date, j.id, j.source_type, j.source_id, j.reference, coalesce(l.description, j.notes), l.contact_id, l.debit, l.credit
  from public.journal_lines l join public.journals j on j.id = l.journal_id
  where l.tenant_id = public.current_user_tenant_id() and l.account_id = p_account and l.line_date between p_from and p_to
  order by l.line_date, j.created_at
$$;
grant execute on function public.acc_ledger(uuid, date, date) to authenticated;

/** Re-posts every document of the company (after an import or a fix). */
create or replace function public.acc_repost_all()
returns int language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_user_tenant_id(); n int := 0; r record;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Only the administrator can rebuild the books'; end if;
  for r in select * from public.invoices where tenant_id = v_tenant loop perform public.acc_post_invoice(r); n := n + 1; end loop;
  for r in select * from public.payments_received where tenant_id = v_tenant loop perform public.acc_post_payment_received(r); n := n + 1; end loop;
  for r in select * from public.credit_notes where tenant_id = v_tenant loop perform public.acc_post_credit_note(r); n := n + 1; end loop;
  for r in select * from public.bills where tenant_id = v_tenant loop perform public.acc_post_bill(r); n := n + 1; end loop;
  for r in select * from public.supplier_payments where tenant_id = v_tenant loop perform public.acc_post_supplier_payment(r); n := n + 1; end loop;
  for r in select * from public.vendor_credits where tenant_id = v_tenant loop perform public.acc_post_vendor_credit(r); n := n + 1; end loop;
  for r in select * from public.expenses where tenant_id = v_tenant loop perform public.acc_post_expense(r); n := n + 1; end loop;
  for r in select * from public.transactions where tenant_id = v_tenant loop perform public.acc_post_sale(r); n := n + 1; end loop;
  return n;
end $$;
grant execute on function public.acc_repost_all() to authenticated;

-- Opening balances: one journal against Opening balance equity.
create or replace function public.acc_opening_balances(p_date date, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_user_tenant_id(); v_dr numeric := 0; v_cr numeric := 0; l jsonb; v_lines jsonb := '[]'::jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Only the administrator can set opening balances'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_dr := v_dr + coalesce((l->>'debit')::numeric, 0); v_cr := v_cr + coalesce((l->>'credit')::numeric, 0);
    v_lines := v_lines || jsonb_build_array(l);
  end loop;
  if v_dr <> v_cr then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', public.acc_key(v_tenant, 'opening_equity'),
      'debit', greatest(v_cr - v_dr, 0), 'credit', greatest(v_dr - v_cr, 0), 'description', 'Opening balance adjustment'));
  end if;
  return public.acc_post(v_tenant, 'opening', v_tenant, p_date, 'Opening balances', null, v_lines);
end $$;
grant execute on function public.acc_opening_balances(date, jsonb) to authenticated;

create or replace function public.acc_uncategorize_bank_line(p_line uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_user_tenant_id();
begin
  if not exists (select 1 from public.bank_transactions where id = p_line and tenant_id = v_tenant) then raise exception 'Statement line not found'; end if;
  perform public.acc_post(v_tenant, 'bank_line', p_line, null, null, null, '[]'::jsonb);
  update public.bank_transactions set status = 'uncategorized', journal_id = null, category_account_id = null where id = p_line;
end $$;
grant execute on function public.acc_uncategorize_bank_line(uuid) to authenticated;
