import { getAuthUser } from "@/lib/authUser";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe2, Plus, Trash2, ExternalLink } from "lucide-react";
import { Panel, Field, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { confirmAction } from "@/components/books/confirm";

const sb: any = supabase;
export const SERVER_IP = "37.60.255.35";

const cleanHost = (v: string) => v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");

/**
 * Platform admin: the shop's own domain (e.g. maji.co.ke or order.maji.co.ke).
 * Once saved, the server picks it up within a minute, gets it a certificate,
 * and the domain opens this shop exactly like <slug>.garage.jmsurf.co.ke.
 */
export default function CustomDomainPanel({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: domains = [] } = useQuery({
    queryKey: ["tenant-domains", tenantId],
    queryFn: async () => {
      const { data, error } = await sb.from("tenant_domains").select("id,host,status,created_at").eq("tenant_id", tenantId).eq("kind", "custom").order("created_at");
      if (error) throw error;
      return data || [];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["tenant-domains", tenantId] });

  const add = async () => {
    const h = cleanHost(host);
    if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(h) || h.endsWith("garage.jmsurf.co.ke")) {
      toast({ title: "Enter a domain like maji.co.ke or order.maji.co.ke", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { data: { user } } = await getAuthUser();
    const { error } = await sb.from("tenant_domains").insert({
      tenant_id: tenantId, host: h, kind: "custom", status: "approved",
      approved_by: user?.id ?? null, approved_at: new Date().toISOString(), activated_at: new Date().toISOString(),
      payment_status: "waived", dns_target: SERVER_IP,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not add the domain", description: /unique|duplicate/i.test(error.message) ? "That domain is already used by a company." : error.message, variant: "destructive" });
      return;
    }
    setHost("");
    refresh();
    toast({ title: "Domain added", description: "Point its DNS to the server. It works within a few minutes of the DNS being right." });
  };

  const remove = async (id: string, h: string) => {
    if (!(await confirmAction({ title: `Stop serving this company on ${h}?`, danger: true, confirmLabel: "Stop" }))) return;
    const { error } = await sb.from("tenant_domains").delete().eq("id", id);
    if (error) toast({ title: "Could not remove", description: error.message, variant: "destructive" });
    refresh();
  };

  return (
    <Panel title="Custom domain" icon={Globe2} description="The company opens on its own domain too: customers order there, staff and riders sign in there.">
      <div className="space-y-4">
        {domains.length > 0 && (
          <ul className="divide-y divide-border rounded-xl border border-border text-sm">
            {domains.map((d: any) => (
              <li key={d.id} className="flex items-center gap-2 px-3 py-2">
                <a href={`https://${d.host}`} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-mono hover:text-primary">{d.host}<ExternalLink className="h-3 w-3 shrink-0" /></a>
                <Pill tone={d.status === "approved" || d.status === "active" ? "success" : "muted"}>{d.status === "approved" || d.status === "active" ? "On" : d.status}</Pill>
                <button type="button" className="icon-btn-danger h-7 w-7" onClick={() => remove(d.id, d.host)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
        <Field label="Add a domain">
          <div className="flex gap-2">
            <input className="fi flex-1 font-mono" value={host} onChange={(e) => setHost(e.target.value)} placeholder="order.myshop.co.ke" />
            <Button disabled={!host.trim() || busy} onClick={add}><Plus /> Add</Button>
          </div>
        </Field>
        <div className="rounded-xl bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
          <p className="mb-1 font-semibold text-foreground">DNS for the company's domain</p>
          <p>Add an <b>A record</b> for the domain (or subdomain) pointing to <span className="font-mono text-foreground">{SERVER_IP}</span>.</p>
          <p>On Cloudflare keep it <b>DNS only</b> (grey cloud) until the site opens with a padlock; it can be proxied after that.</p>
          <p>The certificate is issued automatically within a few minutes of the DNS being correct.</p>
        </div>
      </div>
    </Panel>
  );
}
