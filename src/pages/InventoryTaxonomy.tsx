import "@/styles/clean.css";
import { PageHeader } from "@/components/kit";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Pencil, Trash2, Tag, Layers, Ruler, ImageIcon, Upload, X, Search, FolderTree } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import {
  useCategories,
  useSubcategories,
  useUnits,
  useTaxonomyMutations,
  uploadTaxonomyImage,
  type CategoryRow,
  type SubcategoryRow,
  type UnitRow,
} from "@/hooks/useTaxonomy";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import Pagination, { usePaginated } from "@/components/Pagination";
import { OrbSpinner } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Tab = "categories" | "subcategories" | "units";

export default function InventoryTaxonomy() {
  const { toast } = useToast();
  const tenantId = useTenantId();
  const [tab, setTab] = useState<Tab>("categories");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data: categories = [], isLoading: catLoading } = useCategories();
  const { data: subcategories = [], isLoading: subLoading } = useSubcategories();
  const { data: units = [], isLoading: unitLoading } = useUnits();
  const m = useTaxonomyMutations();

  const [editing, setEditing] = useState<null | { type: Tab; row?: any }>(null);

  const filteredCats = useMemo(
    () => categories.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())),
    [categories, search]
  );
  const filteredSubs = useMemo(
    () => subcategories.filter((s) => s.name.toLowerCase().includes(search.toLowerCase())),
    [subcategories, search]
  );
  const filteredUnits = useMemo(
    () => units.filter((u) => u.name.toLowerCase().includes(search.toLowerCase())),
    [units, search]
  );

  // Reset pagination when tab/search change
  useEffect(() => { setPage(1); }, [tab, search]);
  const pagedCats = usePaginated(filteredCats, pageSize, page);
  const pagedSubs = usePaginated(filteredSubs, pageSize, page);
  const pagedUnits = usePaginated(filteredUnits, pageSize, page);

  const onDelete = async (type: Tab, id: string, label: string) => {
    if (!(await confirmAction({ title: `Delete "${label}"?`, message: "Products keep their category name. This cannot be undone.", danger: true, confirmLabel: "Delete" }))) return;
    try {
      if (type === "categories") await m.deleteCategory.mutateAsync(id);
      if (type === "subcategories") await m.deleteSubcategory.mutateAsync(id);
      if (type === "units") await m.deleteUnit.mutateAsync(id);
      toast({ title: "Deleted" });
    } catch (e: any) {
      toast({ title: "Could not delete", description: e.message, variant: "destructive" });
    }
  };

  const tabs: { key: Tab; label: string; icon: any; count: number }[] = [
    { key: "categories", label: "Categories", icon: Tag, count: categories.length },
    { key: "subcategories", label: "Subcategories", icon: Layers, count: subcategories.length },
    { key: "units", label: "Units of Measurement", icon: Ruler, count: units.length },
  ];

  const isLoading = catLoading || subLoading || unitLoading;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader icon={FolderTree} title={"Categories & units"} description={"Organise your inventory. Add images for categories & subcategories so they're easy to spot."} actions={<><button
          onClick={() => setEditing({ type: tab })}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" /> Add {tab === "units" ? "unit" : tab.replace(/s$/, "")}
        </button></>} />

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px inline-flex items-center gap-2 transition-colors ${
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
              <span className="text-xs px-1.5 py-0.5 rounded-md bg-muted">{t.count}</span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${tab}...`}
          className="fi pl-9 pr-3"
        />
      </div>

      {/* Table */}
      <div className={tab === "categories" ? "" : "bg-card border border-border rounded-2xl overflow-hidden"}>
        {isLoading ? (
          <div className="p-12 flex items-center justify-center text-muted-foreground">
            <OrbSpinner className="w-5 h-5" />
          </div>
        ) : tab === "categories" ? (
          <>
            <CategoryCards
              rows={pagedCats}
              subcategories={subcategories}
              onEdit={(row) => setEditing({ type: "categories", row })}
              onDelete={(row) => onDelete("categories", row.id, row.name)}
              onAddSub={() => setEditing({ type: "subcategories" })}
            />
            <Pagination
              total={filteredCats.length}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              itemLabel="categories"
            />
          </>
        ) : tab === "subcategories" ? (
          <>
            <SubcategoryTable
              rows={pagedSubs}
              categories={categories}
              onEdit={(row) => setEditing({ type: "subcategories", row })}
              onDelete={(row) => onDelete("subcategories", row.id, row.name)}
            />
            <Pagination
              total={filteredSubs.length}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              itemLabel="subcategories"
            />
          </>
        ) : (
          <>
            <UnitTable
              rows={pagedUnits}
              onEdit={(row) => setEditing({ type: "units", row })}
              onDelete={(row) => onDelete("units", row.id, row.name)}
            />
            <Pagination
              total={filteredUnits.length}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              itemLabel="units"
            />
          </>
        )}
      </div>

      {editing && (
        <EditModal
          editing={editing}
          categories={categories}
          tenantId={tenantId || ""}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/* ---------------- Category cards ---------------- */

const CAT_COLORS = ["from-primary/15 to-primary/5 text-primary", "from-info/15 to-info/5 text-info", "from-success/15 to-success/5 text-success", "from-warning/20 to-warning/5 text-warning", "from-accent/15 to-accent/5 text-accent", "from-destructive/15 to-destructive/5 text-destructive"];

function CategoryCards({ rows, subcategories, onEdit, onDelete, onAddSub }: {
  rows: CategoryRow[]; subcategories: SubcategoryRow[]; onEdit: (r: CategoryRow) => void; onDelete: (r: CategoryRow) => void; onAddSub: () => void;
}) {
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const { data: stats } = useQuery({
    queryKey: ["category-stats", tenantId], enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await (supabase as any).from("products").select("category,stock,cost_price,price,reorder_level").eq("tenant_id", tenantId).eq("is_active", true).limit(10000);
      const m = new Map<string, { n: number; units: number; value: number; low: number }>();
      for (const p of (data || []) as any[]) { const k = p.category || ""; const x = m.get(k) || { n: 0, units: 0, value: 0, low: 0 }; x.n++; x.units += Number(p.stock || 0); x.value += Number(p.stock || 0) * Number(p.cost_price || p.price || 0); if (Number(p.stock) <= Number(p.reorder_level || 0)) x.low++; m.set(k, x); }
      return m;
    },
  });
  if (rows.length === 0) return <Empty label="No categories yet." />;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((r, i) => {
        const st = stats?.get(r.name) || { n: 0, units: 0, value: 0, low: 0 };
        const subs = subcategories.filter((s) => s.category_id === r.id || s.parent_name === r.name);
        return (
          <div key={r.id} data-reveal className="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl">
            <button onClick={() => navigate(`/inventory/products?category=${encodeURIComponent(r.name)}`)} className={`relative flex h-28 w-full items-center gap-4 bg-gradient-to-br px-5 text-left ${CAT_COLORS[i % CAT_COLORS.length]}`}>
              {r.image_url ? <img src={r.image_url} alt="" className="h-16 w-16 rounded-2xl object-cover shadow-md" /> : <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-card/80 shadow-md"><Tag className="h-7 w-7" /></span>}
              <span className="min-w-0"><span className="block truncate font-display text-lg font-bold text-foreground">{r.name}</span><span className="text-sm text-muted-foreground">{st.n} product{st.n === 1 ? "" : "s"} · {st.units.toLocaleString()} in stock</span></span>
            </button>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-muted/60 p-2"><p className="text-muted-foreground">Stock value</p><p className="font-semibold">KES {Math.round(st.value).toLocaleString()}</p></div>
                <div className={`rounded-xl p-2 ${st.low ? "bg-destructive/10" : "bg-muted/60"}`}><p className="text-muted-foreground">Low / out</p><p className={`font-semibold ${st.low ? "text-destructive" : ""}`}>{st.low}</p></div>
              </div>
              <div className="flex min-h-[28px] flex-wrap gap-1.5">{subs.slice(0, 6).map((s) => <span key={s.id} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">{s.name}</span>)}{subs.length > 6 && <span className="text-xs text-muted-foreground">+{subs.length - 6}</span>}{subs.length === 0 && <button onClick={onAddSub} className="text-xs font-medium text-primary hover:underline">+ Add a subcategory</button>}</div>
              <div className="flex gap-2 border-t border-border pt-3">
                <button onClick={() => onEdit(r)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-2 text-sm font-medium hover:border-primary hover:text-primary"><Pencil className="h-4 w-4" /> Edit</button>
                <button onClick={() => onDelete(r)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm text-destructive hover:bg-destructive/10" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Tables ---------------- */

function CategoryTable({ rows, onEdit, onDelete }: {
  rows: CategoryRow[]; onEdit: (r: CategoryRow) => void; onDelete: (r: CategoryRow) => void;
}) {
  if (rows.length === 0) return <Empty label="No categories yet." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">Image</TableHead>
          <TableHead>Name</TableHead>
          <TableHead className="w-32 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell><Thumb url={r.image_url} /></TableCell>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell className="text-right"><RowActions onEdit={() => onEdit(r)} onDelete={() => onDelete(r)} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SubcategoryTable({ rows, categories, onEdit, onDelete }: {
  rows: SubcategoryRow[]; categories: CategoryRow[]; onEdit: (r: SubcategoryRow) => void; onDelete: (r: SubcategoryRow) => void;
}) {
  if (rows.length === 0) return <Empty label="No subcategories yet." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">Image</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Parent category</TableHead>
          <TableHead className="w-32 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell><Thumb url={r.image_url} /></TableCell>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell className="text-muted-foreground text-sm">{r.parent_name || "—"}</TableCell>
            <TableCell className="text-right"><RowActions onEdit={() => onEdit(r)} onDelete={() => onDelete(r)} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function UnitTable({ rows, onEdit, onDelete }: {
  rows: UnitRow[]; onEdit: (r: UnitRow) => void; onDelete: (r: UnitRow) => void;
}) {
  if (rows.length === 0) return <Empty label="No units yet." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Abbreviation</TableHead>
          <TableHead className="w-32 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell className="text-muted-foreground text-sm">{r.abbreviation || "—"}</TableCell>
            <TableCell className="text-right"><RowActions onEdit={() => onEdit(r)} onDelete={() => onDelete(r)} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <button onClick={onEdit} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground" title="Edit">
        <Pencil className="w-4 h-4" />
      </button>
      <button onClick={onDelete} className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Delete">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function Thumb({ url }: { url: string | null }) {
  if (!url) return (
    <div className="w-12 h-12 rounded-lg bg-muted border border-border flex items-center justify-center">
      <ImageIcon className="w-4 h-4 text-muted-foreground" />
    </div>
  );
  return <img src={url} alt="" className="w-12 h-12 rounded-lg object-cover border border-border" />;
}

function Empty({ label }: { label: string }) {
  return <div className="p-12 text-center text-sm text-muted-foreground">{label}</div>;
}

/* ---------------- Edit Modal ---------------- */

function EditModal({ editing, categories, tenantId, onClose, onSaved }: {
  editing: { type: Tab; row?: any };
  categories: CategoryRow[];
  tenantId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const m = useTaxonomyMutations();
  const { toast } = useToast();
  const isEdit = !!editing.row;

  const [name, setName] = useState(editing.row?.name || "");
  const [abbr, setAbbr] = useState(editing.row?.abbreviation || "");
  const [parentId, setParentId] = useState<string>(editing.row?.category_id || "");
  const [imageUrl, setImageUrl] = useState<string | null>(editing.row?.image_url || null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(editing.row?.image_url || null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickImage = (f: File | null) => {
    if (!f) return;
    setImageFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const onSave = async () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (!tenantId) {
      toast({ title: "Workspace not ready", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      let finalImage = imageUrl;
      if (editing.type !== "units" && imageFile) {
        finalImage = await uploadTaxonomyImage(tenantId, imageFile);
      }

      if (editing.type === "categories") {
        if (isEdit) await m.updateCategory.mutateAsync({ id: editing.row.id, name, image_url: finalImage });
        else await m.addCategory.mutateAsync({ name, image_url: finalImage });
      } else if (editing.type === "subcategories") {
        const parentCat = categories.find((c) => c.id === parentId);
        if (!parentCat) {
          toast({ title: "Choose a parent category", variant: "destructive" });
          setSaving(false);
          return;
        }
        if (isEdit) {
          await m.updateSubcategory.mutateAsync({
            id: editing.row.id, name, image_url: finalImage,
            category_id: parentCat.id, parent_name: parentCat.name,
          });
        } else {
          await m.addSubcategory.mutateAsync({
            name, image_url: finalImage,
            category_id: parentCat.id, parent_name: parentCat.name,
          });
        }
      } else {
        if (isEdit) await m.updateUnit.mutateAsync({ id: editing.row.id, name, abbreviation: abbr });
        else await m.addUnit.mutateAsync({ name, abbreviation: abbr });
      }
      toast({ title: isEdit ? "Updated" : "Added" });
      onSaved();
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const showImage = editing.type !== "units";

  return (
    <div className="fixed inset-0 z-50 bg-black/50 side-pop flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">
            {isEdit ? "Edit" : "Add"} {editing.type === "units" ? "unit" : editing.type.replace(/s$/, "")}
          </h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>

        {showImage && (
          <div>
            <label className="text-sm font-medium">Image (optional)</label>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="w-20 h-20 rounded-xl border border-border bg-muted overflow-hidden flex items-center justify-center">
                {previewUrl ? (
                  <img src={previewUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="w-6 h-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <input
                  ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => onPickImage(e.target.files?.[0] || null)}
                />
                <button onClick={() => fileRef.current?.click()} className="text-xs px-3 py-1.5 rounded-md bg-muted hover:bg-muted/70 inline-flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" /> Upload image
                </button>
                {previewUrl && (
                  <button
                    onClick={() => { setPreviewUrl(null); setImageFile(null); setImageUrl(null); }}
                    className="text-xs text-destructive hover:underline text-left"
                  >Remove image</button>
                )}
              </div>
            </div>
          </div>
        )}

        <div>
          <label className="text-sm font-medium">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={editing.type === "units" ? "e.g. Kilogram" : "e.g. Beverages"}
            className="fi mt-1.5"
            autoFocus
          />
        </div>

        {editing.type === "subcategories" && (
          <div>
            <label className="text-sm font-medium">Parent category</label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="fi mt-1.5"
            >
              <option value="">Select a category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {editing.type === "units" && (
          <div>
            <label className="text-sm font-medium">Abbreviation (optional)</label>
            <input
              value={abbr}
              onChange={(e) => setAbbr(e.target.value)}
              placeholder="e.g. kg"
              className="fi mt-1.5"
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-border hover:bg-muted">Cancel</button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving && <OrbSpinner className="w-4 h-4" />}
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
