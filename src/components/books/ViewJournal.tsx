import { useQuery } from "@tanstack/react-query";
import { BookOpenCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Modal, EmptyState } from "@/components/kit";
import { formatMoney } from "@/lib/format";

const sb = supabase as any;

/** "View Journal": the double entry a document posted to the books (accounts, debits, credits). */
export function ViewJournalModal({ sourceType, sourceId, title, onClose }: { sourceType: string; sourceId: string; title: string; onClose: () => void }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["view-journal", sourceType, sourceId],
    queryFn: async () => (await sb.from("journals").select("id, journal_number, journal_date, journal_lines(id, debit, credit, description, chart_of_accounts(code, name))")
      .eq("source_type", sourceType).eq("source_id", sourceId)).data || [],
  });
  const lines = (data as any[]).flatMap((j) => (j.journal_lines || []).map((l: any) => ({ ...l, date: j.journal_date })));
  const dr = lines.reduce((a, l) => a + Number(l.debit || 0), 0), cr = lines.reduce((a, l) => a + Number(l.credit || 0), 0);
  return (
    <Modal open onClose={onClose} title="Journal" description={title} icon={BookOpenCheck} size="lg">
      {!isLoading && !lines.length ? (
        <EmptyState icon={BookOpenCheck} title="Nothing posted yet" description="Drafts post to the books once they are sent or opened." />
      ) : (
        <table className="dt">
          <thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td data-label="Account">{l.chart_of_accounts ? `${l.chart_of_accounts.code ? `${l.chart_of_accounts.code} · ` : ""}${l.chart_of_accounts.name}` : "—"}{l.description && <div className="text-xs text-muted-foreground">{l.description}</div>}</td>
                <td data-label="Debit" className="num">{Number(l.debit) ? formatMoney(Number(l.debit)) : ""}</td>
                <td data-label="Credit" className="num">{Number(l.credit) ? formatMoney(Number(l.credit)) : ""}</td>
              </tr>
            ))}
            <tr className="font-semibold"><td>Total</td><td className="num">{formatMoney(dr)}</td><td className="num">{formatMoney(cr)}</td></tr>
          </tbody>
        </table>
      )}
    </Modal>
  );
}
