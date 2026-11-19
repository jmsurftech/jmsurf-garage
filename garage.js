// ---------------------------------------------------------------------------
// JMSURF Garage server routes (/api/garage/*).
//
// server.js calls isGarageRoute(pathname) and hands matching requests to
// handleGarageRequest(req, res, pathname, { sendJson, readJsonBody }).
// Each area owns its own file and URL prefix, so the areas never edit the same file:
//   /api/garage/w/*  garage-workshop.js     (job cards, estimates, tracking, booking, reminders)
//   /api/garage/s/*  garage-specialist.js   (insurance, fleet, imports, yard, wash, towing, hire)
//   /api/garage/i/*  garage-integrations.js (WhatsApp, call centre, connections)
// startGarageJobs() runs each area's background jobs once at start.
// ---------------------------------------------------------------------------
import * as workshop from "./garage-workshop.js";
import * as specialist from "./garage-specialist.js";
import * as integrations from "./garage-integrations.js";

const AREAS = [
  ["/api/garage/w/", workshop],
  ["/api/garage/s/", specialist],
  ["/api/garage/i/", integrations],
];

export function isGarageRoute(pathname) {
  return pathname.startsWith("/api/garage/");
}

export async function handleGarageRequest(req, res, pathname, helpers) {
  for (const [prefix, area] of AREAS) {
    if (pathname.startsWith(prefix)) return area.handle(req, res, pathname.slice(prefix.length), helpers);
  }
  return helpers.sendJson(res, 404, { error: "Not found" });
}

export function startGarageJobs() {
  for (const [, area] of AREAS) {
    try { area.startJobs?.(); } catch (e) { console.error("[garage] job start failed", e?.message || e); }
  }
}
