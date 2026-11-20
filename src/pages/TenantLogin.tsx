import { useState, useEffect, useRef } from "react";
import { setBrand, tabTitle } from "@/lib/brand";
import { isErpHost, SITE_ORIGIN } from "@/lib/host";
import { belongsToShop, WRONG_SHOP_MESSAGE } from "@/lib/shopAccess";
import { EXPIRED_SIGNIN_MESSAGE } from "@/lib/subscriptionLock";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Mail, Lock, Eye, EyeOff, Store, ArrowLeft } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import { OrbSpinner } from "@/components/orbs";
import { useToast } from "@/hooks/use-toast";
import { resolveTenantBySlug } from "@/hooks/useTenant";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/friendlyError";
import { safeNextPath } from "@/lib/safeNext";
import { getHostSlug, ROOT_HOST, tenantPath } from "@/lib/host";
import { sendVerificationEmail, requestPasswordReset, resolveLoginEmail } from "@/lib/platformEmail";


function ForgotPassword({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { toast } = useToast();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await requestPasswordReset(email.trim());
      if (!result.ok) throw new Error(result.error || "Could not send the reset link. Please try again.");
      setSent(true);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <p className="text-center text-sm text-muted-foreground mt-3">
        <button type="button" onClick={() => setOpen(true)} className="text-primary font-semibold hover:underline">
          Forgot password?
        </button>
      </p>
    );
  }

  if (sent) {
    return (
      <p className="text-center text-sm text-muted-foreground mt-3">
        Check your email for a temporary password. Sign in with it and you will be asked to set a new password straight away.
      </p>
    );
  }

  return (
    <form onSubmit={handleReset} className="mt-3 space-y-3">
      <p className="text-sm text-muted-foreground text-center">Enter your email to reset password</p>
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="email" required value={email} onChange={e => setEmail(e.target.value)}
          placeholder="Email address"
          className="fi h-12 pl-10 text-base"
        />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="flex-1 h-11 rounded-xl border border-border text-sm font-semibold hover:bg-muted transition-colors">Cancel</button>
        <button type="submit" disabled={loading} className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50">{loading ? "Sending..." : "Send Link"}</button>
      </div>
    </form>
  );
}

