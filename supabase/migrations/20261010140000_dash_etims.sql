-- KRA eTIMS (OSCU): each company signs its invoices and credit notes with KRA.
-- Settings live in business_settings.erp_settings.etims (tin, branch, device serial,
-- environment); the consumer key/secret and the communication key (cmcKey) are
-- write-only integration secrets.
alter table public.invoices add column if not exists etims_status text;
alter table public.invoices add column if not exists etims_invc_no integer;
alter table public.invoices add column if not exists etims_rcpt_no text;
alter table public.invoices add column if not exists etims_signature text;
alter table public.invoices add column if not exists etims_internal_data text;
alter table public.invoices add column if not exists etims_sdc_id text;
alter table public.invoices add column if not exists etims_mrc_no text;
alter table public.invoices add column if not exists etims_signed_at text;
alter table public.invoices add column if not exists etims_qr_url text;
alter table public.invoices add column if not exists etims_error text;
alter table public.credit_notes add column if not exists etims_status text;
alter table public.credit_notes add column if not exists etims_invc_no integer;
alter table public.credit_notes add column if not exists etims_rcpt_no text;
alter table public.credit_notes add column if not exists etims_signature text;
alter table public.credit_notes add column if not exists etims_qr_url text;
alter table public.credit_notes add column if not exists etims_error text;
alter table public.products add column if not exists etims_item_cd text;
alter table public.products add column if not exists etims_item_cls_cd text;
alter table public.products add column if not exists etims_tax_type text;

/** Next eTIMS invoice number for the company (a plain integer KRA expects per branch). */
create or replace function public.etims_next_invc_no(p_tenant uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare r public.doc_sequences;
begin
  insert into public.doc_sequences (tenant_id, kind, prefix, next_value, pad) values (p_tenant, 'etims_invc', '', 1, 0)
  on conflict (tenant_id, kind) do nothing;
  update public.doc_sequences set next_value = next_value + 1 where tenant_id = p_tenant and kind = 'etims_invc' returning * into r;
  return (r.next_value - 1)::int;
end $$;
revoke all on function public.etims_next_invc_no(uuid) from public, anon, authenticated;
grant execute on function public.etims_next_invc_no(uuid) to service_role;

create or replace function public.etims_next_item_no(p_tenant uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare r public.doc_sequences;
begin
  insert into public.doc_sequences (tenant_id, kind, prefix, next_value, pad) values (p_tenant, 'etims_item', '', 1, 0)
  on conflict (tenant_id, kind) do nothing;
  update public.doc_sequences set next_value = next_value + 1 where tenant_id = p_tenant and kind = 'etims_item' returning * into r;
  return (r.next_value - 1)::int;
end $$;
revoke all on function public.etims_next_item_no(uuid) from public, anon, authenticated;
grant execute on function public.etims_next_item_no(uuid) to service_role;
