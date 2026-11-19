-- After a move-in, each document series continues from the old system's numbers. The series is the prefix most
-- documents use: a few documents numbered by hand (a sales order "1453" among SO-00001…SO-00159) no longer set
-- the series. Bill numbers are the suppliers' own invoice numbers, so they never set DASH's bill numbering.
create or replace function public.continue_doc_numbers(p_tenant uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
    ('po', 'purchases', 'po_number', ''),
    ('vendor_credit', 'vendor_credits', 'credit_number', ''),
    ('expense', 'expenses', 'expense_number', ''),
    ('journal', 'journals', 'journal_number', ' and source_type = ''manual''')
  ) v(kind, tbl, col, extra) loop
    -- The main series: the prefix with the most documents (ties: the longer prefix).
    execute format(
      'select p from (select substring(%1$I from ''^(.*?)[0-9]+$'') p from public.%2$I
          where tenant_id = $1 and %1$I ~ ''[0-9]+$''%3$s) x
        group by p order by count(*) desc, length(p) desc limit 1', r.col, r.tbl, r.extra)
      into pre using t;
    if pre is null then continue; end if;
    execute format(
      'select substring(%1$I from ''([0-9]+)$'') from public.%2$I
        where tenant_id = $1 and %1$I ~ ''[0-9]+$'' and substring(%1$I from ''^(.*?)[0-9]+$'') = $2%3$s
        order by substring(%1$I from ''([0-9]+)$'')::numeric desc, length(substring(%1$I from ''([0-9]+)$'')) desc limit 1', r.col, r.tbl, r.extra)
      into num using t, pre;
    if num is null then continue; end if;
    insert into public.doc_sequences (tenant_id, kind, prefix, next_value, pad)
      values (t, r.kind, coalesce(pre, ''), num::bigint + 1, greatest(length(num), 1))
    on conflict (tenant_id, kind) do update
      set prefix = excluded.prefix, pad = excluded.pad,
          next_value = case when public.doc_sequences.prefix = excluded.prefix
                            then greatest(public.doc_sequences.next_value, excluded.next_value) else excluded.next_value end;
    out := out || jsonb_build_object(r.kind, coalesce(pre, '') || lpad((num::bigint + 1)::text, greatest(length(num), 1), '0'));
  end loop;
  return out;
end $$;
