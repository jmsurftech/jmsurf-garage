import { PageHeader } from "@/components/kit";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Save, UserPlus, UserCog } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useTenantId } from "@/hooks/useTenantId";
import { useLocations, useUserLocations, useStaff } from "@/hooks/useData";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { tenantPath } from "@/lib/host";
import { useModules } from "@/hooks/useModules";
import { createStaffAccount } from "@/lib/serverStaff";

// Office roles for every company; shop-floor roles only when the POS is switched on.
const OFFICE_ROLES = [
  { value: "admin", label: "Admin", hint: "Full access, including settings, billing and staff" },
  { value: "manager", label: "Manager", hint: "Runs day-to-day work; no company settings" },
  { value: "finance", label: "Finance", hint: "Invoices, bills, expenses, banking and reports" },
  { value: "customer_service", label: "Customer Service", hint: "Customers, quotes and invoices" },
];
const POS_ROLES = [
  { value: "cashier", label: "Cashier" },
  { value: "stock_manager", label: "Stock Manager" },
  { value: "rider", label: "Rider" },
  { value: "packaging", label: "Packaging" },
  { value: "sales_person", label: "Sales Rep" },
];

export default function StaffFormPage() {
  const { id, slug } = useParams<{ id?: string; slug?: string }>();
  const navigate = useNavigate();
  const isEdit = !!id;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: locations = [] } = useLocations();
  const { has: hasModule, ready: modulesReady } = useModules();
  const ROLES: { value: string; label: string; hint?: string }[] = [...OFFICE_ROLES, ...(hasModule("pos") ? POS_ROLES : [])];
  useEffect(() => {
    if (!isEdit && modulesReady && !hasModule("pos")) setForm(f => (f.role === "cashier" ? { ...f, role: "customer_service" } : f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, modulesReady]);
  const { data: staff = [] } = useStaff();
  const existing = staff.find((s: any) => s.user_id === id);
  const { data: userLocs = [] } = useUserLocations(isEdit ? id : undefined);
  const { canAddUser, usedUsers, maxUsers } = useSubscriptionLimits();
  const tenantId = useTenantId();

  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    display_name: "", email: "", password: "", phone: "", role: "cashier", location_id: "",
  });
  // Sales rep: earns commission and is picked automatically at the till when signed in.
  const [rep, setRep] = useState({ on: false, pct: "0", target: "0" });
  const { data: repRow } = useQuery({
    queryKey: ["sales-rep-row", id], enabled: isEdit,
    queryFn: async () => (await (supabase as any).from("sales_reps").select("*").eq("user_id", id).maybeSingle()).data,
  });
  useEffect(() => { if (repRow) setRep({ on: !!repRow.is_active, pct: String(repRow.default_commission_pct ?? 0), target: String(repRow.monthly_target ?? 0) }); }, [repRow]);
  const saveRep = async (userId: string, tenantId: string | null | undefined, name: string, phone: string | null, email: string | null) => {
    const on = rep.on || form.role === "sales_person";
    if (!on && !repRow) return;
    const { error } = await (supabase as any).from("sales_reps").upsert({
      user_id: userId, tenant_id: tenantId, display_name: name, phone, email,
      default_commission_pct: Number(rep.pct) || 0, monthly_target: Number(rep.target) || 0, is_active: on,
    });
    if (error) throw error;
  };

  useEffect(() => {
    if (isEdit && existing) {
      setForm(f => ({ ...f, display_name: existing.display_name || "", phone: existing.phone || "", role: existing.role || "cashier" }));
    }
  }, [isEdit, existing]);

  useEffect(() => {
    if (isEdit && userLocs.length > 0) {
      const primary = userLocs.find((u: any) => u.is_primary) || userLocs[0];
      setForm(f => ({ ...f, location_id: primary.location_id }));
    }
  }, [isEdit, userLocs]);

  useEffect(() => {
    if (!isEdit && !form.location_id && locations.length > 0) {
      const main = (locations as any[]).find(l => l.is_main) || locations[0];
      setForm(f => ({ ...f, location_id: main.id }));
    }
  }, [isEdit, locations, form.location_id]);

  const back = () => navigate(tenantPath(slug, "/staff"));
  // "Give system access" from an employee record: prefill and link the new login to it.
  const [params] = useSearchParams();
  const employeeId = params.get("employee");
  useEffect(() => {
    if (!employeeId || isEdit) return;
    void (supabase as any).from("hr_employees").select("first_name,last_name,other_names,email,phone").eq("id", employeeId).maybeSingle().then(({ data }: any) => {
      if (data) setForm((x) => ({ ...x, display_name: [data.first_name, data.other_names, data.last_name].filter(Boolean).join(" "), email: data.email || x.email, phone: data.phone || x.phone }));
    });
  }, [employeeId, isEdit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.display_name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (!isEdit) {
        if (!canAddUser) throw new Error(`Your plan allows ${maxUsers} user${maxUsers === 1 ? "" : "s"} (currently ${usedUsers}). Upgrade to add more.`);
        if (!form.email.trim()) throw new Error("Email is required");
        const { data: created, error } = await createStaffAccount({
          email: form.email.trim(), password: "",
          display_name: form.display_name.trim(),
          phone: form.phone.trim() || null,
          role: form.role, location_id: form.location_id || null,
        });
        if (error) throw new Error(error);
        if (created?.user_id) await saveRep(created.user_id, tenantId, form.display_name.trim(), form.phone.trim() || null, form.email.trim() || null);
        if (created?.user_id && employeeId) await (supabase as any).from("hr_employees").update({ user_id: created.user_id }).eq("id", employeeId);
        toast({ title: (created as any)?.emailed ? "Invitation sent" : "Staff member added", description: (created as any)?.message || `${form.display_name} was added.`, duration: 8000 });
      } else {
        if (!existing) throw new Error("Staff record not loaded");
        const { error: pErr } = await supabase.from("profiles")
          .update({ display_name: form.display_name.trim(), phone: form.phone.trim() || null })
          .eq("user_id", existing.user_id);
        if (pErr) throw pErr;
        if (form.role !== existing.role && (existing as any).role_id) {
          const { error: rErr } = await supabase.from("user_roles").update({ role: form.role as any }).eq("id", (existing as any).role_id);
          if (rErr) throw rErr;
        }
        if (form.location_id) {
          await supabase.from("user_locations" as any).update({ is_primary: false }).eq("user_id", existing.user_id);
          const { error: lErr } = await supabase.from("user_locations" as any).upsert(
            { user_id: existing.user_id, location_id: form.location_id, is_primary: true },
            { onConflict: "user_id,location_id" }
          );
          if (lErr) throw lErr;
        }
        await saveRep(existing.user_id, tenantId, form.display_name.trim(), form.phone.trim() || null, (existing as any).email || null);
        toast({ title: "Staff updated" });
      }
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["sales-reps"] });
      qc.invalidateQueries({ queryKey: ["sales-reps-ids"] });
      qc.invalidateQueries({ queryKey: ["all-user-locations"] });
      qc.invalidateQueries({ queryKey: ["user-locations"] });
      back();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={back} className="p-2 rounded-lg hover:bg-muted"><ArrowLeft className="w-4 h-4" /></button>
        <div className="flex items-center gap-2">
          <UserPlus className="w-5 h-5 text-primary" />
          <PageHeader icon={UserCog} title={<>{isEdit ? "Edit Staff" : "Add Staff Member"}</>} description={<>{isEdit ? "Update staff profile, role and location" : "Invite a new team member"}</>} />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 bg-card border border-border rounded-2xl p-5">
        <div>
          <label className="text-sm font-medium mb-1 block">Full Name *</label>
          <input required value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
            className="fi" placeholder="Enter full name" />
        </div>

        {!isEdit && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Email *</label>
              <input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="fi" placeholder="Enter email address" />
            </div>
            <p className="self-end pb-2 text-xs text-muted-foreground">We email them a temporary password. They choose their own as soon as they sign in.</p>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Phone</label>
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              className="fi" placeholder="Phone number" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Role</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="fi">
              {!ROLES.some(r => r.value === form.role) && <option value={form.role}>{form.role.replace(/_/g, " ").replace(/w/g, c => c.toUpperCase())}</option>}
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            {ROLES.find(r => r.value === form.role)?.hint && <p className="text-[11px] text-muted-foreground mt-1">{ROLES.find(r => r.value === form.role)?.hint}</p>}
          </div>
        </div>

        <div className="rounded-xl border border-border p-4">
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={rep.on || form.role === "sales_person"} disabled={form.role === "sales_person"}
              onChange={(e) => setRep((r) => ({ ...r, on: e.target.checked }))} />
            <span>
              <span className="block text-sm font-semibold">Sales rep</span>
              <span className="block text-xs text-muted-foreground">Earns commission. Selected automatically at the Point of Sale when this person is signed in.</span>
            </span>
          </label>
          {(rep.on || form.role === "sales_person") && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><label className="text-xs font-medium mb-1 block">Commission %</label><input className="fi" type="number" min={0} max={100} step="0.5" value={rep.pct} onChange={(e) => setRep((r) => ({ ...r, pct: e.target.value }))} /></div>
              <div><label className="text-xs font-medium mb-1 block">Monthly target (KES)</label><input className="fi" type="number" min={0} value={rep.target} onChange={(e) => setRep((r) => ({ ...r, target: e.target.value }))} /></div>
            </div>
          )}
        </div>

        <div>
          <label className="text-sm font-medium mb-1 block">Assigned Location *</label>
          <select value={form.location_id} onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}
            className="fi">
            <option value="">Select location…</option>
            {(locations as any[]).map(l => (
              <option key={l.id} value={l.id}>{l.name}{l.is_main ? " (Main)" : ""}</option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground mt-1">Staff will automatically log in to this location and only see its data.</p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={back} className="px-4 py-2.5 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium">Cancel</button>
          <button type="submit" disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-40">
            <Save className="w-4 h-4" /> {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Staff"}
          </button>
        </div>
      </form>
    </div>
  );
}
