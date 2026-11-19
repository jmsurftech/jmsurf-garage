/** System → Workflow rules: no-code automations (when this happens, do that) with a run log per rule. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Workflow, Plus, Pencil, Trash2, History, Mail, MessageSquare, Bell, PenLine, Webhook, X, Copy, ListChecks, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { Panel, Pill, EmptyState, Modal, Field, PageLoader } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/books/confirm";
import { friendlyError } from "@/lib/friendlyError";
import { cn } from "@/lib/utils";

const sb: any = supabase;
const MAX_RULES = 50;

type FieldDef = { key: string; label: string; options?: string[] };
type ModuleDef = { label: string; fields: FieldDef[]; dates: FieldDef[]; update: FieldDef[]; placeholders: string[]; customer: string };

/** What each module offers. Field updates match the safe list in the database (wf_update_fields). */
export const WF_MODULES: Record<string, ModuleDef> = {
  invoices: {
    label: "Invoices", customer: "Customer",
    fields: [{ key: "status", label: "Status", options: ["draft", "sent", "partially_paid", "paid", "overdue", "void"] }, { key: "total", label: "Total" }, { key: "balance", label: "Balance due" }, { key: "customer_name", label: "Customer name" }, { key: "salesperson_name", label: "Salesperson" }, { key: "payment_terms", label: "Payment terms" }, { key: "reference", label: "Order number" }, { key: "due_date", label: "Due date" }, { key: "issue_date", label: "Invoice date" }],
    dates: [{ key: "due_date", label: "Due date" }, { key: "issue_date", label: "Invoice date" }],
    update: [{ key: "reference", label: "Order number" }, { key: "subject", label: "Description" }, { key: "terms", label: "Terms & conditions" }, { key: "allow_online_payment", label: "Online payment (true / false)" }],
    placeholders: ["invoice_number", "customer_name", "total", "balance", "due_date", "status", "salesperson_name"],
  },
  quotes: {
    label: "Quotes", customer: "Customer",
    fields: [{ key: "status", label: "Status", options: ["draft", "sent", "accepted", "declined", "expired", "invoiced"] }, { key: "total", label: "Total" }, { key: "customer_name", label: "Customer name" }, { key: "salesperson_name", label: "Salesperson" }, { key: "valid_until", label: "Expiry date" }, { key: "reference", label: "Reference" }],
    dates: [{ key: "valid_until", label: "Expiry date" }, { key: "issue_date", label: "Quote date" }],
    update: [{ key: "reference", label: "Reference" }, { key: "subject", label: "Description" }],
    placeholders: ["quote_number", "customer_name", "total", "valid_until", "status", "salesperson_name"],
  },
  sales_orders: {
    label: "Sales orders", customer: "Customer",
    fields: [{ key: "status", label: "Status", options: ["draft", "sent", "accepted", "invoiced", "declined"] }, { key: "total", label: "Total" }, { key: "customer_name", label: "Customer name" }, { key: "salesperson_name", label: "Salesperson" }, { key: "delivery_method", label: "Delivery method" }, { key: "expected_shipment_date", label: "Expected shipment date" }],
    dates: [{ key: "expected_shipment_date", label: "Expected shipment date" }, { key: "issue_date", label: "Order date" }],
    update: [{ key: "reference", label: "Reference" }, { key: "delivery_method", label: "Delivery method" }, { key: "expected_shipment_date", label: "Expected shipment date (YYYY-MM-DD)" }],
    placeholders: ["number", "customer_name", "total", "expected_shipment_date", "status"],
  },
  bills: {
    label: "Bills", customer: "Vendor",
    fields: [{ key: "status", label: "Status", options: ["draft", "pending", "partially_paid", "paid", "void"] }, { key: "amount", label: "Total" }, { key: "balance", label: "Balance due" }, { key: "category", label: "Category" }, { key: "supplier_name", label: "Vendor" }, { key: "due_date", label: "Due date" }],
    dates: [{ key: "due_date", label: "Due date" }, { key: "bill_date", label: "Bill date" }, { key: "expected_payment_date", label: "Expected payment date" }],
    update: [{ key: "reference", label: "Bill#" }, { key: "subject", label: "Description" }, { key: "notes", label: "Notes" }, { key: "expected_payment_date", label: "Expected payment date (YYYY-MM-DD)" }],
    placeholders: ["bill_number", "supplier_name", "amount", "balance", "due_date", "status"],
  },
  customers: {
    label: "Customers", customer: "The customer",
    fields: [{ key: "name", label: "Name" }, { key: "customer_type", label: "Type" }, { key: "balance", label: "Balance" }, { key: "credit_limit", label: "Credit limit" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }],
    dates: [{ key: "created_at", label: "Date added" }],
    update: [{ key: "notes", label: "Notes" }, { key: "reminders_stopped", label: "Stop reminders (true / false)" }, { key: "credit_limit", label: "Credit limit" }, { key: "credit_days", label: "Credit days" }],
    placeholders: ["customer_name", "phone", "email", "balance"],
  },
  items: {
    label: "Items", customer: "",
    fields: [{ key: "name", label: "Name" }, { key: "category", label: "Category" }, { key: "stock", label: "Stock" }, { key: "reorder_level", label: "Reorder level" }, { key: "price", label: "Price" }, { key: "is_active", label: "Active", options: ["true", "false"] }],
    dates: [],
    update: [{ key: "reorder_level", label: "Reorder level" }, { key: "is_active", label: "Active (true / false)" }, { key: "category", label: "Category" }],
    placeholders: ["name", "sku", "stock", "reorder_level", "price"],
  },
  leads: {
    label: "CRM leads", customer: "The lead",
    fields: [{ key: "lead_status", label: "Lead status", options: ["New", "Contacted", "Follow up later", "Qualified", "Not qualified", "Junk", "Lost", "Converted"] }, { key: "source", label: "Lead source" }, { key: "rating", label: "Rating", options: ["Hot", "Warm", "Cold"] }, { key: "industry", label: "Industry" }, { key: "expected_revenue", label: "Expected deal value" }, { key: "city", label: "City" }, { key: "salesperson_id", label: "Lead owner (id)" }],
    dates: [{ key: "created_at", label: "Date created" }],
    update: [{ key: "lead_status", label: "Lead status" }, { key: "rating", label: "Rating (Hot / Warm / Cold)" }, { key: "description", label: "Description" }],
    placeholders: ["name", "customer_name", "email", "phone", "source", "lead_status"],
  },
  deals: {
    label: "CRM deals", customer: "The account",
    fields: [{ key: "stage", label: "Stage", options: ["qualification", "needs_analysis", "value_proposition", "decision_makers", "proposal", "negotiation", "won", "lost"] }, { key: "amount", label: "Amount" }, { key: "probability", label: "Probability %" }, { key: "deal_type", label: "Type" }, { key: "source", label: "Lead source" }, { key: "account_name", label: "Account" }, { key: "closing_date", label: "Closing date" }],
    dates: [{ key: "closing_date", label: "Closing date" }, { key: "created_at", label: "Date created" }],
    update: [{ key: "stage", label: "Stage" }, { key: "probability", label: "Probability %" }, { key: "next_step", label: "Next step" }, { key: "closing_date", label: "Closing date (YYYY-MM-DD)" }, { key: "deal_type", label: "Type" }, { key: "description", label: "Description" }],
    placeholders: ["name", "customer_name", "amount", "stage", "closing_date", "deal_number"],
  },
  contacts: {
    label: "CRM contacts", customer: "The contact",
    fields: [{ key: "title", label: "Job title" }, { key: "lead_source", label: "Lead source" }, { key: "email", label: "Email" }, { key: "mailing_city", label: "City" }, { key: "email_opt_out", label: "No marketing email", options: ["true", "false"] }],
    dates: [{ key: "date_of_birth", label: "Birthday" }, { key: "created_at", label: "Date added" }],
    update: [{ key: "lead_source", label: "Lead source" }, { key: "description", label: "Description" }, { key: "email_opt_out", label: "No marketing email (true / false)" }],
    placeholders: ["name", "first_name", "email", "phone", "title"],
  },
  expenses: {
    label: "Expenses", customer: "Vendor",
    fields: [{ key: "category_name", label: "Category" }, { key: "amount", label: "Amount" }, { key: "payment_method", label: "Payment method" }, { key: "approval_status", label: "Approval", options: ["pending", "approved", "rejected"] }, { key: "vendor_name", label: "Paid to" }, { key: "expense_date", label: "Date" }],
    dates: [{ key: "expense_date", label: "Expense date" }, { key: "next_due_date", label: "Next repeat date" }],
    update: [{ key: "reference", label: "Reference" }, { key: "description", label: "Description" }, { key: "notes", label: "Internal notes" }],
    placeholders: ["expense_number", "category_name", "amount", "vendor_name", "expense_date"],
  },
  payments: {
    label: "Payments received", customer: "Customer",
    fields: [{ key: "amount", label: "Amount" }, { key: "method", label: "Method" }, { key: "customer_name", label: "Customer name" }, { key: "reference", label: "Reference" }, { key: "payment_date", label: "Payment date" }],
    dates: [{ key: "payment_date", label: "Payment date" }],
    update: [{ key: "reference", label: "Reference" }, { key: "notes", label: "Notes" }],
    placeholders: ["payment_number", "customer_name", "amount", "method", "reference", "payment_date"],
  },
};
const COMMON_PLACEHOLDERS = ["number", "customer_name", "total", "balance", "due_date", "company_name", "link", "today"];
const ROLES: [string, string][] = [["admin", "Owners & admins"], ["manager", "Managers"], ["finance", "Finance"], ["customer_service", "Customer service"], ["sales_person", "Salespeople"], ["cashier", "Cashiers"], ["stock_manager", "Stock managers"]];
const OPS: [string, string][] = [["eq", "is"], ["neq", "is not"], ["contains", "contains"], ["gt", "is more than"], ["lt", "is less than"], ["empty", "is empty"], ["not_empty", "is not empty"]];
const TRIGGERS: [string, string][] = [["created", "A record is created"], ["updated", "A record is changed"], ["field_changed", "A field changes"], ["date", "A date comes (checked daily)"]];

