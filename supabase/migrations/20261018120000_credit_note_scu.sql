-- Credit notes keep the same KRA SCU details as invoices (date, control unit, internal data).
alter table public.credit_notes add column if not exists etims_sdc_id text;
alter table public.credit_notes add column if not exists etims_internal_data text;
alter table public.credit_notes add column if not exists etims_signed_at text;
