-- Withholding VAT on payments: a customer (or we, for a vendor) keeps part of the VAT
-- and pays it to KRA. The invoice/bill is settled in full; the withheld part sits in
-- Withholding tax receivable (customers) or Withholding tax payable (vendors).
alter table public.payments_received add column if not exists withholding_vat numeric(16,2) not null default 0;
alter table public.supplier_payments add column if not exists withholding_vat numeric(16,2) not null default 0;

create or replace function public.acc_post_payment_received(r payments_received)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare w numeric := least(greatest(coalesce(r.withholding_vat, 0), 0), r.amount);
  lines jsonb;
begin
  lines := jsonb_build_array(
    jsonb_build_object('account_id', public.acc_method_account(r.tenant_id, r.method), 'debit', r.amount - w, 'description', 'Payment ' || coalesce(r.payment_number, '') || ' ' || coalesce(r.reference, '')));
  if w > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'wht_in'), 'debit', w, 'description', 'Withholding VAT · ' || coalesce(r.payment_number, '')));
  end if;
  lines := lines || jsonb_build_array(
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'ar'), 'credit', r.amount, 'description', 'Payment received', 'contact_type', 'customer', 'contact_id', r.customer_id));
  perform public.acc_post(r.tenant_id, 'payment_received', r.id, r.payment_date, r.payment_number, r.customer_name, lines);
end $function$;

create or replace function public.acc_post_supplier_payment(r supplier_payments)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare w numeric := least(greatest(coalesce(r.withholding_vat, 0), 0), r.amount);
  lines jsonb;
begin
  lines := jsonb_build_array(
    jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'ap'), 'debit', r.amount, 'description', 'Payment made', 'contact_type', 'supplier', 'contact_id', r.supplier_id),
    jsonb_build_object('account_id', case when r.method = 'vendor_credit' then public.acc_key(r.tenant_id, 'purchases') else public.acc_method_account(r.tenant_id, r.method) end,
                       'credit', r.amount - w, 'description', coalesce(r.method, '') || ' ' || coalesce(r.reference, '')));
  if w > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('account_id', public.acc_key(r.tenant_id, 'wht_out'), 'credit', w, 'description', 'Withholding VAT withheld'));
  end if;
  perform public.acc_post(r.tenant_id, 'payment_made', r.id, coalesce(r.paid_on, r.created_at::date), r.reference, r.notes, lines);
end $function$;

-- Paying a numbered (books) bill marked recurring settles that bill; only the old
-- shop-style recurring bill (no number) resets itself for the next period.
do $$
declare d text := pg_get_functiondef('public.record_bill_payment(uuid,numeric,text,text,date,text)'::regprocedure);
begin
  if d !~ 'b\.bill_number IS NULL' then
    d := replace(d, 'AND b.is_recurring AND b.next_due_date IS NOT NULL THEN', 'AND b.is_recurring AND b.next_due_date IS NOT NULL AND b.bill_number IS NULL THEN');
    execute d;
  end if;
end $$;
