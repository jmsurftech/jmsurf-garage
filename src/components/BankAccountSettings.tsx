import { useEffect, useState } from "react";
import { Landmark, Save, Trash2, Send, CheckCircle2, AlertCircle, Building2, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatKES } from "@/lib/format";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { OrbSpinner } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";
import { PagedRows } from "@/components/Pager";
const fmt = formatKES;

// Common Kenyan banks with PayHero "network_code" values
const KENYAN_BANKS: { code: string; name: string }[] = [
  { code: "01", name: "Kenya Commercial Bank (KCB)" },
  { code: "02", name: "Standard Chartered Bank" },
  { code: "03", name: "Absa Bank Kenya" },
  { code: "07", name: "NCBA Bank" },
  { code: "11", name: "Co-operative Bank of Kenya" },
  { code: "12", name: "National Bank of Kenya" },
  { code: "16", name: "Citibank" },
  { code: "23", name: "Stanbic Bank Kenya" },
  { code: "31", name: "Bank of Africa" },
  { code: "35", name: "ABC Bank" },
  { code: "43", name: "Ecobank Kenya" },
  { code: "49", name: "Spire Bank" },
  { code: "50", name: "Paramount Universal Bank" },
  { code: "51", name: "Jamii Bora Bank" },
  { code: "53", name: "Consolidated Bank of Kenya" },
  { code: "54", name: "Credit Bank" },
  { code: "55", name: "Equity Bank Kenya" },
  { code: "57", name: "I&M Bank" },
  { code: "61", name: "HFC Bank" },
  { code: "63", name: "Diamond Trust Bank (DTB)" },
  { code: "66", name: "Sidian Bank" },
  { code: "68", name: "Family Bank" },
  { code: "70", name: "Gulf African Bank" },
  { code: "72", name: "Guaranty Trust Bank (GTBank)" },
  { code: "74", name: "First Community Bank" },
  { code: "76", name: "UBA Kenya" },
  { code: "78", name: "KWFT Bank" },
  { code: "83", name: "Faulu Microfinance Bank" },
];

type BankAccount = {
  id: string;
  bank_name: string;
  bank_code: string;
  account_number: string;
  account_name: string;
  is_active: boolean;
  verification_status: string;
  payhero_reference: string | null;
};

type Settlement = {
  id: string;
  amount: number;
  status: string;
  external_reference: string | null;
  payhero_withdrawal_id: string | null;
  message: string | null;
  created_at: string;
  completed_at: string | null;
};

type TenantOption = { id: string; business_name: string; slug: string | null };

