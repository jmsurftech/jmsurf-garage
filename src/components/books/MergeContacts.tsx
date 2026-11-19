import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Merge } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Modal, Field } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Picker } from "@/apps/fields";
import { confirmAction } from "@/components/books/confirm";
import { friendlyError } from "@/lib/friendlyError";

/**
 * Merge a duplicate into this customer or vendor: the duplicate's invoices, bills,
 * payments, quotes and activities move here, then the duplicate is removed.
 */
export function MergeContactModal({ kind, keep, onClose }: { kind: "customer" | "supplier"; keep: { id: string; name: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const [other, setOther] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const table = kind === "customer" ? "customers" : "suppliers";
  const { data: list = [] } = useQuery({
    queryKey: ["merge-candidates", table],
    queryFn: async () => ((await (supabase as any).from(table).select("id, name, phone, email").neq("id", keep.id).order("name").limit(2000)).data || []) as any[],
  });
  const run = async () => {
    const dup = (list as any[]).find((x) => x.id === other);
    if (!dup) return toast.error(`Choose the duplicate ${kind === "customer" ? "customer" : "vendor"}`);
    if (!(await confirmAction({ title: `Merge ${dup.name} into ${keep.name}?`, message: `Everything recorded for ${dup.name} moves to ${keep.name}, then ${dup.name} is removed. This cannot be undone.`, confirmLabel: "Merge", danger: true }))) return;
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("merge_contacts", { p_kind: kind, p_keep: keep.id, p_merge: dup.id });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries();
    toast.success("Merged", { description: `${data?.moved ?? 0} records moved to ${keep.name}.` });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Merge into ${keep.name}`} icon={Merge} description="Pick the duplicate. It is merged into this record."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void run()} disabled={busy || !other}>{busy ? "Merging…" : "Merge"}</Button></>}>
      <Field label={kind === "customer" ? "Duplicate customer" : "Duplicate vendor"}>
        <Picker value={other} onChange={setOther} options={(list as any[]).map((x) => ({ id: x.id, label: x.name, sub: [x.phone, x.email].filter(Boolean).join(" · ") }))} />
      </Field>
    </Modal>
  );
}
