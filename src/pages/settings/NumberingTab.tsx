import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel, Field } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { Button } from "@/components/ui/button";
import { useTenantId } from "@/hooks/useTenantId";
import { friendlyError } from "@/lib/friendlyError";

const sb: any = supabase;

type Row = { kind: string; label: string; prefix: string; pad: number; next_value: number; used: number };

const fmt = (r: Pick<Row, "prefix" | "pad" | "next_value">) => {
  const n = String(Math.max(1, Math.floor(Number(r.next_value) || 1)));
  return `${r.prefix}${n.padStart(Math.max(1, Number(r.pad) || 1), "0")}`;
};

/** System → Document numbers: prefix, digits and the next number of every document kind. */
export default function NumberingTab({ canManage }: { canManage: boolean }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["doc-numbering", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await sb.rpc("doc_numbering_list");
      if (error) throw error;
      return (data || []) as Row[];
    },
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [all, setAll] = useState({ pad: 5, next: 1001 });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setRows(q.data.map((r) => ({ ...r }))); }, [q.data]);

  if (q.isLoading) return <OrbLoader label="Loading document numbers…" />;
  if (q.error) return <p className="text-sm text-destructive">{friendlyError(q.error)}</p>;

  const off = !canManage;
  const setRow = (i: number, patch: Partial<Row>) => setRows((xs) => xs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const changed = rows.filter((r) => {
    const o = q.data?.find((x) => x.kind === r.kind);
    return !o || o.prefix !== r.prefix || Number(o.pad) !== Number(r.pad) || Number(o.next_value) !== Number(r.next_value);
  });

  const applyAll = () => {
    setRows((xs) => xs.map((r) => ({ ...r, pad: all.pad, next_value: Math.max(all.next, r.used + 1) })));
    const bumped = rows.filter((r) => r.used >= all.next).map((r) => r.label);
    if (bumped.length) toast.info(`${bumped.join(", ")} already passed ${all.next}, so they continue after their last number.`);
  };

  const save = async () => {
    setBusy(true);
    const failed: string[] = [];
    for (const r of changed) {
      const { error } = await sb.rpc("set_doc_numbering", { p_kind: r.kind, p_prefix: r.prefix, p_pad: Number(r.pad), p_next: Number(r.next_value) });
      if (error) failed.push(friendlyError(error));
    }
    setBusy(false);
    void qc.invalidateQueries({ queryKey: ["doc-numbering", tenantId] });
    if (failed.length) return toast.error(failed.join("\n"));
    toast.success(changed.length === 1 ? "Numbering saved" : `Numbering saved for ${changed.length} documents`);
  };

  return (
    <div className="space-y-5">
      {canManage && (
        <Panel title="Same numbering for every document" icon={Wand2}
          description="Set the digits and starting number once for all documents; each keeps its own prefix.">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Digits" className="w-28">
              <input className="fi" type="number" min={1} max={12} value={all.pad} onChange={(e) => setAll({ ...all, pad: Math.min(12, Math.max(1, Number(e.target.value) || 1)) })} />
            </Field>
            <Field label="Start from" className="w-36">
              <input className="fi" type="number" min={1} value={all.next} onChange={(e) => setAll({ ...all, next: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
            </Field>
            <span className="pb-2.5 text-sm text-muted-foreground">e.g. <b className="text-foreground">{String(all.next).padStart(all.pad, "0")}</b></span>
            <Button type="button" variant="outline" onClick={applyAll}>Apply to all</Button>
          </div>
        </Panel>
      )}

      <Panel title="Document numbers" icon={Hash}
        description="The prefix, the number of digits and the next number of each document. A number already used cannot be given again.">
        <div className="overflow-x-auto">
          <table className="dt-phone dt-stack w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Document</th><th className="py-2 pr-3">Prefix</th><th className="py-2 pr-3">Digits</th>
                <th className="py-2 pr-3">Next number</th><th className="py-2 pr-3">Next document</th><th className="py-2">Last used</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const low = Number(r.next_value) <= r.used;
                return (
                  <tr key={r.kind} className="border-t border-border align-top">
                    <td className="py-2 pr-3 pt-4 font-medium">{r.label}</td>
                    <td className="py-2 pr-3"><input className="fi h-9 w-28" maxLength={20} value={r.prefix} disabled={off} onChange={(e) => setRow(i, { prefix: e.target.value })} aria-label={`${r.label} prefix`} /></td>
                    <td className="py-2 pr-3"><input className="fi h-9 w-20" type="number" min={1} max={12} value={r.pad} disabled={off} onChange={(e) => setRow(i, { pad: Math.min(12, Math.max(1, Number(e.target.value) || 1)) })} aria-label={`${r.label} digits`} /></td>
                    <td className="py-2 pr-3">
                      <input className="fi h-9 w-32" type="number" min={1} value={r.next_value} disabled={off} onChange={(e) => setRow(i, { next_value: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} aria-label={`${r.label} next number`} />
                      {low && <span className="mt-1 block text-xs text-destructive">Start from {r.used + 1} or higher</span>}
                    </td>
                    <td className="py-2 pr-3 pt-4 font-mono">{fmt(r)}</td>
                    <td className="py-2 pt-4 text-muted-foreground">{r.used ? r.used : "None yet"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Numbers longer than the digits keep growing (99999 is followed by 100000). Changing a prefix does not rename documents already made.</p>
      </Panel>

      {canManage && (
        <div className="flex items-center justify-end gap-3">
          {changed.length > 0 && <span className="text-sm text-muted-foreground">{changed.length} changed</span>}
          <Button onClick={save} disabled={busy || !changed.length}>{busy ? "Saving…" : "Save numbering"}</Button>
        </div>
      )}
    </div>
  );
}
