import { cn } from "@/lib/utils";

/** "Powered by JMSURF TECHNOLOGIES", linking to www.jmsurf.co.ke. */
export default function PoweredBy({ className }: { className?: string }) {
  return (
    <a href="https://www.jmsurf.co.ke" target="_blank" rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary", className)}>
      Powered by <span className="font-semibold tracking-wide">JMSURF TECHNOLOGIES</span>
    </a>
  );
}
