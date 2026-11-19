import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import type { PartyKind } from "@/lib/contractTemplates";

export const sb = supabase as any;

export type Contract = {
  id: string; tenant_id: string; number: string | null; title: string; type: string; area: string;
  party_kind: PartyKind; party_id: string | null; party_name: string | null; party_contact: string | null; party_email: string | null; party_phone: string | null; party_address: string | null; party_pin: string | null;
  value: number; currency: string; start_date: string | null; end_date: string | null; renewal: "none" | "notify" | "auto"; notice_days: number;
  status: "draft" | "review" | "sent" | "amend_requested" | "signed" | "active" | "expired" | "terminated";
  source: "drafted" | "uploaded"; body: string; version: number; file_path: string | null; share_token: string; review_token: string;
  lawyer_name: string | null; lawyer_email: string | null; lawyer_status: "pending" | "approved" | "changes" | null;
  sent_at: string | null; viewed_at: string | null; party_signed_at: string | null; party_signer_name: string | null; party_signer_title: string | null; party_signature: string | null; party_upload_path: string | null;
  terminated_at: string | null; termination_reason: string | null; parent_id: string | null; owner_id: string | null; edited_at: string | null; created_at: string; updated_at: string;
};

export const STATUS: Record<Contract["status"], { label: string; tone: "muted" | "info" | "warning" | "success" | "danger" | "primary" }> = {
  draft: { label: "Draft", tone: "muted" },
  review: { label: "In review", tone: "info" },
  sent: { label: "Out for signature", tone: "warning" },
  amend_requested: { label: "Changes requested", tone: "danger" },
  signed: { label: "Signed (starts later)", tone: "info" },
  active: { label: "Active", tone: "success" },
  expired: { label: "Expired", tone: "danger" },
  terminated: { label: "Terminated", tone: "muted" },
};

export const PARTY_LABEL: Record<PartyKind, string> = { customer: "Customer", supplier: "Vendor", employee: "Employee", other: "Other party" };

export const daysLeft = (d: string | null) => (d ? Math.ceil((Date.parse(`${d}T23:59:59`) - Date.now()) / 86400000) : null);
export const shareUrl = (token: string) => `${window.location.origin}/contract/${token}`;

export function useContracts() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["contracts", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("contracts").select("id,number,title,type,area,party_kind,party_id,party_name,party_email,value,currency,start_date,end_date,renewal,notice_days,status,source,lawyer_status,owner_id,parent_id,created_at,updated_at").order("created_at", { ascending: false }).limit(1000)).data || []) as Contract[],
  });
}

export type PartyOption = { id: string; name: string; contact?: string | null; email?: string | null; phone?: string | null; address?: string | null; pin?: string | null; idNo?: string | null; role?: string | null; pay?: number | null; end?: string | null };

/** Customers, vendors or employees for the party picker. */
export function useParties(kind: PartyKind) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["contract-parties", kind, tenantId], enabled: !!tenantId && kind !== "other", staleTime: 60_000,
    queryFn: async (): Promise<PartyOption[]> => {
      if (kind === "customer") {
        const { data } = await sb.from("customers").select("id,name,company_name,email,phone,address,kra_pin").order("name").limit(3000);
        return (data || []).map((c: any) => ({ id: c.id, name: c.company_name || c.name, contact: c.company_name ? c.name : null, email: c.email, phone: c.phone, address: c.address, pin: c.kra_pin }));
      }
      if (kind === "supplier") {
        const { data } = await sb.from("suppliers").select("id,name,contact_person,email,phone,address,kra_pin").order("name").limit(3000);
        return (data || []).map((s: any) => ({ id: s.id, name: s.name, contact: s.contact_person, email: s.email, phone: s.phone, address: s.address, pin: s.kra_pin }));
      }
      const { data } = await sb.from("hr_employees").select("id,first_name,last_name,other_names,email,phone,address,kra_pin,national_id,basic_salary,contract_end,hr_designations(name)").order("first_name").limit(3000);
      return (data || []).map((e: any) => ({
        id: e.id, name: [e.first_name, e.other_names, e.last_name].filter(Boolean).join(" "), email: e.email, phone: e.phone, address: e.address, pin: e.kra_pin, idNo: e.national_id,
        role: e.hr_designations?.name || null, pay: Number(e.basic_salary || 0) || null, end: e.contract_end,
      }));
    },
  });
}

/** The existing customer, vendor or employee with this name (as read from a contract), if any. */
export async function findParty(kind: PartyKind, name?: string | null): Promise<PartyOption | null> {
  const n = String(name || "").trim();
  if (!n || kind === "other") return null;
  const like = `%${n.replace(/[%_,()."]/g, " ").trim().split(/\s+/).slice(0, 3).join("%")}%`;
  if (kind === "customer") {
    const { data } = await sb.from("customers").select("id,name,company_name,email,phone,address,kra_pin").or(`name.ilike.${like},company_name.ilike.${like}`).limit(1);
    const c = data?.[0]; return c ? { id: c.id, name: c.company_name || c.name, contact: c.company_name ? c.name : null, email: c.email, phone: c.phone, address: c.address, pin: c.kra_pin } : null;
  }
  if (kind === "supplier") {
    const { data } = await sb.from("suppliers").select("id,name,contact_person,email,phone,address,kra_pin").ilike("name", like).limit(1);
    const s = data?.[0]; return s ? { id: s.id, name: s.name, contact: s.contact_person, email: s.email, phone: s.phone, address: s.address, pin: s.kra_pin } : null;
  }
  const [first] = n.split(/\s+/);
  const { data } = await sb.from("hr_employees").select("id,first_name,last_name,other_names,email,phone,address,kra_pin,national_id").ilike("first_name", `%${first}%`).limit(20);
  const e = (data || []).find((x: any) => n.toLowerCase().includes(String(x.last_name || "").toLowerCase())) || data?.[0];
  return e ? { id: e.id, name: [e.first_name, e.other_names, e.last_name].filter(Boolean).join(" "), email: e.email, phone: e.phone, address: e.address, pin: e.kra_pin, idNo: e.national_id } : null;
}

export async function logEvent(c: { id: string }, kind: string, actor: string | null, body: string) {
  await sb.from("contract_events").insert({ contract_id: c.id, kind, actor, body });
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function readAsBase64(f: File): Promise<string> {
  return toBase64(new Uint8Array(await f.arrayBuffer()));
}

/** Sends an email through the company's mail (the same route documents use), with an optional PDF. */
export async function sendMail(to: string[], subject: string, message: string, pdf?: Uint8Array, filename?: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sign in again to send email");
  const res = await fetch("/api/email/document", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ to, subject, message, pdf: pdf ? toBase64(pdf) : "", filename: filename || "contract.pdf" }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out?.ok) throw new Error(out?.error || "The email was not sent");
  return out;
}
