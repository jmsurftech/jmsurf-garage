import { supabase } from "@/integrations/supabase/client";

/** A document raised from a contract (…?contract=<id>) is linked to it when first saved. */
export async function linkToContract(entityType: "invoice" | "quote" | "sales_order" | "bill" | "purchase_order" | "expense", entityId: string) {
  const contractId = new URLSearchParams(window.location.search).get("contract");
  if (!contractId || !/^[0-9a-f-]{36}$/i.test(contractId)) return;
  await (supabase as any).from("contract_links").insert({ contract_id: contractId, entity_type: entityType, entity_id: entityId }).then(() => null, () => null);
  await (supabase as any).from("contract_events").insert({ contract_id: contractId, kind: "linked", body: `New ${entityType.replace(/_/g, " ")} raised under the contract` }).then(() => null, () => null);
}
