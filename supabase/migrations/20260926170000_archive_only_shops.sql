-- Shops are archived, never deleted (2026-09-26)
--
-- Archiving sets tenants.deleted_at / is_active = false and keeps every
-- record, so a shop can be restored at any time. With no DELETE policy the
-- API cannot remove a shop row (and cascade away its data) for anyone.

DROP POLICY IF EXISTS tenants_delete ON public.tenants;