type Condition = { field: string; op: string; value: string };
type Action = { type: "email" | "sms" | "notify" | "update" | "webhook" | "task" | "assign"; kind?: string; days?: number; priority?: string; user?: string; users?: string[]; to?: string; role?: string; fixed?: string; subject?: string; body?: string; text?: string; title?: string; field?: string; value?: string; webhook_id?: string };
type Rule = {
  id?: string; name: string; module: string; trigger_type: string; trigger_field: string | null; trigger_value: string | null;
  date_field: string | null; date_offset: number; conditions: Condition[]; actions: Action[]; is_active: boolean;
  run_count?: number; last_run_at?: string | null; last_status?: string | null;
};
const ACTION_LABEL: Record<Action["type"], [string, typeof Mail]> = { email: ["Send email", Mail], sms: ["Send SMS", MessageSquare], notify: ["Bell notification", Bell], update: ["Change a field", PenLine], task: ["Create a follow-up", ListChecks], assign: ["Assign in turn", UsersRound], webhook: ["Call a webhook", Webhook] };
/** Modules whose records have an owner a rule can assign. */
const ASSIGNABLE = new Set(["leads", "deals", "contacts", "customers"]);
const blankAction = (type: Action["type"]): Action =>
  type === "email" ? { type, to: "customer", subject: "{{number}} from {{company_name}}", body: "Hello {{customer_name}},\n\n" }
    : type === "sms" ? { type, to: "customer", text: "Hi {{customer_name}}, " }
      : type === "notify" ? { type, to: "owner", title: "{{number}}: ", body: "" }
        : type === "update" ? { type, field: "", value: "" }
          : type === "task" ? { type, kind: "task", title: "Follow up: {{number}}", body: "", days: 1, priority: "normal", to: "owner" }
            : type === "assign" ? { type, users: [] } : { type, webhook_id: "" };
