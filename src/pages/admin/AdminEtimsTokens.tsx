import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Check, X, Mail } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, Pill, Segmented } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/friendlyError";

const sb = supabase as any;

/** JMSURF TAX as KRA knows the integrator (set when the integrator was registered on GavaConnect). */
const INTEGRATOR = { pin: "P052523451C", name: "JMSURF TECHNOLOGIES LTD", tis: "JMSURF Garage", version: "1.0.0", contact: "Joseph Muthama", phone: "0712504593", email: "jmsurftech@gmail.com" };

/** A ready email to KRA eTIMS Integrator Support asking for one company's integration token. */
function kraTokenMail(r: any) {
  const subject = `Request for eTIMS Integration Token - ${r.kra_pin} (${r.company})`;
  const body = `Dear eTIMS Integrator Support Team,

JMSURF TECHNOLOGIES LTD (JMSURF TAX), a Third-Party Integrator for KRA eTIMS through the Online Sales Control Unit (OSCU), kindly requests an Integration Token for the taxpayer below, who uses our system JMSURF Garage.

Taxpayer details:
- Taxpayer name: ${r.company}
- Taxpayer KRA PIN: ${r.kra_pin}
- Branch ID: ${r.branch_id}
- Device serial number: ${r.device_serial}
- Taxpayer contact: ${[r.contact_phone, r.contact_email].filter(Boolean).join(" / ") || "-"}

Integrator details:
- Integrator KRA PIN: ${INTEGRATOR.pin}
- Integrator name: ${INTEGRATOR.name}
- Solution type: OSCU
- TIS name: ${INTEGRATOR.tis}
- TIS version: ${INTEGRATOR.version}
- Type of integrator: Third-Party Integrator
- Contact person: ${INTEGRATOR.contact}, ${INTEGRATOR.phone}, ${INTEGRATOR.email}

The taxpayer will enter the token with the OSCU service request on the eTIMS portal.

Thank you.

Kind regards,
${INTEGRATOR.contact}
${INTEGRATOR.name}`;
  return `mailto:eTIMSintegratorsupport@kra.go.ke?cc=apisupport@kra.go.ke&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** JMSURF admin → KRA tokens: companies' requests for the eTIMS integration token (JMSURF TAX). */
export default function AdminEtimsTokens() {
  const qc = useQueryClient();
  const [view, setView] = useState<"requested" | "issued" | "all">("requested");
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const { data = [] } = useQuery({
    queryKey: ["admin-etims-tokens"], refetchInterval: 60_000,
    queryFn: async () => {
      const { data: reqs } = await sb.from("etims_token_requests").select("*").order("requested_at", { ascending: false }).limit(500);
      const ids = [...new Set((reqs || []).map((r: any) => r.tenant_id))];
      const { data: ts } = ids.length ? await sb.from("tenants").select("id,business_name,slug").in("id", ids) : { data: [] };
      const names = new Map((ts || []).map((t: any) => [t.id, t.business_name || t.slug]));
      return (reqs || []).map((r: any) => ({ ...r, company: names.get(r.tenant_id) || r.tenant_id }));
    },
  });
  const decide = async (r: any, issue: boolean) => {
    const token = (tokens[r.id] || "").trim();
    if (issue && !token) return toast.error("Paste the integration token from the KRA integrator portal");
    const { error } = await sb.from("etims_token_requests").update(issue ? { status: "issued", token, issued_at: new Date().toISOString() } : { status: "rejected", note: token || null }).eq("id", r.id);
    if (error) return toast.error(friendlyError(error));
    // The company's admins are told by the database (etims_token_notify).
    toast.success(issue ? "Token issued" : "Request closed");
    void qc.invalidateQueries({ queryKey: ["admin-etims-tokens"] });
  };
  const rows = data.filter((r: any) => view === "all" || r.status === view);
  return (
    <div className="space-y-5">
      <PageHeader title="KRA tokens" icon={KeyRound} description="Companies asking JMSURF TAX for their eTIMS integration token. KRA issues the token: press Email KRA to send the request to KRA eTIMS Integrator Support with the taxpayer and integrator details, then paste the token KRA replies with and press Issue. The company sees it in System → KRA eTIMS." />
      <Segmented<"requested" | "issued" | "all"> value={view} onChange={setView} options={[
        { value: "requested", label: "Waiting", count: data.filter((r: any) => r.status === "requested").length },
        { value: "issued", label: "Issued", count: data.filter((r: any) => r.status === "issued").length },
        { value: "all", label: "All", count: data.length },
      ]} />
      <Panel flush>
        {rows.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Nothing here.</p> : (
          <div className="overflow-x-auto"><table className="dt">
            <thead><tr><th>Company</th><th>KRA PIN</th><th>Branch</th><th>Device serial</th><th>Contact</th><th>Requested</th><th>Token</th><th /></tr></thead>
            <tbody>{rows.map((r: any) => (
              <tr key={r.id}>
                <td className="font-semibold">{r.company}</td>
                <td className="font-mono text-xs">{r.kra_pin}</td>
                <td>{r.branch_id}</td>
                <td className="font-mono text-xs">{r.device_serial}</td>
                <td className="text-xs">{[r.contact_phone, r.contact_email].filter(Boolean).join(" · ") || "—"}</td>
                <td className="text-xs">{new Date(r.requested_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td>{r.status === "requested"
                  ? <input className="fi h-9 w-56 font-mono text-xs" placeholder="Paste the integration token" value={tokens[r.id] || ""} onChange={(e) => setTokens({ ...tokens, [r.id]: e.target.value })} />
                  : r.status === "issued" ? <span className="font-mono text-xs">{r.token}</span> : <Pill tone="muted">Closed</Pill>}</td>
                <td className="whitespace-nowrap text-right">{r.status === "requested" ? <>
                  <Button size="sm" variant="outline" asChild><a href={kraTokenMail(r)}><Mail /> Email KRA</a></Button>
                  <Button size="sm" onClick={() => void decide(r, true)}><Check /> Issue</Button>
                  <Button size="sm" variant="ghost" onClick={() => void decide(r, false)}><X /></Button>
                </> : <Pill tone={r.status === "issued" ? "success" : "muted"}>{r.status}</Pill>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </div>
  );
}
