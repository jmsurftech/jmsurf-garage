import { getAuthUser } from "@/lib/authUser";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, CheckCircle2, Clock, ExternalLink, Download, Unlock, BadgeCheck } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { allRows, downloadCsv } from "@/lib/fetchAll";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Toolbar, SearchBox, Segmented, Panel, StatTile, StatGrid, TableWrap, EmptyState, StatusPill, PageLoader, ExportMenu, Field } from "@/components/kit";
import { PagedRows } from "@/components/Pager";
import { Button } from "@/components/ui/button";
import { OrbSpinner } from "@/components/orbs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const sb: any = supabase;
const isOn = (s: string) => s === "approved" || s === "active";
type Filter = "all" | "on" | "pending";
const VIA: Record<string, string> = { mpesa: "Paid by M-Pesa", free: "Unlocked free", existing: "Had a domain before" };

/**
 * Every company's own domain in one place (paid add-on, KES 300 once). Companies pay and connect it
 * from System › Custom domain and it switches on by itself once DNS points here; the platform owner
 * sees them all, unlocks a company free, switches a domain on by hand or removes it. The
 * custom-domain sync job routes active domains and gets their certificates within a few minutes.
 */
export default function AdminDomains() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState("");
  const [removing, setRemoving] = useState<any | null>(null);
  const [unlockId, setUnlockId] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-domains"],
    queryFn: async () => {
      const [{ data: rows, error }, { data: tenants }] = await Promise.all([
        allRows(() => sb.from("tenant_domains").select("id, tenant_id, host, alias_host, alias_ok, kind, status, created_at, activated_at, checked_at, check_detail").eq("kind", "custom").order("created_at", { ascending: false })),
        allRows(() => sb.from("tenants").select("id, business_name, custom_domain_paid_at, custom_domain_paid_via").is("deleted_at", null).order("business_name")),
      ]);
      if (error) throw error;
      const shops: Record<string, any> = {};
      (tenants || []).forEach((t: any) => { shops[t.id] = t; });
      return { domains: ((rows || []) as any[]).map((d) => ({ ...d, shop: shops[d.tenant_id] })), tenants: (tenants || []) as any[] };
    },
  });

  const rows = useMemo(() => data?.domains || [], [data]);
  const tenants = useMemo(() => data?.tenants || [], [data]);
  const unlocked = useMemo(() => tenants.filter((t) => t.custom_domain_paid_at), [tenants]);
  const locked = useMemo(() => tenants.filter((t) => !t.custom_domain_paid_at), [tenants]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((d) => {
      if (filter === "on" && !isOn(d.status)) return false;
      if (filter === "pending" && isOn(d.status)) return false;
      if (!q) return true;
      return `${d.host} ${d.alias_host || ""} ${d.shop?.business_name || ""}`.toLowerCase().includes(q);
    });
  }, [rows, search, filter]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-domains"] });

  const switchOn = async (d: any) => {
    setBusy(d.id);
    const { data: { user } } = await getAuthUser();
    const now = new Date().toISOString();
    const { error } = await sb.from("tenant_domains").update({ status: "active", approved_by: user?.id ?? null, approved_at: now, activated_at: now, updated_at: now }).eq("id", d.id);
    setBusy("");
    if (error) return toast({ title: "Could not switch it on", description: error.message, variant: "destructive" });
    toast({ title: "Domain switched on", description: `${d.host}: the server picks it up within a few minutes.` });
    refresh();
  };

  const unlock = async (tenantId: string, on: boolean) => {
    setBusy(tenantId);
    const { error } = await sb.rpc("garage_domain_unlock", { p_tenant: tenantId, p_unlock: on });
    setBusy("");
    if (error) return toast({ title: "Could not change it", description: error.message, variant: "destructive" });
    toast({ title: on ? "Unlocked free" : "Locked again" });
    setUnlockId("");
    refresh();
  };

  const remove = async () => {
    const d = removing;
    if (!d) return;
    setBusy(d.id);
    const { error } = await sb.from("tenant_domains").delete().eq("id", d.id);
    setBusy("");
    setRemoving(null);
    if (error) return toast({ title: "Could not remove", description: error.message, variant: "destructive" });
    toast({ title: "Domain removed", description: d.host });
    refresh();
  };

  if (isLoading) return <PageLoader label="Loading domains…" />;

  const live = rows.filter((d) => isOn(d.status)).length;
  const waiting = rows.length - live;

  return (
    <div className="space-y-3">
      <PageHeader title="Domains" icon={Globe}
        actions={<ExportMenu items={[{ label: "Download CSV", icon: Download, disabled: !filtered.length, onSelect: () => downloadCsv(`garage-domains-${new Date().toISOString().slice(0, 10)}.csv`,
          ["Domain", "www", "Company", "Status", "Added", "Live since"],
          filtered.map((d: any) => [d.host, d.alias_host || "", d.shop?.business_name, d.status, (d.created_at || "").slice(0, 10), (d.activated_at || "").slice(0, 10)])) }]} />} />

      <StatGrid>
        <StatTile label="Live" value={live} icon={CheckCircle2} tone="success" />
        <StatTile label="Waiting for DNS" value={waiting} icon={Clock} tone="warning" />
        <StatTile label="Companies unlocked" value={unlocked.length} icon={BadgeCheck} tone="info" />
      </StatGrid>

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search domains or companies" />
        <Segmented<Filter> value={filter} onChange={setFilter} options={[
          { value: "all", label: "All", count: rows.length },
          { value: "on", label: "Live", count: live },
          { value: "pending", label: "Waiting", count: waiting },
        ]} />
      </Toolbar>

      <Panel flush>
        {filtered.length === 0 ? (
          <EmptyState icon={Globe} title="No domains" description={rows.length ? "Nothing matches this filter." : "No company has connected its own domain yet."} />
        ) : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Domain</th><th>Company</th><th>Status</th><th>Added</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                <PagedRows rows={filtered} colSpan={5}>
                  {(page) => page.map((d) => (
                    <tr key={d.id}>
                      <td className="font-medium">
                        <a href={`https://${d.host}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 break-all hover:text-primary">
                          {d.host} <ExternalLink className="h-3 w-3 opacity-60" />
                        </a>
                        {d.alias_host && <div className="text-xs text-muted-foreground">{d.alias_host}{d.alias_ok ? "" : " (DNS not set)"}</div>}
                        {!isOn(d.status) && d.check_detail && <div className="text-xs text-muted-foreground">{d.check_detail}</div>}
                      </td>
                      <td className="font-medium">{d.shop?.business_name || "—"}</td>
                      <td><StatusPill status={d.status} /></td>
                      <td className="whitespace-nowrap text-muted-foreground">{format(new Date(d.created_at), "d MMM yyyy")}</td>
                      <td>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {busy === d.id && <OrbSpinner className="h-4 w-4 self-center text-muted-foreground" />}
                          {!isOn(d.status) && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void switchOn(d)}>Switch on</Button>}
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={!!busy} onClick={() => setRemoving(d)}>Remove</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Unlock free" icon={Unlock} description="Lets a company connect its own domain without the M-Pesa payment.">
        <div className="space-y-4">
          <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (unlockId) void unlock(unlockId, true); }}>
            <Field label="Company" className="flex-1">
              <select className="fi" value={unlockId} onChange={(e) => setUnlockId(e.target.value)}>
                <option value="">Choose a company</option>
                {locked.map((t) => <option key={t.id} value={t.id}>{t.business_name}</option>)}
              </select>
            </Field>
            <Button type="submit" disabled={!unlockId || !!busy}><Unlock /> Unlock free</Button>
          </form>
          {unlocked.length > 0 && (
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              {unlocked.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{t.business_name}</span>
                  <span className="text-xs text-muted-foreground">{VIA[t.custom_domain_paid_via] || "Unlocked"}</span>
                  {t.custom_domain_paid_via === "free" && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void unlock(t.id, false)}>Lock</Button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.host}?</AlertDialogTitle>
            <AlertDialogDescription>
              The company stops answering there within a few minutes; its customer pages stay on app.jmsurfgarage.co.ke. It can connect a domain again without paying.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
