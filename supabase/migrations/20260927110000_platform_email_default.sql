-- Shops send email through the JMSURF mail server unless they save their own
-- (2026-09-27). Shops that have no mail server of their own are switched to it
-- now so receipts and notices always go out.
ALTER TABLE public.business_settings ALTER COLUMN use_platform_smtp SET DEFAULT true;
UPDATE public.business_settings SET use_platform_smtp = true
  WHERE coalesce(smtp_host, '') = '' AND coalesce(use_platform_smtp, false) = false;
