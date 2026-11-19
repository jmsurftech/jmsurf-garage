import { useEffect, useMemo, useState , useRef } from "react";
import { useMoneyAccounts } from "@/hooks/useMoneyAccounts";
import { Sparkles } from "lucide-react";
import { OrbSpinner } from "@/components/orbs";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Trash2, Save, Wallet, Repeat, CalendarDays, MapPin, Pencil, Paperclip, Receipt, Download, Eye, Tags, User, Building2, CreditCard, Hash, Copy } from "lucide-react";
import { useApprovalRule, submitForApproval } from "@/lib/approvals";
import ImportExport from "@/components/ImportExport";
import { supabase } from "@/integrations/supabase/client";
import { offlineMutate } from "@/lib/offlineMutate";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocations } from "@/hooks/useData";
import { useSuppliers } from "@/pages/Suppliers";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { formatKES, currencyCode } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { PageHeader, Toolbar, SearchBox, Panel, TableWrap, EmptyState, Field, Modal, Pill, StatTile, StatGrid, PageLoader } from "@/components/kit";
import Pager, { usePaged } from "@/components/Pager";
import { useSelection, BulkBar, Tick, downloadCsv } from "@/components/Bulk";
import { confirmAction } from "@/components/books/confirm";
import { CustomerPicker, type PickedCustomer } from "@/components/books/CustomerPicker";
import { uploadDocument, openDocument } from "@/components/DocumentsPanel";
import { useUnsavedGuard } from "@/lib/unsaved";
import { fmtDate } from "@/lib/doc-pdf";
import { cn } from "@/lib/utils";
import { TagPickers, TagChips, TagFilter, TagGroupSummary, cleanTags, matchesTagView, missingTag, useModuleTags, NO_TAG_VIEW, type TagValues, type TagView } from "@/lib/reportingTags";

const sb: any = supabase;
const today = () => new Date().toISOString().split("T")[0];
export const PAYMENT_METHODS = [["cash", "Cash"], ["mpesa", "M-Pesa"], ["bank_transfer", "Bank transfer"], ["card", "Card"], ["cheque", "Cheque"], ["petty_cash", "Petty cash"], ["credit", "On credit (unpaid)"]] as const;
const PAID_THROUGH = ["Cash in till", "Petty cash", "M-Pesa till / paybill", "Bank account", "Owner's money", "Company card"];
const methodLabel = (m?: string | null) => PAYMENT_METHODS.find(([v]) => v === m)?.[1] || (m ? m.replace(/_/g, " ") : "—");

function useExpenseCategories() {
  return useQuery({
    queryKey: ["expense-categories"],
    queryFn: async () => {
      const { data, error } = await sb.from("expense_categories").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return data as any[];
    },
  });
}

