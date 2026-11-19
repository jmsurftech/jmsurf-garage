-- Bills: the date the company expects to pay (the other system's "Expected Payment Date").
alter table public.bills add column if not exists expected_payment_date date;
