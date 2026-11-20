import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSessionState } from "@/lib/sessionState";
import { PagedRows } from "@/components/Pager";
import { supabase } from "@/integrations/supabase/client";
import { allRows, downloadCsv } from "@/lib/fetchAll";
import { requestPasswordReset } from "@/lib/platformEmail";
import { deleteStaffAccount, listStaffAccounts, verifyUserAccount } from "@/lib/serverStaff";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, LogIn, X, Building2, Mail, MailCheck, Phone, MapPin, Calendar, CreditCard, Users, Link2, Copy, CheckCircle, XCircle, Pencil, Save, Plus, Archive, RotateCcw, ChevronRight, Download, ArrowLeft, Wallet, Receipt } from "lucide-react";
import { PageHeader, Toolbar, SearchBox, Segmented, Panel, TableWrap, EmptyState, Field, Modal, Pill, StatusPill, StatGrid, StatTile, MoreMenu, ExportMenu, LineTabs } from "@/components/kit";
import { format } from "date-fns";
import AdminTenantFeaturesPanel from "@/components/admin/AdminTenantFeaturesPanel";
import AdminCompanySuites from "@/components/admin/AdminCompanySuites";
import CustomDomainPanel from "@/components/admin/CustomDomainPanel";
import { ROOT_HOST, tenantUrl } from "@/lib/host";
import { AddOwnerCompanyModal, CompanyPeoplePanel, GroupPaymentModal, OwnerCompaniesPanel, openCompany, useCompanyPeople } from "@/components/admin/AdminCompanyGroup";


