import { PageHeader } from "@/components/kit";
import { useMemo, useState } from "react";
import { PagedRows } from "@/components/Pager";
import { useProductBatches, useUpsertBatch, useDeleteBatch, type ProductBatch } from "@/hooks/useBatches";
import { useProducts, useLocations } from "@/hooks/useData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { CalendarX, Clock, PackageCheck, Plus, Pencil, Trash2, AlertTriangle, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { confirmAction } from "@/components/books/confirm";

type FilterMode = "all" | "expired" | "expiring" | "ok";

export default function InventoryBatches() {
  const { data: batches = [], isLoading } = useProductBatches();
  const { data: products = [] } = useProducts();
  const { data: locations = [] } = useLocations();
  const upsert = useUpsertBatch();
  const del = useDeleteBatch();

  const [locationId, setLocationId] = useState<string>("__all__");
  const [mode, setMode] = useState<FilterMode>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const [editing, setEditing] = useState<Partial<ProductBatch> | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const productMap = useMemo(() => {
    const m: Record<string, string> = {};
    products.forEach((p: any) => (m[p.id] = p.name));
    return m;
  }, [products]);

  const locMap = useMemo(() => {
    const m: Record<string, string> = {};
    locations.forEach((l: any) => (m[l.id] = l.name));
    return m;
  }, [locations]);

  const filtered = useMemo(() => {
    return batches.filter((b) => {
      if (locationId !== "__all__" && b.location_id !== locationId) return false;
      if (mode === "expired" && !(b.expiry_date && b.expiry_date < today && b.quantity > 0)) return false;
      if (mode === "expiring" && !(b.expiry_date && b.expiry_date >= today && b.expiry_date <= in30 && b.quantity > 0)) return false;
      if (mode === "ok" && (!b.expiry_date || b.expiry_date >= today)) {
        // ok mode = no expiry concern (no date OR future-distant)
        if (b.expiry_date && b.expiry_date <= in30) return false;
      }
      if (from && b.expiry_date && b.expiry_date < from) return false;
      if (to && b.expiry_date && b.expiry_date > to) return false;
      return true;
    });
  }, [batches, locationId, mode, from, to, today, in30]);

  const totals = useMemo(() => {
    const expired = batches.filter((b) => b.expiry_date && b.expiry_date < today && b.quantity > 0);
    const expiring = batches.filter((b) => b.expiry_date && b.expiry_date >= today && b.expiry_date <= in30 && b.quantity > 0);
    return {
      expiredCount: expired.length,
      expiredUnits: expired.reduce((s, b) => s + b.quantity, 0),
      expiringCount: expiring.length,
      expiringUnits: expiring.reduce((s, b) => s + b.quantity, 0),
      total: batches.length,
    };
  }, [batches, today, in30]);

  const save = async () => {
    if (!editing) return;
    if (!editing.product_id) { toast.error("Pick a product"); return; }
    try {
      await upsert.mutateAsync({
        id: editing.id,
        product_id: editing.product_id,
        location_id: editing.location_id || null,
        batch_number: editing.batch_number || null,
        quantity: Number(editing.quantity || 0),
        expiry_date: editing.expiry_date || null,
        notes: editing.notes || "",
      } as any);
      toast.success(editing.id ? "Batch updated" : "Batch added");
      setEditing(null);
    } catch (e: any) {
      toast.error(e?.message || "Failed to save");
    }
  };

  const remove = async (id: string) => {
    if (!(await confirmAction({ title: "Delete this batch?", message: "This cannot be undone.", danger: true, confirmLabel: "Delete" }))) return;
    try {
      await del.mutateAsync(id);
      toast.success("Batch deleted");
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete");
    }
  };

  const statusOf = (b: ProductBatch) => {
    if (!b.expiry_date) return { label: "—", className: "text-muted-foreground" };
    if (b.expiry_date < today) return { label: "Expired", className: "text-destructive font-medium" };
    if (b.expiry_date <= in30) return { label: "Expiring", className: "text-orange-500 font-medium" };
    return { label: "OK", className: "text-emerald-600" };
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={CalendarClock} title={"Product batches"} description={"Track expiry by batch and location."} actions={<><Button onClick={() => setEditing({ quantity: 0 })} className="gap-2">
          <Plus className="w-4 h-4" /> Add Batch
        </Button></>} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 flex items-center gap-3">
          <PackageCheck className="w-6 h-6 text-primary" />
          <div><div className="text-xs text-muted-foreground">All Batches</div><div className="text-xl font-semibold">{totals.total}</div></div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <CalendarX className="w-6 h-6 text-destructive" />
          <div><div className="text-xs text-muted-foreground">Expired</div><div className="text-xl font-semibold">{totals.expiredCount} <span className="text-xs text-muted-foreground font-normal">/ {totals.expiredUnits}u</span></div></div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <Clock className="w-6 h-6 text-orange-500" />
          <div><div className="text-xs text-muted-foreground">Expiring (30d)</div><div className="text-xl font-semibold">{totals.expiringCount} <span className="text-xs text-muted-foreground font-normal">/ {totals.expiringUnits}u</span></div></div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
          <div><div className="text-xs text-muted-foreground">Filtered</div><div className="text-xl font-semibold">{filtered.length}</div></div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as FilterMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="expiring">Expiring (30d)</SelectItem>
                <SelectItem value="ok">OK</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Location</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All locations</SelectItem>
                {locations.map((l: any) => (<SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Expiry from</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Expiry to</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Batch #</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No batches match your filters.</TableCell></TableRow>
              ) : <PagedRows rows={filtered} colSpan={7}>{(pageRows) => pageRows.map((b) => {
                const s = statusOf(b);
                return (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{productMap[b.product_id] || "—"}</TableCell>
                    <TableCell>{b.batch_number || "—"}</TableCell>
                    <TableCell>{b.location_id ? (locMap[b.location_id] || "—") : "—"}</TableCell>
                    <TableCell className="text-right">{b.quantity}</TableCell>
                    <TableCell>{b.expiry_date ? format(new Date(b.expiry_date), "MMM d, yyyy") : "—"}</TableCell>
                    <TableCell><span className={s.className}>{s.label}</span></TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setEditing(b)}><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => remove(b.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}</PagedRows>}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit Batch" : "Add Batch"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Product</Label>
              <Select value={editing?.product_id || ""} onValueChange={(v) => setEditing({ ...(editing || {}), product_id: v })}>
                <SelectTrigger><SelectValue placeholder="Pick a product" /></SelectTrigger>
                <SelectContent>
                  {products.map((p: any) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Location</Label>
              <Select value={editing?.location_id || ""} onValueChange={(v) => setEditing({ ...(editing || {}), location_id: v })}>
                <SelectTrigger><SelectValue placeholder="Pick a location" /></SelectTrigger>
                <SelectContent>
                  {locations.map((l: any) => (<SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Batch #</Label><Input value={editing?.batch_number || ""} onChange={(e) => setEditing({ ...(editing || {}), batch_number: e.target.value })} /></div>
              <div><Label>Quantity</Label><Input type="number" value={editing?.quantity ?? 0} onChange={(e) => setEditing({ ...(editing || {}), quantity: Number(e.target.value) })} /></div>
            </div>
            <div><Label>Expiry date</Label><Input type="date" value={editing?.expiry_date || ""} onChange={(e) => setEditing({ ...(editing || {}), expiry_date: e.target.value })} /></div>
            <div><Label>Notes</Label><Input value={editing?.notes || ""} onChange={(e) => setEditing({ ...(editing || {}), notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={upsert.isPending}>{upsert.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
