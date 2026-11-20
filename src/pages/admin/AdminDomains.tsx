import { getAuthUser } from "@/lib/authUser";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, CheckCircle2, Clock, XCircle, ExternalLink, Download } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { allRows, downloadCsv } from "@/lib/fetchAll";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Toolbar, SearchBox, Segmented, Panel, StatTile, StatGrid, TableWrap, EmptyState, StatusPill, PageLoader, ExportMenu } from "@/components/kit";
import { PagedRows } from "@/components/Pager";
import { Button } from "@/components/ui/button";
import { OrbSpinner } from "@/components/orbs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const sb: any = supabase;
const isOn = (s: string) => s === "approved" || s === "active";
type Filter = "all" | "on" | "pending" | "rejected";

/**
 * Every shop's own web address in one place. Shops connect their domain from
 * Settings › Domain and it switches on by itself once DNS points here; this
 * page lets the platform owner see them all and step in (approve, reject or
 * remove) when needed. The server picks up changes within a few minutes.
 */
export default function AdminDomains() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState("");
  const [removing, setRemoving] = useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-domains"],
    queryFn: async () => {
      const [{ data: rows, error }, { data: tenants }] = await Promise.all([
        allRows(() => sb.from("tenant_domains").select("id, tenant_id, host, kind, status, created_at, approved_at, notes").eq("kind", "custom").order("created_at", { ascending: false })),
        allRows(() => sb.from("tenants").select("id, business_name, slug").order("created_at")),
      ]);
      if (error) throw error;
      const shops: Record<string, any> = {};
      (tenants || []).forEach((t: any) => { shops[t.id] = t; });
      return ((rows || []) as any[]).map((d) => ({ ...d, shop: shops[d.tenant_id] }));
    },
  });

  const rows = useMemo(() => data || [], [data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((d) => {
      if (filter === "on" && !isOn(d.status)) return false;
      if (filter === "pending" && d.status !== "pending") return false;
      if (filter === "rejected" && d.status !== "rejected") return false;
      if (!q) return true;
      return d.host.toLowerCase().includes(q) || String(d.shop?.business_name || "").toLowerCase().includes(q) || String(d.shop?.slug || "").includes(q);
    });
  }, [rows, search, filter]);

  const setStatus = async (d: any, status: "approved" | "rejected") => {
    setBusy(d.id);
    const { data: { user } } = await getAuthUser();
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === "approved") Object.assign(patch, { approved_by: user?.id ?? null, approved_at: new Date().toISOString() });
    const { error } = await sb.from("tenant_domains").update(patch).eq("id", d.id);
    setBusy("");
    if (error) return toast({ title: "Could not update", description: error.message, variant: "destructive" });
    toast({ title: status === "approved" ? "Domain switched on" : "Domain rejected", description: `${d.host} — the server picks this up within a few minutes.` });
    qc.invalidateQueries({ queryKey: ["admin-domains"] });
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
    qc.invalidateQueries({ queryKey: ["admin-domains"] });
  };

  if (isLoading) return <PageLoader label="Loading domains…" />;

  const counts = {
    on: rows.filter((d) => isOn(d.status)).length,
    pending: rows.filter((d) => d.status === "pending").length,
    rejected: rows.filter((d) => d.status === "rejected").length,
  };

  return (
    <div className="space-y-3">
      <PageHeader title="Domains" icon={Globe}
        actions={<ExportMenu items={[{ label: "Download CSV", icon: Download, disabled: !filtered.length, onSelect: () => downloadCsv(`dash-domains-${new Date().toISOString().slice(0, 10)}.csv`,
          ["Domain", "Company", "Status", "Added", "Approved", "Notes"],
          filtered.map((d: any) => [d.host, d.shop?.business_name, d.status, (d.created_at || "").slice(0, 10), (d.approved_at || "").slice(0, 10), d.notes])) }]} />} />

      <StatGrid>
        <StatTile label="Live" value={counts.on} icon={CheckCircle2} tone="success" />
        <StatTile label="Waiting for DNS" value={counts.pending} icon={Clock} tone="warning" />
        <StatTile label="Rejected" value={counts.rejected} icon={XCircle} tone="danger" />
        <StatTile label="All domains" value={rows.length} icon={Globe} tone="info" />
      </StatGrid>

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search domains" />
        <Segmented<Filter> value={filter} onChange={setFilter} options={[
          { value: "all", label: "All", count: rows.length },
          { value: "on", label: "Live", count: counts.on },
          { value: "pending", label: "Pending", count: counts.pending },
          { value: "rejected", label: "Rejected", count: counts.rejected },
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
                      </td>
                      <td>
                        <div className="font-medium">{d.shop?.business_name || "—"}</div>
                        {d.shop?.slug && <div className="break-all text-xs text-muted-foreground">{d.shop.slug}.garage.jmsurf.co.ke</div>}
                      </td>
                      <td><StatusPill status={d.status} /></td>
                      <td className="whitespace-nowrap text-muted-foreground">{format(new Date(d.created_at), "d MMM yyyy")}</td>
                      <td>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {busy === d.id && <OrbSpinner className="h-4 w-4 self-center text-muted-foreground" />}
                          {!isOn(d.status) && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setStatus(d, "approved")}>Approve</Button>}
                          {d.status !== "rejected" && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setStatus(d, "rejected")}>Reject</Button>}
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

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.host}?</AlertDialogTitle>
            <AlertDialogDescription>
              The shop stops answering on this address within a few minutes. Its own {removing?.shop?.slug}.garage.jmsurf.co.ke address keeps working, and the shop can connect the domain again later.
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
