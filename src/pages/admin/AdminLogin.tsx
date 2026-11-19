import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requestPasswordReset } from "@/lib/platformEmail";
import { ShieldCheck, Mail, Lock, Eye, EyeOff } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import { Field } from "@/components/kit";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { OrbSpinner } from "@/components/orbs";

export default function AdminLogin({ needsCode = false }: { needsCode?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const { toast } = useToast();
  const navigate = useNavigate();

  // Signed in with the password but the code is still due (for example after
  // a page reload): go straight to the code screen.
  useEffect(() => {
    if (!needsCode || mfaFactorId) return;
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const totp = (data?.totp || []).find((f: any) => f.status === "verified");
      if (totp) setMfaFactorId(totp.id);
    });
  }, [needsCode, mfaFactorId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(/invalid login/i.test(error.message) ? "Wrong email or password." : error.message);
      // Platform owners are listed in platform_admins (their saved role may be "admin").
      // Checked before anything opens; a slow answer is retried, not treated as "no".
      let owner: boolean | null = null;
      for (let i = 0; i < 4 && owner === null; i++) {
        const { data: ok, error: rpcErr } = await (supabase as any).rpc("is_platform_admin");
        if (!rpcErr) owner = ok === true;
        else await new Promise((r) => setTimeout(r, 700 * (i + 1)));
      }
      if (owner !== true) {
        await supabase.auth.signOut({ scope: "local" });
        throw new Error(owner === false
          ? "This account is not a platform owner. Company owners and staff sign in on their company address."
          : "Could not confirm your access right now. Check your connection and try again.");
      }

      // If this account has an authenticator app set up, ask for the code
      // before letting the session into the admin portal.
      const { data: factorData } = await supabase.auth.mfa.listFactors();
      const totp = (factorData?.totp || []).find((f: any) => f.status === "verified");
      if (totp) {
        setMfaFactorId(totp.id);
        setLoading(false);
        return;
      }

      navigate("/admin");
    } catch (err: any) {
      toast({ title: "Could not sign in", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaFactorId) return;
    setLoading(true);
    try {
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
      if (cErr) throw cErr;
      const { error } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challenge.id,
        code: mfaCode.trim(),
      });
      if (error) throw error;
      // verify() upgrades this session to aal2; the portal opens by itself.
      await supabase.auth.refreshSession().catch(() => undefined);
      navigate("/admin");
    } catch (err: any) {
      setMfaCode("");
      toast({ title: "Wrong code", description: "Check your authenticator app and try the current code.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const cancelMfa = async () => {
    await supabase.auth.signOut({ scope: "local" });
    setMfaFactorId(null);
    setMfaCode("");
    setPassword("");
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { toast({ title: "Enter your email first", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const result = await requestPasswordReset(email);
      if (!result.ok) throw new Error(result.error || "Could not send the reset link");
      toast({ title: "Reset link sent", description: "Check your email for the password reset link." });
      setForgotMode(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const btn = "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 disabled:opacity-50";
  const link = "w-full text-center text-sm font-medium text-primary hover:underline";

  return (
    <AuthShell
      variant="admin"
      title={mfaFactorId ? "Two-step check" : forgotMode ? "Reset your password" : "Admin sign in"}
      subtitle={mfaFactorId ? "Enter the 6-digit code from your authenticator app." : forgotMode ? "We will email you a link to set a new password." : "For the JMSURF Garage platform owner only."}
      footer={<span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Sign-ins are recorded. Company staff sign in on their company address.</span>}
    >
      {mfaFactorId ? (
        <form onSubmit={handleMfa} className="space-y-4">
          <Field label="Authenticator code">
            <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder="123456"
              className="fi h-14 text-center text-2xl tracking-[0.5em]" />
          </Field>
          <button type="submit" disabled={loading || mfaCode.length < 6} className={btn}>
            {loading && <OrbSpinner className="h-4 w-4" />} {loading ? "Checking…" : "Verify and continue"}
          </button>
          <button type="button" onClick={cancelMfa} className={link}>Back to sign in</button>
        </form>
      ) : forgotMode ? (
        <form onSubmit={handleForgot} className="space-y-4">
          <Field label="Admin email">
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="fi h-12 text-base" autoFocus />
          </Field>
          <button type="submit" disabled={loading} className={btn}>
            {loading && <OrbSpinner className="h-4 w-4" />} {loading ? "Sending…" : "Send reset link"}
          </button>
          <button type="button" onClick={() => setForgotMode(false)} className={link}>Back to sign in</button>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Email">
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="fi h-12 pl-10 text-base" autoFocus />
            </div>
          </Field>
          <Field label="Password" hint={<button type="button" onClick={() => setForgotMode(true)} className="font-medium text-primary hover:underline">Forgot password?</button>}>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input type={showPw ? "text" : "password"} required minLength={6} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="fi h-12 px-10 text-base" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={showPw ? "Hide password" : "Show password"}>
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <button type="submit" disabled={loading || !email || !password} className={btn}>
            {loading ? <OrbSpinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />} {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
