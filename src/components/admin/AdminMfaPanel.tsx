import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, ShieldAlert, Trash2 } from "lucide-react";
import { OrbSpinner } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";

type Factor = { id: string; friendly_name?: string | null; status: string };

/**
 * Two-step sign-in (authenticator app) for the platform owner's own account.
 * Once switched on, the admin portal asks for a 6-digit code after the password.
 */
export default function AdminMfaPanel() {
  const { toast } = useToast();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      toast({ title: "Could not load security settings", description: error.message, variant: "destructive" });
    }
    setFactors(((data?.totp || []) as Factor[]).filter(Boolean));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const startEnroll = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        issuer: window.location.hostname,
        friendlyName: `Authenticator ${new Date().toLocaleDateString()}`,
      });
      if (error) throw error;
      setCode("");
      setEnrolling({
        id: data.id,
        qr: (data as any).totp?.qr_code || "",
        secret: (data as any).totp?.secret || "",
      });
    } catch (e: any) {
      toast({ title: "Could not start setup", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const confirmEnroll = async () => {
    if (!enrolling) return;
    setBusy(true);
    try {
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: enrolling.id });
      if (cErr) throw cErr;
      const { error } = await supabase.auth.mfa.verify({
        factorId: enrolling.id,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (error) throw error;
      toast({ title: "Two-step sign-in is on", description: "You will be asked for a code each time you sign in." });
      setEnrolling(null);
      setCode("");
      await load();
    } catch (e: any) {
      toast({ title: "Wrong code", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const cancelEnroll = async () => {
    if (enrolling) {
      try { await supabase.auth.mfa.unenroll({ factorId: enrolling.id }); } catch { /* already gone */ }
    }
    setEnrolling(null);
    setCode("");
    await load();
  };

  const remove = async (factorId: string) => {
    if (!(await confirmAction({ title: "Turn off two-step sign-in for this account?", danger: true, confirmLabel: "Turn off" }))) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      toast({ title: "Two-step sign-in turned off" });
      await load();
    } catch (e: any) {
      toast({ title: "Could not remove", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const active = factors.filter(f => f.status === "verified");
  const inputClass = "w-full px-4 py-2.5 rounded-xl bg-muted/40 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Two-step sign-in</h3>
        {active.length > 0 ? (
          <span className="flex items-center gap-1 text-xs font-medium text-success"><ShieldCheck className="w-3 h-3" />On</span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><ShieldAlert className="w-3 h-3" />Off</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        A 6-digit code from an authenticator app after your password.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2"><OrbSpinner className="w-4 h-4" />Loading...</p>
      ) : enrolling ? (
        <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
          <p className="text-sm text-muted-foreground">Scan with your authenticator app, then enter the code.</p>
          {enrolling.qr && (
            <img src={enrolling.qr} alt="Authenticator setup code" className="w-44 h-44 bg-white rounded-xl p-2" />
          )}
          {enrolling.secret && (
            <p className="text-xs text-muted-foreground">
              Can't scan? Key: <span className="font-mono text-foreground break-all">{enrolling.secret}</span>
            </p>
          )}
          <div className="max-w-xs">
            <input
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              placeholder="Enter 6-digit code"
              className={inputClass}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="rounded-xl" disabled={busy || code.length < 6} onClick={confirmEnroll}>
              {busy ? "Checking..." : "Turn on"}
            </Button>
            <Button variant="outline" className="rounded-xl border-border text-foreground" onClick={cancelEnroll} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : active.length > 0 ? (
        <div className="space-y-2">
          {active.map(f => (
            <div key={f.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{f.friendly_name || "Authenticator app"}</div>
                <div className="text-xs text-muted-foreground">Asked at every sign-in</div>
              </div>
              <Button size="sm" variant="ghost" className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => remove(f.id)} disabled={busy}>
                <Trash2 className="w-4 h-4 mr-1" />Remove
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <Button className="rounded-xl" onClick={startEnroll} disabled={busy}>
          <ShieldCheck className="w-4 h-4 mr-2" />{busy ? "Preparing..." : "Set up"}
        </Button>
      )}
    </div>
  );
}
