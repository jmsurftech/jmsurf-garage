import "@/styles/clean.css";
import { PageHeader } from "@/components/kit";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Receipt, Search, X, FolderPlus, Tags } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { OrbSpinner } from "@/components/orbs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { confirmAction } from "@/components/books/confirm";

import { PagedRows } from "@/components/Pager";
type CategoryRow = { id: string; name: string; is_active: boolean };

const SEARCH_STORAGE_KEY = "jmsurf_purchase_categories_search";

export default function PurchaseCategories() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("purchases") || hasPermission("expenses");

  const [search, setSearch] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(SEARCH_STORAGE_KEY) || "";
  });
  const [editing, setEditing] = useState<null | { row?: CategoryRow }>(null);

  useEffect(() => {
    try { window.localStorage.setItem(SEARCH_STORAGE_KEY, search); } catch {}
  }, [search]);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("expense_categories").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return (data || []) as CategoryRow[];
    },
  });

  const filtered = useMemo(
    () => categories.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())),
    [categories, search]
  );

  const onDelete = async (row: CategoryRow) => {
    if (!(await confirmAction({ title: `Delete "${row.name}"?`, message: "This hides it from new entries.", danger: true, confirmLabel: "Delete" }))) return;
    try {
      const { error } = await (supabase as any)
        .from("expense_categories").update({ is_active: false }).eq("id", row.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["expense-categories"] });
      toast({ title: "Category removed" });
    } catch (e: any) {
      toast({ title: "Could not delete", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader icon={Tags} title={"Expense categories"} description={"One list for everything you spend on — rent, utilities, salaries and more."} actions={<>{canManage && (
          <button
            onClick={() => setEditing({})}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" /> Add category
          </button>
        )}</>} />

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search categories..."
          className="fi pl-9 pr-3"
        />
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 flex items-center justify-center text-muted-foreground">
            <OrbSpinner className="w-5 h-5" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 sm:p-14 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
              <Receipt className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">
                {search ? `No categories match “${search}”` : "No categories yet"}
              </h3>
              <p className="text-xs text-muted-foreground max-w-xs">
                {search
                  ? "Try a different search, or clear the filter to see everything."
                  : "Group spending like Rent, Utilities or Internet to keep your records organised."}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted"
                >
                  <X className="w-3.5 h-3.5" /> Clear search
                </button>
              )}
              {canManage && (
                <button
                  onClick={() => setEditing({})}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  Add first category
                </button>
              )}
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <PagedRows rows={filtered} colSpan={2}>{(pageRows) => pageRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1.5">
                      {canManage && (
                        <>
                          <button
                            onClick={() => setEditing({ row: r })}
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onDelete(r)}
                            className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}</PagedRows>
            </TableBody>
          </Table>
        )}
      </div>

      {editing && (
        <EditModal
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["expense-categories"] });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/* ───── Edit / Add Modal ───── */
function EditModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: { row?: CategoryRow };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(editing.row?.name || "");
  const isEdit = !!editing.row;

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (trimmed.length < 2) throw new Error("Name must be at least 2 characters.");
      if (trimmed.length > 60) throw new Error("Name must be 60 characters or fewer.");
      if (isEdit) {
        const { error } = await (supabase as any)
          .from("expense_categories").update({ name: trimmed }).eq("id", editing.row!.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("expense_categories").insert({ name: trimmed });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: isEdit ? "Category updated" : "Category added" });
      onSaved();
    },
    onError: (e: any) => {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    },
  });

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 side-pop flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold">{isEdit ? "Edit" : "Add"} category</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <label className="text-xs font-medium text-muted-foreground">Name</label>
          <input
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save.mutate(); } }}
            placeholder="e.g. Utilities, Rent, Internet"
            className="fi"
          />
        </div>
        <div className="flex items-center justify-end gap-2 p-5 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-40"
          >
            {save.isPending ? <OrbSpinner className="w-4 h-4" /> : null}
            {isEdit ? "Save changes" : "Add category"}
          </button>
        </div>
      </div>
    </div>
  );
}
