// Single source of truth for PayHero platform credentials.
// Order of precedence: values saved by the super admin in Admin -> Settings ->
// Payment Gateways (platform_settings.payment.payhero), then runtime secrets.
export type PayheroCreds = {
  username: string;
  password: string;
  accountId: string;
  channelId: string;
  /** Ready-to-use Authorization header value (handles pasted Basic tokens too). */
  authHeader: string;
  configured: boolean;
};


type MinimalClient = {
  from: (table: string) => any;
};

const pick = (...values: Array<unknown>) => {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
};

export async function getPayheroCredentials(admin: MinimalClient): Promise<PayheroCreds> {
  let saved: Record<string, unknown> = {};
  try {
    const { data } = await admin
      .from("platform_settings")
      .select("value")
      .eq("key", "payment")
      .maybeSingle();
    saved = ((data as any)?.value?.payhero || {}) as Record<string, unknown>;
  } catch (_e) {
    saved = {};
  }

  const username = pick(
    saved.api_username,
    Deno.env.get("PAYHERO_API_USERNAME"),
  );
  const password = pick(saved.api_password, Deno.env.get("PAYHERO_API_PASSWORD"));
  const accountId = pick(saved.account_id, Deno.env.get("PAYHERO_ACCOUNT_ID"));
  const channelId = pick(saved.channel_id, Deno.env.get("PAYHERO_CHANNEL_ID"));
  // Some PayHero dashboards hand out a ready-made Basic token instead of a
  // username/password pair. Support both without extra setup.
  const token = pick(saved.basic_auth_token, Deno.env.get("PAYHERO_BASIC_AUTH_TOKEN"));

  const authHeader = username && password
    ? "Basic " + btoa(`${username}:${password}`)
    : token
      ? (token.toLowerCase().startsWith("basic ") ? token : `Basic ${token}`)
      : "";

  return {
    username,
    password,
    accountId,
    channelId,
    authHeader,
    configured: Boolean(authHeader),
  };
}

export function basicAuthHeader(user: string, pass: string) {
  return "Basic " + btoa(`${user}:${pass}`);
}

