import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { LOGIN_META } from "@/seo/meta";
import { ArrowRight, Building2, Mail, ShieldCheck, Eye, EyeOff } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import { Segmented, Field } from "@/components/kit";
import { resolveTenantBySlug } from "@/hooks/useTenant";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { safeNextPath } from "@/lib/safeNext";
import { ROOT_HOST, companyUrl, PLATFORM_ORIGIN } from "@/lib/host";
import { goToCompany, listMyCompanies, type MyCompany } from "@/lib/companySwitch";
import { OrbSpinner } from "@/components/orbs";

/**
 * Sign in once (website / app. address) and land in your company already
 * signed in. Several companies: pick one. (The super admin has its own private address.)
 */
export default function Login() {
  const [slug, setSlug] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"email" | "company">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [choices, setChoices] = useState<{ companies: MyCompany[]; platform: boolean } | null>(null);
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const next = safeNextPath(searchParams.get("next")) || "/dashboard";

  const route = async () => {
    // The super admin is private: it is only reached at its own address, never from here.
    const companies = await listMyCompanies();
    const platform = false;
    if (companies.length === 1) { await goToCompany(companies[0].slug || "", next); return; }
    if (!companies.length) {
      await supabase.auth.signOut({ scope: "local" });
      toast({ title: "No company yet", description: "This login is not linked to a company. Create one to start.", variant: "destructive" });
      return;
    }
    setChoices({ companies, platform: !!platform });
  };

  // Already signed in: go straight on.
  useEffect(() => {
    if (authLoading || !user || choices) return;
    void route();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  const handleGo = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!clean) return;
    setLoading(true);
    try {
      const tenant = await resolveTenantBySlug(clean);
      if (tenant) window.location.href = companyUrl(clean, "/login");
      else toast({ title: "Company not found", description: `No company uses ${clean}.${ROOT_HOST}`, variant: "destructive" });
    } catch {
      toast({ title: "Error", description: "Could not check that address", variant: "destructive" });
    } finally { setLoading(false); }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error || !data.user) throw new Error("That email and password don't match an account.");
      await route();
    } catch (err: any) {
      toast({ title: "Couldn't sign in", description: err?.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <>
      <Helmet>
        <title>{LOGIN_META.title}</title>
        <meta name="description" content={LOGIN_META.description} />
        <meta name="robots" content="noindex, follow" />
        <link rel="canonical" href="https://garage.jmsurf.co.ke/login" />
      </Helmet>
      <AuthShell title={choices ? "Choose a company" : "Sign in"} subtitle={choices ? "You have access to more than one." : "One login for every company you run."}
        footer={<>New to JMSURF Garage? <a href="/register" className="font-semibold text-primary hover:underline">Start free</a></>}>
        {choices ? (
          <div className="space-y-2">
            {choices.companies.map((c) => (
              <button key={c.tenant_id} onClick={() => void goToCompany(c.slug || "", next)}
                className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5">
                <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-primary/10 font-bold text-primary">
                  {c.logo_url ? <img src={c.logo_url} alt="" className="h-full w-full object-contain" /> : c.business_name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.business_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{c.slug}.{ROOT_HOST}</span>
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        ) : (
          <>
            <Segmented value={mode} onChange={(v) => setMode(v as "email" | "company")} className="mb-6 w-full" options={[
              { value: "email", label: <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />Email</span> },
              { value: "company", label: <span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />Company address</span> },
            ]} />
            {mode === "email" ? (
              <form onSubmit={handleSignIn} className="space-y-4">
                <Field label="Email"><input type="email" autoComplete="email" className="fi h-12 text-base" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus disabled={loading} /></Field>
                <Field label="Password">
                  <div className="relative">
                    <input type={show ? "text" : "password"} autoComplete="current-password" className="fi h-12 pr-11 text-base" value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} />
                    <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                  </div>
                </Field>
                <button type="submit" disabled={!email.trim() || !password || loading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 disabled:opacity-50">
                  {loading ? <OrbSpinner className="h-4 w-4" /> : null}
                  {loading ? "Signing in…" : "Sign in"} {!loading && <ArrowRight className="h-4 w-4" />}
                </button>
                <p className="text-center text-xs text-muted-foreground"><a href="/reset-password" className="font-semibold text-primary hover:underline">Forgot password?</a></p>
              </form>
            ) : (
              <form onSubmit={handleGo} className="space-y-4">
                <Field label="Company address">
                  <div className="flex">
                    <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="yourcompany" autoFocus disabled={loading}
                      autoCapitalize="none" autoCorrect="off" spellCheck={false} className="fi h-12 rounded-r-none text-base" />
                    <span className="flex items-center rounded-r-xl border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">.{ROOT_HOST}</span>
                  </div>
                </Field>
                <button type="submit" disabled={!slug.trim() || loading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 disabled:opacity-50">
                  {loading ? <OrbSpinner className="h-4 w-4" /> : null}
                  {loading ? "Checking…" : "Continue"} {!loading && <ArrowRight className="h-4 w-4" />}
                </button>
              </form>
            )}
          </>
        )}
      </AuthShell>
    </>
  );
}
