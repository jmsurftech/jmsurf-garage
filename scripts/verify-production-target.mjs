// Guards production builds against being pointed at the wrong database.
// The live JMSURF POS system runs on the self-hosted database at db.jmsurfpos.co.ke.
const ALLOWED_PRODUCTION_HOSTS = ["db.jmsurfpos.co.ke", "jmsurfgarage.co.ke", "garage.jmsurf.co.ke"];

const isProductionBuild = Boolean(
  process.env.NETLIFY || process.env.COOLIFY_URL || process.env.PRODUCTION_BUILD,
);

if (isProductionBuild) {
  const url = process.env.VITE_SUPABASE_URL;

  if (!url) {
    console.error("Production build blocked: VITE_SUPABASE_URL is missing.");
    process.exit(1);
  }

  let host;
  try {
    host = new URL(url).host;
  } catch {
    console.error("Production build blocked: VITE_SUPABASE_URL is not a valid URL.");
    process.exit(1);
  }

  if (!ALLOWED_PRODUCTION_HOSTS.includes(host)) {
    console.error(
      `Production build blocked: the database target "${host}" is not an approved JMSURF database.`,
    );
    process.exit(1);
  }

  if (!process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    console.error("Production build blocked: the database publishable key is missing.");
    process.exit(1);
  }

  console.log(`Production database target verified: ${host}`);
}
