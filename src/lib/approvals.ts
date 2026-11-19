import { supabase } from "@/integrations/supabase/client";
import { useErpSettings } from "@/pages/settings/ErpSettingsTabs";

/** Documents that can need approval (System → Approvals). */
export const APPROVAL_TYPES = [
  { key: "quote", label: "Quotations", link: (id: string) => `/sales/quotes/${id}` },
  { key: "sales_order", label: "Sales orders", link: (id: string) => `/sales/orders/${id}` },
  { key: "invoice", label: "Invoices", link: (id: string) => `/sales/invoices/${id}` },
  { key: "credit_note", label: "Credit notes", link: (id: string) => `/sales/credit-notes/${id}` },
  { key: "purchase_order", label: "Purchase orders", link: (id: string) => `/purchases/orders/${id}` },
  { key: "bill", label: "Bills", link: (id: string) => `/purchases/bills/${id}` },
  { key: "expense", label: "Expenses", link: () => `/purchases/expenses` },
  { key: "requisition", label: "Requisitions", link: (id: string) => `/purchases/requisitions/${id}` },
  { key: "payroll", label: "Payroll runs", link: () => `/hrm/payroll` },
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number]["key"];

export type ApprovalStep = { label: string; approvers: string[]; mode: "any" | "all" };
export type ApprovalRule = { enabled: boolean; approvers: string[]; min_amount?: number; steps?: ApprovalStep[] };
/** The rule's stages (older rules had one list of approvers). */
export const ruleSteps = (r: ApprovalRule): ApprovalStep[] => (r.steps?.length ? r.steps : [{ label: "Approval", approvers: r.approvers || [], mode: "any" }]);

/** Is approval switched on for this document type (and amount)? */
export function useApprovalRule(type: ApprovalType) {
  const { settings } = useErpSettings();
  const rule: ApprovalRule = { enabled: false, approvers: [], min_amount: 0, ...(settings.approvals?.[type] || {}) };
  return { rule, needs: (amount?: number) => rule.enabled && (!rule.min_amount || Number(amount || 0) >= Number(rule.min_amount)) };
}

/** Sends a saved document to its approvers. */
export async function submitForApproval(type: ApprovalType, docId: string, number: string | null, title: string, amount?: number) {
  const { error } = await (supabase as any).rpc("submit_for_approval", { p_type: type, p_doc: docId, p_number: number, p_title: title, p_amount: amount ?? null });
  if (error) throw error;
}

export const approvalLabel: Record<string, string> = { pending: "Waiting for approval", approved: "Approved", rejected: "Rejected", not_required: "" };