function ResendVerification({ slug, presetEmail, highlight, onVerified }: { slug: string; presetEmail?: string; highlight?: boolean; onVerified?: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(presetEmail || "");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (presetEmail && /@/.test(presetEmail)) setEmail(presetEmail);
  }, [presetEmail]);

  const send = async (address: string) => {
    const clean = address.trim();
    if (!/@/.test(clean)) {
      toast({ title: "Email needed", description: "Enter the email address you signed up with.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      // The mail service inside the app sends this directly.
      let payload: any = await sendVerificationEmail(clean, `${window.location.origin}/dashboard`);

      if (payload?.unavailable) {
        throw new Error("We could not reach the mail service. Please try again in a moment.");
      }
      if (payload?.error) throw new Error(payload.error);

      if (payload?.alreadyVerified) {
        toast({ title: "Already verified", description: "This email is verified. Sign in with your password." });
        onVerified?.();
        return;
      }
      setSent(true);
      toast({
        title: "Verification email sent",
        description: `Check ${clean} (including the spam folder) and click the link to activate your account.`,
      });
    } catch (err: any) {
      toast({ title: "Could not send", description: friendlyError(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <p className="text-center text-sm text-muted-foreground mt-3">
        Verification email sent. Open the link in your inbox, then sign in here.
      </p>
    );
  }

  if (highlight && !open) {
    return (
      <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-center space-y-3">
        <p className="text-sm text-amber-800 dark:text-amber-200">Your email is not verified yet.</p>
        <button
          type="button"
          disabled={loading}
          onClick={() => (presetEmail && /@/.test(presetEmail) ? send(presetEmail) : setOpen(true))}
          className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-40"
        >
          {loading ? "Sending..." : "Resend verification email"}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <p className="text-center text-sm text-muted-foreground mt-2">
        <button type="button" onClick={() => setOpen(true)} className="text-primary font-semibold hover:underline">
          Resend verification email
        </button>
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); send(email); }}
      className="mt-3 space-y-3"
    >
      <p className="text-sm text-muted-foreground text-center">Enter your email to get a new verification link</p>
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="email" required value={email} onChange={e => setEmail(e.target.value)}
          placeholder="Email address"
          className="fi h-12 pl-10 text-base"
        />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="flex-1 h-11 rounded-xl border border-border text-sm font-semibold hover:bg-muted transition-colors">Cancel</button>
        <button type="submit" disabled={loading} className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50">{loading ? "Sending..." : "Send Link"}</button>
      </div>
    </form>
  );
}

export default function TenantLogin() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug || getHostSlug() || "";
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const nextParam = searchParams.get("next");
  const safeNext = safeNextPath(nextParam);
  const { user, loading: authLoading, role, signOut } = useAuth();
  const { toast } = useToast();
  const [tenant, setTenant] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState("");
  // Holds the redirect while a fresh sign-in is checked against this shop.
  const checkingShop = useRef(false);
  const [confirmed, setConfirmed] = useState(0);
  const [shopError, setShopError] = useState<string | null>(
    searchParams.get("wrong_shop") ? WRONG_SHOP_MESSAGE : searchParams.get("expired") ? EXPIRED_SIGNIN_MESSAGE : null,
  );

  // The resend link is only for brand-new shops that have not signed in yet.
  // Once an account signs in successfully (or turns out to be verified), the
  // link disappears for good on this device.
  const verifiedKey = `jmsurf_verified_${slug}`;
  const [everSignedIn, setEverSignedIn] = useState(false);
  const isNewSignup = searchParams.get("new") === "1";
  const markVerified = () => {
    try { localStorage.setItem(verifiedKey, "1"); } catch { /* storage blocked */ }
    setEverSignedIn(true);
    setNeedsVerification(false);
  };

  useEffect(() => {
    try { setEverSignedIn(localStorage.getItem(`jmsurf_verified_${slug}`) === "1"); } catch { /* storage blocked */ }
  }, [slug]);

  const showResend = !everSignedIn && (isNewSignup || needsVerification);


  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) setNotFound(true); }, 8000);
    resolveTenantBySlug(slug)
      .then((t) => {
        if (cancelled) return;
        if (t) { setTenant(t); setBrand(t.business_name || null); document.title = tabTitle("Sign in"); }
        else setNotFound(true);
      })
      .catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => clearTimeout(timer));
    return () => { cancelled = true; clearTimeout(timer); };
  }, [slug]);


  // Only this shop's own accounts (and the platform owner) get in here.
  useEffect(() => {
    if (authLoading || !user || !slug || checkingShop.current) return;
    if (safeNext) {
      window.location.replace(safeNext);
      return;
    }
    // Riders work from their delivery screen; everyone else starts on the dashboard.
    nav(tenantPath(slug, role === "rider" ? "/rider" : "/dashboard"), { replace: true });
  }, [user, authLoading, slug, nav, safeNext, role, confirmed]);



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!navigator.onLine) {
      toast({ title: "Offline", description: "You need internet to sign in. If you were previously logged in, your session should auto-restore.", variant: "destructive" });
      return;
    }
    setLoading(true);
    setNeedsVerification(false);
    let signInEmail = email.trim();
    try {
      if (!/@/.test(signInEmail)) {
        const resolved = await resolveLoginEmail(signInEmail, password);
        if (!resolved.email) throw new Error(resolved.error || "Invalid phone or password.");
        signInEmail = resolved.email;
      }
      setShopError(null);
      checkingShop.current = true;
      const { data: signed, error } = await supabase.auth.signInWithPassword({ email: signInEmail, password });
      if (error) { checkingShop.current = false; throw error; }
      const allowed = tenant?.id && signed.user ? await belongsToShop(signed.user.id, tenant.id).catch(() => false) : false;
      if (!allowed) {
        await supabase.auth.signOut({ scope: "local" });
        checkingShop.current = false;
        setShopError(WRONG_SHOP_MESSAGE);
        return;
      }
      checkingShop.current = false;
      markVerified();
      // Let the redirect effect run now that the account is confirmed.
      setConfirmed((c) => c + 1);
    } catch (err: any) {
      const raw = `${err?.message || ""} ${err?.code || ""}`.toLowerCase();
      if (raw.includes("not confirmed") || raw.includes("email_not_confirmed") || raw.includes("not verified")) {
        setNeedsVerification(true);
        setVerifyEmail(signInEmail);
        toast({
          title: "Email not verified",
          description: "Use the button below to get a new verification link.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Sign in failed", description: friendlyError(err), variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  };

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-sm text-center space-y-4">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Store className="h-7 w-7" /></span>
          <h1 className="font-display text-2xl font-bold">Store not found</h1>
          <p className="text-muted-foreground">The store URL "/{slug}" does not exist.</p>
          <div className="flex justify-center gap-2"><button onClick={() => nav("/login")} className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground">Find my store</button><button onClick={() => nav("/")} className="h-11 rounded-xl border border-border px-5 text-sm font-semibold hover:bg-muted">Home</button></div>
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <OrbSpinner className="size-10" label="Loading" />
      </div>
    );
  }

  const logoUrl = tenant.logo_url;

  return (
    <AuthShell
      variant="card"
      shopTheme
      brandName={tenant.business_name}
      logoUrl={logoUrl}
      title="Welcome back"
      subtitle="Staff sign-in. Use your email or phone number."
      
      footer={<div className="space-y-4"><a href={isErpHost() ? SITE_ORIGIN : "/"} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> Back to the website</a></div>}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {shopError && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert">{shopError}</p>}
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" required value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email or phone number"
            autoComplete="username"
            className="fi h-12 pl-10 text-base" />
        </div>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type={showPw ? "text" : "password"} required value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Password" minLength={6}
            className="fi h-12 pl-10 pr-11 text-base" />
          <button type="button" onClick={() => setShowPw(!showPw)} aria-label={showPw ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground">
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 disabled:opacity-50"
        >
          {loading && <OrbSpinner className="size-4" tint="#ffffff" />}{loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {showResend && (
        <ResendVerification
          key={needsVerification ? "needs" : "idle"}
          slug={slug!}
          presetEmail={verifyEmail || (/@/.test(email) ? email : "")}
          highlight={needsVerification}
          onVerified={markVerified}
        />
      )}


      <div className="mt-4 space-y-2">
          <ForgotPassword slug={slug!} />
      </div>
    </AuthShell>
  );
}
