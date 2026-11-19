import { PageHeader, Toolbar, SearchBox, StatTile, PageLoader, Panel, EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import PageHead from "@/components/PageHead";
import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, Edit, PackageMinus, AlertTriangle, MapPin, Trash2, Upload, Download, FileDown, Printer, Package, Columns3, ArrowUp, ArrowDown, ArrowUpDown, Filter, GripVertical , Boxes, Wallet, Layers, PackagePlus, PencilLine, Warehouse, MoreHorizontal } from "lucide-react";
import Pagination, { usePaginated } from "@/components/Pagination";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { useLocations, useProductStocks, useStockAdjustments, useBusinessSettings } from "@/hooks/useData";
import { supabase } from "@/integrations/supabase/client";
import { offlineMutate } from "@/lib/offlineMutate";
import { formatKES, currencyCode } from "@/lib/format";
import { cn } from "@/lib/utils";
import StockAdjustment from "@/components/StockAdjustment";
import ProductDetailDialog from "@/components/ProductDetailDialog";
import { logActivity } from "@/lib/auditLog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useUserUIPreference } from "@/hooks/useUserUIPreference";
import type { Database } from "@/integrations/supabase/types";
import { tenantPath } from "@/lib/host";
import BulkAddProducts from "@/components/products/BulkAddProducts";
import BulkEditProducts from "@/components/products/BulkEditProducts";
import BulkAdjustStock from "@/components/products/BulkAdjustStock";
import { bulkColumns, downloadTemplate } from "@/components/products/bulkColumns";
import { useBusinessType } from "@/hooks/useBusinessType";
import { useVatEnabled } from "@/hooks/useVatEnabled";

type DbProduct = Database["public"]["Tables"]["products"]["Row"];

