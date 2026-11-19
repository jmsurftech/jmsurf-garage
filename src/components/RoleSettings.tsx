import { PageLoader } from "@/components/kit";
import { useState } from "react";
import { Shield, Plus, Check, XCircle, X, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { confirmAction } from "@/components/books/confirm";

const sb: any = supabase;

export const ALL_PERMISSIONS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "pos", label: "Point of Sale" },
  { key: "sales", label: "Sales (Quotes/Invoices)" },
  { key: "customers", label: "Customers (view/edit)" },
  { key: "customers_delete", label: "Customers (delete)" },
  { key: "inventory", label: "Inventory (view/edit)" },
  { key: "inventory_delete", label: "Inventory (delete)" },
  { key: "purchases", label: "Purchases (view/edit)" },
  { key: "purchases_delete", label: "Purchases (delete)" },
  { key: "expenses", label: "Expenses (view/edit)" },
  { key: "expenses_delete", label: "Expenses (delete)" },
  { key: "bills", label: "Bills (view/edit)" },
  { key: "bills_delete", label: "Bills (delete)" },
  { key: "quotes", label: "Quotes (view/edit)" },
  { key: "quotes_delete", label: "Quotes (delete)" },
  { key: "invoices", label: "Invoices (view/edit)" },
  { key: "invoices_delete", label: "Invoices (delete)" },
  { key: "services", label: "Services (view/edit)" },
  { key: "services_delete", label: "Services (delete)" },
  { key: "suppliers", label: "Suppliers (view/edit)" },
  { key: "suppliers_delete", label: "Suppliers (delete)" },
  { key: "reports", label: "Reports" },
  { key: "staff", label: "Staff Management" },
  { key: "staff_delete", label: "Staff (delete)" },
  { key: "hrm", label: "HRM (employees, leave, payroll)" },
  { key: "documents", label: "Documents (all files)" },
  { key: "crm", label: "CRM (leads, deals, campaigns)" },
  { key: "communication", label: "Communication (SMS, email)" },
  { key: "settings", label: "System settings" },
];

function useRolePermissions() {
  return useQuery({
    queryKey: ["role-permissions"],
    queryFn: async () => {
      const { data, error } = await sb.from("role_permissions").select("*");
      if (error) throw error;
      return data as any[];
    },
  });
}

export default function RoleSettings() {
  const { data: permissions = [], isLoading } = useRolePermissions();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newRole, setNewRole] = useState("");
  const [showAddRole, setShowAddRole] = useState(false);

  const roles = [...new Set(permissions.map((p: any) => p.role))].sort();
  // Ensure built-in roles are always shown
  const allRoles = [...new Set(["admin", "manager", "finance", "customer_service", "cashier", "stock_manager", ...roles])].sort();

  const getPermission = (role: string, perm: string) => {
    if (role === "admin") return true;
    return permissions.find((p: any) => p.role === role && p.permission === perm)?.allowed ?? false;
  };

  const togglePermission = async (role: string, perm: string) => {
    const current = getPermission(role, perm);
    const existing = permissions.find((p: any) => p.role === role && p.permission === perm);

    if (existing) {
      await sb.from("role_permissions").update({ allowed: !current }).eq("id", existing.id);
    } else {
      await sb.from("role_permissions").insert({ role, permission: perm, allowed: !current });
    }
    qc.invalidateQueries({ queryKey: ["role-permissions"] });
  };

  const addRole = async () => {
    const roleName = newRole.trim().toLowerCase().replace(/\s+/g, "_");
    if (!roleName || allRoles.includes(roleName)) {
      toast({ title: "Role already exists or empty", variant: "destructive" });
      return;
    }
    // Insert permissions for the new role (all false by default)
    const inserts = ALL_PERMISSIONS.map(p => ({ role: roleName, permission: p.key, allowed: false }));
    const { error } = await sb.from("role_permissions").insert(inserts);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["role-permissions"] });
    toast({ title: `Role "${roleName}" created` });
    setNewRole("");
    setShowAddRole(false);
  };

  const deleteRole = async (role: string) => {
    if (["admin", "manager", "finance", "customer_service", "cashier", "stock_manager"].includes(role)) {
      toast({ title: "Cannot delete built-in roles", variant: "destructive" });
      return;
    }
    if (!(await confirmAction({ title: `Delete the "${role}" role?`, message: "Staff with this role lose its permissions.", danger: true, confirmLabel: "Delete" }))) return;
    await sb.from("role_permissions").delete().eq("role", role);
    qc.invalidateQueries({ queryKey: ["role-permissions"] });
    toast({ title: `Role "${role}" deleted` });
  };

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-display font-bold flex items-center gap-2"><Shield className="w-5 h-5" /> Role Permissions</h2>
          <p className="text-sm text-muted-foreground">Configure what each role can access. Changes are saved immediately.</p>
        </div>
        <button onClick={() => setShowAddRole(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
          <Plus className="w-4 h-4" /> Add Role
        </button>
      </div>

      {showAddRole && (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg border border-border">
          <input value={newRole} onChange={e => setNewRole(e.target.value)} placeholder="Role name (e.g. supervisor)"
            onKeyDown={e => e.key === "Enter" && addRole()}
            className="fi flex-1" />
          <button onClick={addRole} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm"><Save className="w-4 h-4" /></button>
          <button onClick={() => setShowAddRole(false)} className="px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-muted/50">Permission</th>
              {allRoles.map(role => (
                <th key={role} className="text-center py-3 px-4 font-medium text-muted-foreground capitalize min-w-[100px]">
                  <div className="flex flex-col items-center gap-1">
                    <span>{role.replace(/_/g, " ")}</span>
                    {!["admin", "manager", "finance", "customer_service", "cashier", "stock_manager"].includes(role) && (
                      <button onClick={() => deleteRole(role)} className="text-[10px] text-destructive hover:underline">delete</button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_PERMISSIONS.map(perm => (
              <tr key={perm.key} className="border-b border-border last:border-0">
                <td className="py-3 px-4 font-medium sticky left-0 bg-card">{perm.label}</td>
                {allRoles.map(role => {
                  const allowed = getPermission(role, perm.key);
                  return (
                    <td key={role} className="py-3 px-4 text-center">
                      <button
                        onClick={() => togglePermission(role, perm.key)}
                        disabled={role === "admin"}
                        className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                          allowed ? "bg-success/10 text-success hover:bg-success/20" : "bg-destructive/10 text-destructive hover:bg-destructive/20",
                          role === "admin" && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        {allowed ? <Check className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">Admin permissions cannot be changed. Toggle permissions for other roles by clicking the icons above.</p>
    </div>
  );
}
