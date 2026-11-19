// Router for the self-hosted Supabase Edge Runtime.
// The self-hosted edge-runtime container boots a single "main" worker which
// dispatches each request to /functions/v1/<name> to the matching function.
// This file is ignored by Supabase Cloud deployments.

// deno-lint-ignore-file no-explicit-any
const JWT_SECRET = Deno.env.get("SUPABASE_INTERNAL_JWT_SECRET") ?? "";
const VERIFY_JWT = (Deno.env.get("VERIFY_JWT") ?? "false") === "true";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const name = pathname.replace(/^\/+/, "").split("/")[0];

  if (!name || name === "_internal") {
    return new Response(JSON.stringify({ error: "Function name is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const servicePath = `/home/deno/functions/${name}`;

  const memoryLimitMb = 256;
  const workerTimeoutMs = 5 * 60 * 1000;
  const noModuleCache = false;
  const importMapPath = null;
  const envVars = Object.entries(Deno.env.toObject());

  try {
    const worker = await (EdgeRuntime as any).userWorkers.create({
      servicePath,
      memoryLimitMb,
      workerTimeoutMs,
      noModuleCache,
      importMapPath,
      envVars,
      forceCreate: false,
      jwtSecret: JWT_SECRET,
      verifyJwt: VERIFY_JWT,
    });

    return await worker.fetch(req);
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Function not available", detail: String(error) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
