import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = Omit<React.ComponentProps<"input">, "type"> & { wrapperClassName?: string };

/** Password field with a show/hide eye button inside its right edge. Drop-in for <input type="password">. */
export const PasswordInput = React.forwardRef<HTMLInputElement, Props>(({ className, wrapperClassName, ...props }, ref) => {
  const [show, setShow] = React.useState(false);
  return (
    <div className={cn("relative", wrapperClassName)}>
      <input ref={ref} type={show ? "text" : "password"} className={cn(className, "pr-10")} {...props} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        title={show ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
