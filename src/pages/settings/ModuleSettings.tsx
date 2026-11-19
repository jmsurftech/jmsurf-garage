import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ShoppingCart, Package, FolderKanban, Factory, Wallet, Sparkles, ReceiptText, ExternalLink } from "lucide-react";
import { Panel, Field } from "@/components/kit";
import { useErpSettings, Toggle } from "@/pages/settings/ErpSettingsTabs";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";

/** Each suite keeps its own options in business_settings.erp_settings.<key>. */
function useSection<T extends Record<string, any>>(key: string, defaults: T) {
  const { settings, save } = useErpSettings();
  const [v, setV] = useState<T>(defaults);
  useEffect(() => { setV({ ...defaults, ...(settings[key] || {}) }); }, [settings[key]]); // eslint-disable-line react-hooks/exhaustive-deps
  const persist = async () => { const { error } = await save(key, v); if (error) toast.error(friendlyError(error)); else toast.success("Saved"); };
  return { v, set: (p: Partial<T>) => setV({ ...v, ...p }), persist };
}

function Save({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return <div className="flex justify-end"><button disabled={disabled} onClick={onClick} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">Save</button></div>;
}

/** System → Point of Sale: till behaviour (barcodes and labels sit beside it). */
export function PosSettings({ canManage, barcodes }: { canManage: boolean; barcodes: ReactNode }) {
  const { v, set, persist } = useSection("pos", { auto_print: true, ask_customer: false, allow_negative: false, allow_discounts: "manager", max_discount: 10, show_images: true, require_shift: true, offline: true, round_to: 0, paper: "80mm" });
  return (
    <div className="space-y-5">
      <Panel title="At the till" icon={ShoppingCart}>
        <div className="grid gap-2">
          <Toggle label="Print the receipt automatically after each sale" checked={v.auto_print} disabled={!canManage} onChange={(x) => set({ auto_print: x })} />
          <Toggle label="Ask for the customer on every sale" hint="Otherwise sales go to Walk-in unless a customer is picked." checked={v.ask_customer} disabled={!canManage} onChange={(x) => set({ ask_customer: x })} />
          <Toggle label="Allow selling below zero stock" checked={v.allow_negative} disabled={!canManage} onChange={(x) => set({ allow_negative: x })} />
          <Toggle label="Cashiers must open a shift (float) before selling" checked={v.require_shift} disabled={!canManage} onChange={(x) => set({ require_shift: x })} />
          <Toggle label="Show item pictures on the till" checked={v.show_images} disabled={!canManage} onChange={(x) => set({ show_images: x })} />
          <Toggle label="Keep selling when the internet drops" hint="Sales sync when the connection is back." checked={v.offline} disabled={!canManage} onChange={(x) => set({ offline: x })} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <Field label="Who can give discounts"><select className="fi" disabled={!canManage} value={v.allow_discounts} onChange={(e) => set({ allow_discounts: e.target.value })}><option value="everyone">Everyone</option><option value="manager">Managers only</option><option value="nobody">Nobody</option></select></Field>
          <Field label="Biggest discount (%)"><input className="fi" type="number" min={0} max={100} disabled={!canManage} value={v.max_discount} onChange={(e) => set({ max_discount: Number(e.target.value) })} /></Field>
          <Field label="Round totals to"><select className="fi" disabled={!canManage} value={v.round_to} onChange={(e) => set({ round_to: Number(e.target.value) })}><option value={0}>No rounding</option><option value={1}>1 shilling</option><option value={5}>5 shillings</option><option value={10}>10 shillings</option></select></Field>
          <Field label="Receipt paper"><select className="fi" disabled={!canManage} value={v.paper} onChange={(e) => set({ paper: e.target.value })}><option value="80mm">80 mm</option><option value="58mm">58 mm</option><option value="a4">A4</option></select></Field>
        </div>
        <div className="mt-4"><Save onClick={() => void persist()} disabled={!canManage} /></div>
      </Panel>
      <Panel title="Receipts" icon={ReceiptText}>
        <p className="text-sm text-muted-foreground">The receipt's header, footer, terms and layout are set with the other document templates.</p>
        <Link to="/settings/documents?section=receipts" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">Open receipt settings in Documents <ExternalLink className="h-3.5 w-3.5" /></Link>
      </Panel>
      {barcodes}
    </div>
  );
}

/** System → Items: the basic item and stock preferences every company has (no Inventory module needed). */
export function ItemSettings({ canManage }: { canManage: boolean }) {
  const { v, set, persist } = useSection("items", {
    qty_decimals: 2, valuation: "fifo", allow_duplicate_names: false, enhanced_search: true, hs_codes: false,
    price_lists: true, price_list_per_line: false, track_inventory: true, inventory_start: "", negative_stock: "block", negative_level: "organization",
    out_of_stock_warning: true, reorder_notify: true, reorder_notify_to: "", landed_cost: false, landed_cost_method: "quantity",
  });
  return (
    <div className="space-y-5">
      <Panel title="Items" icon={Package}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Decimal places for item quantity"><select className="fi" disabled={!canManage} value={v.qty_decimals} onChange={(e) => set({ qty_decimals: Number(e.target.value) })}>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          <Field label="Default inventory valuation method"><select className="fi" disabled={!canManage} value={v.valuation} onChange={(e) => set({ valuation: e.target.value })}><option value="fifo">FIFO (first in, first out)</option><option value="average">Weighted average</option></select></Field>
        </div>
        <div className="mt-3 grid gap-2">
          <Toggle label="Allow duplicate item names" hint="Imports then match items by SKU." checked={v.allow_duplicate_names} disabled={!canManage} onChange={(x) => set({ allow_duplicate_names: x })} />
          <Toggle label="Enhanced item search" hint="Find items by any of their words, in any order." checked={v.enhanced_search} disabled={!canManage} onChange={(x) => set({ enhanced_search: x })} />
          <Toggle label="HS codes on items" checked={v.hs_codes} disabled={!canManage} onChange={(x) => set({ hs_codes: x })} />
          <Toggle label="Price lists" hint="Custom rates per customer or vendor." checked={v.price_lists} disabled={!canManage} onChange={(x) => set({ price_lists: x })} />
          {v.price_lists && <Toggle label="Apply a price list on each line" checked={v.price_list_per_line} disabled={!canManage} onChange={(x) => set({ price_list_per_line: x })} />}
        </div>
      </Panel>
      <Panel title="Inventory" icon={Package}>
        <div className="grid gap-2">
          <Toggle label="Track inventory" hint="Stock on hand, receiving and adjustments. Warehouses, batches, serials and transfers come with the Inventory module." checked={v.track_inventory} disabled={!canManage} onChange={(x) => set({ track_inventory: x })} />
        </div>
        {v.track_inventory && (
          <div className="mt-3 space-y-3">
            <Field label="Inventory start date"><input className="fi w-48" type="date" disabled={!canManage} value={v.inventory_start} onChange={(e) => set({ inventory_start: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Stock going below zero"><select className="fi" disabled={!canManage} value={v.negative_stock} onChange={(e) => set({ negative_stock: e.target.value })}><option value="block">Prevent it</option><option value="warn">Allow, with a warning</option><option value="allow">Allow</option></select></Field>
              {v.negative_stock === "block" && <Field label="Checked at"><select className="fi" disabled={!canManage} value={v.negative_level} onChange={(e) => set({ negative_level: e.target.value })}><option value="organization">Organization level</option><option value="location">Location level</option></select></Field>}
            </div>
            <Toggle label="Show an out-of-stock warning when stock drops below zero" checked={v.out_of_stock_warning} disabled={!canManage} onChange={(x) => set({ out_of_stock_warning: x })} />
            <Toggle label="Notify me when an item reaches its reorder level" checked={v.reorder_notify} disabled={!canManage} onChange={(x) => set({ reorder_notify: x })} />
            {v.reorder_notify && <Field label="Notify to"><input className="fi" type="email" disabled={!canManage} value={v.reorder_notify_to} placeholder="stores@yourcompany.co.ke" onChange={(e) => set({ reorder_notify_to: e.target.value })} /></Field>}
            <Toggle label="Track landed cost on items" checked={v.landed_cost} disabled={!canManage} onChange={(x) => set({ landed_cost: x })} />
            {v.landed_cost && <Field label="Default landed cost allocation"><select className="fi w-56" disabled={!canManage} value={v.landed_cost_method} onChange={(e) => set({ landed_cost_method: e.target.value })}><option value="quantity">Quantity</option><option value="value">Value</option><option value="weight">Weight</option></select></Field>}
          </div>
        )}
        <div className="mt-4"><Save onClick={() => void persist()} disabled={!canManage} /></div>
      </Panel>
    </div>
  );
}

export function InventorySettings({ canManage }: { canManage: boolean }) {
  const { v, set, persist } = useSection("inventory", { costing: "average", fefo: true, require_batch: false, require_expiry: false, expiry_alert_days: 60, low_stock_alert: true, invoice_reduces_stock: true });
  return (
    <Panel title="Inventory" icon={Package}>
      <div className="grid gap-2">
        <Toggle label="Issued invoices take stock out" hint="Switch off if stock only leaves through packages and shipments." checked={v.invoice_reduces_stock} disabled={!canManage} onChange={(x) => set({ invoice_reduces_stock: x })} />
        <Toggle label="Pick earliest-expiring batches first (FEFO)" checked={v.fefo} disabled={!canManage} onChange={(x) => set({ fefo: x })} />
        <Toggle label="A batch number is required when receiving" checked={v.require_batch} disabled={!canManage} onChange={(x) => set({ require_batch: x })} />
        <Toggle label="An expiry date is required when receiving" checked={v.require_expiry} disabled={!canManage} onChange={(x) => set({ require_expiry: x })} />
        <Toggle label="Alert when items fall to their reorder level" checked={v.low_stock_alert} disabled={!canManage} onChange={(x) => set({ low_stock_alert: x })} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Costing method"><select className="fi" disabled={!canManage} value={v.costing} onChange={(e) => set({ costing: e.target.value })}><option value="average">Weighted average</option><option value="fifo">FIFO</option></select></Field>
        <Field label="Warn about expiry this many days ahead"><input className="fi" type="number" min={1} disabled={!canManage} value={v.expiry_alert_days} onChange={(e) => set({ expiry_alert_days: Number(e.target.value) })} /></Field>
      </div>
      <div className="mt-4"><Save onClick={() => void persist()} disabled={!canManage} /></div>
    </Panel>
  );
}

export function ProjectSettings({ canManage }: { canManage: boolean }) {
  const { v, set, persist } = useSection("projects", { default_rate: 2500, billable_default: true, timesheet_approval: false, budget_alert_pct: 80 });
  return (
    <Panel title="Projects" icon={FolderKanban}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Default hourly rate (KES)"><input className="fi" type="number" min={0} disabled={!canManage} value={v.default_rate} onChange={(e) => set({ default_rate: Number(e.target.value) })} /></Field>
        <Field label="Alert when a project uses this much of its budget (%)"><input className="fi" type="number" min={1} max={100} disabled={!canManage} value={v.budget_alert_pct} onChange={(e) => set({ budget_alert_pct: Number(e.target.value) })} /></Field>
      </div>
      <div className="mt-3 grid gap-2">
        <Toggle label="New time entries are billable" checked={v.billable_default} disabled={!canManage} onChange={(x) => set({ billable_default: x })} />
        <Toggle label="Timesheets need a manager's approval before billing" checked={v.timesheet_approval} disabled={!canManage} onChange={(x) => set({ timesheet_approval: x })} />
      </div>
      <div className="mt-4"><Save onClick={() => void persist()} disabled={!canManage} /></div>
    </Panel>
  );
}

export function ManufacturingSettings({ canManage }: { canManage: boolean }) {
  const { v, set, persist } = useSection("manufacturing", { labour_rate: 500, overhead_pct: 10, quality_required: false, scrap_account: "Production scrap" });
  return (
    <Panel title="Manufacturing" icon={Factory}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Labour cost per hour (KES)"><input className="fi" type="number" min={0} disabled={!canManage} value={v.labour_rate} onChange={(e) => set({ labour_rate: Number(e.target.value) })} /></Field>
        <Field label="Overheads on production (%)"><input className="fi" type="number" min={0} disabled={!canManage} value={v.overhead_pct} onChange={(e) => set({ overhead_pct: Number(e.target.value) })} /></Field>
        <Field label="Scrap expense account"><input className="fi" disabled={!canManage} value={v.scrap_account} onChange={(e) => set({ scrap_account: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Toggle label="A quality check must pass before finished goods go to stock" checked={v.quality_required} disabled={!canManage} onChange={(x) => set({ quality_required: x })} /></div>
      <div className="mt-4"><Save onClick={() => void persist()} disabled={!canManage} /></div>
    </Panel>
  );
}

export function ExpenseSettings({ canManage }: { canManage: boolean }) {
  const { v, set, persist } = useSection("expense_policy", { mileage_rate: 30, per_diem: 3000, receipt_over: 1000, approval_over: 5000, reimburse_via: "mpesa" });
  return (
    <Panel title="Expense claims" icon={Wallet}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Mileage rate (KES per km)"><input className="fi" type="number" min={0} disabled={!canManage} value={v.mileage_rate} onChange={(e) => set({ mileage_rate: Number(e.target.value) })} /></Field>
        <Field label="Per diem (KES per day)"><input className="fi" type="number" min={0} disabled={!canManage} value={v.per_diem} onChange={(e) => set({ per_diem: Number(e.target.value) })} /></Field>
        <Field label="Receipt required above (KES)"><input className="fi" type="number" min={0} disabled={!canManage} value={v.receipt_over} onChange={(e) => set({ receipt_over: Number(e.target.value) })} /></Field>
        <Field label="Manager approval above (KES)"><input className="fi" type="number" min={0} disabled={!canManage} value={v.approval_over} onChange={(e) => set({ approval_over: Number(e.target.value) })} /></Field>
        <Field label="Reimburse by"><select className="fi" disabled={!canManage} value={v.reimburse_via} onChange={(e) => set({ reimburse_via: e.target.value })}><option value="mpesa">M-Pesa</option><option value="bank">Bank transfer</option><option value="payroll">With payroll</option></select></Field>
      </div>
      <div className="mt-4"><Save onClick={() => void persist()} disabled={!canManage} /></div>
    </Panel>
  );
}

export function AiSettings({ canManage }: { canManage: boolean }) {
  const { v, set, persist } = useSection("dash_ai", { enabled_roles: ["admin", "manager"], voice: true, may_draft: true, language: "English" });
  const roles = ["admin", "manager", "accountant", "cashier", "sales_person", "stock_manager"];
  return (
    <Panel title="Garage AI" icon={Sparkles}>
      <p className="mb-2 text-sm font-medium">Who can use Garage AI</p>
      <div className="flex flex-wrap gap-1.5">{roles.map((r) => { const on = v.enabled_roles.includes(r); return <button key={r} disabled={!canManage} onClick={() => set({ enabled_roles: on ? v.enabled_roles.filter((x: string) => x !== r) : [...v.enabled_roles, r] })} className={on ? "rounded-full bg-primary px-3 py-1.5 text-xs font-semibold capitalize text-primary-foreground" : "rounded-full bg-muted px-3 py-1.5 text-xs font-semibold capitalize text-muted-foreground"}>{r.replace("_", " ")}</button>; })}</div>
      <div className="mt-3 grid gap-2">
        <Toggle label="Voice in and out" checked={v.voice} disabled={!canManage} onChange={(x) => set({ voice: x })} />
        <Toggle label="May draft invoices, reminders and messages (always confirmed by a person)" checked={v.may_draft} disabled={!canManage} onChange={(x) => set({ may_draft: x })} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Answer in"><select className="fi" disabled={!canManage} value={v.language} onChange={(e) => set({ language: e.target.value })}><option>English</option><option>Swahili</option><option>French</option></select></Field></div>
      <div className="mt-4"><Save onClick={() => void persist()} disabled={!canManage} /></div>
    </Panel>
  );
}
