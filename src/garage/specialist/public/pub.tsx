/**
 * No-login pages (fleet portal, driver check, car listings, pre-order status)
 * talk to garage-specialist.js under /api/garage/s/pub/. Tokens in the link
 * are the only key; the server checks them and scopes every read to one company.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Helmet } from "react-helmet-async";

export class PubError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function pub<T = any>(action: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/garage/s/pub/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new PubError("Could not reach the server. Check your connection and try again.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new PubError(data?.error || "Something went wrong. Try again.", res.status);
  return data as T;
}

export function usePub<T = any>(action: string, body: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: ["garage-pub", action, body],
    enabled,
    retry: (n, e: any) => n < 2 && !(e instanceof PubError && e.status >= 400 && e.status < 500),
    queryFn: () => pub<T>(action, body),
  });
}

export const money = (n: unknown, ccy = "KES") => `${ccy} ${(Number(n) || 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Plain page frame for customers, drivers and fleet managers (light and dark). */
export function PublicShell({ company, title, children, wide }: { company?: { name?: string; logo_url?: string | null; phone?: string | null } | null; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-[100svh] bg-background text-foreground">
      <Helmet><title>{company?.name ? `${title} · ${company.name}` : title}</title><meta name="robots" content="noindex" /></Helmet>
      <header className="border-b border-border bg-card">
        <div className={`mx-auto flex items-center gap-3 px-4 py-3 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>
          {company?.logo_url ? <img src={company.logo_url} alt="" className="h-9 w-9 rounded-lg object-contain" /> : <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">{(company?.name || "G")[0]}</span>}
          <div className="min-w-0 flex-1">
            <p className="truncate font-display font-bold leading-tight">{company?.name || " "}</p>
            <p className="truncate text-xs text-muted-foreground">{title}</p>
          </div>
          {company?.phone && <a href={`tel:${company.phone}`} className="rounded-xl border border-border px-3 py-1.5 text-sm font-medium">Call</a>}
        </div>
      </header>
      <main className={`mx-auto space-y-3 px-4 py-4 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>{children}</main>
    </div>
  );
}

export function PubState({ loading, error }: { loading?: boolean; error?: unknown }) {
  if (loading) return <div className="py-20 text-center text-sm text-muted-foreground">Loading…</div>;
  if (error) return <div className="mx-auto max-w-md py-20 text-center"><p className="font-semibold">This link does not work</p><p className="mt-1 text-sm text-muted-foreground">{(error as any)?.message || "Ask the garage for a new link."}</p></div>;
  return null;
}

export const card = "rounded-2xl border border-border bg-card p-3";
