-- ---------------------------------------------------------------------------
-- JMSURF Garage integrations (garage-integrations.js, gateways.js, messaging.js).
--
--   garage_connections      one row per company: Daraja C2B address token, WhatsApp
--                           Cloud API number, Call Centre link. Server only (keys are
--                           in integration_secrets, encrypted "enc:v1:…").
--   garage_mpesa_c2b        payments customers make themselves to the company's own
--                           paybill / till (Daraja C2B confirmation), matched to invoices.
--   garage_wa_conversations two-way WhatsApp inbox: one thread per customer number.
--   garage_wa_messages      every WhatsApp message in and out.
--   garage_cc_users         Garage staff mirrored as Call Centre members (dash-db ids).
--   garage_callbacks        missed calls to call back (Call Centre or typed in).
--   garage_settle_c2b()     records a paybill payment and applies it to an invoice once.
--
-- Idempotent. Staff read their own company's rows (RLS on tenant_id); every write goes
-- through the app server with the service key.
-- ---------------------------------------------------------------------------

create table if not exists public.garage_connections (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  daraja_c2b_token text unique,
  daraja_c2b_shortcode text,
  daraja_c2b_type text check (daraja_c2b_type in ('paybill', 'till')),
  daraja_c2b_registered_at timestamptz,
  daraja_c2b_note text,
  daraja_c2b_validation text not null default 'all' check (daraja_c2b_validation in ('all', 'strict')),
  daraja_b2c_enabled boolean not null default false,
  wa_phone_number_id text unique,
  wa_waba_id text,
  wa_display_phone text,
  wa_enabled boolean not null default false,
  wa_default_template text,
  wa_template_lang text not null default 'en',
  wa_connected_at timestamptz,
  cc_tenant_id uuid,
  cc_owner_user_id uuid,
  cc_linked_at timestamptz,
  cc_lookup_key_hash text,
  cc_missed_sms boolean not null default true,
  cc_missed_text text,
  updated_at timestamptz not null default now()
);
alter table public.garage_connections enable row level security;
revoke all on public.garage_connections from anon, authenticated;

create table if not exists public.garage_mpesa_c2b (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trans_id text not null,
  amount numeric not null check (amount > 0),
  account_ref text,
  msisdn text,
  payer_name text,
  shortcode text,
  trans_time timestamptz,
  status text not null default 'received' check (status in ('received', 'matched', 'unmatched', 'review', 'failed')),
  invoice_id uuid references public.invoices(id) on delete set null,
  payment_id uuid,
  note text,
  trusted boolean not null default true,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, trans_id)
);
create index if not exists garage_mpesa_c2b_open_idx on public.garage_mpesa_c2b (tenant_id, status, created_at desc);
alter table public.garage_mpesa_c2b enable row level security;
revoke all on public.garage_mpesa_c2b from anon, authenticated;
grant select on public.garage_mpesa_c2b to authenticated;
drop policy if exists garage_mpesa_c2b_read on public.garage_mpesa_c2b;
create policy garage_mpesa_c2b_read on public.garage_mpesa_c2b for select to authenticated
  using (tenant_id = public.current_user_tenant_id());

create table if not exists public.garage_wa_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,                       -- international digits, e.g. 2547XXXXXXXX
  display_name text,
  customer_id uuid,
  status text not null default 'open' check (status in ('open', 'closed')),
  assigned_to uuid,
  unread integer not null default 0,
  last_message_at timestamptz,
  last_inbound_at timestamptz,               -- the 24-hour session window starts here
  last_preview text,
  created_at timestamptz not null default now(),
  unique (tenant_id, phone)
);
create index if not exists garage_wa_conversations_list_idx on public.garage_wa_conversations (tenant_id, last_message_at desc);
alter table public.garage_wa_conversations enable row level security;
revoke all on public.garage_wa_conversations from anon, authenticated;
grant select on public.garage_wa_conversations to authenticated;
drop policy if exists garage_wa_conversations_read on public.garage_wa_conversations;
create policy garage_wa_conversations_read on public.garage_wa_conversations for select to authenticated
  using (tenant_id = public.current_user_tenant_id());

