-- Seed platform-wide M-Pesa defaults so every tenant can run STK Push
-- by simply entering their till/paybill number. Super-admins can override
-- per tenant by toggling business_settings.use_platform_mpesa = false.
INSERT INTO public.platform_settings (key, value, updated_at)
VALUES (
  'payment',
  jsonb_build_object(
    'mpesa', jsonb_build_object(
      'consumer_key', 'wSnVI9NChi2LrX1Q1B44Hrv5ZFMA9ZTU',
      'consumer_secret', 'H3FvEscmTdyLbJQZ',
      'passkey', '9dc9fc69c16e292e2e8ee5d440dc5ade183f0a2da56b7232868f6a46f775ab08',
      'environment', 'live'
    )
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = jsonb_set(
      COALESCE(public.platform_settings.value, '{}'::jsonb),
      '{mpesa}',
      COALESCE(public.platform_settings.value->'mpesa', '{}'::jsonb)
        || jsonb_build_object(
          'consumer_key', 'wSnVI9NChi2LrX1Q1B44Hrv5ZFMA9ZTU',
          'consumer_secret', 'H3FvEscmTdyLbJQZ',
          'passkey', '9dc9fc69c16e292e2e8ee5d440dc5ade183f0a2da56b7232868f6a46f775ab08',
          'environment', 'live'
        ),
      true
    ),
    updated_at = now();

-- Make sure platform_settings has a UNIQUE constraint on key (required for ON CONFLICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'platform_settings_key_key'
      AND conrelid = 'public.platform_settings'::regclass
  ) THEN
    -- Add it only if missing; ignore if column already unique elsewhere
    BEGIN
      ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_key_key UNIQUE (key);
    EXCEPTION WHEN duplicate_table OR unique_violation OR duplicate_object THEN
      NULL;
    END;
  END IF;
END$$;

-- Flip use_platform_mpesa = true for any tenant that does NOT have its own
-- consumer_key + secret + passkey. Tenants that already entered all 3 custom
-- credentials are left alone so super_admin can still switch them later.
UPDATE public.business_settings
SET use_platform_mpesa = true,
    updated_at = now()
WHERE COALESCE(use_platform_mpesa, false) = false
  AND (
    NULLIF(trim(mpesa_consumer_key), '') IS NULL
    OR NULLIF(trim(mpesa_consumer_secret), '') IS NULL
    OR NULLIF(trim(mpesa_passkey), '') IS NULL
  );