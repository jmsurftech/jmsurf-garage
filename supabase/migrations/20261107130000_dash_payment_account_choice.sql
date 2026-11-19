-- Payments received ("Deposit to") and payments made ("Paid through") now land
-- in the bank, M-Pesa or cash account the user picks, so a company with several
-- banks can reconcile each one. The forms store the account id; older rows hold
-- a free label and keep posting by payment method as before.

create or replace function public.acc_pick_account(p_tenant uuid, p_choice text, p_method text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid; c text := nullif(trim(coalesce(p_choice, '')), '');
begin
  if c is not null then
    if c ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select id into v from public.chart_of_accounts where tenant_id = p_tenant and id = c::uuid and type = 'asset';
    else
      select id into v from public.chart_of_accounts where tenant_id = p_tenant and lower(name) = lower(c) and sub_type in ('bank', 'cash') limit 1;
    end if;
  end if;
  return coalesce(v, public.acc_method_account(p_tenant, p_method));
end $$;

create or replace function public.acc_post_payment_received(r payments_received)
returns void language plpgsql security definer set search_path = public as $$
declare w numeric := least(greatest(coalesce(r.withholding_vat, 0), 0), r.amount);
  lines jsonb;
begin
  lines := jsonb_build_array(
    jsonb_build_object('account_id', public.acc_pick_account(r.tenant_id, r.deposit_to, r.method), 'debit', r.amount - w, 'description', 'Payment ' || coalesce(r.payment_number, '') || ' ' || coalesce(r.reference, '')));
  if w > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'wht_in'), 'debit', w, 'description', 'Withholding VAT · ' || coalesce(r.payment_number, '')));
  end if;
  lines := lines || jsonb_build_array(
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'ar'), 'credit', r.amount, 'description', 'Payment received', 'contact_type', 'customer', 'contact_id', r.customer_id));
  perform public.acc_post(r.tenant_id, 'payment_received', r.id, r.payment_date, r.payment_number, r.customer_name, lines);
end $$;

create or replace function public.acc_post_supplier_payment(r supplier_payments)
returns void language plpgsql security definer set search_path = public as $$
declare w numeric := least(greatest(coalesce(r.withholding_vat, 0), 0), r.amount);
  lines jsonb;
begin
  lines := jsonb_build_array(
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'ap'), 'debit', r.amount, 'description', 'Payment made', 'contact_type', 'supplier', 'contact_id', r.supplier_id),
    jsonb_build_object('account_id', case when r.method = 'vendor_credit' then public.acc_key(r.tenant_id, 'purchases') else public.acc_pick_account(r.tenant_id, r.paid_through, r.method) end,
                       'credit', r.amount - w, 'description', coalesce(r.method, '') || ' ' || coalesce(r.reference, '')));
  if w > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'wht_out'), 'credit', w, 'description', 'Withholding VAT withheld'));
  end if;
  perform public.acc_post(r.tenant_id, 'payment_made', r.id, coalesce(r.paid_on, r.created_at::date), r.reference, r.notes, lines);
end $$;

-- Expenses: "Paid through" may name one of the company's own bank / M-Pesa / cash accounts.
CREATE OR REPLACE FUNCTION public.acc_post_expense(r expenses)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_paid uuid;
begin
  if coalesce(r.approval_status, 'approved') in ('pending', 'rejected') then
    perform public.acc_post(r.tenant_id, 'expense', r.id, r.expense_date, r.expense_number, null, '[]'::jsonb); return;
  end if;
  v_paid := case when lower(coalesce(r.paid_through, '')) like '%payable%' or lower(coalesce(r.payment_method, '')) = 'credit'
                 then public.acc_key(r.tenant_id, 'ap')
                 else public.acc_pick_account(r.tenant_id, r.paid_through, coalesce(nullif(r.paid_through, ''), r.payment_method)) end;
  perform public.acc_post(r.tenant_id, 'expense', r.id, coalesce(r.expense_date, r.created_at::date), coalesce(r.expense_number, r.reference), r.description, jsonb_build_array(
    jsonb_build_object('account_id', public.acc_expense_account(r.tenant_id, r.category_name), 'debit', coalesce(r.amount, 0) - coalesce(r.tax_amount, 0), 'description', coalesce(r.description, r.category_name)),
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'vat_in'), 'debit', coalesce(r.tax_amount, 0), 'description', 'VAT input'),
    jsonb_build_object('account_id', v_paid, 'credit', r.amount, 'description', coalesce(r.vendor_name, 'Expense'), 'contact_type', case when r.supplier_id is not null then 'supplier' end, 'contact_id', r.supplier_id)));
end $function$;