create table if not exists public.garage_wa_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.garage_wa_conversations(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  wa_message_id text,
  kind text not null default 'text',         -- text | template | image | document | audio | video | location | other
  body text,
  media_id text,
  media_mime text,
  template_name text,
  status text not null default 'sent' check (status in ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
  error text,
  via text,                                  -- cloud | apiwap
  sent_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists garage_wa_messages_wamid_idx on public.garage_wa_messages (tenant_id, wa_message_id) where wa_message_id is not null;
create index if not exists garage_wa_messages_thread_idx on public.garage_wa_messages (conversation_id, created_at);
alter table public.garage_wa_messages enable row level security;
revoke all on public.garage_wa_messages from anon, authenticated;
grant select on public.garage_wa_messages to authenticated;
drop policy if exists garage_wa_messages_read on public.garage_wa_messages;
create policy garage_wa_messages_read on public.garage_wa_messages for select to authenticated
  using (tenant_id = public.current_user_tenant_id());

create table if not exists public.garage_cc_users (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  cc_user_id uuid not null,
  linked_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
alter table public.garage_cc_users enable row level security;
revoke all on public.garage_cc_users from anon, authenticated;

create table if not exists public.garage_callbacks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  customer_id uuid,
  customer_name text,
  source text not null default 'callcentre' check (source in ('callcentre', 'manual', 'whatsapp')),
  status text not null default 'open' check (status in ('open', 'done')),
  note text,
  sms_sent boolean not null default false,
  called_at timestamptz not null default now(),
  done_at timestamptz,
  done_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists garage_callbacks_open_idx on public.garage_callbacks (tenant_id, status, created_at desc);
alter table public.garage_callbacks enable row level security;
revoke all on public.garage_callbacks from anon, authenticated;
grant select on public.garage_callbacks to authenticated;
drop policy if exists garage_callbacks_read on public.garage_callbacks;
create policy garage_callbacks_read on public.garage_callbacks for select to authenticated
  using (tenant_id = public.current_user_tenant_id());

/** Server-side: a paybill / till payment becomes a payment applied to its invoice (once). */
create or replace function public.garage_settle_c2b(p_c2b uuid, p_invoice uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c public.garage_mpesa_c2b; i public.invoices; num text; pid uuid; amt numeric;
begin
  select * into c from public.garage_mpesa_c2b where id = p_c2b for update;
  if not found then raise exception 'Payment not found'; end if;
  if c.status = 'matched' then return 'matched'; end if;
  select * into i from public.invoices where id = p_invoice and tenant_id = c.tenant_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  -- A prompt (STK) payment on the same paybill is announced here too: never record it twice.
  if exists (select 1 from public.payments_received p where p.tenant_id = c.tenant_id and p.reference = c.trans_id) then
    update public.garage_mpesa_c2b set status = 'matched', invoice_id = i.id, note = 'Already recorded (payment prompt)' where id = c.id;
    return 'matched';
  end if;
  amt := least(c.amount, greatest(0, i.total - i.amount_paid));
  num := public.next_doc_number('payment', c.tenant_id);
  insert into public.payments_received (tenant_id, payment_number, customer_id, customer_name, payment_date, amount, method, reference, notes, received_by_name)
  values (c.tenant_id, num, i.customer_id, i.customer_name, coalesce(c.trans_time::date, current_date), c.amount, 'mpesa', c.trans_id,
          'M-Pesa paybill payment for ' || i.invoice_number || coalesce(' from ' || nullif(c.payer_name, ''), ''), 'M-Pesa (own paybill / till)')
  returning id into pid;
  if amt > 0 then insert into public.payment_allocations (tenant_id, payment_id, invoice_id, amount) values (c.tenant_id, pid, i.id, amt); end if;
  update public.garage_mpesa_c2b set status = 'matched', invoice_id = i.id, payment_id = pid,
    note = 'Paid towards ' || i.invoice_number || case when c.amount > amt then ' (' || (c.amount - amt) || ' more than it owed)' else '' end
   where id = c.id;
  insert into public.shop_notifications (tenant_id, kind, title, body, link, role, entity_type, entity_id)
  values (c.tenant_id, 'payment', 'M-Pesa payment received for ' || i.invoice_number,
          coalesce(nullif(c.payer_name, ''), 'A customer') || ' paid KES ' || c.amount || ' · ' || c.trans_id, '/sales/invoices/' || i.id, 'admin', 'invoice', i.id);
  return 'matched';
end $$;
revoke all on function public.garage_settle_c2b(uuid, uuid) from public, anon, authenticated;
grant execute on function public.garage_settle_c2b(uuid, uuid) to service_role;
