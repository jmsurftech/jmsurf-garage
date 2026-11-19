-- Add address fields and main flag to locations
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS is_main boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS building text,
  ADD COLUMN IF NOT EXISTS po_box text,
  ADD COLUMN IF NOT EXISTS city text;

-- Mark the oldest location per tenant as Main (for existing data)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at ASC) AS rn
  FROM public.locations
  WHERE tenant_id IS NOT NULL
)
UPDATE public.locations l
SET is_main = true
FROM ranked r
WHERE l.id = r.id AND r.rn = 1;

-- Partial unique index: only one Main per tenant
CREATE UNIQUE INDEX IF NOT EXISTS locations_one_main_per_tenant
  ON public.locations (tenant_id)
  WHERE is_main = true;

-- Trigger: auto-mark first location as Main
CREATE OR REPLACE FUNCTION public.set_first_location_as_main()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL AND NOT NEW.is_main THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.locations
      WHERE tenant_id = NEW.tenant_id AND is_main = true AND id <> NEW.id
    ) THEN
      NEW.is_main := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_locations_set_main ON public.locations;
CREATE TRIGGER trg_locations_set_main
  BEFORE INSERT ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_first_location_as_main();