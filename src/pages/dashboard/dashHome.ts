/** What the dash_home database function returns: the dashboard's figures in one round trip. */
export interface DashHome {
  payables: number;
  stock_value: number;
  approvals: number;
  web_orders: number;
  overdue_list: { invoice_id: string; invoice_number: string; customer_name: string; due_date: string; balance: number; days_overdue: number }[];
  bills_due: { id: string; bill_number: string | null; due_date: string; amount: number; amount_paid: number }[];
  owed: number;
  overdue: number;
  reminders_due: number;
  low_stock_count: number;
  low_stock: { id: string; name: string; stock: number; unit: string | null }[];
  funnel: { quotes: number; orders: number; invoices: number; paid: number };
  recent_invoices: { id: string; invoice_number: string | null; customer_name: string | null; total: number; status: string; created_at: string }[];
  recent_sales: { id: string; customer_name: string | null; total: number; status: string | null; created_at: string }[];
  flows: { ym: string; in: number; out: number }[];
  expenses: { name: string; value: number }[];
  prev_revenue: number;
  get_started: { company: boolean; data: boolean; modules: boolean; team: boolean; payments: boolean; invoice: boolean } | null;
}
