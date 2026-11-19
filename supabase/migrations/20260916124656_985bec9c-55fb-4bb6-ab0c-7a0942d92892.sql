CREATE OR REPLACE FUNCTION public.allowed_feature_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT ARRAY[
    'sales','purchases','roles','communication','smtp_email',
    'sms','whatsapp','theme','session','reports','staff',
    'inventory_transfer','dashboard','customers','suppliers',
    'invoices','quotes','bills','expenses','audit_logs'
  ]::text[];
$function$;