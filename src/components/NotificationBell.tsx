import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const sb: any = supabase;

/** Short two-note chime so reception hears a new order or a low tank. */
export function playChime() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.start(t); o.stop(t + 0.4);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch { /* sound is a nicety */ }
}

/** Shop notifications (low tank, new delivery orders…) in the top bar. */
export default function NotificationBell({ makePath }: { makePath: (p: string) => string }) {
  const tenantId = useTenantId();
  const { user, role } = useAuth() as any;
  /** A notification is for me when it targets nobody in particular, me, or my role. */
  const forMe = (n: any) => (!n.user_id || n.user_id === user?.id) && (!n.role || n.role === role || role === "admin" || role === "super_admin");
  const qc = useQueryClient();
  const { toast } = useToast();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const { data: rows = [] } = useQuery({
    queryKey: ["company-notifications", tenantId],
    enabled: !!tenantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from("shop_notifications").select("id,kind,title,body,link,read_at,created_at,user_id,role")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(60);
      if (error) return [];
      return (data || []).filter(forMe).slice(0, 30);
    },
  });

  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase.channel(`shop-notifications-${tenantId}`)
      .on("postgres_changes" as any, { event: "INSERT", schema: "public", table: "shop_notifications", filter: `tenant_id=eq.${tenantId}` },
        (payload: any) => {
          const n = payload.new || {};
          if (!forMe(n)) return;
          playChime();
          toast({ title: n.title || "New notification", description: n.body || undefined });
          qc.invalidateQueries({ queryKey: ["company-notifications", tenantId] });
          if (n.kind?.startsWith("order")) qc.invalidateQueries({ queryKey: ["water-orders"] });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, qc, toast]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { const t = e.target as Node; if (box.current?.contains(t) || panel.current?.contains(t)) return; setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const unread = rows.filter((r: any) => !r.read_at);

  const markRead = async (ids: string[]) => {
    if (!ids.length) return;
    await sb.from("shop_notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
    qc.invalidateQueries({ queryKey: ["company-notifications", tenantId] });
  };

  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Notifications"
        className="relative rounded-xl p-2 hover:bg-muted">
        <Bell className="h-5 w-5" />
        {unread.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>
      {open && createPortal(
        <div ref={panel} className="fixed right-3 top-[3.75rem] z-[80] w-[min(94vw,380px)] overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl sm:top-[4.25rem]">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {unread.length > 0 && (
              <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                onClick={() => markRead(unread.map((r: any) => r.id))}><CheckCheck className="h-3.5 w-3.5" /> Mark all read</button>
            )}
          </div>
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
            {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing yet.</li>}
            {rows.map((r: any) => (
              <li key={r.id}>
                <button type="button" className={cn("block w-full px-4 py-3 text-left hover:bg-muted/60", !r.read_at && "bg-primary/5")}
                  onClick={() => { markRead([r.id]); setOpen(false); if (r.link) nav(makePath(r.link)); }}>
                  <p className="text-sm font-medium">{r.title}</p>
                  {r.body && <p className="mt-0.5 text-xs text-muted-foreground">{r.body}</p>}
                  <p className="mt-1 text-[11px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>, document.body,
      )}
    </div>
  );
}
