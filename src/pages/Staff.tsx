import { tenantPath } from "@/lib/host";
import { PagedRows } from "@/components/Pager";
import { useState, useMemo, useEffect } from "react";
import { PageHeader, Toolbar, SearchBox, Segmented, Panel, TableWrap, EmptyState, StatTile, StatGrid, StatusPill, PageLoader } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SessionsTab } from "@/pages/settings/ErpSettingsTabs";
import StaffDirectory from "@/pages/staff/StaffDirectory";
import { useStaff, useShifts, useTransactions, useLocations, useAllUserLocations, useBusinessSettings } from "@/hooks/useData";
import StaffPerformance from "@/components/staff/StaffPerformance";
import { printThermal, shiftSummaryHtml, summarizeShiftSales, type ShiftSummary } from "@/lib/printThermal";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { formatKES, formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/usePermissions";
import RoleSettings from "@/components/RoleSettings";
import { resetStaffPassword, deleteStaffAccount } from "@/lib/serverStaff";
import {
  Users, Shield, Clock, TrendingUp, Play, Square, Printer,
  ChevronDown, BarChart3, UserPlus, X, Save, Trash2, Edit, KeyRound, Phone, Mail, MapPin
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Tab = "staff" | "performance" | "roles" | "sessions";

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  admin: { label: "Admin", color: "bg-primary/10 text-primary" },
  manager: { label: "Manager", color: "bg-info/10 text-info" },
  finance: { label: "Finance", color: "bg-success/10 text-success" },
  customer_service: { label: "Customer Service", color: "bg-warning/10 text-warning" },
  cashier: { label: "Cashier", color: "bg-success/10 text-success" },
  stock_manager: { label: "Stock Manager", color: "bg-warning/10 text-warning" },
  rider: { label: "Rider", color: "bg-accent/10 text-accent-foreground" },
  packaging: { label: "Packaging", color: "bg-secondary text-secondary-foreground" },
  sales_person: { label: "Sales Person", color: "bg-info/10 text-info" },
};

export default function Staff() {
  const [params, setParams] = useSearchParams();
  const tab = (["staff", "performance", "roles", "sessions"].includes(params.get("tab") || "") ? params.get("tab") : "staff") as Tab;
  const setTab = (t: Tab) => setParams((p) => { const n = new URLSearchParams(p); if (t === "staff") n.delete("tab"); else n.set("tab", t); return n; }, { replace: true });
  const { data: reps = [] } = useQuery({ queryKey: ["sales-reps-ids"], queryFn: async () => ((await (supabase as any).from("sales_reps").select("user_id").eq("is_active", true)).data || []) as { user_id: string }[] });
  const repIds = new Set(reps.map((r) => r.user_id));
  const { data: staff = [], isLoading: staffLoading } = useStaff();
  const { data: shifts = [], isLoading: shiftsLoading } = useShifts();
  const { data: transactions = [] } = useTransactions();
  const { user, profile, role } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canDeleteStaff = hasPermission("staff_delete");
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const staffBase = tenantPath(slug, "/staff");

  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [resetTarget, setResetTarget] = useState<any>(null);
  const isAdmin = role === "admin" || role === "super_admin";
  // Cashiers and other shop-floor roles only ever see their own card and shifts.
  const canSeeTeam = isAdmin || role === "manager";
  const activeShift = shifts.find(s => s.user_id === user?.id && s.status === "active");
  const { data: bizSettings } = useBusinessSettings();
  const [endingShift, setEndingShift] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<ShiftSummary | null>(null);
  // Sales of a shift, counted live as they happen (the list updates in real time).
  const liveShiftSales = (shift: any) =>
    transactions.filter((t: any) =>
      t.cashier_id === shift.user_id &&
      t.status === "completed" &&
      new Date(t.created_at) >= new Date(shift.start_time) &&
      (!shift.end_time || new Date(t.created_at) <= new Date(shift.end_time)));
  const shiftFigures = (shift: any) => {
    if (shift.status !== "active") return { total: Number(shift.total_sales || 0), count: Number(shift.transactions_count || 0) };
    const sales = liveShiftSales(shift);
    return { total: sales.reduce((sum: number, t: any) => sum + Number(t.total || 0), 0), count: sales.length };
  };
  const visibleStaff = canSeeTeam ? staff : staff.filter(s => s.user_id === user?.id);
  const visibleShifts = canSeeTeam ? shifts : shifts.filter(s => s.user_id === user?.id);

  const [startingShift, setStartingShift] = useState(false);
  const startShift = async () => {
    if (startingShift || activeShift) return;
    setStartingShift(true);
    const { error } = await supabase.from("shifts").insert({
      user_id: user!.id,
      staff_name: profile?.display_name || "Unknown",
      tenant_id: profile?.tenant_id || null,
    });
    if (error) { setStartingShift(false); toast({ title: "Could not start the shift", description: error.message, variant: "destructive" }); return; }
    await queryClient.invalidateQueries({ queryKey: ["shifts"] });
    setStartingShift(false);
    toast({ title: "Shift started" });
  };

  const endShift = async () => {
    if (!activeShift || endingShift) return;
    setEndingShift(true);
    try {
      const endedAt = new Date().toISOString();
      // Read this shift's sales straight from the database so the totals are
      // exact even if this screen has been open for hours.
      const { data: fresh, error: readError } = await supabase
        .from("transactions")
        .select("id, total, discount, payment_method, items, created_at, status")
        .eq("cashier_id", user!.id)
        .eq("status", "completed")
        .gte("created_at", activeShift.start_time)
        .lte("created_at", endedAt);
      const sales = readError ? liveShiftSales(activeShift) : (fresh || []);
      const totals = summarizeShiftSales(sales);
      const { error } = await supabase.from("shifts").update({
        end_time: endedAt, status: "completed",
        total_sales: totals.totalSales, transactions_count: totals.transactions,
      }).eq("id", activeShift.id);
      if (error) { toast({ title: "Could not end the shift", description: error.message, variant: "destructive" }); return; }
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      setShiftSummary({
        shopName: (bizSettings as any)?.business_name || "JMSURF Garage",
        cashierName: profile?.display_name || "Cashier",
        startedAt: activeShift.start_time,
        endedAt,
        ...totals,
      });
    } finally {
      setEndingShift(false);
    }
  };

  const printShiftSummary = async () => {
    if (!shiftSummary) return;
    try {
      await printThermal("Shift summary", shiftSummaryHtml(shiftSummary));
    } catch {
      toast({ title: "Printer error", description: "Use your browser print menu (Ctrl+P) instead.", variant: "destructive" });
    }
  };

  const updateRole = async (userId: string, roleId: string, newRole: string) => {
    const { error } = await supabase.from("user_roles").update({ role: newRole as any }).eq("id", roleId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["staff"] });
    toast({ title: "Role updated" });
  };

  const handleDeleteStaff = async () => {
    if (!deleteTarget) return;
    // Removes the login itself as well, so the person can no longer sign in
    // and the account disappears from the owner's list too.
    const { error } = await deleteStaffAccount(deleteTarget.user_id);
    if (error) { toast({ title: "Error", description: error, variant: "destructive" }); setDeleteTarget(null); return; }
    queryClient.invalidateQueries({ queryKey: ["staff"] });
    toast({ title: "Staff member removed" });
    setDeleteTarget(null);
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    // We need the user's email - fetch from edge function or use the admin function
    const { data, error } = await resetStaffPassword(resetTarget.user_id);
    if (error) {
      toast({ title: "Could not reset the password", description: error, variant: "destructive" });
    } else {
      toast({
        title: "Password reset",
        description: data?.message || "A new password was sent to the staff member.",
        duration: 15000,
      });
    }
    setResetTarget(null);
  };



  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [shiftStaff, setShiftStaff] = useState("all");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!activeShift) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [activeShift]);

  const duration = (start: string, end?: string | null) => {
    const mins = Math.max(0, Math.round(((end ? new Date(end).getTime() : now) - new Date(start).getTime()) / 60000));
    const h = Math.floor(mins / 60);
    return h ? `${h}h ${mins % 60}m` : `${mins}m`;
  };
  const onShiftNow = shifts.filter((s: any) => s.status === "active");
  const todayKey = new Date().toDateString();
  const todaySales = transactions.filter((t: any) => t.status === "completed" && new Date(t.created_at).toDateString() === todayKey)
    .reduce((a: number, t: any) => a + Number(t.total || 0), 0);
  const teamShown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleStaff.filter((s: any) => (roleFilter === "all" || s.role === roleFilter)
      && (!q || `${s.display_name} ${(s as any).email || ""} ${s.phone || ""}`.toLowerCase().includes(q)));
  }, [visibleStaff, search, roleFilter]);
  const shiftsShown = shiftStaff === "all" ? visibleShifts : visibleShifts.filter((s: any) => s.user_id === shiftStaff);

  if (staffLoading || shiftsLoading) return <PageLoader label="Loading staff…" />;

  return (
    <div className="space-y-5">
      <PageHeader
        title={canSeeTeam ? "Staff" : "My details"}
        icon={Users}
        description={canSeeTeam ? `${staff.length} team member${staff.length === 1 ? "" : "s"} · roles, permissions and who is signed in` : "Your details"}
        actions={<>
          {isAdmin && <Button variant="outline" onClick={() => navigate(`${staffBase}/new`)}><UserPlus /> Add staff</Button>}
        </>}
      />

      {canSeeTeam && (
        <StatGrid>
          <StatTile label="Team" value={staff.length} icon={Users} tone="primary" />
          <StatTile label="Sales reps" value={staff.filter((x: any) => repIds.has(x.user_id)).length} icon={TrendingUp} tone="success" hint="Earn commission on their sales" />
          <StatTile label="Sales today" value={formatKES(todaySales)} icon={TrendingUp} tone="info" />
          <StatTile label="Owners & managers" value={staff.filter((x: any) => ["admin", "manager"].includes(x.role)).length} icon={Shield} tone="muted" />
        </StatGrid>
      )}

      <Segmented value={tab} onChange={(v) => setTab(v as Tab)} options={[
        { value: "staff", label: canSeeTeam ? "Team" : "My details" },
        ...(isAdmin ? [{ value: "roles", label: "Roles & permissions" }] : []),
        ...(isAdmin ? [{ value: "sessions", label: "Active sessions" }] : []),
        ...(canSeeTeam ? [{ value: "performance", label: "Performance" }] : []),
      ] as { value: Tab; label: string }[]} />

      {tab === "staff" && canSeeTeam && <StaffDirectory />}
      {tab === "staff" && !canSeeTeam && (
        <>
          {canSeeTeam && (
            <Toolbar>
              <SearchBox value={search} onChange={setSearch} placeholder="Name, email or phone…" />
              <select className="fi w-auto" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Role">
                <option value="all">All roles</option>
                {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Toolbar>
          )}
          {teamShown.length === 0 ? (
            <Panel><EmptyState icon={Users} title={visibleStaff.length ? "Nobody matches" : "No staff yet"}
              action={isAdmin && !visibleStaff.length ? <Button onClick={() => navigate(`${staffBase}/new`)}><UserPlus /> Add staff</Button> : undefined} /></Panel>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <PagedRows rows={teamShown} gridSpan>{(pageRows) => pageRows.map((s: any) => {
                const r = ROLE_LABELS[s.role] || ROLE_LABELS.cashier;
                const onShift = shifts.some((x: any) => x.user_id === s.user_id && x.status === "active");
                const manage = isAdmin && s.user_id !== user?.id;
                return (
                  <div key={s.id} className="group flex flex-col rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg">
                    <div className="flex items-start gap-3">
                      <div className="relative">
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 font-display text-lg font-bold text-primary-foreground">
                          {String(s.display_name || "?").charAt(0).toUpperCase()}
                        </span>
                        {onShift && <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-success" title="On shift" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-semibold">{s.display_name}</h3>
                        <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold", r.color)}>{r.label}</span>
                        {repIds.has(s.user_id) && <span className="ml-1 mt-1 inline-block rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">Sales rep</span>}
                      </div>
                    </div>
                    <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
                      <p className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 shrink-0" /> {s.store_location || "No branch set"}</p>
                      {s.email && <p className="flex items-center gap-2 truncate"><Mail className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{s.email}</span></p>}
                      {s.phone && <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 shrink-0" /> {s.phone}</p>}
                    </div>
                    {manage && (
                      <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
                        <select value={s.role} onChange={(e) => s.role_id && updateRole(s.user_id, s.role_id, e.target.value)}
                          className="fi h-9 flex-1 text-xs" aria-label="Role">
                          {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        <button className="icon-btn" title="Edit" onClick={() => navigate(`${staffBase}/${s.user_id}/edit`)}><Edit className="h-4 w-4" /></button>
                        <button className="icon-btn" title="Send a temporary password" onClick={() => setResetTarget(s)}><KeyRound className="h-4 w-4" /></button>
                        {canDeleteStaff && <button className="icon-btn-danger" title="Remove" onClick={() => setDeleteTarget(s)}><Trash2 className="h-4 w-4" /></button>}
                      </div>
                    )}
                  </div>
                );
              })}</PagedRows>
            </div>
          )}
        </>
      )}

      {tab === "performance" && canSeeTeam && (
        <StaffPerformance staff={staff} transactions={transactions} shifts={shifts} />
      )}
      {tab === "roles" && isAdmin && <RoleSettings />}
      {tab === "sessions" && isAdmin && <SessionsTab />}


      {/* End-of-shift summary */}
      <AlertDialog open={!!shiftSummary} onOpenChange={o => !o && setShiftSummary(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Shift ended</AlertDialogTitle>
            <AlertDialogDescription>Summary of the sales made during this shift.</AlertDialogDescription>
          </AlertDialogHeader>
          {shiftSummary && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-baseline border-b border-border pb-2">
                <span className="text-muted-foreground">Total sales</span>
                <span className="text-2xl font-display font-bold">{formatKES(shiftSummary.totalSales)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><p className="text-xs text-muted-foreground">Sales</p><p className="font-semibold">{shiftSummary.transactions}</p></div>
                <div><p className="text-xs text-muted-foreground">Items sold</p><p className="font-semibold">{shiftSummary.itemsSold}</p></div>
              </div>
              <div className="space-y-1">
                {shiftSummary.byMethod.map(m => (
                  <div key={m.method} className="flex justify-between">
                    <span className="capitalize text-muted-foreground">{m.method.replace("_", " ")} ({m.count})</span>
                    <span className="font-medium">{formatKES(m.amount)}</span>
                  </div>
                ))}
                {shiftSummary.byMethod.length === 0 && <p className="text-muted-foreground">No sales during this shift.</p>}
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Done</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void printShiftSummary(); }}>
              <Printer className="w-4 h-4 mr-2" /> Print summary
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove staff member?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.display_name}" will be removed from the system. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteStaff} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Password Confirmation */}
      <AlertDialog open={!!resetTarget} onOpenChange={o => !o && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset password?</AlertDialogTitle>
            <AlertDialogDescription>
              "{resetTarget?.display_name}" will get an email with a temporary password. When they sign in with it, they are asked to choose a new password straight away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetPassword} className="bg-warning text-warning-foreground hover:bg-warning/90">Send temporary password</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

