import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Building2, Check, ChevronsUpDown, Plus, Settings2, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { erpApi } from "@/lib/erpApi";
import { tenantUrl } from "@/lib/host";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTenant } from "@/hooks/useTenant";
import { useAuth } from "@/hooks/useAuth";
import { listMyCompanies, switchCompany } from "@/lib/companySwitch";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendlyError";
import { cn } from "@/lib/utils";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "C";

/** Header control: shows the company you are in and switches to another one in one click. */
export default function CompanySwitcher({ className }: { className?: string }) {
  const { tenant } = useTenant();
  const { user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const { data: companies = [] } = useQuery({ queryKey: ["my-companies", user?.id], enabled: !!user?.id, queryFn: listMyCompanies, staleTime: 10 * 60_000 });
  // Companies of my other logins (linked by the platform owner or in My profile).
  const { data: linked = [] } = useQuery({ queryKey: ["my-linked-companies", user?.id], enabled: !!user?.id, staleTime: 10 * 60_000, queryFn: async () => ((await (supabase as any).rpc("my_linked_companies")).data || []) as { linked_user_id: string; linked_email: string; tenant_id: string; slug: string; business_name: string; logo_url: string | null; role: string }[] });
  const name = tenant?.business_name || "Company";
  const openLinked = async (c: { linked_user_id: string; tenant_id: string }) => {
    setBusy(c.linked_user_id + c.tenant_id);
    try {
      const r = await erpApi("session/switch-account", { user_id: c.linked_user_id, tenant_id: c.tenant_id });
      window.location.assign(`${tenantUrl(r.slug, "/auth/handoff")}#th=${encodeURIComponent(r.th)}&next=${encodeURIComponent("/dashboard")}`);
    } catch (e) { toast.error(friendlyError(e)); setBusy(null); }
  };

  const open = async (id: string) => {
    if (id === tenant?.id) return;
    setBusy(id);
    try { await switchCompany(id); } catch (e) { toast.error(friendlyError(e)); setBusy(null); }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button title={name} className={cn("hidden max-w-[220px] shrink-0 items-center gap-2 rounded-xl border border-border bg-background px-1.5 py-1.5 min-[1700px]:px-2.5 text-left text-sm transition-colors hover:border-primary/40 md:flex", className)}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-[11px] font-bold text-primary">
            {tenant?.logo_url ? <img src={tenant.logo_url} alt="" className="h-full w-full object-contain" /> : initials(name)}
          </span>
          <span className="hidden min-w-0 flex-1 min-[1700px]:block">
            <span className="block truncate font-semibold leading-tight">{name}</span>
            {companies.length + linked.length > 1 && <span className="block text-[10px] leading-tight text-muted-foreground">{companies.length + linked.length} companies</span>}
          </span>
          <ChevronsUpDown className="hidden h-4 w-4 shrink-0 text-muted-foreground min-[1700px]:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Switch company</DropdownMenuLabel>
        {companies.map((c) => (
          <DropdownMenuItem key={c.tenant_id} onSelect={(e) => { e.preventDefault(); void open(c.tenant_id); }} className="gap-3 py-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-xs font-bold">
              {c.logo_url ? <img src={c.logo_url} alt="" className="h-full w-full object-contain" /> : initials(c.business_name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{c.business_name}</span>
              <span className="block truncate text-xs text-muted-foreground">{c.slug}.garage.jmsurf.co.ke · {String(c.role).replace("_", " ")}</span>
            </span>
            {busy === c.tenant_id ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              : c.tenant_id === tenant?.id ? <Check className="h-4 w-4 text-primary" /> : null}
          </DropdownMenuItem>
        ))}
        {companies.length === 0 && !linked.length && <div className="px-2 py-3 text-sm text-muted-foreground"><Building2 className="mr-2 inline h-4 w-4" />Only this company</div>}
        {linked.length > 0 && <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your other logins</DropdownMenuLabel>
          {linked.map((c) => (
            <DropdownMenuItem key={c.linked_user_id + c.tenant_id} onSelect={(e) => { e.preventDefault(); void openLinked(c); }} className="gap-3 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-xs font-bold">
                {c.logo_url ? <img src={c.logo_url} alt="" className="h-full w-full object-contain" /> : initials(c.business_name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.business_name}</span>
                <span className="flex items-center gap-1 truncate text-xs text-muted-foreground"><KeyRound className="h-3 w-3 shrink-0" />{c.linked_email}</span>
              </span>
              {busy === c.linked_user_id + c.tenant_id && <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
            </DropdownMenuItem>
          ))}
        </>}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link to="/companies?new=1" className="gap-2"><Plus className="h-4 w-4" /> Add a company</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/companies" className="gap-2"><Settings2 className="h-4 w-4" /> Manage companies & users</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/profile#linked" className="gap-2"><KeyRound className="h-4 w-4" /> Link another login</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
