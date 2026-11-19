import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ListChecks, Eye, EyeOff, Save } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useModules } from "@/hooks/useModules";
import { useErpSettings } from "@/pages/settings/ErpSettingsTabs";
import { hideableMenu, hideableGroups } from "@/lib/navConfig";
import { friendlyError } from "@/lib/friendlyError";
import { cn } from "@/lib/utils";

/** System → Customization → Menu items: hide screens a company does not use (e.g. Sales Orders). */
export default function MenuItemsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { has, menuHidden } = useModules();
  const { save } = useErpSettings();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => setHidden(new Set(menuHidden)), [menuHidden]);
  const groups = hideableMenu().filter((g) => !g.group.module || has(g.group.module))
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.module || has(i.module)) })).filter((g) => g.items.length);
  const toggle = (path: string) => setHidden((h) => { const n = new Set(h); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  const changed = [...hidden].sort().join() !== [...menuHidden].sort().join();
  const persist = async () => {
    setBusy(true);
    const { error } = await save("menu_hidden", [...hidden]);
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    await qc.invalidateQueries({ queryKey: ["modules-hidden"] });
    toast.success("Menu updated", { description: "Everyone in the company sees the new menu." });
  };
  const wholeGroups = hideableGroups().filter((g) => !g.module || has(g.module));
  return (
    <div className="space-y-5">
      <Panel title="Whole menus" icon={ListChecks}
        description="Switch off a whole menu you don't use. The data stays; switch it back on any time."
        actions={canManage && <Button disabled={!changed || busy} onClick={() => void persist()}><Save /> Save</Button>}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {wholeGroups.map((g) => {
            const off = hidden.has(g.path);
            return (
              <button key={g.path} type="button" disabled={!canManage} onClick={() => toggle(g.path)}
                className={cn("flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left text-sm transition-colors", off ? "border-border bg-muted/40 text-muted-foreground" : "border-success/40 bg-success/5")}>
                <g.icon className="h-5 w-5 shrink-0" />
                <span className="flex-1 font-semibold">{g.label}<span className="block text-xs font-normal text-muted-foreground">{g.children?.length || 0} screens</span></span>
                <span role="switch" aria-checked={!off} className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", off ? "bg-muted-foreground/30" : "bg-success")}>
                  <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", off ? "left-0.5" : "left-[22px]")} />
                </span>
              </button>
            );
          })}
        </div>
      </Panel>
      <Panel title="Menu items" icon={ListChecks}
        description="Hide screens you don't use. Nothing is deleted; show them again any time. Core screens always stay."
        actions={canManage && <Button disabled={!changed || busy} onClick={() => void persist()}><Save /> Save</Button>}>
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {groups.filter(({ group }) => !hidden.has(group.path)).map(({ group, items }) => (
            <section key={group.path} className="rounded-2xl border border-border p-4">
              <p className="mb-3 flex items-center gap-2 font-semibold"><group.icon className="h-4 w-4 text-primary" /> {group.label}
                <span className="ml-auto text-xs font-normal text-muted-foreground">{items.filter((i) => !hidden.has(i.path)).length} of {items.length} shown</span></p>
              <ul className="space-y-1">
                {items.map((i) => {
                  const off = hidden.has(i.path);
                  return (
                    <li key={i.path}>
                      <button type="button" disabled={!canManage} onClick={() => toggle(i.path)}
                        className={cn("flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-muted", off && "text-muted-foreground")}>
                        <i.icon className="h-4 w-4 shrink-0" />
                        <span className={cn("flex-1", off && "line-through decoration-1")}>{i.label}</span>
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", off ? "bg-muted text-muted-foreground" : "bg-success/15 text-success")}>
                          {off ? <><EyeOff className="h-3 w-3" /> Hidden</> : <><Eye className="h-3 w-3" /> Shown</>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </Panel>
    </div>
  );
}