function useExpenses(locationId?: string) {
  return useQuery({
    queryKey: ["expenses", locationId],
    queryFn: async () => {
      let q = sb.from("expenses").select("*, customers(name), hr_employees(first_name,last_name)").order("expense_date", { ascending: false }).limit(5000);
      if (locationId) q = q.eq("location_id", locationId);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });
}

const EMPTY_FORM = () => ({
  location_id: "", category_id: "", description: "", amount: "", tax_amount: "", expense_date: today(),
  supplier_id: "", vendor_name: "", payment_method: "cash", paid_through: "Cash in till", reference: "", notes: "", employee_id: "",
  is_recurring: false, recurrence_interval: "1", recurrence_unit: "months",
});

export default function Expenses() {
  const { id } = useParams<{ id?: string }>();
  const { data: moneyAccounts = [] } = useMoneyAccounts();
  const navigate = useNavigate();
  const [branch, setBranch] = useState("all");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(showForm && dirty && !saving);
  const { data: locations = [] } = useLocations();
  const { data: categories = [] } = useExpenseCategories();
  const { data: suppliers = [] } = useSuppliers();
  const tenantId = useTenantId();
  const { data: employees = [] } = useQuery({ queryKey: ["exp-employees"], queryFn: async () => (await sb.from("hr_employees").select("id,first_name,last_name").order("first_name")).data || [] });
  const { data: expenses = [], isLoading } = useExpenses(branch === "all" ? undefined : branch);
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canDelete = hasPermission("expenses_delete");
  const [form, setForm] = useState(EMPTY_FORM);
  const [cust, setCust] = useState<PickedCustomer | null>(null);
  const expenseTags = useModuleTags("expenses");
  const [tags, setTags] = useState<TagValues>({});
  const [tagView, setTagView] = useState<TagView>(NO_TAG_VIEW);
  const [file, setFile] = useState<File | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const approval = useApprovalRule("expense");
  const [repeatFor, setRepeatFor] = useState<{ ids: string[]; title: string; from?: string; every?: number; unit?: string } | null>(null);
  const nextAfter = (from: string, every: number, unit: string) => {
    const d = new Date(`${from}T00:00:00`);
    if (unit === "days") d.setDate(d.getDate() + every); else if (unit === "weeks") d.setDate(d.getDate() + every * 7); else if (unit === "years") d.setFullYear(d.getFullYear() + every); else d.setMonth(d.getMonth() + every);
    return d.toISOString().slice(0, 10);
  };
  /** Turns existing expenses into repeating ones (the next copy is added automatically on its date). */
  const makeRecurring = async (ids: string[], every: number, unit: string, next: string) => {
    const { error } = await sb.from("expenses").update({ is_recurring: true, recurrence_interval: every, recurrence_unit: unit, next_due_date: next }).in("id", ids);
    if (error) return toast({ title: "Not changed", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["expenses"] }); sel.clear(); setRepeatFor(null);
    toast({ title: ids.length === 1 ? "Expense now repeats" : `${ids.length} expenses now repeat`, description: `Next one is added on ${fmtDate(next)}.` });
  };
  const stopRecurring = async (ids: string[]) => {
    const { error } = await sb.from("expenses").update({ is_recurring: false, next_due_date: null }).in("id", ids);
    if (error) return toast({ title: "Not changed", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["expenses"] }); sel.clear(); toast({ title: "Stopped repeating" });
  };
  const set = (k: keyof ReturnType<typeof EMPTY_FORM>, v: any) => { setDirty(true); setForm((f) => ({ ...f, [k]: v })); };
  const openEdit = (e: any, copy = false) => {
    setEditId(copy ? null : e.id); setDirty(false); setFile(null);
    setForm({ ...EMPTY_FORM(), location_id: e.location_id || "", category_id: e.category_id || "", description: e.description || "", amount: String(e.amount), tax_amount: e.tax_amount ? String(e.tax_amount) : "",
      expense_date: copy ? today() : e.expense_date, supplier_id: e.supplier_id || "", vendor_name: e.vendor_name || "", payment_method: e.payment_method || "cash", paid_through: e.paid_through || "Cash in till",
      reference: copy ? "" : e.reference || "", notes: e.notes || "", employee_id: e.employee_id || "",
      is_recurring: !copy && !!e.is_recurring, recurrence_interval: String(e.recurrence_interval || 1), recurrence_unit: e.recurrence_unit || "months" });
    setCust(e.customer_id ? { id: e.customer_id, name: e.customers?.name || "Customer" } : null);
    setTags(e.tags || {});
    setShowForm(true);
  };
  const locationName = useMemo(() => new Map(locations.map((l: any) => [l.id, l.name])), [locations]);
  const openForm = () => {
    setEditId(null); setDirty(false); setFile(null); setCust(null); setTags({});
    setForm({ ...EMPTY_FORM(), location_id: branch !== "all" ? branch : (locations[0]?.id || "") });
    setShowForm(true);
  };
  // Record from invoice: Garage AI reads the supplier invoice or receipt and fills the form; the person checks and saves.
  const invInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [choose, setChoose] = useState(false);
  const fromInvoice = async (f: File) => {
    if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(f.type)) return toast({ title: "Upload a photo (JPG, PNG) or a PDF", variant: "destructive" });
    if (f.size > 20 * 1024 * 1024) return toast({ title: "That file is too large", description: "20 MB at most.", variant: "destructive" });
    setReading(true);
    try {
      const data = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = bad; r.readAsDataURL(f); });
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/ai/extract-expense", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify({ file: { name: f.name, type: f.type, data } }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not read the invoice");
      const x = j.expense || {};
      const norm = (v: string) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const cat = (categories as any[]).find((c) => norm(c.name) === norm(x.category)) || (categories as any[]).find((c) => norm(c.name).includes(norm(x.category)) || norm(x.category).includes(norm(c.name)));
      let sup: any = (suppliers as any[]).find((v) => (x.vendor_pin && String(v.kra_pin || "").toUpperCase() === String(x.vendor_pin).toUpperCase()) || norm(v.name) === norm(x.vendor));
      // A vendor seen for the first time is added to Vendors (company or individual), with what the invoice shows.
      let added = "";
      if (!sup && String(x.vendor || "").trim() && tenantId) {
        const pin = String(x.vendor_pin || "").trim().toUpperCase();
        const { data: made } = await sb.from("suppliers").insert({
          tenant_id: tenantId, name: String(x.vendor).trim().slice(0, 200), supplier_type: x.vendor_type === "individual" ? "individual" : "company",
          kra_pin: /^[AP]\d{9}[A-Z]$/.test(pin) ? pin : null, phone: String(x.vendor_phone || "").trim() || null, email: String(x.vendor_email || "").trim() || null,
          address: String(x.vendor_address || "").trim() || null, is_active: true, onboarding_status: "pending", notes: "Added from an uploaded invoice",
        }).select("id,name").single();
        if (made) { sup = made; added = made.name; void qc.invalidateQueries({ queryKey: ["suppliers"] }); void qc.invalidateQueries({ queryKey: ["suppliers-z"] }); }
      }
      const method = x.payment_method === "mpesa" ? "mpesa" : x.payment_method === "bank" ? "bank" : x.payment_method === "card" ? "card" : "cash";
      const items = Array.isArray(x.items) ? x.items.filter((i: any) => i?.name).map((i: any) => `${i.quantity ?? 1} × ${i.name}${i.amount ? ` = ${Number(i.amount).toLocaleString()}` : ""}`).join("\n") : "";
      setEditId(null); setDirty(true); setCust(null); setFile(f); setTags({});
      setForm({ ...EMPTY_FORM(), location_id: branch !== "all" ? branch : (locations[0]?.id || ""), category_id: cat?.id || "",
        amount: String(Number(x.total) || ""), tax_amount: Number(x.tax) ? String(Number(x.tax)) : "", expense_date: /^\d{4}-\d{2}-\d{2}$/.test(String(x.date || "")) ? x.date : today(),
        supplier_id: sup?.id || "", vendor_name: sup && !added ? "" : String(x.vendor || ""), payment_method: method,
        paid_through: method === "mpesa" ? "M-Pesa till / paybill" : method === "bank" ? "Bank account" : method === "card" ? "Company card" : "Cash in till",
        reference: String(x.invoice_number || ""), description: String(x.description || "").slice(0, 200), notes: [items, x.vendor_pin ? `Supplier PIN: ${x.vendor_pin}` : ""].filter(Boolean).join("\n") });
      setShowForm(true);
      toast({ title: "Invoice read", description: `${added ? `${added} added to Vendors. ` : ""}${cat ? "Check the details and save." : `Check the details, choose a category (suggested: ${x.category}) and save.`}` });
    } catch (e: any) { toast({ title: "Could not read the invoice", description: e.message, variant: "destructive" }); }
    finally { setReading(false); }
  };
  // "+ New → Expense" from the header opens the form straight away.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") !== "1") return;
    window.history.replaceState({}, "", window.location.pathname);
    setChoose(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const vendorOf = (e: any) => e.vendor_name || suppliers.find((s: any) => s.id === e.supplier_id)?.name || "";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses.filter((e: any) => {
      if (categoryFilter !== "all" && (e.category_id || e.category_name) !== categoryFilter) return false;
      if (methodFilter !== "all" && (e.payment_method || "cash") !== methodFilter) return false;
      if (from && e.expense_date < from) return false;
      if (to && e.expense_date > to) return false;
      if (!matchesTagView(e, tagView)) return false;
      if (!q) return true;
      return `${e.expense_number || ""} ${e.category_name} ${e.description || ""} ${vendorOf(e)} ${e.reference || ""}`.toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, search, categoryFilter, methodFilter, from, to, suppliers, tagView]);
  const paged = usePaged(filtered, 25);
  const sel = useSelection(paged.rows.map((e: any) => e.id));
  const open = id ? expenses.find((e: any) => e.id === id) : null;

  const total = filtered.reduce((s: number, e: any) => s + Number(e.amount), 0);
  const thisMonth = useMemo(() => {
    const m = today().slice(0, 7);
    return expenses.filter((e: any) => String(e.expense_date).startsWith(m)).reduce((s: number, e: any) => s + Number(e.amount), 0);
  }, [expenses]);
  const recurringCount = expenses.filter((e: any) => e.is_recurring).length;
  const topCategory = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((e: any) => m.set(e.category_name || "Other", (m.get(e.category_name || "Other") || 0) + Number(e.amount)));
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  }, [filtered]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.tenant_id) { toast({ title: "Workspace not ready", description: "Please refresh and try again.", variant: "destructive" }); return; }
    const amount = parseFloat(form.amount);
    if (!(amount > 0)) { toast({ title: "Enter the amount", variant: "destructive" }); return; }
    if (!form.category_id) { toast({ title: "Choose a category", variant: "destructive" }); return; }
    const missingT = missingTag(expenseTags, "expenses", tags);
    if (missingT) { toast({ title: `Choose ${missingT}`, variant: "destructive" }); return; }
    const cat = categories.find((c: any) => c.id === form.category_id);
    const sup = suppliers.find((s: any) => s.id === form.supplier_id);
    const data: any = {
      category_id: form.category_id || null, category_name: cat?.name || "Other", description: form.description.trim() || null, amount,
      tax_amount: Number(form.tax_amount) || 0, location_id: form.location_id || null, expense_date: form.expense_date, tenant_id: profile.tenant_id,
      supplier_id: form.supplier_id || null, vendor_name: form.vendor_name.trim() || sup?.name || null, payment_method: form.payment_method, paid_through: form.paid_through || null,
      reference: form.reference.trim() || null, notes: form.notes.trim() || null, customer_id: cust?.id || null, employee_id: form.employee_id || null,
      is_recurring: form.is_recurring, updated_at: new Date().toISOString(), tags: cleanTags(tags),
    };
    if (form.is_recurring) {
      const interval = parseInt(form.recurrence_interval) || 1;
      data.recurrence_interval = interval; data.recurrence_unit = form.recurrence_unit;
      const next = new Date(form.expense_date);
      if (form.recurrence_unit === "days") next.setDate(next.getDate() + interval);
      else if (form.recurrence_unit === "weeks") next.setDate(next.getDate() + interval * 7);
      else if (form.recurrence_unit === "months") next.setMonth(next.getMonth() + interval);
      else next.setFullYear(next.getFullYear() + interval);
      data.next_due_date = next.toISOString().split("T")[0];
    }
    setSaving(true);
    try {
      if (file) data.document_id = (await uploadDocument(profile.tenant_id, file, { entity_type: "expense", entity_id: editId, entity_name: `${data.category_name} · ${formatKES(amount)}`, category: "Expense receipt", uploaded_by_name: (profile as any)?.display_name })).id;
      if (editId) {
        const { tenant_id: _t, ...patch } = data;
        const { error } = await sb.from("expenses").update(patch).eq("id", editId);
        if (error) throw error;
        toast({ title: "Expense updated" });
      } else {
        const newId = crypto.randomUUID();
        const res = await offlineMutate({ table: "expenses", action: "insert", payload: { id: newId, ...data, created_by: user?.id, created_by_name: (profile as any)?.display_name || null } });
        if (!res.offline && approval.needs(amount)) { await submitForApproval("expense", newId, null, `${data.category_name}: ${data.description || "expense"}`, amount); toast({ title: "Expense sent for approval" }); }
        else toast({ title: res.offline ? "Expense saved offline. It will sync" : "Expense recorded" });
      }
      qc.invalidateQueries({ queryKey: ["expenses"] });
      setDirty(false); setShowForm(false);
    } catch (err: any) {
      toast({ title: "Could not save", description: err?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const removeOne = async (exp: any) => {
    if (!(await confirmAction({ title: "Delete this expense?", message: `${exp.category_name} · ${formatKES(Number(exp.amount))}. This removes it from your reports.`, danger: true, confirmLabel: "Delete" }))) return;
    const res = await offlineMutate({ table: "expenses", action: "delete", payload: { id: exp.id } });
    qc.invalidateQueries({ queryKey: ["expenses"] });
    toast({ title: res.offline ? "Expense deleted offline. It will sync" : "Expense deleted" });
    if (id) navigate("/purchases/expenses");
  };
  const removeMany = async () => {
    if (!(await confirmAction({ title: `Delete ${sel.count} expense${sel.count === 1 ? "" : "s"}?`, message: "They are removed from your reports.", danger: true, confirmLabel: "Delete" }))) return;
    const { error } = await sb.from("expenses").delete().in("id", sel.ids);
    if (error) return toast({ title: "Not deleted", description: error.message, variant: "destructive" });
    sel.clear(); qc.invalidateQueries({ queryKey: ["expenses"] }); toast({ title: "Deleted" });
  };
  const recategorise = async (catId: string) => {
    const cat = categories.find((c: any) => c.id === catId);
    if (!cat) return;
    const { error } = await sb.from("expenses").update({ category_id: cat.id, category_name: cat.name }).in("id", sel.ids);
    if (error) return toast({ title: "Not changed", description: error.message, variant: "destructive" });
    sel.clear(); qc.invalidateQueries({ queryKey: ["expenses"] }); toast({ title: `Moved to ${cat.name}` });
  };

  if (isLoading) return <PageLoader label="Loading expenses…" />;

  return (
    <div className="space-y-5">
      <PageHeader title="Expenses" description="Rent, salaries, supplies and other running costs, with receipts and how they were paid." icon={Wallet}
        children={<div className="flex justify-end"><ImportExport entity="expenses" rows={filtered.map((e: any) => ({ number: e.expense_number, date: e.expense_date, category: e.category_name, vendor: vendorOf(e), description: e.description, amount: e.amount, tax: e.tax_amount, method: methodLabel(e.payment_method), reference: e.reference, branch: locationName.get(e.location_id) || "", recurring: e.is_recurring ? "yes" : "no", approval: e.approval_status }))}
          spec={{ table: "expenses", columns: [{ key: "expense_date", label: "Date", type: "date", required: true }, { key: "category_name", label: "Category", required: true }, { key: "vendor_name", label: "Vendor" }, { key: "description", label: "Description" }, { key: "amount", label: "Amount", type: "number", required: true }, { key: "reference", label: "Reference" }], toRecord: (r) => ({ ...r, created_by: user?.id }) }} /></div>}
        actions={<>
          <input ref={invInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void fromInvoice(f); e.target.value = ""; }} />
          <Button onClick={() => setChoose(true)} disabled={reading}>{reading ? <OrbSpinner state="working" /> : <Plus />} {reading ? "Reading invoice…" : "Add expense"}</Button>
        </>} />

      {choose && (
        <Modal open onClose={() => setChoose(false)} title="Add expense" icon={Receipt} description="Upload the invoice or receipt and Garage AI fills everything in, or type it yourself.">
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" className="flex flex-col items-start gap-2 rounded-2xl border-2 border-primary bg-primary/5 p-4 text-left hover:bg-primary/10" onClick={() => { setChoose(false); invInput.current?.click(); }}>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="h-5 w-5" /></span>
              <span className="font-semibold">Upload invoice or receipt</span>
              <span className="text-xs text-muted-foreground">PDF or photo. The amount, VAT, date, vendor (added to Vendors if new), category and reference are filled in; you check and save.</span>
            </button>
            <button type="button" className="flex flex-col items-start gap-2 rounded-2xl border-2 border-border p-4 text-left hover:border-primary/50" onClick={() => { setChoose(false); openForm(); }}>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted"><Pencil className="h-5 w-5" /></span>
              <span className="font-semibold">Continue manually</span>
              <span className="text-xs text-muted-foreground">Type the expense details yourself.</span>
            </button>
          </div>
        </Modal>
      )}

      <StatGrid>
        <StatTile label="Shown total" value={formatKES(total)} icon={Wallet} tone="danger" />
        <StatTile label="This month" value={formatKES(thisMonth)} icon={CalendarDays} tone="warning" />
        <StatTile label="Biggest category" value={topCategory ? topCategory[0] : "—"} icon={Tags} tone="info" hint={topCategory ? formatKES(topCategory[1]) : undefined} />
        <StatTile label="Recurring" value={recurringCount} icon={Repeat} tone="muted" hint="Added automatically" />
      </StatGrid>

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search number, vendor, note, reference…" />
        {locations.length > 1 && (
          <select className="fi w-auto" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
            <option value="all">All branches</option>
            {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        <select className="fi w-auto" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
          <option value="all">All categories</option>
          {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="fi w-auto" value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} aria-label="Paid by"><option value="all">Any payment</option>{PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input type="date" className="fi w-auto" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <input type="date" className="fi w-auto" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <TagFilter module="expenses" view={tagView} onChange={setTagView} />
        {(from || to || categoryFilter !== "all" || methodFilter !== "all" || search || tagView.tag) && (
          <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); setCategoryFilter("all"); setMethodFilter("all"); setSearch(""); setTagView(NO_TAG_VIEW); }}>Clear</Button>
        )}
      </Toolbar>

      <Panel flush>
        {filtered.length === 0 ? (
          <EmptyState icon={Wallet} title={expenses.length ? "No expenses match these filters" : "No expenses yet"}
            description={expenses.length ? undefined : "Record your first expense to see true profit in reports."}
            action={!expenses.length && <Button onClick={openForm}><Plus /> Add expense</Button>} />
        ) : (<>
          <TagGroupSummary rows={filtered} view={tagView} amount={(e: any) => Number(e.amount)} />
          <BulkBar sel={sel} noun="expense">
            <Button size="sm" variant="outline" onClick={() => setRepeatFor({ ids: sel.ids, title: `${sel.count} expense${sel.count === 1 ? "" : "s"}` })}><Repeat /> Mark as recurring</Button>
            <Button size="sm" variant="outline" onClick={() => stopRecurring(sel.ids)}>Stop repeating</Button>
            <select className="fi h-8 w-52 text-sm" value="" onChange={(e) => e.target.value && recategorise(e.target.value)}><option value="">Change category…</option>{categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <Button size="sm" variant="outline" onClick={() => downloadCsv("expenses-selected.csv", ["Number", "Date", "Category", "Vendor", "Description", "Amount", "Tax", "Paid by", "Reference"], expenses.filter((e: any) => sel.has(e.id)).map((e: any) => [e.expense_number, e.expense_date, e.category_name, vendorOf(e), e.description, e.amount, e.tax_amount, methodLabel(e.payment_method), e.reference]))}><Download /> Export</Button>
            {canDelete && <Button size="sm" variant="outline" className="text-destructive" onClick={removeMany}><Trash2 /> Delete</Button>}
          </BulkBar>
          <TableWrap>
            <table className="dt">
              <thead><tr><th className="w-10"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} /></th><th>Date</th><th>Expense</th><th>Category</th><th className="hidden md:table-cell">Vendor</th><th className="hidden lg:table-cell">Paid by</th>{locations.length > 1 && <th className="hidden xl:table-cell">Branch</th>}<th className="num">Amount</th><th className="w-16" /></tr></thead>
              <tbody>
                {(paged.rows as any[]).map((exp) => (
                  <tr key={exp.id} className={cn("cursor-pointer", sel.has(exp.id) && "bg-primary/5")} onClick={() => navigate(`/purchases/expenses/${exp.id}`)}>
                    <td data-label=""><Tick on={sel.has(exp.id)} onChange={() => sel.toggle(exp.id)} /></td>
                    <td data-label="Date" className="whitespace-nowrap text-muted-foreground">{fmtDate(exp.expense_date)}</td>
                    <td data-label="Expense"><span className="font-semibold text-primary">{exp.expense_number || "—"}</span><span className="block max-w-[240px] truncate text-xs text-muted-foreground">{exp.description || "—"}</span></td>
                    <td data-label="Category"><span className="font-medium">{exp.category_name}</span>{exp.is_recurring && <Pill tone="info" className="ml-2">Every {exp.recurrence_interval} {exp.recurrence_unit}</Pill>}{exp.document_id && <Paperclip className="ml-1.5 inline h-3.5 w-3.5 text-muted-foreground" />}</td>
                    <td data-label="Vendor" className="hidden md:table-cell">{vendorOf(exp) || "—"}</td>
                    <td data-label="Paid by" className="hidden lg:table-cell">{methodLabel(exp.payment_method)}</td>
                    {locations.length > 1 && <td data-label="Branch" className="hidden text-muted-foreground xl:table-cell">{locationName.get(exp.location_id) || "—"}</td>}
                    <td data-label="Amount" className="num font-semibold text-destructive">{formatKES(Number(exp.amount))}{exp.approval_status === "pending" && <Pill tone="warning" className="ml-1">Pending</Pill>}{exp.approval_status === "rejected" && <Pill tone="danger" className="ml-1">Rejected</Pill>}</td>
                    <td onClick={(e) => e.stopPropagation()}><span className="flex justify-end gap-1">
                      <button className="icon-btn" title="Edit" onClick={() => openEdit(exp)}><Pencil className="h-4 w-4" /></button>
                      {canDelete && <button className="icon-btn-danger" title="Delete" onClick={() => removeOne(exp)}><Trash2 className="h-4 w-4" /></button>}
                    </span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <Pager {...paged.pager} />
        </>)}
      </Panel>

      {open && (
        <Modal open onClose={() => navigate("/purchases/expenses")} title={open.expense_number || "Expense"} icon={Receipt} size="lg" description={`${open.category_name} · ${fmtDate(open.expense_date)}`}
          footer={<div className="flex w-full flex-wrap gap-2">
            <Button onClick={() => openEdit(open)}><Pencil /> Edit</Button>
            <Button variant="outline" onClick={() => openEdit(open, true)}><Copy /> Duplicate</Button>
            {open.is_recurring
              ? <><Button variant="outline" onClick={() => setRepeatFor({ ids: [open.id], title: open.expense_number || "this expense", from: open.next_due_date || open.expense_date, every: open.recurrence_interval, unit: open.recurrence_unit })}><Repeat /> Change schedule</Button><Button variant="ghost" onClick={() => stopRecurring([open.id])}>Stop repeating</Button></>
              : <Button variant="outline" onClick={() => setRepeatFor({ ids: [open.id], title: open.expense_number || "this expense", from: open.expense_date })}><Repeat /> Mark as recurring</Button>}
            {open.document_id && <Button variant="outline" onClick={async () => { const { data } = await sb.from("documents").select("path,url,name,mime_type").eq("id", open.document_id).maybeSingle(); if (data) void openDocument(data); }}><Eye /> Receipt</Button>}
            {canDelete && <Button variant="ghost" className="ml-auto text-destructive" onClick={() => removeOne(open)}><Trash2 /> Delete</Button>}
          </div>}>
          <div className="space-y-5">
            <div className="rounded-2xl bg-gradient-to-br from-destructive/10 to-transparent p-5">
              <p className="text-sm text-muted-foreground">Amount</p>
              <p className="font-display text-3xl font-bold text-destructive">{formatKES(Number(open.amount))}</p>
              {Number(open.tax_amount) > 0 && <p className="text-sm text-muted-foreground">includes {formatKES(Number(open.tax_amount))} tax</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {open.approval_status && open.approval_status !== "not_required" && <Pill tone={open.approval_status === "approved" ? "success" : open.approval_status === "rejected" ? "danger" : "warning"}>{open.approval_status}</Pill>}
                {open.is_recurring && <Pill tone="info"><Repeat className="h-3 w-3" /> Every {open.recurrence_interval} {open.recurrence_unit}{open.next_due_date ? ` · next ${fmtDate(open.next_due_date)}` : ""}</Pill>}
                <TagChips values={open.tags} />
              </div>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {([
                [Tags, "Category", open.category_name],
                [Building2, "Vendor / paid to", vendorOf(open) || "—"],
                [CreditCard, "Payment method", methodLabel(open.payment_method)],
                [Wallet, "Paid through", open.paid_through || "—"],
                [Hash, "Reference", open.reference || "—"],
                [MapPin, "Branch", locationName.get(open.location_id) || "—"],
                [User, "Billable to customer", open.customers?.name || "—"],
                [User, "Employee", open.hr_employees ? `${open.hr_employees.first_name} ${open.hr_employees.last_name}` : "—"],
                [CalendarDays, "Recorded", `${fmtDate(open.created_at)}${open.created_by_name ? ` by ${open.created_by_name}` : ""}`],
              ] as const).map(([I, k, v]) => (
                <div key={k} className="flex items-start gap-3"><I className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div></div>
              ))}
            </dl>
            {open.description && <div><p className="text-xs text-muted-foreground">Description</p><p className="mt-1 rounded-xl bg-muted/50 p-3 text-sm">{open.description}</p></div>}
            {open.notes && <div><p className="text-xs text-muted-foreground">Internal notes</p><p className="mt-1 rounded-xl bg-muted/50 p-3 text-sm">{open.notes}</p></div>}
            {!open.document_id && <p className="flex items-center gap-2 rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground"><Paperclip className="h-4 w-4" /> No receipt attached. Edit the expense to attach one.</p>}
          </div>
        </Modal>
      )}

      {repeatFor && <RepeatSheet target={repeatFor} nextAfter={nextAfter} onClose={() => setRepeatFor(null)} onSave={makeRecurring} />}
      <Modal open={showForm} onClose={() => setShowForm(false)} locked={saving} icon={Wallet} title={editId ? "Edit expense" : "Add expense"} size="lg"
        footer={<>
          <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
          <Button type="submit" form="expense-form" disabled={saving}><Save /> {saving ? "Saving…" : "Save expense"}</Button>
        </>}>
        <form id="expense-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label={`Amount (${currencyCode()})`} required>
            <input type="number" step="0.01" min="0" inputMode="decimal" className="fi text-base font-semibold" autoFocus required value={form.amount} onChange={(e) => set("amount", e.target.value)} />
          </Field>
          <Field label="Date" required><input type="date" className="fi" value={form.expense_date} max={today()} onChange={(e) => set("expense_date", e.target.value)} /></Field>
          <Field label="Category" required>
            <select className="fi" required value={form.category_id} onChange={(e) => set("category_id", e.target.value)}>
              <option value="">Choose…</option>{categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Tax included (optional)"><input type="number" step="0.01" min="0" className="fi" value={form.tax_amount} onChange={(e) => set("tax_amount", e.target.value)} placeholder="e.g. VAT on the receipt" /></Field>
          <Field label="Vendor (supplier)">
            <select className="fi" value={form.supplier_id} onChange={(e) => set("supplier_id", e.target.value)}><option value="">Not a saved supplier</option>{suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </Field>
          <Field label="Or paid to"><input className="fi" value={form.vendor_name} onChange={(e) => set("vendor_name", e.target.value)} placeholder="e.g. KPLC, landlord, fundi" /></Field>
          <Field label="Payment method"><select className="fi" value={form.payment_method} onChange={(e) => set("payment_method", e.target.value)}>{PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Paid through"><select className="fi" value={form.paid_through} onChange={(e) => set("paid_through", e.target.value)}>{[...new Set([...PAID_THROUGH, ...moneyAccounts.map((m) => m.name), ...(form.paid_through ? [form.paid_through] : [])])].map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Reference" hint="M-Pesa code, cheque or receipt number"><input className="fi" value={form.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
          <Field label="Branch">
            <select className="fi" value={form.location_id} onChange={(e) => set("location_id", e.target.value)}><option value="">No branch</option>{locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </Field>
          <Field label="Description" className="sm:col-span-2"><input className="fi" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What was it for?" /></Field>
          <Field label="Billable to a customer (optional)"><CustomerPicker value={cust} onChange={(c) => { setDirty(true); setCust(c); }} /></Field>
          <Field label="Employee (optional)" hint="e.g. a staff claim or allowance"><select className="fi" value={form.employee_id} onChange={(e) => set("employee_id", e.target.value)}><option value="">—</option>{(employees as any[]).map((x) => <option key={x.id} value={x.id}>{x.first_name} {x.last_name}</option>)}</select></Field>
          <TagPickers module="expenses" values={tags} onChange={(t) => { setDirty(true); setTags(t); }} className="grid gap-4 sm:col-span-2 sm:grid-cols-2" />
          <Field label="Internal notes" className="sm:col-span-2"><textarea className="fi min-h-[60px]" value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-border p-3 text-sm text-muted-foreground hover:border-primary sm:col-span-2">
            <Paperclip className="h-5 w-5" /><span className="flex-1 truncate">{file ? file.name : "Attach the receipt or invoice (photo or PDF, kept in Documents)"}</span>
            <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] || null); setDirty(true); }} />
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm sm:col-span-2">
            <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={form.is_recurring} onChange={(e) => set("is_recurring", e.target.checked)} />
            <span><span className="font-medium">Mark as recurring</span><span className="block text-xs text-muted-foreground">Add it again automatically, e.g. rent every month.</span></span>
          </label>
          {form.is_recurring && (
            <div className="flex items-end gap-2 sm:col-span-2">
              <Field label="Every" className="w-24"><input type="number" min="1" className="fi" value={form.recurrence_interval} onChange={(e) => set("recurrence_interval", e.target.value)} /></Field>
              <select className="fi flex-1" value={form.recurrence_unit} onChange={(e) => set("recurrence_unit", e.target.value)} aria-label="Unit">
                <option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option><option value="years">Years</option>
              </select>
            </div>
          )}
        </form>
      </Modal>
    </div>
  );
}

/** Schedule for one or many expenses: every N days/weeks/months/years from a start date. */
function RepeatSheet({ target, nextAfter, onClose, onSave }: { target: { ids: string[]; title: string; from?: string; every?: number; unit?: string }; nextAfter: (from: string, every: number, unit: string) => string; onClose: () => void; onSave: (ids: string[], every: number, unit: string, next: string) => void }) {
  const [every, setEvery] = useState(String(target.every || 1));
  const [unit, setUnit] = useState(target.unit || "months");
  const base = target.from || today();
  const [next, setNext] = useState(() => nextAfter(base, target.every || 1, target.unit || "months"));
  const change = (e: string, u: string) => { setEvery(e); setUnit(u); setNext(nextAfter(base, Math.max(1, Number(e) || 1), u)); };
  return (
    <Modal open onClose={onClose} title="Mark as recurring" icon={Repeat} description={target.title}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => onSave(target.ids, Math.max(1, Number(every) || 1), unit, next)}><Repeat /> Save schedule</Button></>}>
      <div className="space-y-3">
        <div className="flex items-end gap-2">
          <Field label="Every" className="w-24"><input type="number" min={1} className="fi" value={every} onChange={(e) => change(e.target.value, unit)} /></Field>
          <select className="fi flex-1" value={unit} onChange={(e) => change(every, e.target.value)} aria-label="Unit"><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option><option value="years">Years</option></select>
        </div>
        <Field label="Next one is added on" hint="A copy with the same amount, category and vendor is recorded automatically on this date, then again every period."><input type="date" className="fi" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
