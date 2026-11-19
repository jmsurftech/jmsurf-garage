import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PenLine, Stamp, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenantId";
import { useStaff } from "@/hooks/useData";
import { cleanInkImage, signatureUrl, type UserSignature } from "@/lib/signing";
import { friendlyError } from "@/lib/friendlyError";

const sb = supabase as any;

/** Shows a stored signature or stamp image (private file, short-lived link). */
function Ink({ path, label }: { path: string | null; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let on = true; void signatureUrl(path).then((u) => on && setUrl(u)); return () => { on = false; }; }, [path]);
  return (
    <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]">
      {url ? <img src={url} alt={label} className="max-h-20 max-w-[90%] object-contain" /> : <span className="text-xs text-muted-foreground">No {label.toLowerCase()} yet</span>}
    </div>
  );
}

/** One person's card: name and title as printed under the signature, signature and stamp uploads. */
function SignerCard({ person, row, canEdit }: { person: any; row: UserSignature | null; canEdit: boolean }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const [name, setName] = useState(row?.full_name || person.display_name || "");
  const [title, setTitle] = useState(row?.title || "");
  const [busy, setBusy] = useState("");
  const sigRef = useRef<HTMLInputElement>(null), stampRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setName(row?.full_name || person.display_name || ""); setTitle(row?.title || ""); }, [row?.full_name, row?.title, person.display_name]);
  const save = async (patch: Partial<UserSignature>) => {
    const { error } = await sb.from("user_signatures").upsert({ tenant_id: tenantId, user_id: person.user_id, full_name: name.trim() || null, title: title.trim() || null, ...patch, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,user_id" });
    if (error) throw error;
    void qc.invalidateQueries({ queryKey: ["user-signatures"] });
  };
  const upload = async (kind: "signature" | "stamp", f: File) => {
    if (!/^image\//.test(f.type)) return toast.error("Upload a photo or scan (PNG or JPG)");
    setBusy(kind);
    try {
      const png = await cleanInkImage(f, kind === "stamp" ? 700 : 900);
      const path = `${tenantId}/signatures/${person.user_id}/${kind}-${Date.now()}.png`;
      const { error } = await supabase.storage.from("documents").upload(path, png, { contentType: "image/png" });
      if (error) throw error;
      await save(kind === "signature" ? { signature_path: path } : { stamp_path: path });
      toast.success(kind === "signature" ? "Signature saved" : "Stamp saved", { description: "The paper background was removed so it sits cleanly on documents." });
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(""); }
  };
  return (
    <div className="space-y-3 rounded-2xl border border-border p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-medium text-muted-foreground">Name on documents<input className="fi mt-1" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} onBlur={() => canEdit && void save({}).catch((e) => toast.error(friendlyError(e)))} /></label>
        <label className="text-xs font-medium text-muted-foreground">Title<input className="fi mt-1" value={title} placeholder="Director" disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} onBlur={() => canEdit && void save({}).catch((e) => toast.error(friendlyError(e)))} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["signature", "stamp"] as const).map((k) => (
          <div key={k}>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold">{k === "signature" ? <PenLine className="h-3.5 w-3.5" /> : <Stamp className="h-3.5 w-3.5" />}{k === "signature" ? "Signature" : "Company stamp"}</p>
            <Ink path={(k === "signature" ? row?.signature_path : row?.stamp_path) || null} label={k === "signature" ? "Signature" : "Stamp"} />
            {canEdit && (
              <div className="mt-2 flex gap-2">
                <input ref={k === "signature" ? sigRef : stampRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(k, f); e.target.value = ""; }} />
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => (k === "signature" ? sigRef : stampRef).current?.click()}><Upload className="h-3.5 w-3.5" /> {busy === k ? "Saving…" : (k === "signature" ? row?.signature_path : row?.stamp_path) ? "Replace" : "Upload"}</Button>
                {(k === "signature" ? row?.signature_path : row?.stamp_path) && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void save(k === "signature" ? { signature_path: null } : { stamp_path: null }).catch((e) => toast.error(friendlyError(e)))}><Trash2 className="h-3.5 w-3.5" /></Button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** System → Signatures & stamps: who signs documents, with their e-signature and stamp. */
export default function Signatures() {
  const { user, role } = useAuth() as any;
  const manager = ["admin", "manager", "super_admin"].includes(String(role));
  const { data: staff = [] } = useStaff();
  const { data: rows = [] } = useQuery({ queryKey: ["user-signatures"], queryFn: async () => ((await sb.from("user_signatures").select("*")).data || []) as UserSignature[] });
  const people = (staff as any[]).filter((s) => manager || s.user_id === user?.id);
  return (
    <div className="space-y-5">
      <PageHeader title="Signatures & stamps" icon={PenLine} description="Each signer's signature and the company stamp, used on documents that must be signed." />
      <Panel title="Tips for clean results" icon={Stamp}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Sign in dark ink on plain white paper, take a straight, well-lit photo, then upload it. The white paper is removed automatically.</li>
          <li>For the stamp, stamp once on white paper and photograph it the same way. A round or rectangular stamp both work.</li>
          <li>Only the person and admins or managers can change a signature.</li>
        </ul>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        {people.map((p) => <div key={p.user_id}><p className="mb-2 text-sm font-semibold">{p.display_name}<span className="ml-2 text-xs font-normal capitalize text-muted-foreground">{String(p.role || "").replace(/_/g, " ")}</span></p><SignerCard person={p} row={(rows as any[]).find((r) => r.user_id === p.user_id) || null} canEdit={manager || p.user_id === user?.id} /></div>)}
      </div>
    </div>
  );
}
