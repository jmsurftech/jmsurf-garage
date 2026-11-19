import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { useDisplaySubscriber, type DisplayState } from "@/hooks/useCustomerDisplay";
import { resolveTenantBySlug } from "@/hooks/useTenant";
import { formatKES } from "@/lib/format";

export default function CustomerDisplay() {
  const { slug, sessionId } = useParams<{ slug?: string; sessionId?: string }>();
  const [now, setNow] = useState(new Date());
  const [tenant, setTenant] = useState<{ business_name: string; logo_url: string | null } | null>(null);
  const [state, setState] = useState<DisplayState>({ type: "idle" });
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (slug) resolveTenantBySlug(slug).then((t) => t && setTenant(t as any));
  }, [slug]);

  useDisplaySubscriber(sessionId || null, (s) => {
    if (resetTimerRef.current) { clearTimeout(resetTimerRef.current); resetTimerRef.current = null; }
    setState(s);
    if (s.type === "paid") {
      // Show "Thank you / Welcome again" then reset to idle so the next sale starts clean.
      resetTimerRef.current = setTimeout(() => setState({ type: "idle", shopName: s.shopName, logoUrl: s.logoUrl }), 6000);
    }
  });

  const shopName = state.shopName || tenant?.business_name || "Welcome";
  const logo = state.logoUrl ?? tenant?.logo_url ?? null;

  return (
    <div className="fixed inset-0 overflow-hidden bg-gradient-to-br from-background via-background to-primary/5 flex flex-col">
      {/* Header — compact */}
      <header className="px-8 py-4 flex items-center justify-between border-b border-border/40 shrink-0">
        <div className="flex items-center gap-3">
          {logo ? (
            <img src={logo} alt={shopName} className="h-12 w-12 rounded-xl object-cover" />
          ) : (
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <span className="font-display font-bold text-primary text-lg">{shopName.charAt(0).toUpperCase()}</span>
            </div>
          )}
          <h1 className="text-2xl font-display font-bold tracking-tight truncate max-w-[50vw]">{shopName}</h1>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-bold tabular-nums leading-none">
            {now.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {now.toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>
      </header>

      {/* Main — fills viewport, no scroll */}
      <main className="flex-1 flex items-center justify-center px-8 overflow-hidden">
        {state.type === "paid" ? (
          <div className="text-center space-y-6 animate-in fade-in zoom-in-95 duration-500">
            <CheckCircle2 className="w-32 h-32 mx-auto text-success" strokeWidth={1.5} />
            <h2 className="text-7xl font-display font-bold text-success leading-none">Thank You!</h2>
            <p className="text-3xl text-muted-foreground">Welcome again soon</p>
            {state.changeGiven && state.changeGiven > 0 && (
              <div className="inline-block mt-2 px-8 py-4 rounded-2xl bg-success/10 border-2 border-success/30">
                <div className="text-sm uppercase tracking-wider text-success">Your Change</div>
                <div className="font-display text-4xl font-bold text-success">{formatKES(state.changeGiven)}</div>
              </div>
            )}
          </div>
        ) : (
          // Idle + running both show the same minimal "TOTAL" hero — only the number changes.
          <div className="w-full max-w-3xl text-center">
            <div className="text-base uppercase tracking-[0.3em] text-muted-foreground mb-4">Total Due</div>
            <div className="font-display font-bold tabular-nums leading-none text-primary"
              style={{ fontSize: "clamp(80px, 18vw, 240px)" }}
            >
              {formatKES(state.total ?? 0)}
            </div>
            {state.itemCount !== undefined && state.itemCount > 0 && (
              <div className="mt-6 text-lg text-muted-foreground">
                {state.itemCount} item{state.itemCount === 1 ? "" : "s"} in cart
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="px-8 py-3 text-center text-xs text-muted-foreground border-t border-border/40 shrink-0">
        Thank you for shopping with us
      </footer>
    </div>
  );
}
