import { PageHeader, PageLoader, Toolbar, SearchBox, EmptyState, StatTile, StatGrid } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { formatKES } from "@/lib/format";
import { tenantPath } from "@/lib/host";
import { PagedRows } from "@/components/Pager";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Edit, Trash2, Phone, Mail, MapPin, Truck, Wallet, ShoppingBag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { useTenantId } from "@/hooks/useTenantId";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const sb: any = supabase;

export function useSuppliers() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["suppliers", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("suppliers").select("*")
        .eq("is_active", true)
        .eq("tenant_id", tenantId)
        .order("name");
      if (error) throw error;
      return data as any[];
    },
  });
}

export default function Suppliers() {
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const { data: suppliers = [], isLoading } = useSuppliers();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canDelete = hasPermission("suppliers_delete");
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const base = tenantPath(slug, "/purchases/suppliers");

  const tenantId = useTenantId();
  // What you bought from each supplier and what you still owe them.
  const { data: money } = useQuery({
    queryKey: ["supplier-money", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const [{ data: purchases }, { data: bills }] = await Promise.all([
        sb.from("purchases").select("supplier_id,total").eq("tenant_id", tenantId),
        sb.from("bills").select("supplier_id,amount,status").eq("tenant_id", tenantId).neq("status", "paid"),
      ]);
      const bought: Record<string, number> = {}; const owed: Record<string, number> = {};
      (purchases || []).forEach((p: any) => { if (p.supplier_id) bought[p.supplier_id] = (bought[p.supplier_id] || 0) + Number(p.total || 0); });
      (bills || []).forEach((b: any) => { if (b.supplier_id) owed[b.supplier_id] = (owed[b.supplier_id] || 0) + Number(b.amount || 0); });
      return { bought, owed };
    },
  });
  const q = search.trim().toLowerCase();
  const filtered = suppliers.filter((s: any) =>
    !q || s.name.toLowerCase().includes(q) || (s.phone || "").includes(q) || (s.email || "").toLowerCase().includes(q)
  );
  const totalOwed = Object.values(money?.owed || {}).reduce((a, b) => a + b, 0);
  const totalBought = Object.values(money?.bought || {}).reduce((a, b) => a + b, 0);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await sb.from("suppliers").update({ is_active: false }).eq("id", deleteTarget.id);
    qc.invalidateQueries({ queryKey: ["suppliers"] });
    toast({ title: "Supplier removed" });
    setDeleteTarget(null);
  };

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <PageHeader title="Suppliers" icon={Truck} description="Who you buy from, what you've bought and what you owe."
        actions={<Button onClick={() => navigate(`${base}/new`)}><Plus /> Add supplier</Button>} />

      <StatGrid className="lg:grid-cols-3">
        <StatTile label="Suppliers" value={suppliers.length} icon={Truck} tone="primary" />
        <StatTile label="Bought from them" value={formatKES(totalBought)} icon={ShoppingBag} tone="info" hint="All purchase orders" />
        <StatTile label="You owe" value={formatKES(totalOwed)} icon={Wallet} tone={totalOwed > 0 ? "warning" : "muted"} hint="Unpaid supplier bills" className="col-span-2 lg:col-span-1" />
      </StatGrid>

      <Toolbar><SearchBox value={search} onChange={setSearch} placeholder="Name, phone or email…" /></Toolbar>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50">
          <EmptyState icon={Truck} title={suppliers.length ? "No suppliers match" : "No suppliers yet"}
            description={suppliers.length ? undefined : "Add the businesses you buy stock from to track orders and what you owe."}
            action={!suppliers.length ? <Button onClick={() => navigate(`${base}/new`)}><Plus /> Add supplier</Button> : undefined} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <PagedRows rows={filtered} gridSpan>{(pageRows) => pageRows.map((s: any) => {
            const owed = money?.owed[s.id] || 0;
            return (
              <div key={s.id} className="flex flex-col rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 font-display text-lg font-bold text-primary">{s.name.charAt(0).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">{s.name}</h3>
                    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {s.phone && <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {s.phone}</p>}
                      {s.email && <p className="flex items-center gap-1.5 truncate"><Mail className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{s.email}</span></p>}
                      {s.address && <p className="flex items-center gap-1.5 truncate"><MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{s.address}</span></p>}
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-3 text-center">
                  <div><p className="text-[11px] text-muted-foreground">Bought</p><p className="text-sm font-semibold">{formatKES(money?.bought[s.id] || 0)}</p></div>
                  <div><p className="text-[11px] text-muted-foreground">You owe</p><p className={`text-sm font-semibold ${owed > 0 ? "text-warning" : ""}`}>{formatKES(owed)}</p></div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate(`${base}/${s.id}/edit`)}><Edit /> Edit</Button>
                  {canDelete && <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(s)} aria-label="Remove"><Trash2 /></Button>}
                </div>
              </div>
            );
          })}</PagedRows>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remove supplier?</AlertDialogTitle>
            <AlertDialogDescription>"{deleteTarget?.name}" will be deactivated.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

