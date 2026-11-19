import { useState } from "react";
import { PackageCheck, PackageMinus, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import { useLocations } from "@/hooks/useData";
import { usePermissions } from "@/hooks/usePermissions";
import { StatusPill } from "@/components/kit";
import { sb, must } from "../lib/api";
import { useGarageSettings, logEvent } from "../lib/data";
import { when } from "./bits";

/** One part request: the store issues it from stock or takes back what was not used. */
export function PartRequestRow({ r, line, onChange, canIssue }: { r: any; line?: any; onChange: () => void; canIssue: boolean }) {
  const { toast } = useToast();
  const { data: locations = [] } = useLocations();
  const { data: settings } = useGarageSettings();
  const [qty, setQty] = useState(String(Math.max(0, Number(r.qty) - Number(r.issued_qty)) || 1));
  const [loc, setLoc] = useState<string>(r.location_id || settings?.default_location_id || (locations as any[])[0]?.id || "");
  const net = Number(r.issued_qty) - Number(r.returned_qty);
  const move = async (n: number) => {
    if (!n) return;
    const { error } = await sb.rpc("garage_issue_part", { p_request: r.id, p_qty: n, p_location: loc || null });
    if (error) return toast({ title: n > 0 ? "Not issued" : "Not taken back", description: error.message, variant: "destructive" });
    toast({ title: n > 0 ? `Issued ${n}` : `Took back ${-n}` });
    onChange();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{r.description || line?.description || "Part"}</p>
        <p className="text-[11px] text-muted-foreground">Asked {Number(r.qty)} · issued {Number(r.issued_qty)}{Number(r.returned_qty) ? ` · returned ${Number(r.returned_qty)}` : ""} · {when(r.requested_at)}</p>
      </div>
      <StatusPill status={r.status} />
      {canIssue && r.item_id && r.status !== "cancelled" && (
        <div className="flex flex-wrap items-center gap-1.5">
          {(locations as any[]).length > 1 && <select className="fi h-8 w-36 py-0 text-xs" value={loc} onChange={(e) => setLoc(e.target.value)}>{(locations as any[]).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
          <input className="fi h-8 w-16 py-0 text-xs" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          <button type="button" onClick={() => move(Number(qty) || 0)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-2 text-xs font-semibold text-primary-foreground"><PackageCheck className="h-3.5 w-3.5" />Issue</button>
          {net > 0 && <button type="button" onClick={() => move(-Math.min(net, Number(qty) || net))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs"><PackageMinus className="h-3.5 w-3.5" />Take back</button>}
        </div>
      )}
      {!r.item_id && <span className="text-[11px] text-warning">Not a stock item: order it</span>}
    </div>
  );
}

/** Parts for the job: request from the store, issue from stock, take back unused parts. */
export default function JobParts({ data, onChange }: { data: any; onChange: () => void }) {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const { can } = usePermissions();
  const { job, lines, parts } = data;
  const canIssue = can("garage_parts", "issue") || can("inventory_adjustments", "create");
  const partLines = lines.filter((l: any) => (l.kind === "part" || l.kind === "consumable") && l.status !== "cancelled" && l.approved !== false);
  const unrequested = partLines.filter((l: any) => !parts.some((p: any) => p.line_id === l.id && p.status !== "cancelled"));

  const request = async (ls: any[]) => {
    try {
      must(await sb.from("garage_part_requests").insert(ls.map((l) => ({ tenant_id: tenantId, job_id: job.id, line_id: l.id, item_id: l.item_id, description: l.description, qty: Number(l.qty) || 1, status: l.item_id ? "requested" : "to_order", location_id: job.location_id || null }))));
      await logEvent(tenantId!, job.id, "parts_requested", `${ls.length} part(s) asked from the store`);
      toast({ title: "Sent to the store" });
      onChange();
    } catch (e: any) { toast({ title: "Not sent", description: e.message, variant: "destructive" }); }
  };

  return (
    <div className="space-y-3">
      {unrequested.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-2.5">
          <p className="text-sm font-medium">{unrequested.length} part line(s) not asked from the store yet</p>
          <ul className="mt-1 text-xs text-muted-foreground">{unrequested.map((l: any) => <li key={l.id}>{l.qty} × {l.description}{l.approved !== true ? " (not approved yet)" : ""}</li>)}</ul>
          <button type="button" onClick={() => request(unrequested)} className="mt-2 inline-flex h-8 items-center gap-1 rounded-xl bg-primary px-2.5 text-xs font-semibold text-primary-foreground"><Send className="h-3.5 w-3.5" />Ask the store</button>
        </div>
      )}
      {!parts.length ? <p className="text-sm text-muted-foreground">No parts asked for yet. Add part lines on the Work tab first.</p> : (
        <div className="divide-y divide-border rounded-xl border border-border px-2.5">
          {parts.map((r: any) => <PartRequestRow key={r.id} r={r} line={lines.find((l: any) => l.id === r.line_id)} onChange={onChange} canIssue={canIssue} />)}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Issuing moves the item out of stock like any other stock movement. Taking back returns unused parts to the shelf. When the job is invoiced the invoice takes over, so nothing is counted twice.</p>
    </div>
  );
}