export default function BankAccountSettings({ canManage, compact = false }: { canManage: boolean; compact?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const resolvedTenantId = useTenantId();
  const { role } = useAuth();
  const isSuperAdmin = role === "super_admin";

  // Super-admin override: pick any tenant. Default to the resolved tenant.
  const [overrideTenantId, setOverrideTenantId] = useState<string | null>(null);
  const tenantId = isSuperAdmin ? (overrideTenantId || resolvedTenantId) : resolvedTenantId;

  const [form, setForm] = useState({
    bank_code: "",
    bank_name: "",
    account_number: "",
    account_name: "",
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; message: string; details?: any }>(null);

  // List of tenants for super-admin selector
  const { data: tenantOptions = [] } = useQuery({
    queryKey: ["tenants-for-bank-selector"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data } = await supabase
        .from("tenants")
        .select("id, business_name, slug")
        .order("business_name", { ascending: true });
      return (data || []) as TenantOption[];
    },
  });

  // Active tenant display name
  const activeTenant = tenantOptions.find((t) => t.id === tenantId);

  const { data: account, isLoading } = useQuery({
    queryKey: ["tenant-bank-account", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase
        .from("tenant_bank_accounts")
        .select("*")
        .eq("tenant_id", tenantId!)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as BankAccount | null;
    },
  });

  const { data: settlements = [] } = useQuery({
    queryKey: ["tenant-settlements", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase
        .from("settlements")
        .select("*")
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: false })
        .limit(20);
      return (data || []) as Settlement[];
    },
  });

  useEffect(() => {
    if (account) {
      setForm({
        bank_code: account.bank_code,
        bank_name: account.bank_name,
        account_number: account.account_number,
        account_name: account.account_name,
      });
    } else {
      setForm({ bank_code: "", bank_name: "", account_number: "", account_name: "" });
    }
    setTestResult(null);
  }, [account, tenantId]);

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["tenant-bank-account", tenantId] }),
      qc.invalidateQueries({ queryKey: ["tenant-settlements", tenantId] }),
      qc.invalidateQueries({ queryKey: ["business-settings"] }),
    ]);
  };

  const logAudit = async (action: "linked" | "unlinked" | "updated", details: any) => {
    if (!tenantId) return;
    try {
      await (supabase as any).from("feature_audit_logs").insert({
        scope: "tenant",
        tenant_id: tenantId,
        diff: { action: `bank_account_${action}`, ...details },
      });
    } catch (e) {
      // Non-blocking
      console.warn("[bank-audit] log failed:", e);
    }
  };

  const save = async () => {
    if (!tenantId) {
      toast({ title: "No business selected", description: isSuperAdmin ? "Pick a business from the selector above." : "Your account isn't linked to a business yet.", variant: "destructive" });
      return;
    }
    const bankMatch = KENYAN_BANKS.find((b) => b.code === form.bank_code);
    if (!bankMatch) {
      toast({ title: "Invalid bank", description: "Pick a bank from the list. Custom codes are not supported by PayHero.", variant: "destructive" });
      return;
    }
    const acctNum = form.account_number.trim();
    const acctName = form.account_name.trim();
    if (!/^[0-9]{4,20}$/.test(acctNum)) {
      toast({ title: "Invalid account number", description: "Use 4–20 digits, numbers only (no spaces or dashes).", variant: "destructive" });
      return;
    }
    if (acctName.length < 2 || acctName.length > 100) {
      toast({ title: "Invalid account name", description: "Account name must be between 2 and 100 characters.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const { data: dupCheck } = await supabase
        .from("tenant_bank_accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("bank_code", form.bank_code)
        .eq("account_number", acctNum);
      const duplicate = (dupCheck || []).find((r: any) => !account || r.id !== account.id);
      if (duplicate) {
        toast({ title: "Duplicate bank account", description: "This bank + account number is already saved for this business.", variant: "destructive" });
        setSaving(false);
        return;
      }

      const payload = {
        tenant_id: tenantId,
        bank_code: form.bank_code,
        bank_name: bankMatch.name,
        account_number: acctNum,
        account_name: acctName,
        is_active: true,
        verification_status: "saved",
      };

      const result = account
        ? await supabase.from("tenant_bank_accounts").update(payload).eq("id", account.id).select().single()
        : await supabase.from("tenant_bank_accounts").insert(payload).select().single();

      if (result.error) {
        const err: any = result.error;
        const code = err.code ? ` [${err.code}]` : "";
        const detail = err.details ? ` — ${err.details}` : "";
        const hint = err.hint ? ` (hint: ${err.hint})` : "";
        throw new Error(`${err.message || "Database rejected the save."}${code}${detail}${hint}`);
      }

      await logAudit(account ? "updated" : "linked", {
        bank_name: bankMatch.name,
        account_number_masked: acctNum.replace(/.(?=.{4})/g, "•"),
        tenant_business_name: activeTenant?.business_name || null,
      });

      toast({ title: "Bank account saved", description: `${bankMatch.name} • ${acctNum}` });
      await refreshAll();

      // Auto-run a connection test so the UI updates immediately
      void runTest();
    } catch (e: any) {
      const msg = String(e?.message || "");
      const lower = msg.toLowerCase();
      const isRls = lower.includes("row-level security") || lower.includes("permission") || lower.includes("42501");
      toast({
        title: isRls ? "Permission denied (RLS blocked save)" : "Failed to save bank",
        description: isRls
          ? `Only Admin or Manager users on this business can save bank details. Exact DB error: ${msg}`
          : msg || "Unknown error. Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!account) return;
    if (!(await confirmAction({ title: "Remove this bank account?", message: "Future settlements will need a new one.", danger: true, confirmLabel: "Remove" }))) return;
    const { error } = await supabase.from("tenant_bank_accounts").delete().eq("id", account.id);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
      return;
    }
    await logAudit("unlinked", {
      bank_name: account.bank_name,
      account_number_masked: account.account_number.replace(/.(?=.{4})/g, "•"),
      tenant_business_name: activeTenant?.business_name || null,
    });
    toast({ title: "Bank account removed" });
    setForm({ bank_code: "", bank_name: "", account_number: "", account_name: "" });
    setTestResult(null);
    await refreshAll();
  };

  const runTest = async () => {
    if (!tenantId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("payhero-test-connection", {
        body: { tenant_id: tenantId },
      });
      if (error) throw new Error(error.message || "Test failed");
      setTestResult({
        ok: !!data?.ok,
        message: data?.message || (data?.ok ? "PayHero credentials are valid." : "Test failed."),
        details: data,
      });
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.message || "Could not reach PayHero." });
    } finally {
      setTesting(false);
    }
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading bank account…</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Tenant context banner */}
      <div className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-2 ${
        tenantId ? "bg-primary/5 border-primary/20" : "bg-destructive/10 border-destructive/30"
      }`}>
        <Building2 className={`w-4 h-4 mt-0.5 ${tenantId ? "text-primary" : "text-destructive"}`} />
        <div className="flex-1">
          {tenantId ? (
            <>
              <div className="font-medium">
                Saving for: <span className="text-primary">{activeTenant?.business_name || "Current business"}</span>
              </div>
              <div className="text-xs text-muted-foreground font-mono mt-0.5">tenant_id: {tenantId}</div>
            </>
          ) : (
            <>
              <div className="font-medium text-destructive">No business context</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {isSuperAdmin
                  ? "Pick a business from the selector below to manage its bank details."
                  : "Your user is not linked to a business. Contact support."}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Super-admin tenant selector */}
      {isSuperAdmin && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-2">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <Building2 className="w-3.5 h-3.5" /> Manage bank details for business
          </label>
          <select
            className="w-full px-3 py-2 rounded-lg bg-muted border border-input text-sm"
            value={overrideTenantId || resolvedTenantId || ""}
            onChange={(e) => setOverrideTenantId(e.target.value || null)}
          >
            <option value="">— Select a business —</option>
            {tenantOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.business_name}{t.slug ? ` (${t.slug})` : ""}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            Super-admin override. Bank details, settlements, and PayHero test target the selected business.
          </p>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Landmark className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Settlement Bank Account</h2>
          {account && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-500">
              <CheckCircle2 className="w-3.5 h-3.5" /> Saved
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Funds collected via PayHero (POS, invoices, subscription billing) are auto-settled to this bank account.
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Bank</label>
            <select
              disabled={!canManage || !tenantId}
              className="w-full px-3 py-2 rounded-lg bg-muted border border-input text-sm"
              value={form.bank_code}
              onChange={(e) => setForm((f) => ({ ...f, bank_code: e.target.value, bank_name: KENYAN_BANKS.find(b => b.code === e.target.value)?.name || "" }))}
            >
              <option value="">— Select bank —</option>
              {KENYAN_BANKS.map((b) => (
                <option key={b.code} value={b.code}>{b.name} ({b.code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Account number</label>
            <input
              disabled={!canManage || !tenantId}
              className="w-full px-3 py-2 rounded-lg bg-muted border border-input text-sm font-mono"
              value={form.account_number}
              onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))}
              placeholder="e.g. 0123456789"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground">Account name (as on bank records)</label>
            <input
              disabled={!canManage || !tenantId}
              className="w-full px-3 py-2 rounded-lg bg-muted border border-input text-sm"
              value={form.account_name}
              onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))}
              placeholder="Business / account holder name"
            />
          </div>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={save} disabled={saving || !tenantId}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40">
              <Save className="w-4 h-4" /> {saving ? "Saving…" : account ? "Update Bank Account" : "Save Bank Account"}
            </button>
            <button onClick={runTest} disabled={testing || !tenantId}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/40 text-sm text-primary hover:bg-primary/10 disabled:opacity-40">
              {testing ? <OrbSpinner className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
              {testing ? "Testing…" : "Test PayHero connection"}
            </button>
            {account && (
              <button onClick={remove}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-destructive hover:bg-destructive/10">
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            )}
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div className={`rounded-lg border px-3 py-2 text-sm flex items-start gap-2 ${
            testResult.ok ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                          : "bg-destructive/10 border-destructive/30 text-destructive"
          }`}>
            {testResult.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertCircle className="w-4 h-4 mt-0.5" />}
            <div className="flex-1">
              <div className="font-medium">{testResult.ok ? "PayHero connected" : "PayHero check failed"}</div>
              <div className="text-xs mt-0.5">{testResult.message}</div>
              {testResult.details?.channels_found != null && (
                <div className="text-[11px] mt-1 opacity-80">
                  Channels found: {testResult.details.channels_found}
                  {testResult.details.channel_id_configured && ` • Configured channel: ${testResult.details.channel_id_configured}`}
                  {testResult.details.has_bank_account ? " • Bank linked" : " • No bank linked"}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {account && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-2">
          <h3 className="font-semibold flex items-center gap-2"><Send className="w-4 h-4 text-primary" /> Automatic Settlement</h3>
          <p className="text-xs text-muted-foreground">
            Every successful PayHero M-Pesa STK Push collection is automatically settled to <strong>{account.account_name}</strong> ({account.bank_name} • {account.account_number}). No manual action needed.
          </p>
        </div>
      )}

      {!compact && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold mb-3">Recent Settlements</h3>
          {settlements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No settlements yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="py-2">Date</th>
                    <th className="py-2">Amount</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Reference</th>
                    <th className="py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  <PagedRows rows={settlements} colSpan={5}>{(pageRows) => pageRows.map((s) => (
                    <tr key={s.id} className="border-b border-border/60">
                      <td className="py-2">{new Date(s.created_at).toLocaleString()}</td>
                      <td className="py-2 font-medium">{fmt(s.amount)}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          s.status === "completed" ? "bg-emerald-500/15 text-emerald-500"
                          : s.status === "failed" ? "bg-destructive/15 text-destructive"
                          : "bg-amber-500/15 text-amber-500"
                        }`}>{s.status}</span>
                      </td>
                      <td className="py-2 font-mono text-xs">{s.payhero_withdrawal_id || s.external_reference || "—"}</td>
                      <td className="py-2 text-xs text-muted-foreground">{s.message || "—"}</td>
                    </tr>
                  ))}</PagedRows>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
