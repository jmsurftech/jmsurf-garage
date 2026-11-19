import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessagesSquare, Paperclip, Send, X, UserCog, CheckCircle2, Ban } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { Panel, EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { openDocument } from "@/components/DocumentsPanel";
import { erpApi } from "@/lib/erpApi";
import { fmtDate } from "@/lib/doc-pdf";
import { friendlyError } from "@/lib/friendlyError";
import { cn } from "@/lib/utils";

const sb: any = supabase;

/** Unread customer messages for one customer (tab badge). */
export function usePortalUnread(customerId: string) {
  return useQuery({
    queryKey: ["portal-unread", customerId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count } = await sb.from("portal_messages").select("id", { count: "exact", head: true }).eq("customer_id", customerId).eq("sender", "customer").is("read_by_staff_at", null);
      return Number(count || 0);
    },
  });
}

/** The customer's portal thread: their messages and the team's replies (the customer is emailed). */
export function PortalMessages({ customer }: { customer: { id: string; name: string } }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ["portal-thread", customer.id],
    refetchInterval: 20_000,
    queryFn: async () => ((await sb.from("portal_messages").select("*").eq("customer_id", customer.id).order("created_at").limit(500)).data || []) as any[],
  });
  const unread = data.filter((m) => m.sender === "customer" && !m.read_by_staff_at).length;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
    if (!unread) return;
    void sb.from("portal_messages").update({ read_by_staff_at: new Date().toISOString() }).eq("customer_id", customer.id).eq("sender", "customer").is("read_by_staff_at", null)
      .then(() => { void qc.invalidateQueries({ queryKey: ["portal-unread", customer.id] }); });
  }, [data.length, unread, customer.id, qc]);

  const send = async () => {
    if (!tenantId || (!body.trim() && !file)) return;
    if (file && file.size > 5 * 1024 * 1024) return toast.error("Files up to 5 MB");
    setBusy(true);
    try {
      let f: Record<string, unknown> = {};
      if (file) {
        const safe = file.name.replace(/[^a-z0-9.]+/gi, "-").toLowerCase();
        const path = `${tenantId}/portal/${customer.id}/${Date.now()}-${safe}`;
        const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || "application/octet-stream" });
        if (error) throw error;
        f = { file_path: path, file_name: file.name, file_mime: file.type || null, file_size: file.size };
      }
      const r = await erpApi<any>("portal/reply", { customer_id: customer.id, body, ...f });
      setBody(""); setFile(null);
      void refetch();
      toast.success(r.emailed ? "Sent. They were emailed too." : "Sent. They see it in their portal.");
    } catch (e) { toast.error(friendlyError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Panel title="Portal messages" icon={MessagesSquare} description="What the customer writes in their portal, and your replies. They get an email when you reply.">
      <div className="max-h-[55vh] min-h-[14rem] space-y-3 overflow-y-auto pr-1">
        {isLoading ? <OrbLoader label="Loading messages…" /> : data.length === 0 ? <EmptyState icon={MessagesSquare} title="No messages yet" description="When the customer writes from their portal, it shows here." /> : data.map((m) => {
          const staff = m.sender === "staff";
          return (
            <div key={m.id} className={cn("flex", staff ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-sm", staff ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted")}>
                <p className="mb-0.5 text-xs font-semibold opacity-80">{staff ? m.staff_name || "Staff" : customer.name}</p>
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                {m.attachment_path && <button onClick={() => openDocument({ path: m.attachment_path, url: null, name: m.attachment_name, mime_type: m.attachment_mime }).catch((e) => toast.error(friendlyError(e)))} className={cn("mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold", staff ? "bg-white/20" : "bg-card")}><Paperclip className="h-3.5 w-3.5" /> {m.attachment_name || "File"}</button>}
                <p className={cn("mt-1 text-[10px]", staff ? "text-primary-foreground/75" : "text-muted-foreground")}>{new Date(m.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{staff && m.read_by_customer_at ? " · Read" : ""}</p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="mt-3 border-t border-border pt-3">
        {file && <p className="mb-2 inline-flex items-center gap-2 rounded-lg bg-muted px-2 py-1 text-xs"><Paperclip className="h-3.5 w-3.5" /> {file.name}<button onClick={() => setFile(null)} aria-label="Remove file"><X className="h-3.5 w-3.5" /></button></p>}
        <div className="flex items-end gap-2">
          <button onClick={() => input.current?.click()} className="icon-btn" aria-label="Attach a file" title="Attach a file (up to 5 MB)"><Paperclip className="h-4 w-4" /></button>
          <textarea className="fi min-h-[44px] flex-1" rows={2} placeholder={`Reply to ${customer.name}…`} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send(); }} />
          <Button onClick={() => void send()} disabled={busy || (!body.trim() && !file)}>{busy ? <OrbSpinner /> : <Send />} Reply</Button>
        </div>
        <input ref={input} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.txt,.csv,.doc,.docx,.xls,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] || null); e.target.value = ""; }} />
      </div>
    </Panel>
  );
}

const LABEL: Record<string, string> = { name: "Name", phone: "Phone (sign-in)", email: "Email", alt_phone: "Other phone", company_name: "Company", kra_pin: "KRA PIN", address: "Address", area: "Area / estate", building: "Building / house no.", landmark: "Landmark" };

/** Contact changes the customer sent from the portal, waiting for approval. */
export function ProfileUpdates({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const { data = [] } = useQuery({
    queryKey: ["profile-updates", customerId],
    queryFn: async () => ((await sb.from("customer_profile_updates").select("*").eq("customer_id", customerId).eq("status", "pending").order("created_at", { ascending: false })).data || []) as any[],
  });
  if (!data.length) return null;
  const review = async (id: string, approve: boolean) => {
    setBusy(id);
    try {
      await erpApi("portal/profile-review", { id, approve });
      toast.success(approve ? "Changes applied" : "Changes rejected");
      void qc.invalidateQueries({ queryKey: ["profile-updates", customerId] });
      void qc.invalidateQueries({ queryKey: ["zcustomers"] });
    } catch (e) { toast.error(friendlyError(e)); }
    finally { setBusy(null); }
  };
  return (
    <Panel title="Contact changes to approve" icon={UserCog} className="border-warning/40">
      {data.map((u) => (
        <div key={u.id} className="space-y-2">
          <p className="text-xs text-muted-foreground">Sent from the portal on {fmtDate(u.created_at)}</p>
          <table className="dt"><thead><tr><th>Field</th><th>Now</th><th>New</th></tr></thead>
            <tbody>{Object.entries(u.changes || {}).map(([k, v]) => <tr key={k}><td>{LABEL[k] || k}</td><td className="text-muted-foreground">{String(u.previous?.[k] ?? "—")}</td><td className="font-semibold">{String(v ?? "—")}</td></tr>)}</tbody></table>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void review(u.id, true)} disabled={busy === u.id}><CheckCircle2 /> Approve</Button>
            <Button size="sm" variant="outline" onClick={() => void review(u.id, false)} disabled={busy === u.id}><Ban /> Reject</Button>
          </div>
        </div>
      ))}
    </Panel>
  );
}
