/**
 * JMSURF CALL CENTRE inside DASH: a phone button in the corner opens the agent's
 * phone (the Call Centre's own phone, embedded and signed in with the same login).
 * Calls go out and come in without leaving DASH. Anywhere in DASH,
 * window.dispatchEvent(new CustomEvent("dash:call", { detail: "0712…" })) dials.
 */
import { useEffect, useRef, useState } from "react";
import { Phone, PhoneIncoming, X, ExternalLink, Minus } from "lucide-react";
import { erpApi } from "@/lib/erpApi";
import { cn } from "@/lib/utils";

const CC = "https://app.jmsurfcallcentre.co.ke";
const ON_KEY = "dash-phone-on";

export function callNumber(number: string) {
  window.dispatchEvent(new CustomEvent("dash:call", { detail: number }));
}

export default function PhoneDock() {
  // On the till the cart button owns the bottom-right corner on phones: sit above it.
  const frame = useRef<HTMLIFrameElement>(null);
  const [mounted, setMounted] = useState(() => { try { return localStorage.getItem(ON_KEY) === "1"; } catch { return false; } });
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState(`${CC}/embed/phone`);
  const [status, setStatus] = useState<{ state?: string; incoming?: string | null; live?: { number: string } | null }>({});
  const pending = useRef<string | null>(null);

  // The embedded phone asks to be signed in: hand over this login once.
  useEffect(() => {
    const on = async (e: MessageEvent) => {
      if (e.origin !== CC || e.data?.source !== "jmsurf-phone") return;
      if (e.data.type === "need-auth") {
        try { const r = await erpApi("callcentre/handoff", { next: "/embed/phone" }); setSrc(r.url); } catch { /* shown inside the panel */ }
      }
      if (e.data.type === "status") {
        setStatus({ state: e.data.state, incoming: e.data.incoming, live: e.data.live });
        if (e.data.incoming) setOpen(true);
        if (e.data.state === "ready" && pending.current) { frame.current?.contentWindow?.postMessage({ type: "dial", number: pending.current }, CC); pending.current = null; }
      }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);

  // Click-to-call from anywhere in DASH.
  useEffect(() => {
    const on = (e: Event) => {
      const n = String((e as CustomEvent).detail || "");
      if (!n) return;
      turnOn(); setOpen(true);
      if (status.state === "ready") frame.current?.contentWindow?.postMessage({ type: "dial", number: n }, CC);
      else pending.current = n;
    };
    window.addEventListener("dash:call", on);
    return () => window.removeEventListener("dash:call", on);
  }, [status.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const turnOn = () => { setMounted(true); try { localStorage.setItem(ON_KEY, "1"); } catch { /* private mode */ } };
  const turnOff = () => { setMounted(false); setOpen(false); try { localStorage.setItem(ON_KEY, "0"); } catch { /* private mode */ } };
  const ringing = !!status.incoming && !status.live;
  // The phone button lives in the top bar (PhoneButton): it toggles the panel; the panel reports its state back.
  useEffect(() => {
    const on = () => { turnOn(); setOpen((o) => !o); };
    window.addEventListener("dash:phone-toggle", on);
    return () => window.removeEventListener("dash:phone-toggle", on);
  }, []);
  useEffect(() => { window.dispatchEvent(new CustomEvent("dash:phone-status", { detail: { ringing, live: !!status.live, ready: status.state === "ready" } })); }, [ringing, status.live, status.state]);

  return (
    <>
      {mounted && (
        <div className={cn("print:hidden fixed right-4 top-20 z-50 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-border bg-card shadow-2xl transition-all md:bottom-24", open ? "opacity-100" : "pointer-events-none translate-y-4 opacity-0")}>
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <Phone className="h-4 w-4 text-primary" /><b className="flex-1 text-sm">Phone</b>
            <a href={`${CC}/`} target="_blank" rel="noopener noreferrer" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" title="Open the full Call Centre"><ExternalLink className="h-4 w-4" /></a>
            <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Minimise"><Minus className="h-4 w-4" /></button>
            <button onClick={turnOff} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Turn the phone off" title="Turn the phone off"><X className="h-4 w-4" /></button>
          </div>
          {/* Kept loaded while minimised so incoming calls still ring. */}
          <iframe ref={frame} src={src} title="Call Centre phone" allow="microphone; autoplay" className="h-[460px] w-full border-0 bg-card" />
        </div>
      )}
    </>
  );
}

/** Top-bar phone button (next to dark mode): opens the Call Centre phone; rings and shows a dot when ready. */
export function PhoneButton() {
  const [st, setSt] = useState<{ ringing?: boolean; live?: boolean; ready?: boolean }>({});
  useEffect(() => {
    const on = (e: Event) => setSt((e as CustomEvent).detail || {});
    window.addEventListener("dash:phone-status", on);
    return () => window.removeEventListener("dash:phone-status", on);
  }, []);
  return (
    <button onClick={() => window.dispatchEvent(new Event("dash:phone-toggle"))} aria-label="Call Centre phone" title="Call Centre phone"
      className={cn("relative flex h-9 w-9 items-center justify-center rounded-full text-white shadow-md transition-transform hover:scale-105", st.ringing ? "animate-bounce bg-success" : st.live ? "bg-success" : "bg-gradient-to-br from-primary to-[#5b0a10] shadow-primary/30")}>
      {st.ringing ? <PhoneIncoming className="h-[18px] w-[18px]" /> : <Phone className="h-[18px] w-[18px]" />}
      {st.ready && !st.ringing && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-success" />}
    </button>
  );
}