export default function AdminCustomers() {
  const [tenants, setTenants] = useSessionState<any[]>("AdminCustomers.tsx:tenants", []);
  const [subs, setSubs] = useState<Record<string, any>>({});
  const [plans, setPlans] = useSessionState<any[]>("AdminCustomers.tsx:plans", []);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [profiles, setProfiles] = useSessionState<any[]>("AdminCustomers.tsx:profiles", []);
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [drawerTab, setDrawerTab] = useState<"package" | "features" | "staff" | "payments">("package");
  const [companyPays, setCompanyPays] = useState<any[]>([]);
  // The open company lives in the address (?company=<id>) so Back and refresh keep it.
  const [params, setParams] = useSearchParams();
  const [manualPayFor, setManualPayFor] = useState<any>(null);
  const [manualRef, setManualRef] = useState("");
  // Editing state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  // Subscription management modal
  const [subModal, setSubModal] = useState<any>(null);
  const [subAction, setSubAction] = useState<"activate" | "deactivate">("activate");
  const [subPlanId, setSubPlanId] = useState("");
  const [subBilling, setSubBilling] = useState("monthly");
  // Inline package / expiry editor
  const [pkgPlanId, setPkgPlanId] = useState("");
  const [pkgBilling, setPkgBilling] = useState("monthly");
  const [pkgStatus, setPkgStatus] = useState("active");
  const [pkgExpiry, setPkgExpiry] = useState("");
  // Add tenant modal
  const [showAddTenant, setShowAddTenant] = useState(false);
  // "existing": the owner already has a login (they get one more company in their company menu).
  const [ownerMode, setOwnerMode] = useState<"new" | "existing">("new");
  const [newTenant, setNewTenant] = useState({
    email: "", password: "", business_name: "", contact_name: "", contact_phone: "",
    business_email: "", business_phone: "", business_address: "", industry: "",
    store_slug: "", plan_id: "", billing_cycle: "monthly",
  });
  const { toast } = useToast();
  // One owner, several companies: adding another for the same owner and paying for several at once.
  const [addForOwner, setAddForOwner] = useState(false);
  const [groupPay, setGroupPay] = useState<string[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  const { people, loading: peopleLoading, reload: reloadPeople } = useCompanyPeople(selected?.id);

  // Which shop owners have confirmed their email address. Keyed by both the
  // account id and the email so a tenant row can be matched either way.
  const [verifiedMap, setVerifiedMap] = useState<Record<string, boolean>>({});
  const [verifying, setVerifying] = useState<string | null>(null);

  const loadVerification = async () => {
    const { data } = await listStaffAccounts();
    const list = (data as any)?.users || [];
    const map: Record<string, boolean> = {};
    list.forEach((u: any) => {
      const ok = !!u.email_confirmed_at;
      if (u.id) map[u.id] = ok;
      if (u.email) map[String(u.email).toLowerCase()] = ok;
    });
    setVerifiedMap(map);
  };

  const isVerified = (t: any): boolean | null => {
    if (t.owner_user_id && t.owner_user_id in verifiedMap) return verifiedMap[t.owner_user_id];
    const email = String(t.contact_email || "").toLowerCase();
    if (email && email in verifiedMap) return verifiedMap[email];
    return null;
  };

  const verifyTenant = async (t: any) => {
    setVerifying(t.id);
    try {
      const { data, error } = await verifyUserAccount({
        user_id: t.owner_user_id || undefined,
        email: t.contact_email || undefined,
      });
      const payload: any = data;
      if (error) throw new Error(error);
      toast({
        title: payload?.alreadyVerified ? "Already verified" : "Account verified",
        description: payload?.email || getDisplayName(t),
      });
      await loadVerification();
    } catch (e: any) {
      toast({ title: "Could not verify", description: e.message, variant: "destructive" });
    } finally {
      setVerifying(null);
    }
  };

  const load = async () => {
    void loadVerification();
    const [{ data: t }, { data: s }, { data: p }] = await Promise.all([
      allRows(() => supabase.from("tenants").select("*").order("created_at", { ascending: false })),
      allRows(() => supabase.from("subscriptions").select("*").order("created_at", { ascending: true })),
      supabase.from("plans").select("*").eq("is_active", true).order("price_monthly"),
    ]);
    if (t) setTenants(t as any[]);
    if (s) {
      const map: Record<string, any> = {};
      // Rows are oldest-first, so the last assignment is always the tenant's
      // newest subscription. Never edit a stale historical package record.
      (s as any[]).forEach(sub => { map[sub.tenant_id] = sub; });
      setSubs(map);
    }
    if (p) setPlans(p as any[]);
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("admin-customer-package-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions" }, () => { void load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "tenant_feature_overrides" }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const loadTenantDetails = async (tenant: any) => {
    setSelected(tenant);
    setEditing(false);
    setDrawerTab("package");
    setCompanyPays([]);
    if (params.get("company") !== tenant.id) setParams((q) => { const n = new URLSearchParams(q); n.set("company", tenant.id); return n; });
    window.scrollTo({ top: 0 });
    const [{ data }, { data: pays }] = await Promise.all([
      supabase.from("profiles").select("*").eq("tenant_id", tenant.id),
      supabase.from("subscription_payments").select("id, amount, gateway, status, reference, created_at").eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(500),
    ]);
    if (data) setProfiles(data as any[]);
    setCompanyPays((pays || []) as any[]);
  };
  const closeCompany = () => {
    setSelected(null);
    setEditing(false);
    setParams((q) => { const n = new URLSearchParams(q); n.delete("company"); return n; });
  };
  // Open the company named in the address (a shared link, Back/Forward, a refresh).
  useEffect(() => {
    const id = params.get("company");
    if (!id) { if (selected) { setSelected(null); setEditing(false); } return; }
    if (selected?.id === id) return;
    const t = tenants.find((x: any) => x.id === id);
    if (t) void loadTenantDetails(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, tenants]);

  // Keep the package editor in sync with the selected tenant's saved subscription
  useEffect(() => {
    if (!selected) return;
    const sub = subs[selected.id];
    setPkgPlanId(sub?.plan_id || plans[0]?.id || "");
    setPkgBilling(sub?.billing_cycle || "monthly");
    setPkgStatus(sub?.status || "active");
    const end = sub?.current_period_end || sub?.trial_ends_at;
    setPkgExpiry(end ? new Date(end).toISOString().slice(0, 10) : "");
  }, [selected?.id, subs, plans]);

  const startEditing = () => {
    setEditing(true);
    setEditForm({
      business_name: selected.business_name || "",
      contact_name: selected.contact_name || "",
      contact_email: selected.contact_email || "",
      contact_phone: selected.contact_phone || "",
      business_email: selected.business_email || "",
      business_phone: selected.business_phone || "",
      business_address: selected.business_address || "",
      industry: selected.industry || "",
      slug: selected.slug || "",
    });
  };

  const saveEdit = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.from("tenants").update(editForm as any).eq("id", selected.id);
      if (error) throw error;
      toast({ title: "Customer updated" });
      setEditing(false);
      const updated = { ...selected, ...editForm };
      setSelected(updated);
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const openSubModal = (tenant: any, action: "activate" | "deactivate") => {
    setSubModal(tenant);
    setSubAction(action);
    const existingSub = subs[tenant.id];
    if (existingSub?.plan_id) setSubPlanId(existingSub.plan_id);
    else if (plans.length > 0) setSubPlanId(plans[0].id);
    setSubBilling(existingSub?.billing_cycle || "monthly");
  };

  const handleSubAction = async () => {
    if (!subModal) return;
    setLoading(true);
    try {
      const sub = subs[subModal.id];
      if (subAction === "deactivate") {
        if (sub) {
          await supabase.from("subscriptions").update({ 
            status: "paused", paused_at: new Date().toISOString() 
          } as any).eq("id", sub.id);
        }
        await supabase.from("tenants").update({ is_active: false } as any).eq("id", subModal.id);
        toast({ title: "Subscription deactivated", description: `${subModal.business_name} has been paused` });
      } else {
        const selectedPlan = plans.find(p => p.id === subPlanId);
        if (!selectedPlan) throw new Error("Please select a plan");
        
        // The stored price is per month; a company keeps its own deal on the same package.
        const keep = sub && sub.plan_id === subPlanId;
        const price = keep ? Number(sub.price ?? selectedPlan.price_monthly) : Number(selectedPlan.price_monthly);
        const maxUsers = keep ? sub.max_users ?? selectedPlan.max_users : selectedPlan.max_users;
        const maxLocations = keep ? sub.max_locations ?? selectedPlan.max_locations : selectedPlan.max_locations;
        
        const now = new Date().toISOString();
        const periodEnd = new Date();
        if (subBilling === "quarterly") periodEnd.setMonth(periodEnd.getMonth() + 3);
        else if (subBilling === "annually") periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        else periodEnd.setMonth(periodEnd.getMonth() + 1);

        if (sub) {
          await supabase.from("subscriptions").update({
            status: "active", plan_id: subPlanId, plan_name: selectedPlan.name,
            billing_cycle: subBilling, price, max_users: maxUsers, max_locations: maxLocations,
            paused_at: null, current_period_start: now, current_period_end: periodEnd.toISOString(),
          } as any).eq("id", sub.id);
        } else {
          await supabase.from("subscriptions").insert({
            tenant_id: subModal.id, plan_id: subPlanId, plan_name: selectedPlan.name,
            billing_cycle: subBilling, price, max_users: selectedPlan.max_users, max_locations: selectedPlan.max_locations,
            status: "active", current_period_start: now, current_period_end: periodEnd.toISOString(),
          } as any);
        }
        await supabase.from("tenants").update({ is_active: true } as any).eq("id", subModal.id);
        toast({ title: "Subscription activated", description: `${subModal.business_name} now on ${selectedPlan.name} (${subBilling})` });
      }
      setSubModal(null);
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  /** Assign/change a tenant's package, billing cycle, status and exact expiry date. */
  const savePackage = async () => {
    if (!selected) return;
    const sub = subs[selected.id];
    setLoading(true);
    try {
      const plan = plans.find(p => p.id === pkgPlanId);
      if (!plan) throw new Error("Please select a package");
      // Same package: the company's own price and limits stay. A new package brings its own.
      const keep = !!sub && sub.plan_id === plan.id;
      const expiry = pkgExpiry ? new Date(`${pkgExpiry}T23:59:59`) : null;
      if (pkgExpiry && Number.isNaN(expiry!.getTime())) throw new Error("Invalid expiry date");

      const payload: any = {
        plan_id: plan.id,
        plan_name: plan.name,
        billing_cycle: pkgBilling,
        status: pkgStatus,
        price: keep ? Number(sub.price ?? plan.price_monthly) : Number(plan.price_monthly ?? 0),
        max_users: keep ? sub.max_users ?? plan.max_users : plan.max_users,
        max_locations: keep ? sub.max_locations ?? plan.max_locations : plan.max_locations,
        paused_at: pkgStatus === "paused" ? new Date().toISOString() : null,
      };
      if (expiry) {
        payload.current_period_end = expiry.toISOString();
        payload.trial_ends_at = pkgStatus === "trial" ? expiry.toISOString() : null;
      }

      if (sub) {
        const { error } = await supabase.from("subscriptions").update(payload).eq("id", sub.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("subscriptions").insert({
          ...payload, tenant_id: selected.id, current_period_start: new Date().toISOString(),
        } as any);
        if (error) throw error;
      }
      await supabase.from("tenants").update({ is_active: pkgStatus !== "paused" } as any).eq("id", selected.id);
      toast({ title: "Package updated", description: `${plan.name} · ${pkgStatus}${expiry ? ` · expires ${format(expiry, "MMM dd, yyyy")}` : ""}` });
      await load();
    } catch (e: any) {
      toast({ title: "Could not update package", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    // One-time link to the shop's own reset page, sent with the saved mail settings.
    const result = await requestPasswordReset(email);
    if (!result.ok) toast({ title: "Error", description: result.error || "Could not send the reset link", variant: "destructive" });
    else toast({ title: "Password reset email sent", description: `Sent to ${email}` });
  };

  const extendTrial = async (tenantId: string, days: number) => {
    const sub = subs[tenantId];
    if (!sub) return toast({ title: "No subscription", variant: "destructive" });
    const base = sub.trial_ends_at ? new Date(sub.trial_ends_at) : new Date();
    const newEnd = new Date(Math.max(base.getTime(), Date.now()));
    newEnd.setDate(newEnd.getDate() + days);
    const { error } = await supabase.from("subscriptions").update({
      status: "trial", trial_ends_at: newEnd.toISOString(), current_period_end: newEnd.toISOString(),
    } as any).eq("id", sub.id);
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    await supabase.from("tenants").update({ is_active: true } as any).eq("id", tenantId);
    toast({ title: `Trial extended by ${days} days`, description: `Until ${format(newEnd, "MMM dd, yyyy")}` });
    load();
  };

  const recordManualPayment = async (tenantId: string, reference: string) => {
    const sub = subs[tenantId];
    if (!sub || !reference) return;
    const now = new Date();
    const periodEnd = new Date();
    if (sub.billing_cycle === "quarterly") periodEnd.setMonth(periodEnd.getMonth() + 3);
    else if (sub.billing_cycle === "annually") periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    else periodEnd.setMonth(periodEnd.getMonth() + 1);

    const { error: payErr } = await supabase.from("subscription_payments").insert({
      tenant_id: tenantId, subscription_id: sub.id, amount: Number(sub.price || 0),
      gateway: "manual", status: "completed", reference,
      metadata: { plan_name: sub.plan_name, billing_cycle: sub.billing_cycle, recorded_by: "super_admin" },
    } as any);
    if (payErr) return toast({ title: "Error", description: payErr.message, variant: "destructive" });

    await supabase.from("subscriptions").update({
      status: "active", paused_at: null,
      current_period_start: now.toISOString(), current_period_end: periodEnd.toISOString(),
    } as any).eq("id", sub.id);
    await supabase.from("tenants").update({ is_active: true } as any).eq("id", tenantId);
    toast({ title: "Payment recorded", description: `Subscription extended to ${format(periodEnd, "MMM dd, yyyy")}` });
    load();
  };

  /** Opens the company at its own address as the platform owner (also when its package has ended). */
  const loginAs = async (tenant: any) => {
    setOpening(tenant.id);
    const err = await openCompany(tenant.id);
    setOpening(null);
    if (err) toast({ title: "Could not open the company", description: err, variant: "destructive" });
  };
  // Companies of the same owner login (each with its own package and expiry).
  const ownerGroup = (t: any) => (t?.owner_user_id ? tenants.filter((x: any) => x.owner_user_id === t.owner_user_id && !x.deleted_at) : t ? [t] : []);
  const groupSize = (() => { const m: Record<string, number> = {}; tenants.forEach((x: any) => { if (x.owner_user_id && !x.deleted_at) m[x.owner_user_id] = (m[x.owner_user_id] || 0) + 1; }); return m; })();

  // Shops are only ever archived: access stops, every record is kept, and the
  // shop can be restored at any time. Nothing here removes data.
  const deleteTenant = async (tenant: any, _mode?: "soft" | "permanent") => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from("tenants")
        .update({ deleted_at: new Date().toISOString(), is_active: false } as any)
        .eq("id", tenant.id);
      if (error) throw error;
      toast({ title: "Company archived", description: `${tenant.business_name} can be restored later` });
      setDeleteConfirm(null);
      closeCompany();
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const restoreTenant = async (tenant: any) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from("tenants")
        .update({ deleted_at: null, is_active: true } as any)
        .eq("id", tenant.id);
      if (error) throw error;
      toast({ title: "Company restored", description: `${tenant.business_name} is active again` });
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const copyLoginUrl = (slug: string) => {
    const url = tenantUrl(slug, "/login");
    navigator.clipboard.writeText(url);
    toast({ title: "Copied!", description: url });
  };

  const createTenant = async () => {
    if (ownerMode === "existing") return createForExistingOwner();
    if (!newTenant.email || !newTenant.password || !newTenant.business_name) {
      toast({ title: "Error", description: "Email, password, and business name are required", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const response = await supabase.functions.invoke("admin-create-tenant", { body: newTenant });
      const data = response.data;
      const error = response.error;
      let errorMsg = data?.error;
      if (!errorMsg && error) {
        try {
          if (error?.context?.body) {
            const errBody = await new Response(error.context.body).json();
            errorMsg = errBody?.error;
          }
        } catch {}
        errorMsg = errorMsg || error?.message || "Failed to create tenant";
      }
      if (error || data?.error) throw new Error(errorMsg || "Failed");
      
      toast({ title: "Tenant created!", description: `${newTenant.business_name} has been set up successfully` });
      setShowAddTenant(false);
      setNewTenant({
        email: "", password: "", business_name: "", contact_name: "", contact_phone: "",
        business_email: "", business_phone: "", business_address: "", industry: "",
        store_slug: "", plan_id: "", billing_cycle: "monthly",
      });
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  /** A company for a login that already exists (no new password; the same login opens every company). */
  const createForExistingOwner = async () => {
    const slug = newTenant.store_slug || newTenant.business_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    setLoading(true);
    try {
      const { data: id, error } = await (supabase as any).rpc("create_company", {
        p_name: newTenant.business_name.trim(), p_slug: slug, p_country: "KE", p_currency: "KES", p_owner_email: newTenant.email.trim(), p_plan: newTenant.plan_id || null,
      });
      if (error) throw error;
      const details: any = {};
      (["contact_name", "contact_phone", "business_email", "business_phone", "business_address", "industry"] as const).forEach((k) => { if (newTenant[k]) details[k] = newTenant[k]; });
      if (Object.keys(details).length) await supabase.from("tenants").update(details).eq("id", id);
      if (newTenant.billing_cycle !== "monthly") await supabase.from("subscriptions").update({ billing_cycle: newTenant.billing_cycle } as any).eq("tenant_id", id);
      toast({ title: "Company added", description: `${newTenant.business_name} · ${slug}.${ROOT_HOST} · on trial` });
      setShowAddTenant(false);
      setNewTenant({
        email: "", password: "", business_name: "", contact_name: "", contact_phone: "",
        business_email: "", business_phone: "", business_address: "", industry: "",
        store_slug: "", plan_id: "", billing_cycle: "monthly",
      });
      load();
    } catch (e: any) {
      toast({ title: "Could not add the company", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const getDisplayName = (t: any) => t.business_name || t.contact_name || t.contact_email || "Unnamed";

  const filtered = tenants.filter(t => {
    const isDeleted = !!t.deleted_at;
    if (showDeleted ? !isDeleted : isDeleted) return false;
    const name = getDisplayName(t).toLowerCase();
    const email = (t.contact_email || "").toLowerCase();
    const slug = (t.slug || "").toLowerCase();
    const q = search.toLowerCase();
    if (ownerFilter && t.owner_user_id !== ownerFilter) return false;
    return name.includes(q) || email.includes(q) || slug.includes(q);
  });


  const subStatus = (t: any) => (subs[t.id]?.status as string) || "none";
  const statusGroup = (t: any) => {
    const s = subStatus(t);
    return s === "trialing" ? "trial" : s;
  };
  const counts = tenants.reduce((acc: Record<string, number>, t) => {
    if (showDeleted ? !t.deleted_at : t.deleted_at) return acc;
    acc.all = (acc.all || 0) + 1;
    acc[statusGroup(t)] = (acc[statusGroup(t)] || 0) + 1;
    return acc;
  }, {});
  const visible = filtered.filter((t) => statusFilter === "all" || statusGroup(t) === statusFilter);
  const selectedSub = selected ? subs[selected.id] : null;
  const isLive = (s?: string) => s === "active" || s === "trial" || s === "trialing";

  return (
    <div className="space-y-3">
      {!selected && (<>
      <PageHeader
        title={showDeleted ? "Archived companies" : "Companies"}
        icon={Building2}
        actions={
          <>
            <ExportMenu items={[{ label: "Download CSV", icon: Download, disabled: !visible.length, onSelect: () => downloadCsv(`dash-companies-${new Date().toISOString().slice(0, 10)}.csv`,
              ["Company", "Address", "Owner", "Email", "Phone", "Industry", "Package", "Status", "Cycle", "Renews / trial ends", "Joined", "Archived"],
              visible.map((t) => { const s = subs[t.id] || {}; return [getDisplayName(t), t.slug, t.contact_name, t.contact_email, t.contact_phone, t.industry, s.plan_name, s.status || "none", s.billing_cycle, (s.current_period_end || s.trial_ends_at || "").slice(0, 10), (t.created_at || "").slice(0, 10), t.deleted_at ? t.deleted_at.slice(0, 10) : ""]; })) }]} />
            <MoreMenu items={[{ label: showDeleted ? "Show active" : "Archived companies", icon: Archive, onSelect: () => { setShowDeleted(!showDeleted); closeCompany(); setStatusFilter("all"); } }]} />
            {!showDeleted && (
              <Button size="sm" onClick={() => {
                if (plans.length > 0 && !newTenant.plan_id) setNewTenant((prev) => ({ ...prev, plan_id: plans[0].id }));
                setShowAddTenant(true);
              }}>
                <Plus /> Add
              </Button>
            )}
          </>
        }
      />

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search companies" />
        {ownerFilter && (() => { const o = tenants.find((x: any) => x.owner_user_id === ownerFilter); return (
          <button onClick={() => setOwnerFilter(null)} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-info/10 px-3 py-1.5 text-xs font-semibold text-info ring-1 ring-info/20" title="Show all companies">
            <span className="truncate">Owner: {o?.contact_name || o?.contact_email || "this owner"}</span> <X className="h-3.5 w-3.5 shrink-0" />
          </button>); })()}
        {!showDeleted && (
          <Segmented value={statusFilter} onChange={setStatusFilter} options={[
            { value: "all", label: "All", count: counts.all || 0 },
            { value: "active", label: "Active", count: counts.active || 0 },
            { value: "trial", label: "Trial", count: counts.trial || 0 },
            { value: "paused", label: "Paused", count: counts.paused || 0 },
            { value: "expired", label: "Expired", count: counts.expired || 0 },
          ]} />
        )}
      </Toolbar>

      <Panel flush>
        {visible.length === 0 ? (
          <EmptyState icon={Building2} title={search ? "No companies match your search" : showDeleted ? "No archived companies" : "No companies here yet"} />
        ) : (
          <TableWrap>
            <table className="dt">
              <thead>
                <tr><th>Company</th><th className="hidden md:table-cell">Owner</th><th>Package</th><th>Status</th><th className="hidden lg:table-cell">Renews / ends</th><th className="text-right">Actions</th></tr>
              </thead>
              <tbody>
                <PagedRows rows={visible} colSpan={6}>{(pageRows) => pageRows.map((t) => {
                  const sub = subs[t.id];
                  const end = sub?.current_period_end || sub?.trial_ends_at;
                  const verified = isVerified(t);
                  return (
                    <tr key={t.id} className="cursor-pointer" onClick={() => loadTenantDetails(t)}>
                      <td>
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                            {getDisplayName(t).charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="max-w-[220px] truncate font-semibold">{getDisplayName(t)}</p>
                            {t.slug ? (
                              <button onClick={(e) => { e.stopPropagation(); copyLoginUrl(t.slug); }}
                                className="inline-flex min-w-0 max-w-full items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-primary" title="Copy login link">
                                <span className="truncate">{t.slug}.{ROOT_HOST}</span> <Copy className="h-3 w-3 shrink-0" />
                              </button>
                            ) : <span className="text-[11px] text-muted-foreground">No address</span>}
                          </div>
                        </div>
                      </td>
                      <td className="hidden md:table-cell">
                        <p className="max-w-[200px] truncate">{t.contact_name || "—"}</p>
                        <p className="max-w-[200px] truncate text-xs text-muted-foreground">{t.contact_email || t.contact_phone || "—"}</p>
                        {(groupSize[t.owner_user_id] || 0) > 1 && (
                          <button onClick={(e) => { e.stopPropagation(); setOwnerFilter(t.owner_user_id); }} title="Show this owner's companies"><Pill tone="info" className="mt-1">{groupSize[t.owner_user_id]} companies</Pill></button>
                        )}
                        {verified === false && <Pill tone="warning" className="mt-1">Email not verified</Pill>}
                      </td>
                      <td>{sub?.plan_name || <span className="text-muted-foreground">—</span>}</td>
                      <td><StatusPill status={t.deleted_at ? "archived" : sub?.status || "none"} /></td>
                      <td className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{end ? format(new Date(end), "d MMM yyyy") : "—"}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {t.deleted_at ? (
                            <Button size="sm" variant="outline" onClick={() => restoreTenant(t)} disabled={loading}><RotateCcw /> Restore</Button>
                          ) : (
                            <>
                              <button className="icon-btn" title="Send password reset" aria-label="Send password reset" onClick={() => resetPassword(t.contact_email)}><KeyRound className="h-4 w-4" /></button>
                              <Button size="sm" variant="outline" title="Open this company (works even when its package has ended)" disabled={opening === t.id} onClick={() => loginAs(t)}><LogIn /> {opening === t.id ? "Opening…" : "Open"}</Button>
                              <button className="icon-btn hidden sm:inline-flex" title="Manage" aria-label="Manage" onClick={() => loadTenantDetails(t)}><ChevronRight className="h-4 w-4" /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}</PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
      </>)}

      {/* ---------------- Company page ---------------- */}
      {selected && (() => {
        const end = selectedSub?.current_period_end || selectedSub?.trial_ends_at;
        const onTrial = selectedSub?.status === "trial" || selectedSub?.status === "trialing";
        const paid = companyPays.filter((x) => x.status === "completed").reduce((t, x) => t + Number(x.amount || 0), 0);
        return (
          <>
            <PageHeader title={getDisplayName(selected)} icon={Building2}
              actions={<>
                <StatusPill status={selected.deleted_at ? "archived" : selectedSub?.status || "none"} />
                <Button variant="outline" size="sm" onClick={closeCompany} aria-label="Back to companies"><ArrowLeft /> <span className="hidden sm:inline">Companies</span></Button>
                {!selected.deleted_at && <Button size="sm" disabled={opening === selected.id} onClick={() => loginAs(selected)}><LogIn /> {opening === selected.id ? "Opening…" : "Open"}</Button>}
                <MoreMenu items={[
                  { label: "Send password reset", icon: KeyRound, onSelect: () => resetPassword(selected.contact_email) },
                  { label: "Mark email verified", icon: MailCheck, onSelect: () => verifyTenant(selected), hidden: isVerified(selected) !== false, disabled: verifying === selected.id },
                  { label: "Restore company", icon: RotateCcw, onSelect: () => restoreTenant(selected), hidden: !selected.deleted_at, disabled: loading, separator: true },
                  { label: "Archive company", icon: Archive, onSelect: () => setDeleteConfirm(selected), hidden: !!selected.deleted_at, danger: true, separator: true },
                ]} />
              </>} />

            <StatGrid className="lg:grid-cols-4">
              <StatTile label="Package" value={selectedSub?.plan_name || "None"} hint={selectedSub ? `KSh ${Number(selectedSub.price || 0).toLocaleString()} · ${selectedSub.billing_cycle || "monthly"}` : undefined} icon={CreditCard} tone="primary" />
              <StatTile label={onTrial ? "Trial ends" : "Paid until"} value={end ? format(new Date(end), "d MMM yyyy") : "—"} icon={Calendar} tone={end && new Date(end) < new Date() ? "danger" : "info"} />
              <StatTile label="Paid to JMSURF" value={`KSh ${paid.toLocaleString()}`} hint={`${companyPays.length} payment${companyPays.length === 1 ? "" : "s"}`} icon={Wallet} tone="success" />
              <StatTile label="Staff" value={profiles.length} hint={selectedSub ? `up to ${selectedSub.max_users ?? "—"} users · ${selectedSub.max_locations ?? "—"} branches` : undefined} icon={Users} tone="muted" />
            </StatGrid>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="min-w-0 space-y-4 lg:col-span-1">
                <Panel title="Business details" icon={Building2} actions={editing ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                    <Button size="sm" onClick={saveEdit} disabled={loading}><Save /> {loading ? "Saving…" : "Save"}</Button>
                  </div>
                ) : <Button size="sm" variant="outline" onClick={startEditing}><Pencil /> Edit</Button>}>
                  {editing ? (
                    <div className="grid gap-4">
                      {([
                        ["business_name", "Business name"], ["slug", "Company address (slug)"],
                        ["contact_name", "Owner name"], ["contact_email", "Owner email"],
                        ["contact_phone", "Owner phone"], ["business_phone", "Business phone"],
                        ["business_email", "Business email"], ["industry", "Industry"], ["business_address", "Address"],
                      ] as const).map(([key, label]) => (
                        <Field key={key} label={label}>
                          <input className="fi" value={editForm[key] || ""} onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })} />
                        </Field>
                      ))}
                    </div>
                  ) : (
                    <dl className="space-y-3.5 text-sm">
                      {[
                        { icon: Users, label: "Owner", value: selected.contact_name },
                        { icon: Mail, label: "Owner email", value: selected.contact_email },
                        { icon: Phone, label: "Phone", value: selected.contact_phone || selected.business_phone },
                        { icon: Mail, label: "Business email", value: selected.business_email },
                        { icon: MapPin, label: "Address", value: selected.business_address },
                        { icon: Building2, label: "Industry", value: selected.industry },
                        { icon: Calendar, label: "Joined", value: selected.created_at ? format(new Date(selected.created_at), "d MMM yyyy") : "" },
                      ].map((row) => (
                        <div key={row.label} className="flex gap-3">
                          <row.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0"><dt className="text-xs text-muted-foreground">{row.label}</dt><dd className="break-words font-medium">{row.value || "—"}</dd></div>
                        </div>
                      ))}
                    </dl>
                  )}
                </Panel>

                {selected.slug && (
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2"><Link2 className="h-4 w-4 shrink-0 text-primary" /><span className="truncate font-mono text-sm text-primary">{selected.slug}.{ROOT_HOST}/login</span></div>
                    <Button size="sm" variant="ghost" className="shrink-0" onClick={() => copyLoginUrl(selected.slug)}><Copy /> Copy</Button>
                  </div>
                )}

                <OwnerCompaniesPanel tenant={selected} group={ownerGroup(selected)} subs={subs}
                  onSelect={(t) => void loadTenantDetails(t)} onAdd={() => setAddForOwner(true)} onPay={() => setGroupPay(ownerGroup(selected).map((t: any) => t.id))} />

                <CustomDomainPanel tenantId={selected.id} />
              </div>

              <div className="min-w-0 space-y-4 lg:col-span-2">
                <LineTabs value={drawerTab} onChange={(v) => setDrawerTab(v)} options={[
                  { value: "package", label: "Package" },
                  { value: "features", label: "Custom deal" },
                  { value: "staff", label: "People", count: people.length || profiles.length },
                  { value: "payments", label: "Payments", count: companyPays.length },
                ]} />

            {drawerTab === "package" && (
              selectedSub ? (
                <>
                  <Panel title="Change package" description="Same package keeps this company's own price and limits (Custom deal).">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Package">
                        <select value={pkgPlanId} onChange={(e) => setPkgPlanId(e.target.value)} className="fi">
                          {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — KSh {Number(p.price_monthly).toLocaleString()}/mo</option>)}
                        </select>
                      </Field>
                      <Field label="Billing cycle">
                        <select value={pkgBilling} onChange={(e) => setPkgBilling(e.target.value)} className="fi">
                          <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option>
                        </select>
                      </Field>
                      <Field label="Status">
                        <select value={pkgStatus} onChange={(e) => setPkgStatus(e.target.value)} className="fi">
                          <option value="active">Active</option><option value="trial">Trial</option><option value="paused">Paused</option><option value="expired">Expired</option>
                        </select>
                      </Field>
                      <Field label="Expiry date">
                        <input type="date" value={pkgExpiry} onChange={(e) => setPkgExpiry(e.target.value)} className="fi" />
                      </Field>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <Button onClick={savePackage} disabled={loading}><Save /> {loading ? "Saving…" : "Save"}</Button>
                    </div>
                  </Panel>

                  <Panel title="Quick actions">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => extendTrial(selected.id, 7)}><Calendar /> +7 day trial</Button>
                      <Button variant="outline" size="sm" onClick={() => extendTrial(selected.id, 30)}><Calendar /> +30 day trial</Button>
                      <Button variant="outline" size="sm" onClick={() => { setManualRef(""); setManualPayFor(selected); }}><CheckCircle /> Record payment</Button>
                      {isLive(selectedSub.status) ? (
                        <Button variant="outline" size="sm" className="text-warning hover:text-warning" onClick={() => openSubModal(selected, "deactivate")}><XCircle /> Pause company</Button>
                      ) : (
                        <Button variant="outline" size="sm" className="text-success hover:text-success" onClick={() => openSubModal(selected, "activate")}><CheckCircle /> Activate</Button>
                      )}
                    </div>
                  </Panel>
                </>
              ) : (
                <Panel><EmptyState icon={CreditCard} title="No package yet"
                  action={<Button onClick={() => openSubModal(selected, "activate")}><CheckCircle /> Add package</Button>} /></Panel>
              )
            )}

            {drawerTab === "features" && (
              selectedSub ? (
                <div className="space-y-4">
                  <AdminTenantFeaturesPanel
                    tenantId={selected.id}
                    subscriptionId={selectedSub.id}
                    planId={selectedSub.plan_id}
                    staffCount={profiles.length}
                    initialPrice={selectedSub.price}
                    initialMaxUsers={selectedSub.max_users}
                    initialMaxLocations={selectedSub.max_locations}
                  />
                  <Panel title="Modules" description="On for this company only: free, trial or paid at your price.">
                    <AdminCompanySuites tenantId={selected.id} />
                  </Panel>
                </div>
              ) : <Panel><EmptyState icon={CreditCard} title="Add a package first" /></Panel>
            )}

            {drawerTab === "staff" && <CompanyPeoplePanel tenant={selected} people={people} loading={peopleLoading} reload={reloadPeople} />}
            {drawerTab === "staff" && (
              <Panel flush title="Staff" icon={Users}>
                {profiles.length === 0 ? <EmptyState icon={Users} title="No staff yet" /> : (
                  <ul className="divide-y divide-border">
                    {profiles.map((p: any) => (
                      <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">{String(p.display_name || "?").charAt(0).toUpperCase()}</span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.display_name || "Unnamed"}</p>
                          <p className="truncate text-xs text-muted-foreground">{p.phone || "No phone"} · {p.store_location || "No branch"}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
                {drawerTab === "payments" && (
                  <Panel flush title="Payments to JMSURF" icon={Receipt}>
                    {companyPays.length === 0 ? <EmptyState icon={Receipt} title="No payments yet" /> : (
                      <TableWrap>
                        <table className="dt">
                          <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
                          <tbody>
                            <PagedRows rows={companyPays} colSpan={5}>{(pageRows) => pageRows.map((x) => (
                              <tr key={x.id}>
                                <td className="whitespace-nowrap text-xs">{format(new Date(x.created_at), "d MMM yyyy, HH:mm")}</td>
                                <td className="text-xs capitalize">{x.gateway === "jmsurf" ? "JMSURF PAY" : x.gateway || "—"}</td>
                                <td className="font-mono text-xs">{x.reference || "—"}</td>
                                <td><StatusPill status={x.status} /></td>
                                <td className="text-right tabular-nums">KSh {Number(x.amount || 0).toLocaleString()}</td>
                              </tr>
                            ))}</PagedRows>
                          </tbody>
                        </table>
                      </TableWrap>
                    )}
                  </Panel>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {/* ---------------- Archive ---------------- */}
      <Modal center open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} size="sm" icon={Archive}
        title="Archive this company?" description="Access stops now. Records are kept and it can be restored."
        footer={<>
          <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button className="bg-warning text-warning-foreground hover:bg-warning/90" onClick={() => deleteTenant(deleteConfirm)} disabled={loading}>{loading ? "Archiving…" : "Archive"}</Button>
        </>}>
        {deleteConfirm && (
          <div className="rounded-xl bg-muted/60 p-3 text-sm">
            <p className="font-semibold">{getDisplayName(deleteConfirm)}</p>
            <p className="text-muted-foreground">{deleteConfirm.contact_email}</p>
          </div>
        )}
      </Modal>

      {/* ---------------- Activate / pause ---------------- */}
      <Modal open={!!subModal} onClose={() => setSubModal(null)} size="md"
        icon={subAction === "activate" ? CheckCircle : XCircle}
        title={subAction === "activate" ? "Activate package" : "Pause company"}
        description={subModal ? getDisplayName(subModal) : ""}
        footer={<>
          <Button variant="outline" onClick={() => setSubModal(null)}>Cancel</Button>
          <Button onClick={handleSubAction} disabled={loading} className={subAction === "activate" ? "" : "bg-warning text-warning-foreground hover:bg-warning/90"}>
            {loading ? "Working…" : subAction === "activate" ? "Activate" : "Pause company"}
          </Button>
        </>}>
        {subAction === "activate" ? (
          <div className="space-y-4">
            <Field label="Package">
              <select value={subPlanId} onChange={(e) => setSubPlanId(e.target.value)} className="fi">
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — KSh {Number(p.price_monthly).toLocaleString()}/mo · {p.max_users} users</option>)}
              </select>
            </Field>
            <Field label="Billing cycle">
              <select value={subBilling} onChange={(e) => setSubBilling(e.target.value)} className="fi">
                <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option>
              </select>
            </Field>
            {(() => {
              const sp = plans.find((p) => p.id === subPlanId);
              if (!sp) return null;
              const price = subBilling === "quarterly" ? sp.price_quarterly : subBilling === "annually" ? sp.price_annually : sp.price_monthly;
              return (
                <div className="flex items-center justify-between rounded-xl bg-muted/60 p-3 text-sm">
                  <span className="text-muted-foreground">{sp.name} · {subBilling}</span>
                  <span className="font-bold text-primary">KSh {Number(price || 0).toLocaleString()}</span>
                </div>
              );
            })()}
          </div>
        ) : (
          <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
            Staff can't sign in until you activate it again. No data is removed.
          </p>
        )}
      </Modal>

      {/* ---------------- Manual payment ---------------- */}
      <Modal open={!!manualPayFor} onClose={() => setManualPayFor(null)} size="sm" icon={CheckCircle}
        title="Record payment"
        description={manualPayFor ? `Extends ${getDisplayName(manualPayFor)} by one ${subs[manualPayFor.id]?.billing_cycle || "monthly"} period.` : ""}
        footer={<>
          <Button variant="outline" onClick={() => setManualPayFor(null)}>Cancel</Button>
          <Button disabled={!manualRef.trim() || loading} onClick={async () => { await recordManualPayment(manualPayFor.id, manualRef.trim()); setManualPayFor(null); }}>Record payment</Button>
        </>}>
        <Field label="M-Pesa code or reference" required>
          <input className="fi uppercase" value={manualRef} onChange={(e) => setManualRef(e.target.value)} placeholder="Enter code" autoFocus />
        </Field>
        {manualPayFor && subs[manualPayFor.id] && (
          <p className="mt-3 text-sm text-muted-foreground">Amount: <strong className="text-foreground">KSh {Number(subs[manualPayFor.id].price || 0).toLocaleString()}</strong></p>
        )}
      </Modal>

      <AddOwnerCompanyModal open={addForOwner} onClose={() => setAddForOwner(false)} source={selected} plans={plans}
        ownerEmail={people.find((p) => p.is_owner && p.user_id === selected?.owner_user_id)?.email || people.find((p) => p.user_id === selected?.owner_user_id)?.email || null}
        onDone={() => { setAddForOwner(false); void load(); }} />
      <GroupPaymentModal open={!!groupPay} onClose={() => setGroupPay(null)} group={selected ? ownerGroup(selected) : []} subs={subs} initial={groupPay || []}
        onDone={async () => { setGroupPay(null); await load(); if (selected) void loadTenantDetails(selected); }} />

      {/* ---------------- Add company ---------------- */}
      <Modal open={showAddTenant} onClose={() => setShowAddTenant(false)} size="lg" icon={Building2}
        title="Add company" description={ownerMode === "new" ? "Creates the owner's login and the company." : "Adds a company to an existing login."}
        footer={<>
          <Button variant="outline" onClick={() => setShowAddTenant(false)}>Cancel</Button>
          <Button onClick={createTenant} disabled={loading || !newTenant.email || (ownerMode === "new" && !newTenant.password) || !newTenant.business_name}>
            {loading ? "Creating…" : "Create company"}
          </Button>
        </>}>
        <div className="space-y-5">
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Owner login</p>
            <Segmented value={ownerMode} onChange={(v) => setOwnerMode(v as "new" | "existing")} options={[
              { value: "new", label: "New owner" },
              { value: "existing", label: "Existing login" },
            ]} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={ownerMode === "new" ? "Email" : "Login email"} required><input className="fi" type="email" placeholder="Enter email" value={newTenant.email} onChange={(e) => setNewTenant({ ...newTenant, email: e.target.value })} /></Field>
              {ownerMode === "new" && <Field label="Password" required hint="At least 8 characters"><input className="fi" type="password" placeholder="Enter password" value={newTenant.password} onChange={(e) => setNewTenant({ ...newTenant, password: e.target.value })} /></Field>}
            </div>
          </section>
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Business</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Business name" required><input className="fi" placeholder="Enter business name" value={newTenant.business_name} onChange={(e) => setNewTenant({ ...newTenant, business_name: e.target.value })} /></Field>
              <Field label="Company address" hint={newTenant.store_slug ? `${newTenant.store_slug}.${ROOT_HOST}` : "Letters, numbers and dashes"}>
                <input className="fi" placeholder="Enter address" value={newTenant.store_slug} onChange={(e) => setNewTenant({ ...newTenant, store_slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
              </Field>
              <Field label="Contact person"><input className="fi" placeholder="Enter name" value={newTenant.contact_name} onChange={(e) => setNewTenant({ ...newTenant, contact_name: e.target.value })} /></Field>
              <Field label="Contact phone"><input className="fi" placeholder="Enter phone" value={newTenant.contact_phone} onChange={(e) => setNewTenant({ ...newTenant, contact_phone: e.target.value })} /></Field>
              <Field label="Business email"><input className="fi" placeholder="Enter email" value={newTenant.business_email} onChange={(e) => setNewTenant({ ...newTenant, business_email: e.target.value })} /></Field>
              <Field label="Business phone"><input className="fi" placeholder="Enter phone" value={newTenant.business_phone} onChange={(e) => setNewTenant({ ...newTenant, business_phone: e.target.value })} /></Field>
              <Field label="Address" className="sm:col-span-2"><input className="fi" placeholder="Enter address" value={newTenant.business_address} onChange={(e) => setNewTenant({ ...newTenant, business_address: e.target.value })} /></Field>
              <Field label="Industry">
                <select className="fi" value={newTenant.industry} onChange={(e) => setNewTenant({ ...newTenant, industry: e.target.value })}>
                  <option value="">Choose…</option>
                  {["Retail", "Restaurant", "Wholesale", "Supermarket", "Pharmacy", "Hardware", "Electronics", "Other"].map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </Field>
            </div>
          </section>
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Package</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Package">
                <select className="fi" value={newTenant.plan_id} onChange={(e) => setNewTenant({ ...newTenant, plan_id: e.target.value })}>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — KSh {Number(p.price_monthly).toLocaleString()}/mo</option>)}
                </select>
              </Field>
              <Field label="Billing cycle">
                <select className="fi" value={newTenant.billing_cycle} onChange={(e) => setNewTenant({ ...newTenant, billing_cycle: e.target.value })}>
                  <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option>
                </select>
              </Field>
            </div>
          </section>
        </div>
      </Modal>
    </div>
  );
}
