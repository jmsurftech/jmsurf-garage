-- After a move-in, new documents continue the old system's numbering: the next
-- invoice after INV000002 is INV000003 (same prefix and width), never INV-000001.
create or replace function public.continue_doc_numbers(p_tenant uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t uuid := coalesce(p_tenant, public.current_user_tenant_id());
  r record; pre text; num text; out jsonb := '{}'::jsonb;
begin
  if t is null then raise exception 'No company for this account'; end if;
  if auth.uid() is not null and t <> public.current_user_tenant_id() and not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Not allowed';
  end if;
  for r in select * from (values
    ('invoice', 'invoices', 'invoice_number', ''),
    ('quote', 'quotes', 'quote_number', ''),
    ('sales_order', 'sales_orders', 'quote_number', ''),
    ('credit_note', 'credit_notes', 'credit_note_number', ''),
    ('payment', 'payments_received', 'payment_number', ''),
    ('bill', 'bills', 'bill_number', ''),
    ('po', 'purchases', 'po_number', ''),
    ('vendor_credit', 'vendor_credits', 'credit_number', ''),
    ('expense', 'expenses', 'expense_number', ''),
    ('journal', 'journals', 'journal_number', ' and source_type = ''manual''')
  ) v(kind, tbl, col, extra) loop
    execute format(
      'select substring(%1$I from ''^(.*?)[0-9]+$''), substring(%1$I from ''([0-9]+)$'') from public.%2$I
        where tenant_id = $1 and %1$I ~ ''[0-9]+$''%3$s
        order by substring(%1$I from ''([0-9]+)$'')::numeric desc limit 1', r.col, r.tbl, r.extra)
      into pre, num using t;
    if num is null then continue; end if;
    insert into public.doc_sequences (tenant_id, kind, prefix, next_value, pad)
      values (t, r.kind, coalesce(pre, ''), num::bigint + 1, greatest(length(num), 1))
    on conflict (tenant_id, kind) do update
      set prefix = excluded.prefix, pad = excluded.pad,
          next_value = greatest(public.doc_sequences.next_value, excluded.next_value);
    out := out || jsonb_build_object(r.kind, coalesce(pre, '') || lpad((num::bigint + 1)::text, greatest(length(num), 1), '0'));
  end loop;
  return out;
end $$;
grant execute on function public.continue_doc_numbers(uuid) to authenticated;
