import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Promise-based confirmation, used like window.confirm but styled:
 *   if (!(await confirmAction({ title: "Delete quote?", danger: true }))) return;
 */
export function confirmAction(opts: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: boolean) => { resolve(v); setTimeout(() => { root.unmount(); host.remove(); }, 0); };
    root.render(<ConfirmBox {...opts} onDone={done} />);
  });
}

function ConfirmBox({ title, message, confirmLabel = "Confirm", danger, onDone }: { title: string; message?: string; confirmLabel?: string; danger?: boolean; onDone: (v: boolean) => void }) {
  const [open] = useState(true);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm animate-in fade-in-0" onMouseDown={(e) => e.target === e.currentTarget && onDone(false)}>
      <div role="alertdialog" aria-modal="true" className="w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)] animate-in zoom-in-95 fade-in-0">
        <div className={`h-1.5 w-full ${danger ? "bg-gradient-to-r from-red-500 to-orange-400" : "bg-gradient-to-r from-primary to-primary/60"}`} />
        <div className="flex flex-col items-center px-6 pb-2 pt-6 text-center">
          <span className={`flex h-14 w-14 items-center justify-center rounded-full ${danger ? "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400" : "bg-primary/10 text-primary"}`}>
            <AlertTriangle className="h-7 w-7" />
          </span>
          <h2 className="mt-4 font-display text-xl font-bold leading-tight">{title}</h2>
          {message && <p className="mt-2 text-sm text-muted-foreground">{message}</p>}
        </div>
        <div className="flex flex-col-reverse gap-2 p-6 pt-4 sm:flex-row sm:justify-center">
          <Button variant="outline" onClick={() => onDone(false)} autoFocus>Cancel</Button>
          <Button variant={danger ? "destructive" : "default"} onClick={() => onDone(true)}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
