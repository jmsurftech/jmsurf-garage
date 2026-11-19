import type { ComponentType } from "react";
import { WORKSHOP_ROUTES, WORKSHOP_PUBLIC_ROUTES } from "./workshop";
import { SPECIALIST_ROUTES, SPECIALIST_PUBLIC_ROUTES } from "./specialist";
import { INTEGRATION_ROUTES } from "./integrations";

/**
 * JMSURF Garage pages. App.tsx mounts these. Each area keeps its own list in its folder
 * (workshop/, specialist/, integrations/) so the areas never edit the same file.
 *
 * GARAGE_ROUTES        staff workspace pages (company app). Relative paths, no leading slash,
 *                      e.g. "garage/jobs/:id". `bare` = full screen without the sidebar (mechanic phone view, TV board).
 * GARAGE_PUBLIC_ROUTES pages with no staff sign-in (estimate approval, job tracking, online booking).
 *                      Absolute paths, e.g. "/e/:token".
 */
export interface GarageRoute {
  path: string;
  page: ComponentType;
  bare?: boolean;
}

export const GARAGE_ROUTES: GarageRoute[] = [...WORKSHOP_ROUTES, ...SPECIALIST_ROUTES, ...INTEGRATION_ROUTES];

export const GARAGE_PUBLIC_ROUTES: GarageRoute[] = [...WORKSHOP_PUBLIC_ROUTES, ...SPECIALIST_PUBLIC_ROUTES];
