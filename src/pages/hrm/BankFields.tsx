/**
 * Bank and branch on an employee's pay details, picked from the Kenya bank list (kenya_banks /
 * kenya_bank_branches) so the codes go into the bank payment file. Anything not on the list can still
 * be typed; it then has no code.
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Field } from "@/components/kit";
import { sb } from "./hrData";

type Bank = { code: string; name: string; match_words: string[] };
type Branch = { branch_code: string; name: string; open: boolean };
export type BankPatch = { bank_name?: string | null; bank_code?: string | null; bank_branch?: string | null; branch_code?: string | null };
const OTHER = "__other";

/** The listed bank a typed name means ("Equity", "Kenya Commercial Bank", "stanchart"), if any. */
export function bankCodeFor(banks: Bank[], name: string | null | undefined) {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return null;
  const exact = banks.find((b) => b.name.toLowerCase() === n);
  if (exact) return exact.code;
  let best: { code: string; len: number } | null = null;
  for (const b of banks) for (const w of b.match_words || []) if (n.includes(w) && (!best || w.length > best.len)) best = { code: b.code, len: w.length };
  return best?.code ?? null;
}

export function BankFields({ f, onChange }: { f: any; onChange: (p: BankPatch) => void }) {
  const { data: banks = [] } = useQuery({
    queryKey: ["kenya-banks"], staleTime: 60 * 60_000,
    queryFn: async () => { const { data, error } = await sb.from("kenya_banks").select("code,name,match_words").order("name"); if (error) return []; return (data || []) as Bank[]; },
  });
  const code: string | null = f.bank_code || bankCodeFor(banks, f.bank_name);
  const { data: branches = [] } = useQuery({
    queryKey: ["kenya-bank-branches", code], enabled: !!code, staleTime: 60 * 60_000,
    queryFn: async () => ((await sb.from("kenya_bank_branches").select("branch_code,name,open").eq("bank_code", code).order("name").limit(1000)).data || []) as Branch[],
  });
  const branchHit = useMemo(() => {
    if (f.branch_code) return branches.find((b) => b.branch_code === f.branch_code) || null;
    const k = String(f.bank_branch || "").toLowerCase().replace(/\bbranch\b/g, "").replace(/[^a-z0-9]/g, "");
    return k ? branches.find((b) => b.name.toLowerCase().replace(/\bbranch\b/g, "").replace(/[^a-z0-9]/g, "") === k) || null : null;
  }, [branches, f.branch_code, f.bank_branch]);

  // Records saved before the list existed: fill the codes the names point to.
  useEffect(() => {
    const p: BankPatch = {};
    if (code && !f.bank_code) p.bank_code = code;
    if (branchHit && !f.branch_code) p.branch_code = branchHit.branch_code;
    if (Object.keys(p).length) onChange(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, branchHit]);

  if (!banks.length) return <>
    <Field label="Bank"><input className="fi" value={f.bank_name ?? ""} onChange={(e) => onChange({ bank_name: e.target.value })} /></Field>
    <Field label="Branch"><input className="fi" value={f.bank_branch ?? ""} onChange={(e) => onChange({ bank_branch: e.target.value })} /></Field>
  </>;

  const typedBank = !code && (f.bank_name || f._bank_other);
  const typedBranch = !!code && !branchHit && (f.bank_branch || f._branch_other);
  const shown = branches.filter((b) => b.open || b.branch_code === branchHit?.branch_code);
  return <>
    <Field label="Bank" hint={code ? `Bank code ${code}` : f.bank_name ? "Not on the bank list: no code" : undefined}>
      <select className="fi" value={code || (typedBank ? OTHER : "")} onChange={(e) => {
        const v = e.target.value;
        if (v === OTHER) return onChange({ bank_code: null, bank_name: "", branch_code: null, _bank_other: true } as any);
        const b = banks.find((x) => x.code === v);
        onChange({ bank_code: b?.code || null, bank_name: b?.name || "", branch_code: null, bank_branch: "" });
      }}>
        <option value="">Select…</option>
        {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        <option value={OTHER}>Other (type it)</option>
      </select>
      {typedBank && <input className="fi mt-2" placeholder="Bank name" value={f.bank_name ?? ""} onChange={(e) => onChange({ bank_name: e.target.value })} />}
    </Field>
    <Field label="Branch" hint={branchHit ? `Branch code ${branchHit.branch_code}` : f.bank_branch ? "Pick it from the list to get the code" : undefined}>
      {code ? <>
        <select className="fi" value={branchHit?.branch_code || (typedBranch ? OTHER : "")} onChange={(e) => {
          const v = e.target.value;
          if (v === OTHER) return onChange({ branch_code: null, bank_branch: "", _branch_other: true } as any);
          const b = branches.find((x) => x.branch_code === v);
          onChange({ branch_code: b?.branch_code || null, bank_branch: b?.name || "" });
        }}>
          <option value="">Select…</option>
          {shown.map((b) => <option key={b.branch_code} value={b.branch_code}>{b.name}{b.open ? "" : " (closed)"}</option>)}
          <option value={OTHER}>Other (type it)</option>
        </select>
        {typedBranch && <input className="fi mt-2" placeholder="Branch name" value={f.bank_branch ?? ""} onChange={(e) => onChange({ bank_branch: e.target.value })} />}
      </> : <input className="fi" value={f.bank_branch ?? ""} onChange={(e) => onChange({ bank_branch: e.target.value })} />}
    </Field>
  </>;
}
