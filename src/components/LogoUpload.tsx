import { useState, useRef, useCallback } from "react";
import { Upload, X, ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { logoColor, saveCompanyTheme } from "@/lib/companyTheme";
import { useTheme } from "@/hooks/useTheme";

export default function LogoUpload() {
  const { tenant, refetch } = useTenant();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const qc = useQueryClient();
  const { setTheme } = useTheme();

  const upload = useCallback(async (file: File) => {
    if (!tenant) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image file", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 2MB", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${tenant.id}/logo.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("tenant-logos")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from("tenant-logos").getPublicUrl(path);
      const logoUrl = urlData.publicUrl + "?t=" + Date.now();

      const { error: updateErr } = await (supabase as any)
        .from("tenants")
        .update({ logo_url: logoUrl })
        .eq("id", tenant.id);
      if (updateErr) throw updateErr;

      refetch();
      // The system and every document take the logo's colour (changeable in Settings → Appearance).
      const hex = await logoColor(file);
      if (hex) {
        await saveCompanyTheme(tenant.id, { preset: null, custom: hex });
        setTheme({ custom: hex });
        void qc.invalidateQueries({ queryKey: ["business-settings"] });
      }
      toast({ title: "Logo updated", description: hex ? "The system and your documents now use your logo's colour. Change it any time in Settings → Appearance." : undefined });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [tenant, refetch, toast, qc, setTheme]);

  const removeLogo = async () => {
    if (!tenant) return;
    setUploading(true);
    try {
      const { error } = await (supabase as any)
        .from("tenants")
        .update({ logo_url: null })
        .eq("id", tenant.id);
      if (error) throw error;
      refetch();
      toast({ title: "Logo removed" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) upload(file);
  };

  return (
    <div className="space-y-3">
      <h2 className="font-semibold flex items-center gap-2">
        <ImageIcon className="w-4 h-4" /> Business Logo
      </h2>
      <p className="text-xs text-muted-foreground">
        Upload your logo. It will appear on receipts, login page, and across the app.
      </p>

      {tenant?.logo_url ? (
        <div className="flex items-center gap-4">
          <img
            src={tenant.logo_url}
            alt="Logo"
            className="w-20 h-20 rounded-xl object-contain border border-border bg-muted p-1"
          />
          <div className="space-y-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-lg"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" /> Change
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-lg text-destructive hover:text-destructive"
              onClick={removeLogo}
              disabled={uploading}
            >
              <X className="w-3.5 h-3.5 mr-1.5" /> Remove
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
          }`}
        >
          <Upload className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {uploading ? "Uploading..." : "Drag & drop or click to upload"}
          </p>
          <p className="text-xs text-muted-foreground/60">PNG, JPG up to 2MB</p>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />
      <FaviconUpload />
    </div>
  );
}

/** Favicon: the small icon in the browser tab and on phones' home screens (default: the JMSURF Garage mark). */
function FaviconUpload() {
  const { tenant, refetch } = useTenant();
  const { toast } = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const current = (tenant as any)?.favicon_url as string | null;
  const save = async (url: string | null) => {
    const { error } = await (supabase as any).from("tenants").update({ favicon_url: url }).eq("id", tenant!.id);
    if (error) throw error;
    refetch();
  };
  const pick = async (file: File) => {
    if (!tenant) return;
    if (!/^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml)$/.test(file.type)) return toast({ title: "Use a PNG, ICO or SVG file", variant: "destructive" });
    if (file.size > 512 * 1024) return toast({ title: "Favicon too large", description: "Max 512 KB. A square 64×64 or 512×512 PNG works best.", variant: "destructive" });
    setBusy(true);
    try {
      const ext = file.type === "image/svg+xml" ? "svg" : file.type.includes("icon") ? "ico" : "png";
      const path = `${tenant.id}/favicon.${ext}`;
      const { error } = await supabase.storage.from("tenant-logos").upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      await save(supabase.storage.from("tenant-logos").getPublicUrl(path).data.publicUrl + "?t=" + Date.now());
      toast({ title: "Favicon updated", description: "Browser tabs show it after the next reload." });
    } catch (e: any) { toast({ title: "Not uploaded", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-5 border-t border-border pt-4">
      <h2 className="font-semibold flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Favicon</h2>
      <p className="text-xs text-muted-foreground">The small icon on browser tabs and home screens. Square PNG, ICO or SVG, 64×64 or larger. Without one, the JMSURF Garage icon is used.</p>
      <div className="mt-3 flex items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-muted">
          <img src={current || "/favicon-64.png"} alt="Favicon" className="h-8 w-8 object-contain" />
        </span>
        <Button size="sm" variant="outline" className="rounded-lg" onClick={() => ref.current?.click()} disabled={busy}><Upload className="w-3.5 h-3.5 mr-1.5" /> {busy ? "Uploading…" : current ? "Change" : "Upload favicon"}</Button>
        {current && <Button size="sm" variant="ghost" className="rounded-lg text-destructive hover:text-destructive" disabled={busy} onClick={async () => { setBusy(true); try { await save(null); toast({ title: "Favicon removed" }); } finally { setBusy(false); } }}><X className="w-3.5 h-3.5 mr-1.5" /> Remove</Button>}
      </div>
      <input ref={ref} type="file" accept=".png,.ico,.svg,image/png,image/x-icon,image/svg+xml" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ""; }} />
    </div>
  );
}
