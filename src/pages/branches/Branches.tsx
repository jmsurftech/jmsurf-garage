import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Building2, Plus, UserCheck, Crown, X, MapPin } from "lucide-react";
import { PageHeader, Panel, EmptyState, StatGrid, StatTile, Pill } from "@/components/kit";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";
import { sb, useLocs } from "@/pages/warehouse/common";

const KEY = "dash-branch";
const EVT = "dash:branch";

/** The branch the person is looking at ("" = all branches). Applies to the main lists. */
export function useBranch(): [string, (id: string) => void] {
  const [b, setB] = useState(() => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } });
  useEffect(() => { const on = () => { try { setB(localStorage.getItem(KEY) || ""); } catch { /* private mode */ } }; window.addEventListener(EVT, on); return () => window.removeEventListener(EVT, on); }, []);
  const set = (id: string) => { try { localStorage.setItem(KEY, id); } catch { /* private mode */ } window.dispatchEvent(new Event(EVT)); };
  return [b, set];
}

/** Adds the branch filter to a query when a branch is chosen. */
export function byBranch<T>(q: T, branch: string, column = "location_id"): T {
  return branch ? (q as any).eq(column, branch) : q;
}

/** Top-bar branch switcher (only when the company has more than one branch). */
export function BranchSwitcher() {
  const { data: locs = [] } = useLocs();
  const [b, setB] = useBranch();
  const branches = locs.filter((l) => l.location_type === "branch" && l.is_active);
  if (branches.length < 2) return null;
  return (
    <label className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-sm lg:flex" title="Branch">
      <MapPin className="h-4 w-4 text-primary" />
      <select value={b} onChange={(e) => setB(e.target.value)} className="max-w-[7rem] bg-transparent text-sm font-medium outline-none min-[1700px]:max-w-[10rem]" aria-label="Branch">
        <option value="">All branches</option>
        {branches.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </label>
  );
}

/** System → Branches: each branch, its manager and its people, and how it is doing this month. */
export default function Branches() {
  const qc = useQueryClient();
  const { data: locs = [] } = useLocs();
  const branches = locs.filter((l) => l.location_type === "branch");
  const { data: staff = [] } = useQuery({ queryKey: ["br-staff"], queryFn: async () => ((await sb.from("profiles").select("user_id,display_name").order("display_name")).data || []) as any[] });
  const { data: links = [] } = useQuery({ queryKey: ["br-links"], queryFn: async () => ((await sb.from("user_branches").select("*")).data || []) as any[] });
  const month = new Date().toISOString().slice(0, 8) + "01";
  const { data: sales = [] } = useQuery({ queryKey: ["br-sales", month], queryFn: async () => ((await sb.from("invoices").select("location_id,total").gte("issue_date", month).not("status", "in", "(draft,void)").limit(20000)).data || []) as any[] });
  const { data: spend = [] } = useQuery({ queryKey: ["br-spend", month], queryFn: async () => ((await sb.from("expenses").select("location_id,amount").gte("expense_date", month).limit(20000)).data || []) as any[] });
  const [adding, setAdding] = useState<Record<string, string>>({});
  const refresh = () => void qc.invalidateQueries({ queryKey: ["br-links"] });
  const add = async (loc: string) => {
    const uid = adding[loc]; if (!uid) return;
    const { error } = await sb.from("user_branches").upsert({ user_id: uid, location_id: loc, is_primary: !links.some((x) => x.user_id === uid) }, { onConflict: "user_id,location_id" });
    if (error) return toast.error(friendlyError(error));
    setAdding({ ...adding, [loc]: "" }); refresh();
  };
  const remove = async (uid: string, loc: string) => { await sb.from("user_branches").delete().eq("user_id", uid).eq("location_id", loc); refresh(); };
  const toggleManager = async (x: any) => { await sb.from("user_branches").update({ is_manager: !x.is_manager }).eq("user_id", x.user_id).eq("location_id", x.location_id); refresh(); };
  const kes = (v: number) => `KES ${Math.round(v).toLocaleString("en-KE")}`;
  return (
    <div className="space-y-6">
      <PageHeader title="Branches" icon={Building2} description="Each branch keeps its own sales, purchases, expenses and stock. Switch branch in the top bar."
        actions={<Link to="/warehouse/locations" className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> Add a branch</Link>} />
      {!branches.length ? <EmptyState icon={Building2} title="No branches yet" description="Add one under Warehouses & Branches (type: Branch)." /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {branches.map((b) => {
            const people = links.filter((x) => x.location_id === b.id);
            const s = sales.filter((x) => x.location_id === b.id).reduce((a, x) => a + Number(x.total || 0), 0);
            const e = spend.filter((x) => x.location_id === b.id).reduce((a, x) => a + Number(x.amount || 0), 0);
            return (
              <Panel key={b.id} title={b.name} icon={Building2} description={[b.is_main ? "Main branch" : "", b.city || ""].filter(Boolean).join(" · ")}>
                <StatGrid className="lg:grid-cols-3"><StatTile label="Sales this month" value={kes(s)} /><StatTile label="Expenses this month" value={kes(e)} tone="warning" /><StatTile label="People" value={people.length} tone="info" /></StatGrid>
                <ul className="mt-3 divide-y divide-border">
                  {people.map((p) => (
                    <li key={p.user_id} className="flex items-center gap-2 py-2 text-sm">
                      <UserCheck className="h-4 w-4 text-muted-foreground" /><span className="flex-1">{staff.find((x) => x.user_id === p.user_id)?.display_name || "Staff"}</span>
                      {p.is_primary && <Pill>home branch</Pill>}
                      <button onClick={() => void toggleManager(p)} className={p.is_manager ? "inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold" : "rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"}><Crown className="h-3 w-3" /> {p.is_manager ? "Manager" : "Make manager"}</button>
                      <button onClick={() => void remove(p.user_id, b.id)} className="rounded-lg p-1 text-muted-foreground hover:text-destructive" aria-label="Remove"><X className="h-4 w-4" /></button>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <select className="fi h-9" value={adding[b.id] || ""} onChange={(e) => setAdding({ ...adding, [b.id]: e.target.value })}><option value="">Add a person…</option>{staff.filter((x) => !people.some((p) => p.user_id === x.user_id)).map((x) => <option key={x.user_id} value={x.user_id}>{x.display_name}</option>)}</select>
                  <button onClick={() => void add(b.id)} className="rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /></button>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
