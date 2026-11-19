// JMSURF Garage server area: workshop. Mounted by garage.js under /api/garage/w/.
// handle(req, res, subpath, { sendJson, readJsonBody }) answers one request; startJobs() starts background jobs.

export async function handle(req, res, subpath, { sendJson }) {
  return sendJson(res, 404, { error: "Not found" });
}

export function startJobs() {}
