import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Barcode, Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useLocations, useProducts } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, Pill, StatGrid, StatTile } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { fmtDate } from "@/lib/doc-pdf";
import { parseSerials } from "@/pages/purchases/PurchaseDocs";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;
const STATUS: Record<string, { label: string; tone: "success" | "info" | "muted" | "warning" | "danger" }> = {
  in_stock: { label: "In stock", tone: "success" },
  sold: { label: "Sold", tone: "info" },
  returned: { label: "Returned", tone: "warning" },
  damaged: { label: "Damaged", tone: "danger" },
  written_off: { label: "Written off", tone: "muted" },
};

/** Serial numbers: what is in stock, who bought each unit, and where it came from. */
export default function SerialNumbers() {
  const tenantId = useTenantId();
  const { data: products = [] } = useProducts();
  const { data: locations = [] } = useLocations();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [productId, setProductId] = useState("");
  const [adding, setAdding] = useState(false);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["product-serials", "list", tenantId, status, productId],
    enabled: !!tenantId,
    queryFn: async () => {
      let x = sb.from("product_serials").select("*").eq("tenant_id", tenantId).order("updated_at", { ascending: false }).limit(2000);
      if (status !== "all") x = x.eq("status", status);
      if (productId) x = x.eq("product_id", productId);
      return ((await x).data || []) as any[];
    },
  });
  const name = useMemo(() => Object.fromEntries((products as any[]).map((p) => [p.id, p.name])), [products]);
  const loc = useMemo(() => Object.fromEntries((locations as any[]).map((l) => [l.id, l.name])), [locations]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => [r.serial_number, r.batch_number, r.invoice_number, r.customer_name, r.received_ref_number, name[r.product_id]].some((v) => String(v || "").toLowerCase().includes(needle))) : rows;
  const tracked = (products as any[]).filter((p) => p.track_serials);

  return (
    <div className="space-y-5">
      <PageHeader title="Serial Numbers" icon={Barcode} description="Every unit of serial-tracked items: in stock, sold to whom, and received on which document."
        actions={<Button onClick={() => setAdding(true)} disabled={!tracked.length}><Plus /> Add serial numbers</Button>} />
      <StatGrid>
        <StatTile label="In stock" value={rows.filter((r) => r.status === "in_stock").length} />
        <StatTile label="Sold" value={rows.filter((r) => r.status === "sold").length} />
        <StatTile label="Items tracked" value={tracked.length} />
      </StatGrid>
      <Panel flush>
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input className="fi pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search serial, customer, invoice or batch" aria-label="Search serial numbers" />
          </div>
          <select className="fi w-auto" value={productId} onChange={(e) => setProductId(e.target.value)} aria-label="Item">
            <option value="">All items</option>
            {tracked.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="fi w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="all">Any status</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        {isLoading ? <OrbLoader label="Loading serial numbers…" /> : !shown.length ? (
          <EmptyState icon={Barcode} title={rows.length ? "No match" : "No serial numbers yet"}
            description={tracked.length ? "Serial numbers are added when serial-tracked items are received, or with Add serial numbers." : "Turn on \"Serial numbers\" on an item (Edit item → Track Inventory) to start."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="dt">
              <thead><tr><th>Serial number</th><th>Item</th><th>Status</th><th>Batch</th><th>Branch</th><th>Received</th><th>Sold</th></tr></thead>
              <tbody><PagedRows rows={shown} colSpan={7}>{(pageRows) => pageRows.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono font-semibold">{r.serial_number}</td>
                  <td>{name[r.product_id] || "Item"}</td>
                  <td><Pill tone={STATUS[r.status]?.tone || "muted"}>{STATUS[r.status]?.label || r.status}</Pill></td>
                  <td>{r.batch_number || "—"}</td>
                  <td>{loc[r.location_id] || "—"}</td>
                  <td>{fmtDate(r.received_at)}{r.received_ref_number && <span className="block text-xs text-muted-foreground">{r.received_ref_number}</span>}</td>
                  <td>{r.status === "sold" ? <>
                    {fmtDate(r.sold_at)}
                    {r.invoice_id && <Link className="block text-xs font-semibold text-primary hover:underline" to={`/sales/invoices/${r.invoice_id}`}>{r.invoice_number || "Invoice"}</Link>}
                    {r.customer_name && <span className="block text-xs text-muted-foreground">{r.customer_name}</span>}
                  </> : "—"}</td>
                </tr>
              ))}</PagedRows></tbody>
            </table>
          </div>
        )}
      </Panel>
      {adding && <AddSerials products={tracked} locations={locations as any[]} onClose={() => setAdding(false)} />}
    </div>
  );
}

/** Opening stock (or stock found) for serial-tracked items: each serial adds one unit. */
function AddSerials({ products, locations, onClose }: { products: any[]; locations: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const main = locations.find((l) => l.is_main) || locations[0];
  const [f, setF] = useState({ product: products[0]?.id || "", location: main?.id || "", serials: "", batch: "", expiry: "" });
  const [busy, setBusy] = useState(false);
  const list = parseSerials(f.serials);
  const save = async () => {
    if (!f.product || !f.location) return toast({ title: "Choose the item and branch", variant: "destructive" });
    if (!list.length) return toast({ title: "Enter at least one serial number", variant: "destructive" });
    setBusy(true);
    const { data, error } = await sb.rpc("wh_receive_serials", { p_location: f.location, p_product: f.product, p_serials: list, p_batch: f.batch.trim() || null, p_expiry: f.expiry || null, p_reason: "restock" });
    setBusy(false);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    ["product-serials", "products", "product-stocks", "zitems", "product_batches"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    toast({ title: `${data} serial number(s) added`, description: "Stock went up by the same number." });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Add serial numbers" icon={Barcode} description="Each serial number adds one unit to stock."
      footer={<div className="flex gap-2"><Button onClick={save} disabled={busy}>{busy ? <OrbSpinner /> : <Plus />} Add {list.length || ""}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Item" required><select className="fi" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Branch" required><select className="fi" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        <Field label="Batch"><input className="fi" value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value })} placeholder="Optional" /></Field>
        <Field label="Expiry"><input className="fi" type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Field label={`Serial numbers (${list.length})`} required hint="Scan or type, one per line or separated by commas.">
          <textarea className="fi min-h-[140px] font-mono text-sm" value={f.serials} onChange={(e) => setF({ ...f, serials: e.target.value })} />
        </Field></div>
      </div>
    </Modal>
  );
}