const blankRule = (): Rule => ({ name: "", module: "invoices", trigger_type: "created", trigger_field: null, trigger_value: null, date_field: null, date_offset: 0, conditions: [], actions: [blankAction("email")], is_active: true });
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");
const fieldLabel = (m: string, k: string | null) => [...(WF_MODULES[m]?.fields || []), ...(WF_MODULES[m]?.dates || [])].find((f) => f.key === k)?.label || k || "";

function summary(r: Rule) {
  const m = WF_MODULES[r.module]?.label || r.module;
  if (r.trigger_type === "created") return `${m}: when one is created`;
  if (r.trigger_type === "updated") return `${m}: when one is changed`;
  if (r.trigger_type === "field_changed") return `${m}: when ${fieldLabel(r.module, r.trigger_field)} changes${r.trigger_value ? ` to ${r.trigger_value}` : ""}`;
  const n = Math.abs(r.date_offset);
  return `${m}: ${n ? `${n} day${n === 1 ? "" : "s"} ${r.date_offset < 0 ? "before" : "after"}` : "on"} the ${fieldLabel(r.module, r.date_field).toLowerCase()}`;
}

export default function WorkflowRules({ canManage }: { canManage: boolean }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Rule | null>(null);
  const [log, setLog] = useState<Rule | null>(null);
  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["workflow-rules", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("workflow_rules").select("*").eq("tenant_id", tenantId).order("created_at")).data || []) as Rule[],
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["workflow-rules"] });
  const toggle = async (r: Rule) => {
    const { error } = await sb.from("workflow_rules").update({ is_active: !r.is_active, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (error) return toast.error(friendlyError(error));
    void refresh();
  };
  const remove = async (r: Rule) => {
    if (!(await confirmAction({ title: `Delete ${r.name}?`, message: "The rule and its run log are removed.", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await sb.from("workflow_rules").delete().eq("id", r.id);
    if (error) return toast.error(friendlyError(error));
    void refresh();
  };

  if (isLoading) return <PageLoader />;
  const full = rules.length >= MAX_RULES;
  return (
    <div className="space-y-5">
      <Panel title={`Workflow rules (${rules.length} of ${MAX_RULES})`} icon={Workflow} flush
        description="When something happens to an invoice, quote, order, bill, customer, item, lead, expense or payment, send an email or SMS, ring the bell, change a field or call a webhook. Date rules (e.g. 3 days after the due date) are checked every morning."
        actions={canManage && <Button size="sm" disabled={full} title={full ? "Up to 50 rules" : undefined} onClick={() => setEdit(blankRule())}><Plus /> New rule</Button>}>
        {!rules.length ? (
          <EmptyState icon={Workflow} title="No workflow rules yet" description="For example: 3 days after an invoice's due date, SMS the customer the balance." action={canManage && <Button onClick={() => setEdit(blankRule())}><Plus /> New rule</Button>} />
        ) : (
          <div className="divide-y divide-border">
            {rules.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{summary(r)}{r.conditions?.length ? ` · ${r.conditions.length} condition${r.conditions.length === 1 ? "" : "s"}` : ""}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(r.actions || []).map((a, i) => <Pill key={i} tone="info">{ACTION_LABEL[a.type]?.[0] || a.type}</Pill>)}
                    {r.last_run_at && <span className="text-[11px] text-muted-foreground">Ran {r.run_count} time{r.run_count === 1 ? "" : "s"}, last {when(r.last_run_at)}</span>}
                    {r.last_status && r.last_status !== "ok" && <Pill tone={r.last_status === "failed" ? "danger" : "warning"}>{r.last_status}</Pill>}
                  </div>
                </div>
                <button type="button" disabled={!canManage} onClick={() => void toggle(r)} className={cn("rounded-full px-3 py-1 text-xs font-semibold", r.is_active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{r.is_active ? "On" : "Off"}</button>
                <button className="icon-btn" title="Run log" onClick={() => setLog(r)}><History className="h-4 w-4" /></button>
                {canManage && <>
                  <button className="icon-btn" title="Copy" disabled={full} onClick={() => setEdit({ ...r, id: undefined, name: `${r.name} (copy)`, is_active: false })}><Copy className="h-4 w-4" /></button>
                  <button className="icon-btn" title="Edit" onClick={() => setEdit({ ...r, conditions: r.conditions || [], actions: r.actions || [] })}><Pencil className="h-4 w-4" /></button>
                  <button className="icon-btn-danger" title="Delete" onClick={() => void remove(r)}><Trash2 className="h-4 w-4" /></button>
                </>}
              </div>
            ))}
          </div>
        )}
      </Panel>
      {edit && <RuleEditor rule={edit} tenantId={tenantId} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void refresh(); }} />}
      {log && <RunLog rule={log} onClose={() => setLog(null)} />}
    </div>
  );
}

function RuleEditor({ rule, tenantId, onClose, onSaved }: { rule: Rule; tenantId: string | null | undefined; onClose: () => void; onSaved: () => void }) {
  const [r, setR] = useState<Rule>(rule);
  const [busy, setBusy] = useState(false);
  const mod = WF_MODULES[r.module];
  const { data: staff = [] } = useQuery({
    queryKey: ["wf-staff", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("profiles").select("user_id,display_name,status").eq("tenant_id", tenantId).order("display_name")).data || []).filter((p: any) => p.status !== "inactive") as { user_id: string; display_name: string }[],
  });
  const { data: hooks = [] } = useQuery({
    queryKey: ["dev-hooks", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("erp_webhooks").select("id,url,is_active").eq("tenant_id", tenantId).order("created_at")).data || []) as any[],
  });
  const set = (p: Partial<Rule>) => setR((x) => ({ ...x, ...p }));
  const setAction = (i: number, p: Partial<Action>) => set({ actions: r.actions.map((a, j) => (j === i ? { ...a, ...p } : a)) });
  const setCond = (i: number, p: Partial<Condition>) => set({ conditions: r.conditions.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const placeholders = [...new Set([...mod.placeholders, ...COMMON_PLACEHOLDERS])];
  const daysAbs = Math.abs(r.date_offset);
  const dir = r.date_offset < 0 ? "before" : "after";

  const save = async () => {
    if (!r.name.trim()) return toast.error("Give the rule a name");
    if (r.trigger_type === "field_changed" && !r.trigger_field) return toast.error("Choose the field to watch");
    if (r.trigger_type === "date" && !r.date_field) return toast.error("Choose the date");
    if (!r.actions.length) return toast.error("Add at least one action");
    for (const a of r.actions) {
      const label = ACTION_LABEL[a.type][0];
      if ((a.type === "email" || a.type === "sms") && a.to === "fixed" && !String(a.fixed || "").trim()) return toast.error(`${label}: enter the addresses or numbers`);
      if ((a.type === "email" || a.type === "sms" || a.type === "notify") && a.to === "role" && !a.role) return toast.error(`${label}: choose the role`);
      if (a.type === "email" && !String(a.body || "").trim()) return toast.error("Send email: write the message");
      if (a.type === "sms" && !String(a.text || "").trim()) return toast.error("Send SMS: write the message");
      if (a.type === "update" && !a.field) return toast.error("Change a field: choose the field");
      if (a.type === "update" && r.trigger_type === "field_changed" && a.field === r.trigger_field) return toast.error("A rule cannot change the field it watches");
      if (a.type === "webhook" && !a.webhook_id) return toast.error("Call a webhook: choose one (add it under API & webhooks)");
      if (a.type === "assign" && !ASSIGNABLE.has(r.module)) return toast.error("Assign in turn works on leads, deals, contacts and customers");
      if (a.type === "assign" && !(a.users || []).length) return toast.error("Assign in turn: choose at least one person");
      if (a.type === "task" && !String(a.title || "").trim()) return toast.error("Create a follow-up: give it a subject");
    }
    const row = {
      name: r.name.trim().slice(0, 120), module: r.module, trigger_type: r.trigger_type,
      trigger_field: r.trigger_type === "field_changed" ? r.trigger_field : null, trigger_value: r.trigger_type === "field_changed" ? (r.trigger_value || "").trim() || null : null,
      date_field: r.trigger_type === "date" ? r.date_field : null, date_offset: r.trigger_type === "date" ? Math.max(-365, Math.min(365, Math.round(r.date_offset) || 0)) : 0,
      conditions: r.conditions.filter((c) => c.field), actions: r.actions, is_active: r.is_active, updated_at: new Date().toISOString(),
    };
    setBusy(true);
    const { error } = r.id ? await sb.from("workflow_rules").update(row).eq("id", r.id) : await sb.from("workflow_rules").insert({ ...row, tenant_id: tenantId });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success("Rule saved"); onSaved();
  };

  const addAction = (t: Action["type"]) => { const a = blankAction(t); if (a.to === "customer" && !mod.customer) a.to = "owner"; set({ actions: [...r.actions, a] }); };
  // A plain function (not a component) so the inputs keep focus while typing.
  const who = (a: Action, i: number, staffOnly?: boolean) => (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label="To">
        <select className="fi" value={a.to || ""} onChange={(e) => setAction(i, { to: e.target.value })}>
          {!staffOnly && mod.customer && <option value="customer">{mod.customer}</option>}
          <option value="owner">Salesperson or owner of the record</option>
          <option value="role">Everyone in a role</option>
          {!staffOnly && <option value="fixed">{a.type === "sms" ? "These numbers" : "These addresses"}</option>}
        </select>
      </Field>
      {a.to === "role" && <Field label="Role"><select className="fi" value={a.role || ""} onChange={(e) => setAction(i, { role: e.target.value })}><option value="">Choose</option>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>}
      {a.to === "fixed" && <Field label={a.type === "sms" ? "Phone numbers" : "Email addresses"} hint="Separate with commas (up to 10)"><input className="fi" value={a.fixed || ""} onChange={(e) => setAction(i, { fixed: e.target.value })} /></Field>}
    </div>
  );

  return (
    <Modal open onClose={onClose} locked={busy} size="2xl" icon={Workflow} title={r.id ? "Edit rule" : "New rule"}
      footer={<>
        <label className="mr-auto flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={r.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> On</label>
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={() => void save()} disabled={busy}>Save rule</Button>
      </>}>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rule name" required><input className="fi" value={r.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Overdue invoice SMS" /></Field>
          <Field label="Module">
            <select className="fi" value={r.module} onChange={(e) => set({ module: e.target.value, trigger_field: null, trigger_value: null, date_field: null, trigger_type: r.trigger_type === "date" && !WF_MODULES[e.target.value].dates.length ? "created" : r.trigger_type, conditions: [], actions: r.actions.map((a) => (a.type === "update" ? { ...a, field: "" } : a.to === "customer" && !WF_MODULES[e.target.value].customer ? { ...a, to: "owner" } : a)) })}>
              {Object.entries(WF_MODULES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </Field>
        </div>

        <section className="space-y-3 rounded-2xl border border-border p-4">
          <p className="text-sm font-semibold">When</p>
          <select className="fi" value={r.trigger_type} onChange={(e) => set({ trigger_type: e.target.value })}>
            {TRIGGERS.filter(([v]) => v !== "date" || mod.dates.length).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {r.trigger_type === "field_changed" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Field"><select className="fi" value={r.trigger_field || ""} onChange={(e) => set({ trigger_field: e.target.value || null, trigger_value: null })}><option value="">Choose</option>{mod.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></Field>
              <Field label="Changes to" hint="Leave empty for any change">
                {mod.fields.find((f) => f.key === r.trigger_field)?.options
                  ? <select className="fi" value={r.trigger_value || ""} onChange={(e) => set({ trigger_value: e.target.value || null })}><option value="">Any value</option>{mod.fields.find((f) => f.key === r.trigger_field)!.options!.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}</select>
                  : <input className="fi" value={r.trigger_value || ""} onChange={(e) => set({ trigger_value: e.target.value })} />}
              </Field>
            </div>
          )}
          {r.trigger_type === "date" && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Days" className="w-24"><input type="number" min={0} max={365} className="fi" value={daysAbs} onChange={(e) => set({ date_offset: (dir === "before" ? -1 : 1) * Math.min(365, Math.max(0, Number(e.target.value) || 0)) })} /></Field>
              <select className="fi w-32" value={dir} onChange={(e) => set({ date_offset: (e.target.value === "before" ? -1 : 1) * daysAbs })} aria-label="Before or after"><option value="before">before</option><option value="after">after</option></select>
              <Field label="the date" className="min-w-[12rem] flex-1"><select className="fi" value={r.date_field || ""} onChange={(e) => set({ date_field: e.target.value || null })}><option value="">Choose</option>{mod.dates.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></Field>
              <p className="w-full text-xs text-muted-foreground">Checked every morning from 07:00. Each record runs once for each date. Use 0 days for "on the day".</p>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-border p-4">
          <div className="flex items-center gap-2"><p className="flex-1 text-sm font-semibold">Only if (all must match)</p><Button size="sm" variant="outline" disabled={r.conditions.length >= 10} onClick={() => set({ conditions: [...r.conditions, { field: mod.fields[0]?.key || "", op: "eq", value: "" }] })}><Plus /> Condition</Button></div>
          {!r.conditions.length && <p className="text-xs text-muted-foreground">No conditions: every matching record.</p>}
          {r.conditions.map((c, i) => {
            const f = mod.fields.find((x) => x.key === c.field);
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select className="fi h-9 w-auto min-w-[10rem]" value={c.field} onChange={(e) => setCond(i, { field: e.target.value, value: "" })} aria-label="Field">{mod.fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
                <select className="fi h-9 w-auto" value={c.op} onChange={(e) => setCond(i, { op: e.target.value })} aria-label="Comparison">{OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                {!["empty", "not_empty"].includes(c.op) && (f?.options
                  ? <select className="fi h-9 w-auto min-w-[8rem]" value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} aria-label="Value"><option value="">Choose</option>{f.options.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}</select>
                  : <input className="fi h-9 w-40" value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} aria-label="Value" />)}
                <button className="icon-btn-danger" title="Remove" onClick={() => set({ conditions: r.conditions.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></button>
              </div>
            );
          })}
        </section>

        <section className="space-y-3 rounded-2xl border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 text-sm font-semibold">Then</p>
            {(Object.keys(ACTION_LABEL) as Action["type"][]).map((t) => { const [l, I] = ACTION_LABEL[t]; return <Button key={t} size="sm" variant="outline" disabled={r.actions.length >= 10} onClick={() => addAction(t)}><I /> {l}</Button>; })}
          </div>
          {r.actions.map((a, i) => {
            const [label, I] = ACTION_LABEL[a.type];
            return (
              <div key={i} className="space-y-3 rounded-xl bg-muted/40 p-3">
                <div className="flex items-center gap-2"><I className="h-4 w-4 text-primary" /><p className="flex-1 text-sm font-semibold">{label}</p><button className="icon-btn-danger" title="Remove" onClick={() => set({ actions: r.actions.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button></div>
                {a.type === "email" && <>
                  {who(a, i)}
                  <Field label="Subject"><input className="fi" value={a.subject || ""} onChange={(e) => setAction(i, { subject: e.target.value })} /></Field>
                  <Field label="Message"><textarea className="fi min-h-[110px]" value={a.body || ""} onChange={(e) => setAction(i, { body: e.target.value })} /></Field>
                </>}
                {a.type === "sms" && <>
                  {who(a, i)}
                  <Field label="Message" hint={`${(a.text || "").length} characters before placeholders are filled. Uses your SMS units.`}><textarea className="fi min-h-[80px]" value={a.text || ""} onChange={(e) => setAction(i, { text: e.target.value })} /></Field>
                </>}
                {a.type === "notify" && <>
                  {who(a, i, true)}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Title"><input className="fi" value={a.title || ""} onChange={(e) => setAction(i, { title: e.target.value })} /></Field>
                    <Field label="Details"><input className="fi" value={a.body || ""} onChange={(e) => setAction(i, { body: e.target.value })} /></Field>
                  </div>
                </>}
                {a.type === "update" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Field"><select className="fi" value={a.field || ""} onChange={(e) => setAction(i, { field: e.target.value })}><option value="">Choose</option>{mod.update.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></Field>
                    <Field label="New value" hint="Leave empty to clear it"><input className="fi" value={a.value || ""} onChange={(e) => setAction(i, { value: e.target.value })} /></Field>
                  </div>
                )}
                {a.type === "task" && <>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Field label="Kind"><select className="fi" value={a.kind || "task"} onChange={(e) => setAction(i, { kind: e.target.value })}><option value="task">Task</option><option value="call">Call</option><option value="meeting">Meeting</option></select></Field>
                    <Field label="Due after (days)"><input className="fi" inputMode="numeric" value={a.days ?? 0} onChange={(e) => setAction(i, { days: Number(e.target.value.replace(/\D/g, "") || 0) })} /></Field>
                    <Field label="Priority"><select className="fi" value={a.priority || "normal"} onChange={(e) => setAction(i, { priority: e.target.value })}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></Field>
                  </div>
                  <Field label="For"><select className="fi" value={a.to === "user" ? a.user || "" : ""} onChange={(e) => setAction(i, e.target.value ? { to: "user", user: e.target.value } : { to: "owner", user: undefined })}><option value="">The record's owner</option>{staff.map((u) => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}</select></Field>
                  <Field label="Subject"><input className="fi" value={a.title || ""} onChange={(e) => setAction(i, { title: e.target.value })} /></Field>
                  <Field label="Details"><textarea className="fi min-h-[70px]" value={a.body || ""} onChange={(e) => setAction(i, { body: e.target.value })} /></Field>
                </>}
                {a.type === "assign" && (
                  <Field label="People, in turn" hint="Each new match goes to the next person in this list, and they get a bell.">
                    <div className="flex flex-wrap gap-1.5">{staff.map((u) => { const on = (a.users || []).includes(u.user_id); return (
                      <button key={u.user_id} type="button" onClick={() => setAction(i, { users: on ? (a.users || []).filter((x) => x !== u.user_id) : [...(a.users || []), u.user_id] })}
                        className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>{u.display_name}</button>); })}</div>
                  </Field>
                )}
                {a.type === "webhook" && (
                  <Field label="Webhook" hint={hooks.length ? "Sends a signed workflow event with the record." : "Add a webhook first under System → API & webhooks."}>
                    <select className="fi" value={a.webhook_id || ""} onChange={(e) => setAction(i, { webhook_id: e.target.value })}><option value="">Choose</option>{hooks.map((h) => <option key={h.id} value={h.id}>{h.url}{h.is_active ? "" : " (paused)"}</option>)}</select>
                  </Field>
                )}
              </div>
            );
          })}
          <div className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
            <p className="mb-1.5 font-medium text-foreground">Placeholders</p>
            <div className="flex flex-wrap gap-1">{placeholders.map((p) => <button key={p} type="button" className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-primary/10" onClick={() => { void navigator.clipboard?.writeText(`{{${p}}}`); toast.success(`Copied {{${p}}}`); }}>{`{{${p}}}`}</button>)}</div>
            <p className="mt-1.5">Any field of the record also works, e.g. {"{{reference}}"}. The demo company never sends email, SMS or webhooks.</p>
          </div>
        </section>
      </div>
    </Modal>
  );
}

function RunLog({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["workflow-runs", rule.id], refetchInterval: 30_000,
    queryFn: async () => ((await sb.from("workflow_runs").select("*").eq("rule_id", rule.id).order("created_at", { ascending: false }).limit(100)).data || []) as any[],
  });
  const tone = (s: string) => (s === "ok" ? "success" : s === "failed" ? "danger" : s === "partial" ? "warning" : "muted") as "success" | "danger" | "warning" | "muted";
  const label: Record<string, string> = { ok: "Done", failed: "Failed", partial: "Partly done", skipped: "Skipped", running: "Running" };
  return (
    <Modal open onClose={onClose} size="xl" icon={History} title="Run log" description={rule.name}>
      {isLoading ? <PageLoader /> : !runs.length ? <EmptyState icon={History} title="Not run yet" description="Runs show here as records match the rule." /> : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {runs.map((x) => (
            <div key={x.id} className="space-y-1 px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{x.record_label || "Record"}</span>
                <Pill tone={tone(x.status)}>{label[x.status] || x.status}</Pill>
                <span className="ml-auto text-xs text-muted-foreground">{when(x.created_at)}</span>
              </div>
              {(Array.isArray(x.results) ? x.results : []).map((a: any, i: number) => (
                <p key={i} className={cn("text-xs", a.ok ? "text-muted-foreground" : "text-destructive")}>{ACTION_LABEL[a.type as Action["type"]]?.[0] || a.type}: {a.detail || (a.ok ? "done" : "failed")}</p>
              ))}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
