
-- product_categories
CREATE TABLE IF NOT EXISTS public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY pc_select ON public.product_categories
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY pc_manage ON public.product_categories
  FOR ALL TO authenticated
  USING (
    (tenant_id = public.current_user_tenant_id()
       AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')))
    OR public.has_role(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    (tenant_id = public.current_user_tenant_id()
       AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')))
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE TRIGGER trg_pc_updated BEFORE UPDATE ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- product_subcategories
CREATE TABLE IF NOT EXISTS public.product_subcategories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  category_id uuid REFERENCES public.product_categories(id) ON DELETE CASCADE,
  parent_name text,
  name text NOT NULL,
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, parent_name, name)
);
ALTER TABLE public.product_subcategories ENABLE ROW LEVEL SECURITY;

CREATE POLICY psc_select ON public.product_subcategories
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY psc_manage ON public.product_subcategories
  FOR ALL TO authenticated
  USING (
    (tenant_id = public.current_user_tenant_id()
       AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')))
    OR public.has_role(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    (tenant_id = public.current_user_tenant_id()
       AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')))
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE TRIGGER trg_psc_updated BEFORE UPDATE ON public.product_subcategories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- product_units
CREATE TABLE IF NOT EXISTS public.product_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  abbreviation text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE public.product_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY pu_select ON public.product_units
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_user_tenant_id() OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY pu_manage ON public.product_units
  FOR ALL TO authenticated
  USING (
    (tenant_id = public.current_user_tenant_id()
       AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')))
    OR public.has_role(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    (tenant_id = public.current_user_tenant_id()
       AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')))
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE TRIGGER trg_pu_updated BEFORE UPDATE ON public.product_units
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_pc_tenant ON public.product_categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_psc_tenant ON public.product_subcategories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pu_tenant ON public.product_units(tenant_id);

-- Backfill from inventory_settings json
INSERT INTO public.product_categories (tenant_id, name, sort_order)
SELECT s.tenant_id, x.name, (x.ord)::int
FROM public.inventory_settings s
CROSS JOIN LATERAL (
  SELECT jsonb_array_elements_text(s.categories) AS name,
         row_number() OVER () AS ord
) x
WHERE s.tenant_id IS NOT NULL AND x.name IS NOT NULL AND length(trim(x.name)) > 0
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO public.product_subcategories (tenant_id, parent_name, name, sort_order)
SELECT s.tenant_id,
       COALESCE(x.elem->>'parent', ''),
       COALESCE(x.elem->>'name', x.elem #>> '{}'),
       (x.ord)::int
FROM public.inventory_settings s
CROSS JOIN LATERAL (
  SELECT elem, row_number() OVER () AS ord
  FROM jsonb_array_elements(s.subcategories) AS elem
) x
WHERE s.tenant_id IS NOT NULL
  AND COALESCE(x.elem->>'name', x.elem #>> '{}') IS NOT NULL
  AND length(trim(COALESCE(x.elem->>'name', x.elem #>> '{}'))) > 0
ON CONFLICT (tenant_id, parent_name, name) DO NOTHING;

-- Link subcategories to categories where parent_name matches a category
UPDATE public.product_subcategories sc
SET category_id = c.id
FROM public.product_categories c
WHERE sc.tenant_id = c.tenant_id
  AND sc.parent_name = c.name
  AND sc.category_id IS NULL;

INSERT INTO public.product_units (tenant_id, name, sort_order)
SELECT s.tenant_id, x.name, (x.ord)::int
FROM public.inventory_settings s
CROSS JOIN LATERAL (
  SELECT jsonb_array_elements_text(s.units) AS name,
         row_number() OVER () AS ord
) x
WHERE s.tenant_id IS NOT NULL AND x.name IS NOT NULL AND length(trim(x.name)) > 0
ON CONFLICT (tenant_id, name) DO NOTHING;
