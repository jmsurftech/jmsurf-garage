import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, X, LifeBuoy, Activity } from "lucide-react";
import { useTenant } from "@/hooks/useTenant";
import { useSupportContact, supportWhatsAppUrl } from "@/lib/support";
import { cn } from "@/lib/utils";
import { useRegisterDropdown } from "@/lib/singleDropdown";

/** Floating help button inside the shop app: WhatsApp support, help centre, status. */
export default function SupportButton({ helpPath, page, className }: { helpPath: string; page?: string; className?: string }) {
  const { tenant } = useTenant() as any;
  const support = useSupportContact();
  const [open, setOpen] = useState(false);
  useRegisterDropdown(open, () => setOpen(false));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className={cn("fixed right-4 z-40 print:hidden", className)}>
      {open && (
        <div className="absolute bottom-14 right-0 w-64 rounded-2xl border border-border bg-card p-2 shadow-elevated">
          <p className="px-3 pb-1 pt-2 text-xs font-semibold text-muted-foreground">Need help?</p>
          {support.whatsappEnabled && (
            <a href={supportWhatsAppUrl(support.whatsapp, tenant?.name, page)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-muted">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#25D366] text-white"><MessageCircle className="h-4 w-4" /></span>
              <span><span className="block font-medium">Chat with support</span><span className="text-xs text-muted-foreground">On WhatsApp</span></span>
            </a>
          )}
          <Link to={helpPath} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-muted">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary"><LifeBuoy className="h-4 w-4" /></span>
            <span><span className="block font-medium">Help centre</span><span className="text-xs text-muted-foreground">Quick answers</span></span>
          </Link>
          <a href="/status" target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-muted">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground"><Activity className="h-4 w-4" /></span>
            <span><span className="block font-medium">System status</span><span className="text-xs text-muted-foreground">Is everything working?</span></span>
          </a>
        </div>
      )}
      <button onClick={() => setOpen((v) => !v)} aria-label={open ? "Close help" : "Get help"}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-elevated transition-transform hover:scale-105">
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>
    </div>
  );
}
