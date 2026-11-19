import type { AppDef } from "@/apps/types";
import { WORKSHOP_APPS } from "./workshop";
import { SPECIALIST_APPS } from "./specialist";

/**
 * Garage modules built on the record engine (app_records + the generic list/kanban/calendar/form screens).
 * Each AppDef key must match a module or suite app key in src/lib/modules.ts. Appended to APPS in src/apps/registry.ts.
 */
export const GARAGE_APPS: AppDef[] = [...WORKSHOP_APPS, ...SPECIALIST_APPS];
