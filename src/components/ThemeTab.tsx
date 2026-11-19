/**
 * Appearance settings: colour theme, custom colour, light/dark/auto, sidebar
 * style, corner roundness and text size. Saved on this device for this user.
 */
import { Palette, Sun, Moon, Check, MonitorSmartphone, PanelLeft, Square, Type, RotateCcw, Columns2, PanelTop, PanelBottom, LayoutPanelLeft } from "lucide-react";
import { useTheme, hslToHex, type ThemeMode, type SidebarStyle, type Radius, type TextSize } from "@/hooks/useTheme";
import { Panel } from "@/components/kit";
import { useNavLayout, NAV_LAYOUTS, type NavLayout } from "@/hooks/useNavLayout";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenantId";
import { saveCompanyTheme, logoPalette } from "@/lib/companyTheme";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/hooks/useTenant";
import { Sparkles } from "lucide-react";

function Choice<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: any; hint?: string }[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            className={cn("flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all", on ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
            {o.icon && <o.icon className={cn("h-5 w-5 shrink-0", on ? "text-primary" : "text-muted-foreground")} />}
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{o.label}</span>{o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}</span>
            {on && <Check className="h-4 w-4 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}

export default function ThemeTab() {
  const { theme, setTheme, reset: resetLocal, activeTheme, selectTheme: selectLocal, themePresets, customColor, setCustomColor: setCustomLocal } = useTheme();
  const { role } = useAuth() as any;
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const canSetCompany = !!tenantId && ["admin", "manager", "super_admin"].includes(String(role));
  // The colour is the company's: documents, the logo and every staff screen follow it.
  const share = (t: { preset: string | null; custom: string | null } | null) => {
    if (!canSetCompany || !tenantId) return;
    void saveCompanyTheme(tenantId, t).then(() => qc.invalidateQueries({ queryKey: ["business-settings", tenantId] }));
  };
  const selectTheme = (name: string) => { selectLocal(name); share({ preset: name, custom: null }); };
  const setCustomColor = (hex: string) => { setCustomLocal(hex); if (/^#[0-9a-fA-F]{6}$/.test(hex)) share({ preset: null, custom: hex }); };
  const reset = () => { resetLocal(); share({ preset: "JMSURF Garage", custom: null }); };
  // Colours read from the company logo, offered as themes (like choosing a theme from your logo elsewhere).
  const { tenant } = useTenant() as any;
  const logo: string | null = tenant?.logo_url || null;
  const { data: fromLogo = [], isLoading: readingLogo } = useQuery({ queryKey: ["logo-palette", logo], enabled: !!logo, staleTime: Infinity, queryFn: () => logoPalette(logo!) });
  const [layout, setLayout] = useNavLayout();
  const layoutIcon: Record<NavLayout, any> = { classic: LayoutPanelLeft, dual: Columns2, top: PanelTop, bottom: PanelBottom };

  return (
    <div className="space-y-5">
      <Panel title="Display mode" icon={Sun} description="Light, dark, or follow this device's setting.">
        <Choice<ThemeMode> value={theme.mode} onChange={(mode) => setTheme({ mode })} options={[
          { value: "light", label: "Light", icon: Sun },
          { value: "dark", label: "Dark", icon: Moon },
          { value: "system", label: "Automatic", icon: MonitorSmartphone, hint: "Matches the device" },
        ]} />
      </Panel>

      <Panel title="Colour theme" icon={Palette} description={canSetCompany ? "Applies to the whole company: every staff member's screen, the logo and all documents." : "Applies instantly across the whole system."}>
        {logo && (
          <div className="mb-5 rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <img src={logo} alt="" className="h-10 max-w-[140px] object-contain" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Colours from your logo</p>
                <p className="text-xs text-muted-foreground">{readingLogo ? "Reading your logo…" : fromLogo.length ? "Pick one to make it the system's colour." : "No clear colours found in the logo."}</p>
              </div>
            </div>
            {fromLogo.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {fromLogo.map((hex) => {
                  const on = activeTheme === "Custom" && customColor.toLowerCase() === hex.toLowerCase();
                  return (
                    <button key={hex} type="button" onClick={() => setCustomColor(hex)} title={hex}
                      className={cn("flex items-center gap-2 rounded-xl border-2 py-1.5 pl-1.5 pr-3 text-xs font-medium transition-all", on ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card hover:border-primary/40")}>
                      <span className="h-7 w-7 rounded-lg shadow-inner" style={{ backgroundColor: hex }} />
                      <span className="font-mono uppercase">{hex}</span>
                      {on && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {themePresets.map((p) => {
            const on = activeTheme === p.name;
            return (
              <button key={p.name} type="button" onClick={() => selectTheme(p.name)}
                className={cn("relative flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition-all", on ? "border-primary bg-primary/5 shadow-md" : "border-border bg-card hover:border-primary/40")}>
                <div className="flex gap-1.5">
                  <span className="h-7 w-7 rounded-full shadow-inner" style={{ backgroundColor: `hsl(${p.primary})` }} />
                  <span className="h-7 w-7 rounded-full shadow-inner" style={{ backgroundColor: `hsl(${p.accent})` }} />
                </div>
                <span className="text-xs font-medium">{p.name}</span>
                {on && <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary"><Check className="h-2.5 w-2.5 text-primary-foreground" /></span>}
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl border border-dashed border-border p-4">
          <input type="color" value={customColor} onChange={(e) => setCustomColor(e.target.value)} aria-label="Pick a custom colour"
            className="h-12 w-12 cursor-pointer rounded-xl border-2 border-border bg-transparent [&::-webkit-color-swatch-wrapper]:p-1 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-0" />
          <div className="min-w-[160px] flex-1">
            <p className="text-sm font-semibold">Custom colour {activeTheme === "Custom" && <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">In use</span>}</p>
            <input className="fi mt-1 max-w-[160px] font-mono" defaultValue={customColor} key={customColor}
              onBlur={(e) => setCustomColor(e.target.value.trim())} placeholder={hslToHex("15 67% 46%")} />
          </div>
        </div>
      </Panel>

      <Panel title="Menu layout" icon={LayoutPanelLeft} description="How the main menu sits on a computer. Phones always use the slide-out menu and the bottom bar.">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {NAV_LAYOUTS.map((o) => {
            const on = o.value === layout; const Icon = layoutIcon[o.value];
            return (
              <button key={o.value} type="button" onClick={() => setLayout(o.value)}
                className={cn("flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all", on ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
                <Icon className={cn("h-6 w-6 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{o.label}</span><span className="block text-xs text-muted-foreground">{o.hint}</span></span>
                {on && <Check className="h-4 w-4 text-primary" />}
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title="Sidebar" icon={PanelLeft}>
        <Choice<SidebarStyle> value={theme.sidebar} onChange={(sidebar) => setTheme({ sidebar })} options={[
          { value: "light", label: "Light", hint: "Clean white" },
          { value: "tinted", label: "Tinted", hint: "A soft wash of your colour" },
          { value: "dark", label: "Dark", hint: "High contrast" },
        ]} />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Corners" icon={Square}>
          <Choice<Radius> value={theme.radius} onChange={(radius) => setTheme({ radius })} options={[
            { value: "sharp", label: "Sharp" }, { value: "rounded", label: "Rounded" }, { value: "extra", label: "Extra round" },
          ]} />
        </Panel>
        <Panel title="Text size" icon={Type}>
          <Choice<TextSize> value={theme.text} onChange={(text) => setTheme({ text })} options={[
            { value: "compact", label: "Compact" }, { value: "normal", label: "Normal" }, { value: "large", label: "Large" },
          ]} />
        </Panel>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" onClick={reset}><RotateCcw /> Back to the JMSURF Garage look</Button>
      </div>
    </div>
  );
}
