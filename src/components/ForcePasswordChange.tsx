import { useState } from "react";
import { Lock, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { PasswordInput } from "@/components/PasswordInput";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

/**
 * Blocking screen shown when an account is signed in with a temporary password.
 * The user cannot reach the app until they choose a new password.
 */
export default function ForcePasswordChange() {
  const { user, refreshProfile, signOut } = useAuth();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Passwords do not match", description: "Type the same password twice.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password,
        data: { must_change_password: false },
      });
      if (error) throw error;
      if (user?.id) {
        await supabase.from("profiles").update({ must_change_password: false } as any).eq("user_id", user.id);
      }
      await refreshProfile();
      toast({ title: "Password updated", description: "You are all set." });
    } catch (err: any) {
      toast({ title: "Could not update password", description: err?.message || "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-4">
            <ShieldCheck className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="font-display text-2xl font-bold">Choose a new password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            You signed in with a temporary password. Set your own password to continue.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type={show ? "text" : "password"} required value={password} minLength={8}
              onChange={e => setPassword(e.target.value)} placeholder="New password"
              className="w-full pl-10 pr-10 py-3 rounded-xl bg-card border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <PasswordInput
              required value={confirm} minLength={8}
              onChange={e => setConfirm(e.target.value)} placeholder="Confirm new password"
              className="w-full pl-10 py-3 rounded-xl bg-card border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <Button type="submit" disabled={saving} className="w-full py-3 rounded-xl">
            {saving ? "Saving..." : "Save password"}
          </Button>
          <button type="button" onClick={signOut} className="w-full text-xs text-muted-foreground hover:underline">
            Sign out instead
          </button>
        </form>
      </div>
    </div>
  );
}
