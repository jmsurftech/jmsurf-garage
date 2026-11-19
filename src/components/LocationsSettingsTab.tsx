import { useState, useMemo } from "react";
import { MapPin, Plus, Save, Trash2, Star, Edit2, X, Check, UserCog } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { offlineWrite } from "@/lib/offlineDb";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenantId";
import { useLocations, useStaff, useAllUserLocations } from "@/hooks/useData";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { confirmAction } from "@/components/books/confirm";

type LocRow = {
  id: string;
  name: string;
  code: string | null;
  is_main: boolean;
  street: string | null;
  building: string | null;
  po_box: string | null;
  city: string | null;
};

export default function LocationsSettingsTab({ canManage }: { canManage: boolean }) {
  const { profile } = useAuth();
  const activeTenantId = useTenantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: locations = [] } = useLocations();
  const { data: staff = [] } = useStaff();
  const { data: assignments = [] } = useAllUserLocations();
  const { canAddLocation, usedLocations, maxLocations } = useSubscriptionLimits();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<LocRow>>({});
  const [adding, setAdding] = useState(false);
  const [newLoc, setNewLoc] = useState<Partial<LocRow>>({ name: "", code: "", street: "", building: "", po_box: "", city: "" });

  const primaryLocationByUser = useMemo(() => {
    const map = new Map<string, string>();
    assignments.forEach((a: any) => {
      if (a.is_primary && !map.has(a.user_id)) map.set(a.user_id, a.location_id);
    });
    return map;
  }, [assignments]);

  const assignStaffLocation = async (userId: string, locationId: string) => {
    if (!canManage) return;
    await supabase.from("user_locations" as any).update({ is_primary: false }).eq("user_id", userId);
    const { error } = await supabase.from("user_locations" as any).upsert(
      { user_id: userId, location_id: locationId, is_primary: true },
      { onConflict: "user_id,location_id" }
    );
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["all-user-locations"] });
    qc.invalidateQueries({ queryKey: ["user-locations"] });
    toast({ title: "Staff assignment updated" });
  };

  const refresh = () => qc.invalidateQueries({ queryKey: ["locations"] });

  const startEdit = (l: any) => {
    setEditingId(l.id);
    setDraft({
      name: l.name, code: l.code || "", street: l.street || "",
      building: l.building || "", po_box: l.po_box || "", city: l.city || "",
    });
  };

  const saveEdit = async () => {
    if (!editingId || !draft.name?.trim()) return;
    const { error } = await (supabase as any).from("locations").update({
      name: draft.name.trim(),
      code: draft.code?.trim() || null,
      street: draft.street?.trim() || null,
      building: draft.building?.trim() || null,
      po_box: draft.po_box?.trim() || null,
      city: draft.city?.trim() || null,
    }).eq("id", editingId);
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    setEditingId(null); setDraft({});
    refresh();
    toast({ title: "Location updated" });
  };

  const addLocation = async () => {
    if (!canManage || !newLoc.name?.trim()) return;
    if (!canAddLocation) {
      return toast({
        title: "Location limit reached",
        description: `Your plan allows ${maxLocations} location${maxLocations === 1 ? "" : "s"} (currently ${usedLocations}). Upgrade to add more.`,
        variant: "destructive",
      });
    }
    const tid = activeTenantId || profile?.tenant_id || null;
    if (!tid) {
      return toast({ title: "No tenant context", description: "Cannot determine which workspace to add the location to.", variant: "destructive" });
    }
    const payload = {
      name: newLoc.name.trim(),
      code: newLoc.code?.trim() || null,
      street: newLoc.street?.trim() || null,
      building: newLoc.building?.trim() || null,
      po_box: newLoc.po_box?.trim() || null,
      city: newLoc.city?.trim() || null,
      tenant_id: tid,
      is_active: true,
      is_main: (locations as any[]).length === 0,
    };

    if (!navigator.onLine) {
      await offlineWrite({ table: "locations", action: "insert", payload, cacheStore: "locations" });
      toast({ title: "Saved offline", description: "Will sync when back online." });
    } else {
      const { error } = await (supabase as any).from("locations").insert(payload);
      if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
      toast({ title: "Location added" });
    }
    setNewLoc({ name: "", code: "", street: "", building: "", po_box: "", city: "" });
    setAdding(false);
    refresh();
  };

  const setAsMain = async (id: string) => {
    if (!canManage) return;
    // Demote current main, then promote selected — wrap to avoid unique-index race
    const current = (locations as any[]).find((l) => l.is_main);
    if (current?.id === id) return;
    if (current) {
      await (supabase as any).from("locations").update({ is_main: false }).eq("id", current.id);
    }
    const { error } = await (supabase as any).from("locations").update({ is_main: true }).eq("id", id);
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    refresh();
    toast({ title: "Main location updated" });
  };

  const removeLocation = async (id: string, isMain: boolean) => {
    if (!canManage) return;
    if (isMain) return toast({ title: "Cannot delete Main", description: "Promote another location to Main first.", variant: "destructive" });
    if (!(await confirmAction({ title: "Delete this branch?", message: "This cannot be undone.", danger: true, confirmLabel: "Delete" }))) return;
    const { error } = await (supabase as any).from("locations").delete().eq("id", id);
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    refresh();
    toast({ title: "Branch deleted" });
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2"><MapPin className="w-4 h-4" /> Locations</h2>
          {canManage && !adding && (
            <button
              onClick={() => setAdding(true)}
              disabled={!canAddLocation}
              title={!canAddLocation ? `Limit reached (${usedLocations}/${maxLocations}) — upgrade your plan` : undefined}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" /> Add Branch {!canAddLocation ? `(${usedLocations}/${maxLocations})` : ""}
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          The first location is the <strong>Main</strong> location. All others are <strong>Branches</strong>. You can promote any branch to Main.
        </p>

        {adding && (
          <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4 space-y-2">
            <div className="grid sm:grid-cols-2 gap-2">
              <input className="fi" placeholder="Name (required)" value={newLoc.name || ""} onChange={(e) => setNewLoc({ ...newLoc, name: e.target.value })} />
              <input className="fi" placeholder="Code (optional)" value={newLoc.code || ""} onChange={(e) => setNewLoc({ ...newLoc, code: e.target.value })} />
              <input className="fi" placeholder="Street" value={newLoc.street || ""} onChange={(e) => setNewLoc({ ...newLoc, street: e.target.value })} />
              <input className="fi" placeholder="Building" value={newLoc.building || ""} onChange={(e) => setNewLoc({ ...newLoc, building: e.target.value })} />
              <input className="fi" placeholder="P.O. Box / ZIP" value={newLoc.po_box || ""} onChange={(e) => setNewLoc({ ...newLoc, po_box: e.target.value })} />
              <input className="fi" placeholder="City / Town" value={newLoc.city || ""} onChange={(e) => setNewLoc({ ...newLoc, city: e.target.value })} />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={addLocation} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm"><Save className="w-4 h-4" /> Save</button>
              <button onClick={() => { setAdding(false); setNewLoc({ name: "", code: "", street: "", building: "", po_box: "", city: "" }); }} className="px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-sm">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {locations.map((l: any) => {
            const isEditing = editingId === l.id;
            return (
              <div key={l.id} className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input className="fi" value={draft.name || ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold">{l.name}</p>
                        {l.is_main ? (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full bg-primary text-primary-foreground">
                            <Star className="w-3 h-3 fill-current" /> Main
                          </span>
                        ) : (
                          <span className="text-[10px] uppercase tracking-wide font-medium px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">Branch</span>
                        )}
                        {l.code && <span className="text-xs text-muted-foreground">({l.code})</span>}
                      </div>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1 shrink-0">
                      {isEditing ? (
                        <>
                          <button onClick={saveEdit} className="p-1.5 rounded-lg hover:bg-success/10 text-success" title="Save"><Check className="w-4 h-4" /></button>
                          <button onClick={() => { setEditingId(null); setDraft({}); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" title="Cancel"><X className="w-4 h-4" /></button>
                        </>
                      ) : (
                        <>
                          {!l.is_main && (
                            <button onClick={() => setAsMain(l.id)} className="p-1.5 rounded-lg hover:bg-primary/10 text-primary" title="Promote to Main"><Star className="w-4 h-4" /></button>
                          )}
                          <button onClick={() => startEdit(l)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" title="Edit"><Edit2 className="w-4 h-4" /></button>
                          {!l.is_main && (
                            <button onClick={() => removeLocation(l.id, l.is_main)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive" title="Delete"><Trash2 className="w-4 h-4" /></button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="grid sm:grid-cols-2 gap-2 pt-1">
                    <input className="fi" placeholder="Code" value={draft.code || ""} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
                    <input className="fi" placeholder="Street" value={draft.street || ""} onChange={(e) => setDraft({ ...draft, street: e.target.value })} />
                    <input className="fi" placeholder="Building" value={draft.building || ""} onChange={(e) => setDraft({ ...draft, building: e.target.value })} />
                    <input className="fi" placeholder="P.O. Box / ZIP" value={draft.po_box || ""} onChange={(e) => setDraft({ ...draft, po_box: e.target.value })} />
                    <input className="fi" placeholder="City / Town" value={draft.city || ""} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
                  </div>
                ) : (
                  (l.street || l.building || l.po_box || l.city) && (
                    <p className="text-xs text-muted-foreground">
                      {[l.building, l.street, l.city, l.po_box && `P.O. Box ${l.po_box}`].filter(Boolean).join(" · ")}
                    </p>
                  )
                )}
              </div>
            );
          })}
          {locations.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No locations yet. Add your first one above — it will become the Main location.</p>
          )}
        </div>
      </section>
    </div>
  );
}
