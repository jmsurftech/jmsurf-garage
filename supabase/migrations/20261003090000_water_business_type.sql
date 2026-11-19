-- Water Refill shops (2026-10-03)
--
-- A new enum value can't be used in the transaction that adds it, so this
-- runs on its own before 20261003091000_water_tanks.sql.
ALTER TYPE public.business_type ADD VALUE IF NOT EXISTS 'water';
