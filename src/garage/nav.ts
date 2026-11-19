import type { NavEntry } from "@/lib/navConfig";
import { WORKSHOP_NAV } from "./workshop";
import { SPECIALIST_NAV } from "./specialist";
import { INTEGRATION_NAV } from "./integrations";

/**
 * Garage menu entries, shown right after Dashboard in the company sidebar.
 * Set `module` on an entry (a key from src/lib/modules.ts) to hide it until that module is on.
 */
export const GARAGE_NAV: NavEntry[] = [...WORKSHOP_NAV, ...SPECIALIST_NAV, ...INTEGRATION_NAV];
