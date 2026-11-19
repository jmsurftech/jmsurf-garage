import { CheckCircle2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          // Confirmations clear after 3 s; problems stay long enough to read.
          <Toast key={id} duration={props.variant === "destructive" ? 6000 : 3000} {...props}>
            <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm ${props.variant === "destructive" ? "bg-red-600" : "bg-emerald-600"}`}>
              {props.variant === "destructive" ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
            </span>
            <div className="grid min-w-0 gap-0.5 pt-0.5">
              {title && <ToastTitle className="text-[15px] font-semibold leading-snug">{title}</ToastTitle>}
              {description && <ToastDescription className="text-sm opacity-80">{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
