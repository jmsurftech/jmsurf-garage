import { useEffect, useRef, useState } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, Download, CloudUpload, Clock, RotateCcw, HardDriveDownload, CheckCircle2, AlertTriangle, FileJson, Cloud, PlugZap, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel, Field, EmptyState, Modal } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { useToast } from "@/hooks/use-toast";
import { confirmAction } from "@/components/books/confirm";
import { erpApi, saveFile } from "@/lib/erpApi";
import { useErpSettings } from "./ErpSettingsTabs";
import { cn } from "@/lib/utils";

import { PagedRows } from "@/components/Pager";
const FREQS = [
  ["off", "Off"], ["hourly", "Every hour"], ["6h", "Every 6 hours"], ["12h", "Every 12 hours"],
  ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"],
] as const;
const size = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

type Backup = { id: string; kind: string; size_bytes: number; tables: Record<string, any>; status: string; error: string | null; created_at: string };

export default function BackupTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { settings, save } = useErpSettings();
  const [cfg, setCfg] = useState<any>({ frequency: "daily", keep: 14, hour: 2, modules: [] as string[], remote: { enabled: false, provider: "r2", prune: true } });
  useEffect(() => setCfg({ frequency: "daily", keep: 14, hour: 2, modules: [], ...(settings.backup || {}), remote: { enabled: false, provider: "r2", prune: true, ...(settings.backup?.remote || {}) } }), [settings.backup]);
  const [secret, setSecret] = useState("");
  const setRemote = (p: any) => setCfg({ ...cfg, remote: { ...cfg.remote, ...p } });
  const [busy, setBusy] = useState("");
  const [restore, setRestore] = useState<{ source: "file" | string; data?: any; label: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["backups"],
    refetchInterval: 60_000,
    queryFn: () => erpApi<{ backups: Backup[]; modules: Record<string, string> }>("backup/list"),
  });
  const backups = data?.backups || [];
  const modules = data?.modules || {};

  const saveSchedule = async () => {
    if (secret.trim()) {
      const { error: e2 } = await (supabase as any).rpc("set_integration_secret", { p_name: "backup_s3_secret", p_value: secret.trim() });
      if (e2) return toast({ title: "Secret not saved", description: e2.message, variant: "destructive" });
      setSecret("");
    }
    const { error } = await save("backup", { ...cfg, keep: Math.min(90, Math.max(1, Number(cfg.keep) || 14)), hour: Number(cfg.hour ?? 2) });
    toast(error ? { title: "Not saved", description: error.message, variant: "destructive" } : { title: "Backup settings saved" });
  };
  const testRemote = async () => {
    setBusy("test");
    try { await saveSchedule(); const r: any = await erpApi("backup/test-remote"); toast({ title: "Storage connected", description: `A test file was written to ${r.bucket} and removed.` }); }
    catch (e: any) { toast({ title: "Storage test failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  };
  const backupNow = async () => {
    setBusy("create");
    try { await erpApi("backup/create"); toast({ title: "Backup made", description: "Stored safely on the server." }); qc.invalidateQueries({ queryKey: ["backups"] }); }
    catch (e: any) { toast({ title: "Backup failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  };
  const download = async (id?: string) => {
    setBusy(id || "full");
    try {
      const d = await erpApi("backup/data", id ? { id } : {});
      saveFile(`jmsurf-dash-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`, JSON.stringify(d));
    } catch (e: any) { toast({ title: "Download failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  };
  const pickFile = async (f?: File) => {
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d?.format !== "garage-erp-backup") throw new Error("That file is not a JMSURF Garage backup");
      setRestore({ source: "file", data: d, label: `${f.name} (${when(d.created_at)})` });
    } catch (e: any) { toast({ title: "Can't use that file", description: e.message, variant: "destructive" }); }
  };
  const doRestore = async (mod: string) => {
    if (!restore) return;
    if (!(await confirmAction({ title: `Restore ${modules[mod]}?`, message: "Records from the backup are put back and records changed since are overwritten with the backup's version. Nothing newer is deleted. A safety backup is taken first.", confirmLabel: "Restore", danger: true }))) return;
    setBusy(`restore-${mod}`);
    try {
      const r = await erpApi<{ restored: Record<string, number> }>("backup/restore", restore.source === "file" ? { module: mod, data: restore.data } : { module: mod, id: restore.source });
      const n = Object.values(r.restored).reduce<number>((a, b) => a + (typeof b === "number" ? b : 0), 0);
      toast({ title: `${modules[mod]} restored`, description: `${n.toLocaleString()} records put back.` });
      qc.invalidateQueries();
      setRestore(null);
    } catch (e: any) { toast({ title: "Restore failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  };

  const restoreAll = async () => {
    if (!restore) return;
    if (!(await confirmAction({ title: "Restore everything?", message: "Every module in this backup is put back. Records changed since are overwritten with the backup's version; nothing newer is deleted. A safety backup is taken first.", confirmLabel: "Restore everything", danger: true }))) return;
    setBusy("restore-all");
    let total = 0; const failed: string[] = [];
    for (const mod of Object.keys(modules)) {
      try {
        const r = await erpApi<{ restored: Record<string, number | string> }>("backup/restore", restore.source === "file" ? { module: mod, data: restore.data } : { module: mod, id: restore.source });
        total += Object.values(r.restored).reduce<number>((a, b) => a + (typeof b === "number" ? b : 0), 0);
      } catch { failed.push(modules[mod]); }
    }
    setBusy(""); qc.invalidateQueries(); setRestore(null);
    toast({ title: "Restore finished", description: `${total.toLocaleString()} records put back.${failed.length ? ` Not in this backup: ${failed.join(", ")}.` : ""}` });
  };

  if (isLoading) return <OrbLoader label="Loading backups…" />;
  if (error) return <EmptyState icon={DatabaseBackup} title="Backups are for the owner" description={(error as Error).message} />;
  const lastOk = backups.find((b) => b.status === "ok");

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Last backup</p>
          <p className="mt-1 font-display text-lg font-bold">{lastOk ? when(lastOk.created_at) : "None yet"}</p>
          {lastOk && <p className="text-xs text-muted-foreground">{lastOk.kind === "auto" ? "Automatic" : "Manual"} · {size(lastOk.size_bytes)}</p>}
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Schedule</p>
          <p className="mt-1 font-display text-lg font-bold">{FREQS.find(([v]) => v === (settings.backup?.frequency || "daily"))?.[1]}</p>
          <p className="text-xs text-muted-foreground">Keeps the last {settings.backup?.keep || 14} automatic backups</p>
        </div>
        <div className="flex flex-col justify-center gap-2 rounded-2xl border border-border bg-card p-4">
          <Button onClick={backupNow} disabled={!!busy}>{busy === "create" ? <OrbSpinner /> : <CloudUpload />} Back up now</Button>
          <Button variant="outline" onClick={() => download()} disabled={!!busy}>{busy === "full" ? <OrbSpinner /> : <HardDriveDownload />} Download a full backup</Button>
        </div>
      </div>

      <Panel title="Automatic backups" icon={Clock} description="Backups are kept on the server in a private store. Download any of them to keep a copy on your computer.">
        <div className="grid gap-4 sm:grid-cols-[1fr_160px_auto] sm:items-end">
          <Field label="How often">
            <div className="flex flex-wrap gap-1.5">
              {FREQS.map(([v, l]) => (
                <button key={v} type="button" onClick={() => setCfg({ ...cfg, frequency: v })}
                  className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold", cfg.frequency === v ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>{l}</button>
              ))}
            </div>
          </Field>
          <Field label="Keep the last"><input className="fi" type="number" min={1} max={90} value={cfg.keep} onChange={(e) => setCfg({ ...cfg, keep: Number(e.target.value) })} /></Field>
          <Button onClick={saveSchedule}>Save</Button>
        </div>
        {["daily", "weekly", "monthly"].includes(cfg.frequency) && (
          <Field label="At (Nairobi time)" className="mt-4 max-w-[12rem]">
            <select className="fi" value={cfg.hour ?? 2} onChange={(e) => setCfg({ ...cfg, hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select>
          </Field>
        )}
        <Field label="What to back up" hint="Nothing ticked = everything" className="mt-4">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(modules).map(([k, l]) => {
              const on = cfg.modules?.includes(k);
              return <button key={k} type="button" onClick={() => setCfg({ ...cfg, modules: on ? cfg.modules.filter((x: string) => x !== k) : [...(cfg.modules || []), k] })}
                className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold", on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}><Layers className="h-3 w-3" />{l}</button>;
            })}
          </div>
        </Field>
      </Panel>

      <Panel title="Also copy to your own storage" icon={Cloud} description="Every backup is also copied to your own S3-compatible storage (R2, S3, Wasabi, B2, Spaces)."
        actions={<label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!cfg.remote?.enabled} onChange={(e) => setRemote({ enabled: e.target.checked })} /> On</label>}>
        <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", !cfg.remote?.enabled && "pointer-events-none opacity-50")}>
          <Field label="Storage">
            <div className="flex items-center gap-2"><BrandLogo id={cfg.remote?.provider === "custom" ? "custom_s3" : cfg.remote?.provider || "r2"} name={cfg.remote?.provider || "S3"} className="h-10 w-10" /><select className="fi" value={cfg.remote?.provider || "r2"} onChange={(e) => setRemote({ provider: e.target.value })}>
              <option value="r2">Cloudflare R2</option><option value="aws">Amazon S3</option><option value="wasabi">Wasabi</option><option value="b2">Backblaze B2</option><option value="spaces">DigitalOcean Spaces</option><option value="custom">Other S3-compatible</option>
            </select></div>
          </Field>
          {cfg.remote?.provider === "r2" && <Field label="Cloudflare account ID"><input className="fi font-mono" value={cfg.remote?.account || ""} onChange={(e) => setRemote({ account: e.target.value.trim() })} /></Field>}
          {["aws", "wasabi", "b2", "spaces"].includes(cfg.remote?.provider) && <Field label="Region" hint="e.g. eu-west-1, us-west-004, fra1"><input className="fi font-mono" value={cfg.remote?.region || ""} onChange={(e) => setRemote({ region: e.target.value.trim() })} /></Field>}
          {cfg.remote?.provider === "custom" && <Field label="Endpoint" hint="Your S3-compatible storage URL"><input className="fi font-mono" value={cfg.remote?.endpoint || ""} onChange={(e) => setRemote({ endpoint: e.target.value.trim() })} /></Field>}
          <Field label="Bucket"><input className="fi font-mono" value={cfg.remote?.bucket || ""} onChange={(e) => setRemote({ bucket: e.target.value.trim() })} /></Field>
          <Field label="Folder (optional)"><input className="fi font-mono" placeholder="jmsurf-dash" value={cfg.remote?.prefix || ""} onChange={(e) => setRemote({ prefix: e.target.value.trim() })} /></Field>
          <Field label="Access key ID"><input className="fi font-mono" autoComplete="off" value={cfg.remote?.access_key_id || ""} onChange={(e) => setRemote({ access_key_id: e.target.value.trim() })} /></Field>
          <Field label="Secret access key" hint="Stored on the server, never shown again. Leave empty to keep the saved one."><input className="fi font-mono" type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} /></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={cfg.remote?.prune !== false} onChange={(e) => setRemote({ prune: e.target.checked })} /> Remove old copies there too</label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={saveSchedule} disabled={!!busy}>Save</Button>
          <Button variant="outline" onClick={() => void testRemote()} disabled={!!busy || !cfg.remote?.enabled}>{busy === "test" ? <OrbSpinner /> : <PlugZap />} Test connection</Button>
        </div>
      </Panel>

      <Panel title="Restore" icon={RotateCcw} description="Put back everything, or one module, from a backup on the server or a file you downloaded.">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => fileRef.current?.click()}><FileJson /> Restore from a file…</Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }} />
          <p className="self-center text-xs text-muted-foreground">or pick a backup below and choose Restore.</p>
        </div>
      </Panel>

      <Panel title="Backups" icon={DatabaseBackup} flush>
        {backups.length === 0 ? <EmptyState icon={DatabaseBackup} title="No backups yet" description="The first automatic backup runs within a few minutes, or press Back up now." /> : (
          <ul className="divide-y divide-border">
            <PagedRows rows={backups} list>{(pageRows) => pageRows.map((b) => {
              const total = Object.values(b.tables || {}).reduce<number>((a, v) => a + (typeof v === "number" ? v : 0), 0);
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <span className={cn("flex h-9 w-9 items-center justify-center rounded-full", b.status === "ok" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
                    {b.status === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{when(b.created_at)} <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{b.kind === "auto" ? "Automatic" : "Manual"}</span></p>
                    <p className="text-xs text-muted-foreground">{b.status === "ok" ? `${total.toLocaleString()} records · ${size(b.size_bytes)}` : b.error}{typeof b.tables?._remote === "string" && <span className={cn("ml-2", String(b.tables._remote).startsWith("copied") ? "text-success" : "text-destructive")}>· {String(b.tables._remote).startsWith("copied") ? "copied to your storage" : `your storage: ${String(b.tables._remote).replace(/^failed: /, "")}`}</span>}</p>
                  </div>
                  {b.status === "ok" && <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => download(b.id)} disabled={!!busy}>{busy === b.id ? <OrbSpinner /> : <Download />} Download</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRestore({ source: b.id, label: when(b.created_at) })}><RotateCcw /> Restore</Button>
                  </div>}
                </li>
              );
            })}</PagedRows>
          </ul>
        )}
      </Panel>

      <Modal open={!!restore} onClose={() => setRestore(null)} title="Restore" description={restore?.label} icon={RotateCcw} size="lg">
        <button type="button" disabled={!!busy} onClick={() => void restoreAll()} className="mb-3 flex w-full items-center justify-between rounded-xl border-2 border-primary/40 bg-primary/5 p-3 text-left font-semibold hover:border-primary disabled:opacity-50">Everything in this backup {busy === "restore-all" ? <OrbSpinner /> : <RotateCcw className="h-4 w-4 text-primary" />}</button>
        <p className="mb-2 text-xs text-muted-foreground">Or one module:</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(modules).map(([k, label]) => (
            <button key={k} type="button" disabled={!!busy} onClick={() => doRestore(k)}
              className="flex items-center justify-between gap-2 rounded-xl border border-border p-3 text-left hover:border-primary disabled:opacity-50">
              <span className="font-semibold">{label}</span>{busy === `restore-${k}` ? <OrbSpinner /> : <RotateCcw className="h-4 w-4 text-muted-foreground" />}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
