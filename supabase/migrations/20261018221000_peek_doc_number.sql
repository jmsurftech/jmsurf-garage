-- The number the next document of a kind will get (shown on a new form, as Zoho does), without taking it.
create or replace function public.peek_doc_number(p_kind text) returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.prefix || lpad(s.next_value::text, s.pad, '0') from public.doc_sequences s where s.tenant_id = public.current_user_tenant_id() and s.kind = p_kind),
    public.doc_prefix_default(p_kind) || lpad('1', 6, '0'))
$$;
grant execute on function public.peek_doc_number(text) to authenticated;
