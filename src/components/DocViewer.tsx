import { useEffect, useState } from "react";
import { Download, ExternalLink, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrbLoader } from "@/components/orbs";

type ViewReq = { url: string; name?: string; mime?: string | null };
const EVT = "ft:view-document";

/** Ask the in-app viewer to show a file (PDF, image or text); anything else offers a download. */
export function viewDocument(req: ViewReq) {
  window.dispatchEvent(new CustomEvent<ViewReq>(EVT, { detail: req }));
}

/** Full-screen document viewer, mounted once in the layout. */
export default function DocViewer() {
  const [req, setReq] = useState<ViewReq | null>(null);
  const [blob, setBlob] = useState<{ url: string; type: string } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const on = (e: Event) => setReq((e as CustomEvent<ViewReq>).detail);
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  useEffect(() => {
    if (!req) return;
    let gone = false, made = "";
    setBlob(null); setErr("");
    fetch(req.url).then(async (r) => {
      if (!r.ok) throw new Error(`The file could not be loaded (${r.status})`);
      const b = await r.blob();
      if (gone) return;
      made = URL.createObjectURL(b);
      setBlob({ url: made, type: req.mime || b.type || "" });
    }).catch((e) => !gone && setErr(e.message));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setReq(null);
    window.addEventListener("keydown", esc);
    return () => { gone = true; window.removeEventListener("keydown", esc); if (made) URL.revokeObjectURL(made); };
  }, [req]);
  if (!req) return null;
  const name = req.name || "Document";
  const kind = blob ? (blob.type.includes("pdf") || /\.pdf$/i.test(name) ? "pdf" : blob.type.startsWith("image/") ? "image" : blob.type.startsWith("text/") ? "text" : "other") : null;
  const download = () => { if (!blob) return; const a = document.createElement("a"); a.href = blob.url; a.download = name; a.click(); };
  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black/80 backdrop-blur-sm animate-in fade-in-0" role="dialog" aria-label={name}>
      <div className="flex items-center gap-2 bg-card px-4 py-2.5 shadow">
        <FileText className="h-5 w-5 text-primary" />
        <p className="min-w-0 flex-1 truncate font-semibold">{name}</p>
        <Button size="sm" variant="outline" onClick={download} disabled={!blob}><Download /> Download</Button>
        <Button size="sm" variant="ghost" onClick={() => window.open(req.url, "_blank", "noopener")} className="hidden sm:inline-flex"><ExternalLink /> New tab</Button>
        <Button size="icon" variant="ghost" onClick={() => setReq(null)} aria-label="Close"><X /></Button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2 sm:p-4" onClick={(e) => e.target === e.currentTarget && setReq(null)}>
        {err ? <p className="rounded-xl bg-card p-6 text-sm text-destructive">{err}</p>
          : !blob ? <div className="rounded-2xl bg-card p-6"><OrbLoader label="Opening the document…" /></div>
          : kind === "pdf" ? <iframe title={name} src={blob.url} className="h-full w-full max-w-5xl rounded-xl bg-white" />
          : kind === "image" ? <img src={blob.url} alt={name} className="max-h-full max-w-full rounded-xl object-contain shadow-2xl" />
          : kind === "text" ? <iframe title={name} src={blob.url} className="h-full w-full max-w-4xl rounded-xl bg-white" />
          : <div className="rounded-2xl bg-card p-8 text-center"><FileText className="mx-auto h-10 w-10 text-muted-foreground" /><p className="mt-3 font-semibold">This file type can't be previewed here</p><p className="text-sm text-muted-foreground">Download it to open it in its app.</p><Button className="mt-4" onClick={download}><Download /> Download</Button></div>}
      </div>
    </div>
  );
}