export default function Inventory() {
  const nav = useNavigate();
  const { tenant } = useTenant();
  const inventoryBase = tenantPath(tenant?.slug, "/inventory/products");
  const goAdd = () => nav(`${inventoryBase}/new${locationId ? `?location=${locationId}` : ""}`);
  const goEdit = (id: string) => nav(`${inventoryBase}/${id}/edit${locationId ? `?location=${locationId}` : ""}`);

  const [search, setSearch] = useState("");
  const [adjustProduct, setAdjustProduct] = useState<DbProduct | null>(null);
  const [detailProduct, setDetailProduct] = useState<any | null>(null);
  const [deleteProduct, setDeleteProduct] = useState<any>(null);
  // Arriving from the dashboard "View all" link opens straight into low stock.
  const [showLowStockOnly, setShowLowStockOnly] = useState(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("stock") === "low"
  );
  const [locationId, setLocationId] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("__all__");
  const [importing, setImporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [ioOpen, setIoOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showBulkAdjust, setShowBulkAdjust] = useState(false);
  const { businessType } = useBusinessType();
  const { vatEnabled } = useVatEnabled();

  // Column visibility + order — defaults: image, Product, Category, Price, Stock, Status, Actions
  type ColKey = "image" | "product" | "category" | "cost" | "price" | "margin" | "stock" | "stockValue" | "status" | "actions";
  const COL_DEFS: { key: ColKey; label: string; alwaysOn?: boolean; sortable?: boolean }[] = [
    { key: "image", label: "Image" },
    { key: "product", label: "Product Name", alwaysOn: true, sortable: true },
    { key: "category", label: "Category", sortable: true },
    { key: "cost", label: "Cost", sortable: true },
    { key: "price", label: "Price", sortable: true },
    { key: "margin", label: "Margin", sortable: true },
    { key: "stock", label: "Stock", sortable: true },
    { key: "stockValue", label: "Stock Value", sortable: true },
    { key: "status", label: "Status", sortable: true },
    { key: "actions", label: "Actions", alwaysOn: true },
  ];
  const DEFAULT_ORDER: ColKey[] = ["image", "product", "category", "cost", "price", "margin", "stock", "stockValue", "status", "actions"];
  const DEFAULT_VISIBLE: Record<ColKey, boolean> = {
    image: false, product: true, category: true, cost: false, price: true,
    margin: false, stock: true, stockValue: true, status: true, actions: true,
  };
  type ColPrefs = { visible: Record<ColKey, boolean>; order: ColKey[] };
  const [colPrefs, setColPrefs] = useUserUIPreference<ColPrefs>("inventory.columns.v3", {
    visible: DEFAULT_VISIBLE, order: DEFAULT_ORDER,
  });
  const visibleCols = colPrefs.visible || DEFAULT_VISIBLE;
  const colOrder: ColKey[] = (colPrefs.order && colPrefs.order.length ? colPrefs.order : DEFAULT_ORDER)
    .filter((k) => DEFAULT_ORDER.includes(k));
  // Re-add any new keys that aren't in saved order
  DEFAULT_ORDER.forEach((k) => { if (!colOrder.includes(k)) colOrder.push(k); });
  const setVisibleCols = (updater: (v: Record<ColKey, boolean>) => Record<ColKey, boolean>) =>
    setColPrefs((p) => ({ ...p, visible: updater(p.visible || DEFAULT_VISIBLE) }));
  const moveCol = (key: ColKey, dir: -1 | 1) => {
    setColPrefs((p) => {
      const order = [...(p.order && p.order.length ? p.order : DEFAULT_ORDER)];
      const i = order.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) return p;
      [order[i], order[j]] = [order[j], order[i]];
      return { ...p, order };
    });
  };
  const isCol = (k: ColKey) => !!visibleCols[k];
  const visibleColCount = COL_DEFS.filter((c) => visibleCols[c.key]).length + 1; // +1 for checkbox col

  // Sorting + filtering
  type SortKey = "product" | "category" | "cost" | "price" | "margin" | "stock" | "stockValue" | "status";
  const [sortKey, setSortKey] = useState<SortKey>("product");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [statusFilter, setStatusFilter] = useState<"all" | "in" | "low" | "out">("all");
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };
  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? <ArrowUpDown className="inline w-3 h-3 opacity-40 ml-1" /> :
    sortDir === "asc" ? <ArrowUp className="inline w-3 h-3 ml-1" /> : <ArrowDown className="inline w-3 h-3 ml-1" />;


  const { data: locations = [] } = useLocations();
  const { data: products = [], isLoading } = useProductStocks(locationId);
  const { data: adjustments = [] } = useStockAdjustments(locationId === "__all__" ? undefined : locationId);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const { data: settings } = useBusinessSettings();

  const isAllLocations = locationId === "__all__";

  useEffect(() => {
    if (!locationId && locations[0]?.id) setLocationId(locations[0].id);
  }, [locationId, locations]);

  // Build category list from products in current view
  const categoriesInView = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p: any) => { if (p.category) set.add(p.category); });
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = products.filter((p: any) => {
      const matchSearch = p.name.toLowerCase().includes(q) || (p.barcode || "").toLowerCase().includes(q);
      const matchStock = !showLowStockOnly || p.stock <= p.reorder_level;
      const matchCategory = activeCategory === "__all__" || p.category === activeCategory;
      const stockNum = Number(p.stock) || 0;
      const reorder = Number(p.reorder_level) || 0;
      const matchStatus =
        statusFilter === "all" ? true :
        statusFilter === "out" ? stockNum <= 0 :
        statusFilter === "low" ? stockNum > 0 && stockNum <= reorder :
        /* in */ stockNum > reorder;
      return matchSearch && matchStock && matchCategory && matchStatus;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    const valOf = (p: any): number | string => {
      switch (sortKey) {
        case "product": return String(p.name || "").toLowerCase();
        case "category": return String(p.category || "").toLowerCase();
        case "cost": return Number(p.cost_price) || 0;
        case "price": return Number(p.price) || 0;
        case "stock": return Number(p.stock) || 0;
        case "stockValue": return ((Number(p.cost_price) || Number(p.price) || 0)) * (Number(p.stock) || 0);
        case "margin": {
          const c = Number(p.cost_price) || 0; const pr = Number(p.price) || 0;
          return pr > 0 ? ((pr - c) / pr) * 100 : -Infinity;
        }
        case "status": {
          const s = Number(p.stock) || 0; const r = Number(p.reorder_level) || 0;
          return s <= 0 ? 0 : s <= r ? 1 : 2;
        }
      }
    };
    return [...list].sort((a, b) => {
      const av = valOf(a); const bv = valOf(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * dir;
    });
  }, [search, products, showLowStockOnly, activeCategory, statusFilter, sortKey, sortDir]);

  // Reset to first page whenever filters change
  useEffect(() => { setPage(1); }, [search, showLowStockOnly, activeCategory, locationId, statusFilter, sortKey, sortDir]);
  const paged = usePaginated(filtered, pageSize, page);

  // Fall back to the selling price when a buying price has not been entered,
  // so stock value is never reported as zero for priced items.
  const totalValue = products.reduce((sum: number, p: any) => sum + (Number(p.cost_price) || Number(p.price) || 0) * Number(p.stock || 0), 0);
  const totalItems = products.reduce((sum: number, p: any) => sum + p.stock, 0);
  const lowStockCount = products.filter((p: any) => p.stock <= p.reorder_level).length;

  const handleDelete = async () => {
    if (!deleteProduct) return;
    try {
      const res = await offlineMutate({
        table: "products", action: "delete",
        payload: { id: deleteProduct.id }, cacheStore: "products",
      });
      toast({ title: res.offline ? "Product deleted (offline — will sync)" : "Product deleted successfully" });
      logActivity({
        action: "delete",
        entity_type: "product",
        entity_id: deleteProduct.id,
        description: `Deleted product "${deleteProduct.name}"`,
      });
      qc.invalidateQueries({ queryKey: ["product-stocks"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e: any) {
      toast({ title: "Error deleting product", description: e.message, variant: "destructive" });
    }
    setDeleteProduct(null);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    let failed = 0;
    let offlineCount = 0;
    for (const id of ids) {
      try {
        const res = await offlineMutate({
          table: "products", action: "delete",
          payload: { id }, cacheStore: "products",
        });
        if (res.offline) offlineCount++;
      } catch { failed++; }
    }
    if (failed > 0) toast({ title: "Error", description: `${failed} of ${ids.length} failed`, variant: "destructive" });
    else toast({ title: `${ids.length} products deleted${offlineCount ? " (offline — will sync)" : ""}` });
    qc.invalidateQueries({ queryKey: ["product-stocks"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    setSelectedIds(new Set());
    setShowBulkDelete(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((p: any) => p.id)));
    }
  };

  const handlePrintLabels = () => {
    const selectedProducts = filtered.filter((p: any) => selectedIds.has(p.id));
    const productsWithBarcode = selectedProducts.filter((p: any) => p.barcode);
    if (productsWithBarcode.length === 0) {
      toast({ title: "No barcodes to print", description: "Selected products have no barcode value", variant: "destructive" });
      return;
    }
    const printWindow = window.open("", "_blank");
    if (!printWindow) { toast({ title: "Popup blocked", description: "Allow popups to print labels", variant: "destructive" }); return; }

    // Read barcode settings from business_settings
    const s = settings as any || {};
    const labelWidth = s.barcode_label_width || "50mm";
    const labelHeight = s.barcode_label_height || "30mm";
    const showName = s.barcode_show_name !== false;
    const showPrice = s.barcode_show_price !== false;

    const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

    const labels = productsWithBarcode.map((p: any) => {
      const code = p.barcode;
      return `<div style="display:inline-block;width:${labelWidth};height:${labelHeight};border:1px dashed #ccc;margin:2mm;padding:3mm;text-align:center;page-break-inside:avoid;font-family:Arial,sans-serif;box-sizing:border-box;overflow:hidden;">
        ${showName ? `<div style="font-size:9px;font-weight:bold;margin-bottom:2mm;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${esc(p.name)}</div>` : ""}
        <div style="font-family:'Libre Barcode 128',monospace;font-size:40px;line-height:1;letter-spacing:2px;">${esc(code)}</div>
        <div style="font-size:8px;margin-top:1mm;font-family:monospace;">${esc(code)}</div>
        ${showPrice ? `<div style="font-size:8px;color:#666;margin-top:1mm;">${currencyCode()} ${Number(p.price).toLocaleString()}</div>` : ""}
      </div>`;
    }).join("");
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Barcode Labels</title>
      <link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+128&display=swap" rel="stylesheet">
      <style>@page{margin:5mm}body{margin:0;padding:5mm}@media print{body{padding:0}}</style>
      </head><body>${labels}</body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  const handleExportCSV = () => {
    const headers = ["Name", "Barcode", "Category", "Subcategory", "Buying Price", "Selling Price", "Stock", "Reorder Level", "VAT Rate", "Unit"];
    const rows = products.map((p: any) => [
      p.name, p.barcode || "", p.category, p.subcategory || "", p.cost_price, p.price, p.stock, p.reorder_level, p.vat_rate, p.unit,
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    import("@e965/xlsx").then(XLSX => {
      const data = products.map((p: any) => ({
        Name: p.name, Barcode: p.barcode || "", Category: p.category, Subcategory: p.subcategory || "",
        "Buying Price": Number(p.cost_price), "Selling Price": Number(p.price),
        Stock: p.stock, "Reorder Level": p.reorder_level, "VAT Rate": p.vat_rate, Unit: p.unit,
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Products");
      XLSX.writeFile(wb, `products-${new Date().toISOString().slice(0, 10)}.xlsx`);
    });
  };

  if (isLoading) return <PageLoader label="Loading inventory…" />;

  return (
    <div className="space-y-4">
      <PageHead
        title="Stock on Hand"
        description="Stock on hand, value and low stock at every branch."
        noindex
      />
      <PageHeader title="Stock on Hand" icon={Warehouse}
        description={isAllLocations ? "All branches" : locations.find((l: any) => l.id === locationId)?.name}
        actions={<>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) { setImportFile(file); setShowBulkAdd(true); } e.target.value = ""; }} />
          <Popover open={ioOpen} onOpenChange={setIoOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" disabled={importing}><Upload /> <span className="hidden sm:inline">{importing ? "Importing…" : "Import / export"}</span></Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 p-1.5" onClick={(e) => { if ((e.target as HTMLElement).closest("button")) setIoOpen(false); }}>
              <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Import</p>
              <button onClick={() => fileInputRef.current?.click()} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-muted"><Upload className="h-4 w-4" /> Import products (CSV / Excel)</button>
              <button onClick={() => { setImportFile(null); setShowBulkAdd(true); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-muted"><PackagePlus className="h-4 w-4" /> Add many at once</button>
              <button onClick={() => downloadTemplate(bulkColumns(businessType, vatEnabled), businessType)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-muted"><FileDown className="h-4 w-4" /> Download template</button>
              <p className="mt-1 border-t border-border px-2 pb-1.5 pt-2 text-xs font-semibold text-muted-foreground">Export</p>
              <button onClick={handleExportCSV} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-muted"><Download className="h-4 w-4" /> CSV</button>
              <button onClick={handleExportExcel} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-muted"><Download className="h-4 w-4" /> Excel</button>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" title="Show / hide columns" aria-label="Columns"><Columns3 /></Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-2">
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Show and order columns</div>
              <div className="max-h-80 space-y-1 overflow-auto">
                {colOrder.map((key, idx) => {
                  const c = COL_DEFS.find((x) => x.key === key);
                  if (!c) return null;
                  return (
                    <div key={c.key} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
                      <Checkbox id={`col-${c.key}`} checked={visibleCols[c.key]} disabled={c.alwaysOn}
                        onCheckedChange={(v) => setVisibleCols((prev) => ({ ...prev, [c.key]: !!v }))} aria-label={`Show ${c.label} column`} />
                      <label htmlFor={`col-${c.key}`} className={cn("flex-1 cursor-pointer", c.alwaysOn && "opacity-60")}>{c.label}</label>
                      <button onClick={() => moveCol(c.key, -1)} disabled={idx === 0} className="rounded p-1 hover:bg-accent disabled:opacity-30" aria-label={`Move ${c.label} up`}><ArrowUp className="h-3 w-3" /></button>
                      <button onClick={() => moveCol(c.key, 1)} disabled={idx === colOrder.length - 1} className="rounded p-1 hover:bg-accent disabled:opacity-30" aria-label={`Move ${c.label} down`}><ArrowDown className="h-3 w-3" /></button>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 border-t border-border px-2 pt-2">
                <button onClick={() => setColPrefs({ visible: DEFAULT_VISIBLE, order: DEFAULT_ORDER })} className="text-xs text-primary hover:underline">Reset to defaults</button>
              </div>
            </PopoverContent>
          </Popover>
          <Button onClick={goAdd}><Plus /> New item</Button>
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Items" value={products.length.toLocaleString()} icon={Package} tone="primary" />
        <StatTile label="Units in stock" value={totalItems.toLocaleString()} icon={Boxes} tone="info" />
        <StatTile label="Stock value" value={formatKES(totalValue)} icon={Wallet} tone="success" hint="Cost × stock on hand" />
        <button type="button" onClick={() => setShowLowStockOnly(!showLowStockOnly)} className="text-left">
          <StatTile label={showLowStockOnly ? "Low stock (tap to clear)" : "Low stock"} value={lowStockCount} icon={AlertTriangle}
            tone={lowStockCount > 0 ? "danger" : "muted"} className={cn("h-full transition-colors hover:border-destructive/40", showLowStockOnly && "border-destructive bg-destructive/5")} />
        </button>
      </div>

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search name or barcode…" />
        {locations.length > 1 && (
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="fi w-auto pl-9" aria-label="Branch">
              <option value="__all__">All branches</option>
              {locations.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
            </select>
          </div>
        )}
        {categoriesInView.length > 0 && (
          <select value={activeCategory} onChange={(e) => setActiveCategory(e.target.value)} aria-label="Category" className="fi w-auto max-w-[12rem]">
            <option value="__all__">All categories</option>
            {categoriesInView.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} aria-label="Stock status" className="fi w-auto">
          <option value="all">All stock</option>
          <option value="in">In stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </select>
        {(statusFilter !== "all" || activeCategory !== "__all__" || sortKey !== "product" || sortDir !== "asc") && (
          <Button variant="ghost" size="sm" onClick={() => { setStatusFilter("all"); setActiveCategory("__all__"); setSortKey("product"); setSortDir("asc"); }}>Clear</Button>
        )}
        {selectedIds.size > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-2 py-1">
            <span className="px-1 text-sm font-medium">{selectedIds.size} selected</span>
            <Button size="sm" variant="outline" onClick={() => setShowBulkEdit(true)}><PencilLine /> Edit</Button>
            <Button size="sm" variant="outline" onClick={() => setShowBulkAdjust(true)} disabled={isAllLocations} title={isAllLocations ? "Pick one branch to adjust stock" : "Adjust stock"}><PackageMinus /> Adjust stock</Button>
            <Button size="sm" variant="outline" onClick={() => handlePrintLabels()}><Printer /> Labels</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>
            <Button size="sm" variant="destructive" onClick={() => setShowBulkDelete(true)}><Trash2 /> Delete</Button>
          </div>
        )}
      </Toolbar>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="dt">
            <thead>
              <tr>
                <th className="w-10 !px-3"><input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} aria-label="Select all products" className="rounded border-input" /></th>
                {colOrder.filter((k) => isCol(k)).map((key) => {
                  const sortable = (k: string): k is SortKey => ["product","category","cost","price","margin","stock","stockValue","status"].includes(k);
                  const headerCls = "select-none";
                  const align = (key === "cost" || key === "price" || key === "margin" || key === "stockValue") ? "text-right"
                              : (key === "stock" || key === "status" || key === "actions") ? "text-center"
                              : "text-left";
                  if (key === "image") return <th key={key} className={cn(headerCls, "text-left w-14 px-3")}>Image</th>;
                  if (key === "actions") return <th key={key} className={cn(headerCls, "text-center")}>Actions</th>;
                  const label = key === "product" ? "Product" :
                                key === "stockValue" ? "Stock Value" :
                                key === "stock" ? "On hand" :
                                key.charAt(0).toUpperCase() + key.slice(1);
                  if (sortable(key)) {
                    return (
                      <th key={key} className={cn(headerCls, align)}>
                        <button
                          onClick={() => toggleSort(key)}
                          className="inline-flex items-center hover:text-foreground transition-colors"
                          aria-label={`Sort by ${label}`}
                        >
                          {label}<SortIcon k={key} />
                        </button>
                      </th>
                    );
                  }
                  return <th key={key} className={cn(headerCls, align)}>{label}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {paged.map((p: any) => {
                const cost = Number(p.cost_price) || 0;
                const price = Number(p.price) || 0;
                const marginAmt = price - cost;
                const marginPct = price > 0 ? (marginAmt / price) * 100 : 0;
                const marginColor = marginAmt < 0 ? "text-destructive" : marginPct < 10 ? "text-warning" : "text-success";
                const renderCell = (key: ColKey) => {
                  switch (key) {
                    case "image": return (
                      <td key={key}>
                        <div className="w-10 h-10 rounded-md bg-muted overflow-hidden flex items-center justify-center border border-border">
                          {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" loading="lazy" /> : <Package className="w-4 h-4 text-muted-foreground" />}
                        </div>
                      </td>
                    );
                    case "product": return (
                      <td key={key} className="font-semibold">
                        <button type="button" onClick={() => setDetailProduct(p)} className="text-left text-primary hover:underline">
                          {p.name}
                        </button>
                        {(p.sku || p.barcode) && <div className="text-[11px] font-normal text-muted-foreground">{p.sku || p.barcode}</div>}
                        {isAllLocations && typeof p.location_count === "number" && (
                          <span className="ml-2 text-[10px] font-normal text-muted-foreground">· {p.location_count} loc{p.location_count === 1 ? "" : "s"}</span>
                        )}
                      </td>
                    );
                    case "category": return <td key={key} className="text-muted-foreground">{p.category}</td>;
                    case "cost": return <td key={key} className="text-right text-muted-foreground">{formatKES(cost)}</td>;
                    case "price": return <td key={key} className="text-right font-medium">{formatKES(price)}</td>;
                    case "margin": return (
                      <td key={key} className={cn("text-right font-semibold", marginColor)}>
                        {price > 0 ? `${marginPct.toFixed(1)}%` : "—"}
                        <div className="text-[10px] font-normal opacity-70">{formatKES(marginAmt)}</div>
                      </td>
                    );
                    case "stock": return <td key={key} className="text-center font-semibold tabular-nums">{Number(p.stock).toLocaleString()}{Number(p.reorder_level) > 0 && <div className="text-[10px] font-normal text-muted-foreground">reorder at {p.reorder_level}</div>}</td>;
                    case "stockValue": return <td key={key} className="text-right font-medium text-primary">{formatKES((cost || price) * (Number(p.stock) || 0))}</td>;
                    case "status": return (
                      <td key={key} className="text-center">
                        <span className={cn("text-xs font-semibold px-2 py-1 rounded-full", p.stock <= 0 && "bg-destructive/10 text-destructive", p.stock > 0 && p.stock <= p.reorder_level && "bg-warning/10 text-warning", p.stock > p.reorder_level && "bg-success/10 text-success")}>{p.stock <= 0 ? "Out of Stock" : p.stock <= p.reorder_level ? "Low Stock" : "In Stock"}</span>
                      </td>
                    );
                    case "actions": return (
                      <td key={key} className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-40" onClick={() => setAdjustProduct(p)} disabled={isAllLocations}
                            aria-label={`Adjust stock for ${p.name}`} title={isAllLocations ? "Pick one branch to adjust stock" : "Adjust stock"}>
                            <PackageMinus className="h-3.5 w-3.5" /> Adjust
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`More for ${p.name}`}><MoreHorizontal className="h-4 w-4" /></button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setDetailProduct(p)}><Package /> View</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => goEdit(p.id)}><Edit /> Edit</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem danger onSelect={() => setDeleteProduct(p)}><Trash2 /> Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    );
                  }
                };
                return (
                  <tr key={p.id} className={cn(p.stock <= p.reorder_level && "bg-warning/5", selectedIds.has(p.id) && "bg-primary/5")}>
                    <td className="!px-3"><input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} aria-label={`Select ${p.name}`} className="rounded border-input" /></td>
                    {colOrder.filter((k) => isCol(k)).map((k) => renderCell(k))}
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={visibleColCount}><EmptyState icon={Package} title={products.length ? "No products match" : "No products yet"} description={products.length ? "Try another search, category or stock filter." : "Add your first product to start selling."} /></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          total={filtered.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          itemLabel="products"
        />
      </div>

      <Panel title="Recent stock adjustments" icon={Layers} flush>
        {adjustments.length === 0 ? <EmptyState title="No adjustments yet" className="py-8" /> : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {adjustments.map((a: any) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.products?.name || "Product"}</p>
                  <p className="truncate text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()} · {a.reason}</p>
                </div>
                <span className={cn("shrink-0 font-semibold tabular-nums", a.quantity_change >= 0 ? "text-success" : "text-destructive")}>{a.quantity_change >= 0 ? `+${a.quantity_change}` : a.quantity_change}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <BulkAddProducts open={showBulkAdd} onClose={() => { setShowBulkAdd(false); setImportFile(null); }}
        defaultLocationId={locationId} existing={products as any[]} initialFile={importFile} />
      {showBulkEdit && (
        <BulkEditProducts open onClose={() => { setShowBulkEdit(false); setSelectedIds(new Set()); }} productIds={Array.from(selectedIds)} />
      )}
      {showBulkAdjust && !isAllLocations && (
        <BulkAdjustStock open onClose={() => { setShowBulkAdjust(false); setSelectedIds(new Set()); }}
          products={(products as any[]).filter((p) => selectedIds.has(p.id))} locationId={locationId}
          locationName={locations.find((l: any) => l.id === locationId)?.name} />
      )}

      {/* Add/Edit product opens as a full page route now */}
      {adjustProduct && locationId && (
        <StockAdjustment locationId={locationId} product={adjustProduct} onClose={() => setAdjustProduct(null)} />
      )}

      {detailProduct && (
        <ProductDetailDialog
          product={detailProduct}
          onClose={() => setDetailProduct(null)}
          onEdit={() => { const id = detailProduct.id; setDetailProduct(null); goEdit(id); }}
        />
      )}

      <AlertDialog open={!!deleteProduct} onOpenChange={(o) => !o && setDeleteProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>"{deleteProduct?.name}" will be deactivated and hidden from inventory and POS. Stock data is preserved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showBulkDelete} onOpenChange={(o) => !o && setShowBulkDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} products?</AlertDialogTitle>
            <AlertDialogDescription>These products will be deactivated and hidden from inventory and POS. Stock data is preserved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete All</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
