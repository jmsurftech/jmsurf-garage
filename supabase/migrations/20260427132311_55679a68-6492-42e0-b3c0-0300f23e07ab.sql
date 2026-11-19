ALTER TABLE public.business_settings ALTER COLUMN use_platform_mpesa SET DEFAULT true;
UPDATE public.business_settings
SET use_platform_mpesa = true
WHERE use_platform_mpesa = false
  AND COALESCE(NULLIF(TRIM(mpesa_consumer_key), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(mpesa_consumer_secret), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(mpesa_passkey), ''), NULL) IS NULL;