UPDATE public.platform_settings 
SET value = jsonb_set(jsonb_set(value::jsonb, '{port}', '"465"'), '{encryption}', '"ssl"'),
    updated_at = now()
WHERE key = 'smtp';