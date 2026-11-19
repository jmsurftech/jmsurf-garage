import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { useModules } from "@/hooks/useModules";
import { moduleFor } from "@/lib/modules";

/**
 * Shows a page only while its module is on. Otherwise: what the module does and
 * where to switch it on (System → Modules & billing). Data a company already has
 * stays in the database; it shows again as soon as the module is back on.
 */
export default function RequireModule({ module, children }: { module: string; children: ReactNode }) {
  const { has, ready } = useModules();
  if (!ready) return null;
  if (has(module)) return <>{children}</>;
  const m = moduleFor(module);
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Lock className="h-6 w-6" /></span>
      <h1 className="mt-4 font-display text-2xl font-extrabold">{m?.name || "This module"} is not switched on</h1>
      <p className="mt-2 text-sm text-muted-foreground">{m?.tagline}</p>
      <p className="mt-1 text-sm text-muted-foreground">Anything you saved before is kept and comes back when you switch it on again.</p>
      <Link to={`/modules?app=${m?.key || module}`} className="mt-6 inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
        See {m?.name || "the module"} in Modules & billing
      </Link>
    </div>
  );
}
