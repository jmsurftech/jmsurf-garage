import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, X } from "lucide-react";
import { useModules } from "@/hooks/useModules";
import { OrbLoader } from "@/components/orbs";

// The chat (and the app registry it uses) loads only when Garage AI is opened, keeping the first page light.
const DashAIChat = lazy(() => import("./DashAI").then((m) => ({ default: m.DashAIChat })));

/** Garage AI button in the top bar (next to notifications) when the module is on; the chat opens under it. */
export function DashAILauncher() {
  const { has, ready } = useModules();
  const [open, setOpen] = useState(false);
  if (!ready) return null;
  if (!has("ai")) {
    return (
      <Link to="/ai" aria-label="Garage AI" title="Garage AI: try it free" className="print:hidden relative rounded-full p-2 text-primary transition-colors hover:bg-primary/10">
        <Sparkles className="h-5 w-5" />
      </Link>
    );
  }
  return (
    <>
      {open && (
        <div className="fixed right-2 top-16 z-[80] h-[min(640px,calc(100svh-6rem))] w-[min(420px,calc(100vw-1rem))] sm:right-4">
          <Suspense fallback={<div className="flex h-full items-center justify-center rounded-3xl border border-border bg-card"><OrbLoader label="Opening Garage AI…" /></div>}>
            <DashAIChat onClose={() => setOpen(false)} />
          </Suspense>
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} aria-label="Ask Garage AI" title="Garage AI"
        className={"print:hidden relative rounded-full p-2 transition-colors " + (open ? "bg-primary text-primary-foreground" : "text-primary hover:bg-primary/10")}>
        {open ? <X className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
      </button>
    </>
  );
}
