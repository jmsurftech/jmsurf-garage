import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const LOAD_TIMEOUT_MS = 15_000;

function logOAuthEvent(event: string, data: Record<string, unknown> = {}) {
  // Structured console log so we can grep silent-failure traces in the browser
  // and (later) forward to an analytics sink without changing call sites.
  try {
    // eslint-disable-next-line no-console
    console.info("[oauth.consent]", event, {
      ts: new Date().toISOString(),
      path: typeof window !== "undefined" ? window.location.pathname + window.location.search : null,
      ...data,
    });
  } catch {
    /* ignore */
  }
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"missing" | "expired" | "timeout" | "generic" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      if (!authorizationId) {
        logOAuthEvent("missing_authorization_id");
        setErrorKind("missing");
        setError("This authorization link is missing an authorization_id parameter.");
        return;
      }

      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        // Preserve the FULL consent URL so we return here after sign-in.
        const next = window.location.pathname + window.location.search;
        logOAuthEvent("redirect_to_login", { authorizationId, next });
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }

      logOAuthEvent("resume_after_auth", { authorizationId, userId: sess.session.user?.id });

      timeoutId = setTimeout(() => {
        if (!active) return;
        logOAuthEvent("get_details_timeout", { authorizationId });
        setErrorKind("timeout");
        setError(
          "We couldn't reach the authorization server in time. Please try the connect link again from the app that started the connection."
        );
      }, LOAD_TIMEOUT_MS);

      try {
        const { data, error } = await (supabase.auth as any).oauth.getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (timeoutId) clearTimeout(timeoutId);

        if (error) {
          const msg = String(error?.message ?? "");
          const expired = /expire|not.?found|invalid/i.test(msg);
          logOAuthEvent("get_details_error", { authorizationId, message: msg, expired });
          setErrorKind(expired ? "expired" : "generic");
          setError(
            expired
              ? "This authorization request has expired or is no longer valid. Please restart the connection from the app that requested access."
              : msg || "We couldn't load this authorization request."
          );
          return;
        }

        const immediate = (data as any)?.redirect_url ?? (data as any)?.redirect_to;
        if (immediate && !(data as any)?.client) {
          logOAuthEvent("immediate_redirect", { authorizationId, target: immediate });
          window.location.href = immediate;
          return;
        }
        logOAuthEvent("details_loaded", { authorizationId, client: (data as any)?.client?.name ?? null });
        setDetails(data);
      } catch (e: any) {
        if (!active) return;
        if (timeoutId) clearTimeout(timeoutId);
        logOAuthEvent("get_details_exception", { authorizationId, message: String(e?.message ?? e) });
        setErrorKind("generic");
        setError("Something went wrong loading this authorization request. Please try again.");
      }
    })();

    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    logOAuthEvent(approve ? "approve_start" : "deny_start", { authorizationId });
    const oauth = (supabase.auth as any).oauth;
    try {
      const { data, error } = approve
        ? await oauth.approveAuthorization(authorizationId)
        : await oauth.denyAuthorization(authorizationId);
      if (error) {
        logOAuthEvent(approve ? "approve_error" : "deny_error", {
          authorizationId,
          message: String(error?.message ?? ""),
        });
        setBusy(false);
        setErrorKind("generic");
        return setError(error.message);
      }
      const target = (data as any)?.redirect_url ?? (data as any)?.redirect_to;
      if (!target) {
        logOAuthEvent(approve ? "approve_no_redirect" : "deny_no_redirect", { authorizationId });
        setBusy(false);
        setErrorKind("generic");
        return setError("No redirect returned by the authorization server.");
      }
      logOAuthEvent(approve ? "approve_redirect" : "deny_redirect", { authorizationId, target });
      window.location.href = target;
    } catch (e: any) {
      logOAuthEvent(approve ? "approve_exception" : "deny_exception", {
        authorizationId,
        message: String(e?.message ?? e),
      });
      setBusy(false);
      setErrorKind("generic");
      setError("Something went wrong completing this authorization. Please try again.");
    }
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" data-testid="oauth-error">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold">
            {errorKind === "expired"
              ? "Authorization expired"
              : errorKind === "timeout"
              ? "Authorization timed out"
              : errorKind === "missing"
              ? "Invalid authorization link"
              : "Authorization error"}
          </h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <p className="text-xs text-muted-foreground pt-2">
            You can close this tab and try connecting again from the app that requested access.
          </p>
        </div>
      </main>
    );
  }
  if (!details) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  const clientName = details.client?.name ?? "an app";
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-card border border-border rounded-xl p-6 space-y-4" data-testid="oauth-consent">
        <h1 className="text-xl font-semibold">Connect {clientName} to your JMSURF Garage account</h1>
        <p className="text-sm text-muted-foreground">
          This will let {clientName} read your business data (products, stock, sales, summaries) on your behalf. You can revoke access at any time.
        </p>
        <div className="flex gap-2 justify-end pt-2">
          <button
            disabled={busy}
            onClick={() => decide(false)}
            data-testid="oauth-deny"
            className="px-4 py-2 rounded-lg text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-60"
          >
            Deny
          </button>
          <button
            disabled={busy}
            onClick={() => decide(true)}
            data-testid="oauth-approve"
            className="px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            Approve
          </button>
        </div>
      </div>
    </main>
  );
}
