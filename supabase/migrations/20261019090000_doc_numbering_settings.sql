-- System → Document numbers: each company sets the prefix, the number of digits and the next number of every
-- document kind (e.g. Ikigai Health: all documents start from 01001). A start number that would repeat an existing
-- document's number is refused.

-- The document kinds a company can number, with where their numbers are stored (for the last-used number).
create or replace function public._doc_number_kinds()
returns table (kind text, label text, tbl text, col text, extra text, ord int) language sql immutable as $$
  select * from (values
    ('quote', 'Quotes', 'quotes', 'quote_number', '', 1),
    ('sales_order', 'Sales orders', 'sales_orders', 'quote_number', '', 2),
    ('invoice', 'Invoices', 'invoices', 'invoice_number', '', 3),
    ('payment', 'Payments received', 'payments_received', 'payment_number', '', 4),
    ('credit_note', 'Credit notes', 'credit_notes', 'credit_note_number', '', 5),
    ('po', 'Purchase orders', 'purchases', 'po_number', '', 6),
    ('purchase_receive', 'Purchase receives', 'purchase_receives', 'receive_number', '', 7),
    ('bill', 'Bills', 'bills', 'bill_number', '', 8),
    ('supplier_payment', 'Payments made', 'supplier_payments', 'payment_number', '', 9),
    ('vendor_credit', 'Vendor credits', 'vendor_credits', 'credit_number', '', 10),
    ('expense', 'Expenses', 'expenses', 'expense_number', '', 11),
    ('journal', 'Manual journals', 'journals', 'journal_number', ' and source_type = ''manual''', 12),
    ('requisition', 'Requisitions', 'requisitions', 'number', '', 13)
  ) v(kind, label, tbl, col, extra, ord)
$$;

-- Highest number already used with this prefix (digits only after the prefix), 0 when none.
create or replace function public._doc_number_used(p_tenant uuid, p_kind text, p_prefix text)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare k record; m numeric;
begin
  select * into k from public._doc_number_kinds() x where x.kind = p_kind;
  if k.kind is null then return 0; end if;
  execute format(
    'select max(substring(%1$I from $3)::numeric) from public.%2$I
      where tenant_id = $1 and left(%1$I, $2) = $4 and substring(%1$I from $3) ~ ''^[0-9]{1,18}$''%3$s',
    k.col, k.tbl, k.extra)
    into m using p_tenant, length(p_prefix), length(p_prefix) + 1, p_prefix;
  return coalesce(m, 0)::bigint;
end $$;
revoke all on function public._doc_number_used(uuid, text, text) from public, anon, authenticated;

-- Every kind's numbering for the caller's company: prefix, digits, next number, a preview and the last number used.
create or replace function public.doc_numbering_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id(); k record; s public.doc_sequences; pre text; pad int; nxt bigint; out jsonb := '[]'::jsonb;
begin
  if t is null then raise exception 'No company for this account'; end if;
  for k in select * from public._doc_number_kinds() order by ord loop
    select * into s from public.doc_sequences where tenant_id = t and doc_sequences.kind = k.kind;
    pre := coalesce(s.prefix, public.doc_prefix_default(k.kind));
    pad := coalesce(s.pad, 6);
    nxt := coalesce(s.next_value, 1);
    out := out || jsonb_build_object('kind', k.kind, 'label', k.label, 'prefix', pre, 'pad', pad, 'next_value', nxt,
      'preview', pre || lpad(nxt::text, greatest(pad, length(nxt::text)), '0'), 'used', public._doc_number_used(t, k.kind, pre));
  end loop;
  return out;
end $$;
grant execute on function public.doc_numbering_list() to authenticated;

-- Sets one kind's numbering. Owners and managers only; the next number must be above every number already used.
create or replace function public.set_doc_numbering(p_kind text, p_prefix text, p_pad int, p_next bigint)
returns text language plpgsql security definer set search_path = public as $$
declare t uuid := public.current_user_tenant_id(); k record; pre text := coalesce(trim(p_prefix), ''); used bigint;
begin
  if t is null then raise exception 'No company for this account'; end if;
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Only owners and managers can change document numbers';
  end if;
  select * into k from public._doc_number_kinds() x where x.kind = p_kind;
  if k.kind is null then raise exception 'Unknown document type'; end if;
  if length(pre) > 20 then raise exception 'Keep the prefix to 20 characters'; end if;
  if pre ~ '[0-9]$' then raise exception '%: the prefix cannot end with a digit (add a dash, e.g. %-)', k.label, pre; end if;
  if p_pad is null or p_pad < 1 or p_pad > 12 then raise exception 'Digits must be between 1 and 12'; end if;
  if p_next is null or p_next < 1 or p_next > 999999999999 then raise exception 'The next number must be 1 or more'; end if;
  used := public._doc_number_used(t, p_kind, pre);
  if p_next <= used then
    raise exception '%: number % is already used. Start from % or higher.', k.label, used, used + 1;
  end if;
  insert into public.doc_sequences (tenant_id, kind, prefix, next_value, pad) values (t, p_kind, pre, p_next, p_pad)
    on conflict (tenant_id, kind) do update set prefix = excluded.prefix, next_value = excluded.next_value, pad = excluded.pad;
  return pre || lpad(p_next::text, greatest(p_pad, length(p_next::text)), '0');
end $$;
revoke all on function public.set_doc_numbering(text, text, int, bigint) from public, anon;
grant execute on function public.set_doc_numbering(text, text, int, bigint) to authenticated;

-- Numbers longer than the digits grow instead of being cut (lpad truncates: 100000 with 5 digits gave 10000).
create or replace function public.next_doc_number(p_kind text, p_tenant uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  t uuid := coalesce(p_tenant, public.current_user_tenant_id());
  r public.doc_sequences;
  n text;
begin
  if t is null then raise exception 'No shop for this account'; end if;
  if p_tenant is not null and auth.uid() is not null and p_tenant <> public.current_user_tenant_id()
     and not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Not allowed';
  end if;
  insert into public.doc_sequences (tenant_id, kind, prefix) values (t, p_kind, public.doc_prefix_default(p_kind))
    on conflict (tenant_id, kind) do nothing;
  update public.doc_sequences set next_value = next_value + 1
    where tenant_id = t and kind = p_kind returning * into r;
  n := (r.next_value - 1)::text;
  return r.prefix || lpad(n, greatest(r.pad, length(n)), '0');
end $$;
revoke all on function public.next_doc_number(text, uuid) from public, anon;
grant execute on function public.next_doc_number(text, uuid) to authenticated, service_role;

create or replace function public.peek_doc_number(p_kind text) returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.prefix || lpad(s.next_value::text, greatest(s.pad, length(s.next_value::text)), '0') from public.doc_sequences s
      where s.tenant_id = public.current_user_tenant_id() and s.kind = p_kind),
    public.doc_prefix_default(p_kind) || lpad('1', 6, '0'))
$$;
grant execute on function public.peek_doc_number(text) to authenticated;
