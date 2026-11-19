import AuthShell from "@/components/auth/AuthShell";
import PageHead from "@/components/PageHead";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Store, Lock, Eye, EyeOff } from "lucide-react";
import { PasswordInput } from "@/components/PasswordInput";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    // Listen for the PASSWORD_RECOVERY event
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });
    // Also check hash for type=recovery
    if (window.location.hash.includes("type=recovery")) {
      setReady(true);
    }
    // Links emailed by the app server carry a one-time token to exchange.
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    if (tokenHash && params.get("type") === "recovery") {
      supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" }).then(({ error }) => {
        window.history.replaceState(null, "", window.location.pathname);
        if (error) {
          toast({ title: "Link expired", description: "Request a new password reset link.", variant: "destructive" });
        } else {
          setReady(true);
        }
      });
    }
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast({ title: "Success", description: "Password updated! Redirecting..." });
      setTimeout(() => navigate("/dashboard"), 1500);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center">
          <span className="mx-auto mb-4 block h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="font-medium">Checking your reset link…</p>
          <p className="text-sm text-muted-foreground mt-2">If this persists, request a new reset link.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHead
        title="Reset your password · JMSURF Garage"
        description="Set a new password for your JMSURF Garage account to regain secure access to your store."
        path="/reset-password"
        noindex
      />
      <AuthShell title="Set a new password" subtitle="Choose a password you haven't used here before.">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input type={showPw ? "text" : "password"} required value={password} onChange={e => setPassword(e.target.value)}
              placeholder="New password (at least 6 characters)" minLength={6} autoComplete="new-password" className="fi h-12 pl-10 pr-11 text-base" />
            <button type="button" onClick={() => setShowPw(!showPw)} aria-label={showPw ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground">
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <PasswordInput required value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Type it again" minLength={6} autoComplete="new-password" className="fi h-12 pl-10 text-base" />
          </div>
          {confirm && password !== confirm && <p className="text-xs text-destructive">The passwords don't match.</p>}
          <Button type="submit" disabled={loading} className="h-12 w-full text-base">{loading ? "Saving…" : "Save new password"}</Button>
        </form>
      </AuthShell>
    </>
  );
}
