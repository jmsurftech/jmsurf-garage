-- Other SMS gateways besides JMSURF SMS (still the default): SendBulkSMS,
-- Africa's Talking, Twilio, Infobip, Advanta and Celcom Africa. The company
-- chooses which one sends (System → SMS gateways).

alter table public.tenant_messaging add column if not exists sms_provider text not null default 'sendbulksms';
alter table public.tenant_messaging add column if not exists sms_account text;
alter table public.tenant_messaging add column if not exists sms_preferred text not null default 'jmsurf';
do $$ begin
  alter table public.tenant_messaging add constraint tenant_messaging_sms_provider_chk check (sms_provider in ('sendbulksms', 'africastalking', 'twilio', 'infobip', 'advanta', 'celcom'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tenant_messaging add constraint tenant_messaging_sms_preferred_chk check (sms_preferred in ('jmsurf', 'own'));
exception when duplicate_object then null; end $$;

create or replace function public.get_messaging_settings()
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
declare _t uuid := public.current_user_tenant_id(); m public.tenant_messaging%rowtype; s public.tenant_sms_settings%rowtype; p jsonb;
begin
  if auth.uid() is null or _t is null then return null; end if;
  select * into m from public.tenant_messaging where tenant_id = _t;
  select * into s from public.tenant_sms_settings where tenant_id = _t;
  select value into p from public.platform_settings where key = 'messaging';
  return jsonb_build_object(
    'sms_mode', coalesce(m.sms_mode, 'off'),
    'sms_sender_id', coalesce(m.sms_sender_id, ''),
    'has_sms_key', coalesce(m.sms_api_key, '') <> '',
    'sms_provider', coalesce(m.sms_provider, 'sendbulksms'),
    'sms_account', coalesce(m.sms_account, ''),
    'sms_preferred', coalesce(m.sms_preferred, 'jmsurf'),
    'wa_mode', coalesce(m.wa_mode, 'off'),
    'has_wa_key', coalesce(m.wa_api_key, '') <> '',
    'auto_receipt_sms', coalesce(m.auto_receipt_sms, false),
    'auto_receipt_whatsapp', coalesce(m.auto_receipt_whatsapp, false),
    'platform_sms_available', coalesce((p->>'sms_enabled')::boolean, false) and coalesce(p->>'sendbulksms_api_key', '') <> '',
    'platform_wa_available', coalesce((p->>'wa_enabled')::boolean, false) and coalesce(p->>'apiwap_api_key', '') <> '',
    'sms_units', coalesce(s.balance_units, 0),
    'sms_price', coalesce(s.price_per_sms, nullif(p->>'price_per_sms', '')::numeric, 1.5),
    'sms_total_sent', coalesce(s.total_sent, 0)
  );
end $function$;

-- The SendBulkSMS key check moves to the gateway save (other gateways have other key shapes).
create or replace function public.save_messaging_settings(p_sms_mode text, p_sms_api_key text, p_sms_sender_id text, p_wa_mode text, p_wa_api_key text, p_auto_receipt_sms boolean default false, p_auto_receipt_whatsapp boolean default false)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare _uid uuid := auth.uid(); _t uuid := public.current_user_tenant_id(); _sender text := nullif(trim(coalesce(p_sms_sender_id, '')), '');
begin
  if _uid is null or _t is null then raise exception 'Sign in first'; end if;
  if not (public.has_role(_uid, 'admin') or public.has_role(_uid, 'manager')) then raise exception 'Only the owner or a manager can change messaging'; end if;
  if p_sms_mode not in ('off', 'platform', 'own') or p_wa_mode not in ('off', 'platform', 'own') then raise exception 'Unknown option'; end if;
  if _sender is not null and _sender !~ '^[A-Za-z0-9 _.-]{1,11}$' then raise exception 'Sender ID: up to 11 letters or numbers'; end if;
  insert into public.tenant_messaging as tm (tenant_id, sms_mode, sms_api_key, sms_sender_id, wa_mode, wa_api_key, auto_receipt_sms, auto_receipt_whatsapp, updated_at, updated_by)
  values (_t, p_sms_mode, nullif(trim(p_sms_api_key), ''), _sender, p_wa_mode, nullif(trim(p_wa_api_key), ''), coalesce(p_auto_receipt_sms, false), coalesce(p_auto_receipt_whatsapp, false), now(), _uid)
  on conflict (tenant_id) do update set
    sms_mode = excluded.sms_mode,
    sms_api_key = case when p_sms_api_key is null then tm.sms_api_key else nullif(trim(p_sms_api_key), '') end,
    sms_sender_id = excluded.sms_sender_id,
    wa_mode = excluded.wa_mode,
    wa_api_key = case when p_wa_api_key is null then tm.wa_api_key else nullif(trim(p_wa_api_key), '') end,
    auto_receipt_sms = excluded.auto_receipt_sms,
    auto_receipt_whatsapp = excluded.auto_receipt_whatsapp,
    updated_at = now(), updated_by = _uid;
  return public.get_messaging_settings();
end $function$;

/** Saves the company's own SMS gateway and which gateway sends. A null key keeps the saved one. */
create or replace function public.save_sms_gateway(p_provider text, p_account text, p_api_key text, p_sender_id text, p_preferred text, p_enabled boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare _uid uuid := auth.uid(); _t uuid := public.current_user_tenant_id(); _sender text := nullif(trim(coalesce(p_sender_id, '')), ''); _key text := nullif(trim(coalesce(p_api_key, '')), '');
begin
  if _uid is null or _t is null then raise exception 'Sign in first'; end if;
  if not (public.has_role(_uid, 'admin') or public.has_role(_uid, 'manager')) then raise exception 'Only the owner or a manager can change messaging'; end if;
  if p_provider not in ('sendbulksms', 'africastalking', 'twilio', 'infobip', 'advanta', 'celcom') then raise exception 'Choose a gateway'; end if;
  if p_preferred not in ('jmsurf', 'own') then raise exception 'Unknown option'; end if;
  if _sender is not null and length(_sender) > 15 then raise exception 'Sender ID: up to 11 letters (or a phone number)'; end if;
  if p_provider = 'sendbulksms' and _key is not null and _key !~ '^bsms_(test|live)_[A-Za-z0-9_-]+$' then
    raise exception 'That does not look like a SendBulkSMS API key (it starts with bsms_live_)';
  end if;
  if p_provider in ('africastalking', 'twilio', 'infobip', 'advanta', 'celcom') and coalesce(trim(p_account), '') = '' then
    raise exception '%', case p_provider when 'africastalking' then 'Enter the Africa''s Talking username' when 'twilio' then 'Enter the Twilio Account SID'
      when 'infobip' then 'Enter your Infobip base URL (e.g. xxxxx.api.infobip.com)' else 'Enter the partner ID' end;
  end if;
  insert into public.tenant_messaging as tm (tenant_id, sms_mode, sms_provider, sms_account, sms_api_key, sms_sender_id, sms_preferred, wa_mode, updated_at, updated_by)
  values (_t, case when p_enabled then 'own' else 'off' end, p_provider, nullif(trim(p_account), ''), _key, _sender, p_preferred, 'off', now(), _uid)
  on conflict (tenant_id) do update set
    sms_mode = case when p_enabled then 'own' when tm.sms_mode = 'own' then 'off' else tm.sms_mode end,
    sms_provider = excluded.sms_provider,
    sms_account = excluded.sms_account,
    -- A different gateway needs its own key.
    sms_api_key = case when _key is not null then _key when tm.sms_provider is distinct from p_provider then null else tm.sms_api_key end,
    sms_sender_id = excluded.sms_sender_id,
    sms_preferred = excluded.sms_preferred,
    updated_at = now(), updated_by = _uid;
  return public.get_messaging_settings();
end $$;
grant execute on function public.save_sms_gateway(text, text, text, text, text, boolean) to authenticated;
