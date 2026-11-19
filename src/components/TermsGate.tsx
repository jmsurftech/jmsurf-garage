import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashMark } from "@/components/brand/DashLogo";

/** Version of the Terms of Service and Privacy Policy (must match public.current_terms_version()). */
export const TERMS_VERSION = "2026-11-14";

type TermsStatus = { needed: boolean; can_accept?: boolean; version?: string; company?: string };

/**
 * Companies that joined before the terms were recorded: the owner or an admin accepts them once
 * at the next sign-in (blocking screen). Other staff are not blocked; they see a small notice.
 * The super admin console and the demo company are never asked (the database says needed=false).
 */
export default function TermsGate() {
  const { user, profile, role } = useAuth() as any;
  const qc = useQueryClient();
  const superConsole = typeof window !== "undefined" && window.location.hostname.startsWith("admin.");
  const tenantId: string | undefined = profile?.tenant_id;
  const { data } = useQuery({
    queryKey: ["terms-status", user?.id, tenantId],
    enabled: !!user?.id && !!tenantId && !superConsole && role !== "super_admin",
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("my_terms_status");
      if (error) return { needed: false } as TermsStatus; // never lock anyone out because a check failed
      return (data || { needed: false }) as TermsStatus;
    },
  });
  const [agreed, setAgreed] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hideNotice, setHideNotice] = useState(false);

  if (!data?.needed) return null;

  if (!data.can_accept) {
    if (hideNotice) return null;
    return (
      <div role="status" className="fixed bottom-20 left-3 right-3 z-[60] flex items-start gap-2 rounded-2xl border border-border bg-card p-3 text-sm shadow-lg sm:left-auto sm:right-4 sm:max-w-sm lg:bottom-4 print:hidden">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="flex-1 text-muted-foreground">Your company's owner or admin needs to accept the updated <a href="/terms" target="_blank" rel="noopener" className="font-semibold text-primary hover:underline">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener" className="font-semibold text-primary hover:underline">Privacy Policy</a>. You can keep working.</p>
        <button onClick={() => setHideNotice(true)} className="rounded-full px-2 text-xs font-semibold text-muted-foreground hover:text-foreground" aria-label="Hide this notice">OK</button>
      </div>
    );
  }

  const accept = async () => {
    if (!agreed || busy) return;
    setBusy(true); setError("");
    const { error: e } = await (supabase as any).rpc("accept_company_terms", { p_version: TERMS_VERSION, p_marketing: marketing });
    setBusy(false);
    if (e) { setError(e.message?.replace(/^.*?: /, "") || "Could not save. Please try again."); return; }
    qc.setQueryData(["terms-status", user?.id, tenantId], { needed: false });
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-background/95 p-4 backdrop-blur-sm print:hidden" role="dialog" aria-modal="true" aria-labelledby="terms-gate-title">
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-xl sm:p-8">
        <div className="flex items-center gap-3">
          <DashMark className="h-10 w-10 shrink-0" />
          <div className="min-w-0">
            <h2 id="terms-gate-title" className="font-display text-xl font-bold leading-tight">Please review our terms</h2>
            {data.company && <p className="truncate text-sm text-muted-foreground">{data.company}</p>}
          </div>
        </div>
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
          We have updated how we record agreement to the JMSURF Garage Terms of Service and Privacy Policy.
          As the company's owner or admin, please read them and accept once to continue. Your data and settings are not changed.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <a href="/terms" target="_blank" rel="noopener" className="rounded-full border border-border px-3 py-1.5 font-semibold hover:border-primary/40 hover:text-primary">Terms of Service</a>
          <a href="/privacy" target="_blank" rel="noopener" className="rounded-full border border-border px-3 py-1.5 font-semibold hover:border-primary/40 hover:text-primary">Privacy Policy</a>
        </div>
        <label className="mt-6 flex items-start gap-3 text-sm">
          <input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
          <span>I agree to the <a href="/terms" target="_blank" rel="noopener" className="font-semibold text-primary hover:underline">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener" className="font-semibold text-primary hover:underline">Privacy Policy</a>. *</span>
        </label>
        <label className="mt-3 flex items-start gap-3 text-sm">
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
          <span className="text-muted-foreground">Send me JMSURF Garage product news and offers by email or SMS (optional). You can stop them at any time.</span>
        </label>
        {error && <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <button onClick={accept} disabled={!agreed || busy} className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary font-semibold text-primary-foreground shadow-sm transition hover:opacity-95 disabled:opacity-50">
          <ShieldCheck className="h-4 w-4" /> {busy ? "Saving…" : "Accept and continue"}
        </button>
      </div>
    </div>
  );
}
