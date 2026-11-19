UPDATE public.platform_settings
SET value = jsonb_set(
  jsonb_set(
    jsonb_set(value, '{port}', '"465"'::jsonb),
    '{encryption}', '"ssl"'::jsonb
  ),
  '{host}', '"das124.truehost.cloud"'::jsonb
),
updated_at = now()
WHERE key = 'smtp';