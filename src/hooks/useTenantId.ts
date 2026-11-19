import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";

/**
 * Resolves the active tenant_id for the current session.
 * For super admins viewing a slug-scoped workspace, prefer the URL tenant.
 * For normal tenant users, prefer the authenticated profile tenant.
 */
export function useTenantId(): string | null {
  const { profile, role } = useAuth();
  const { tenant } = useTenant();

  if (role === "super_admin" && tenant?.id) return tenant.id;
  return profile?.tenant_id || tenant?.id || null;
}
