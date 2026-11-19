import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRegisterDropdown } from "@/lib/singleDropdown";
import { useNavigate } from "react-router-dom";
import { User, Lock, LogOut, X, Save, ChevronDown, ChevronRight, Settings2, LifeBuoy, Moon, Sun, Sparkles } from "lucide-react";
import { unseenWhatsNew } from "@/lib/whatsNew";
import { useAuth } from "@/hooks/useAuth";
import { useTenant, useTenantLoginPath } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { PasswordInput } from "@/components/PasswordInput";
import { OrbSpinner } from "@/components/orbs";
import { useNavLayout, NAV_LAYOUTS } from "@/hooks/useNavLayout";

interface Props {
  variant?: "pos" | "admin" | "default";
  /** Show Settings in the menu (the user may open System settings). */
  settings?: boolean;
  /** Show Help centre in the menu. */
  help?: boolean;
  /** Dark mode switch shown in the menu below 1280px (the top bar hides its own button there). */
  darkMode?: boolean;
  onToggleDark?: () => void;
}

export default function UserProfileMenu({ variant = "default", settings = false, help = false, darkMode, onToggleDark }: Props) {
  const { user, profile, role, signOut } = useAuth();
  const loginPath = useTenantLoginPath();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  useRegisterDropdown(open, () => setOpen(false));
  // What's new: how many entries this person has not seen yet (a dot on the avatar, a count in the menu).
  const [fresh, setFresh] = useState(unseenWhatsNew);
  useEffect(() => { const f = () => setFresh(unseenWhatsNew()); window.addEventListener("dash-whats-new-seen", f); return () => window.removeEventListener("dash-whats-new-seen", f); }, []);
  // The panel is rendered into <body> so no header, sticky bar or page
  // content can ever sit on top of it.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      // Open downward from a header, upward from the bottom of a sidebar.
      if (r.top > window.innerHeight / 2) {
        setPos({ left: Math.max(8, r.left), bottom: Math.max(8, window.innerHeight - r.top + 8) });
      } else {
        setPos({ right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 8 });
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, variant]);
  // view: "menu" = list (Profile / Sign Out), "profile" = profile details with password tab
  const [view, setView] = useState<"menu" | "profile">("menu");
  const [layout, setLayout] = useNavLayout();
  const [tab, setTab] = useState<"profile" | "password">("profile");
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState(profile?.display_name || "");
  const [phone, setPhone] = useState((profile as any)?.phone || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const initials = (profile?.display_name || user?.email || "U").charAt(0).toUpperCase();
  const name = profile?.display_name || user?.email || "User";
  // The top bar shows the first name only; the menu shows the full name.
  const firstName = profile?.display_name ? String(profile.display_name).trim().split(/\s+/)[0] : name;

  const handleSaveProfile = async () => {
    if (!displayName.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim(), phone: phone.trim() || null } as any)
      .eq("user_id", user!.id);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Profile updated" });
      qc.invalidateQueries({ queryKey: ["profiles"] });
      window.location.reload();
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Password changed successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTab("profile");
    }
  };

  const handleSignOut = async () => {
    await signOut();
    // Admin users go to /admin, tenant users go to their slug login
    if (variant === "admin") {
      navigate("/admin");
    } else {
      navigate(loginPath);
    }
  };
  const avatarBg = "bg-primary";
  const avatarText = "text-primary-foreground";
  const accentBg = "bg-primary hover:bg-primary/90";
  const accentText = "text-primary-foreground";

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        ref={triggerRef}
        onClick={() => { setOpen(!open); setView("menu"); setDisplayName(profile?.display_name || ""); setPhone((profile as any)?.phone || ""); }}
        className={cn(
          "flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors",
          "hover:bg-muted"
        )}
      >
        <div className={cn("relative w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0", avatarBg, avatarText)}>
          {initials}
          {fresh > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" aria-label="Something new" />}
        </div>
        <div className="hidden min-[1700px]:block text-left min-w-0">
          <p className={cn("max-w-[120px] text-sm font-medium truncate", "text-foreground")}>{firstName}</p>
          {role && <p className={cn("text-[10px] capitalize", "text-muted-foreground")}>{role}</p>}
        </div>
        <ChevronDown className={cn("hidden sm:block w-3.5 h-3.5 shrink-0 transition-transform", open && "rotate-180", "text-muted-foreground")} />
      </button>

      {/* Dropdown */}
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          <div style={pos} className={cn(
            "fixed z-[1001] w-80 max-w-[calc(100vw-16px)] max-h-[calc(100vh-24px)] overflow-y-auto rounded-2xl shadow-2xl border p-0",
            "bg-card border-border text-foreground"
          )}>
            {/* Header */}
            <div className={cn("px-5 py-4 flex items-center gap-3", "bg-muted/50")}>
              <div className={cn("w-11 h-11 rounded-full flex items-center justify-center text-lg font-bold shrink-0", avatarBg, avatarText)}>
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate">{name}</p>
                <p className={cn("text-xs truncate", "text-muted-foreground")}>{user?.email}</p>
                {role && (
                  <span className={cn("inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full capitalize",
                    "bg-primary/10 text-primary"
                  )}>{role}</span>
                )}
              </div>
              <button onClick={() => setOpen(false)} className={cn("p-1 rounded-lg", "hover:bg-muted text-muted-foreground")}>
                <X className="w-4 h-4" />
              </button>
            </div>

            {view === "menu" ? (
              /* Simple list: Profile, Sign Out */
              <div className="py-2">
                {settings && <button onClick={() => { setOpen(false); navigate("/settings"); }} className={cn("flex w-full items-center gap-3 px-5 py-3 text-sm font-semibold transition-colors", "text-foreground hover:bg-muted")}><Settings2 className="w-4 h-4 text-primary" /><span className="flex-1 text-left">Settings</span><ChevronRight className={cn("w-4 h-4", "text-muted-foreground")} /></button>}
                <button onClick={() => { setOpen(false); navigate("/whats-new"); }} className={cn("flex w-full items-center gap-3 px-5 py-3 text-sm transition-colors", "text-foreground hover:bg-muted")}><Sparkles className="w-4 h-4" /><span className="flex-1 text-left">What's new</span>{fresh > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold leading-5 text-primary-foreground">{fresh}</span>}<ChevronRight className={cn("w-4 h-4", "text-muted-foreground")} /></button>
                {help && <button onClick={() => { setOpen(false); navigate("/help"); }} className={cn("flex w-full items-center gap-3 px-5 py-3 text-sm transition-colors", "text-foreground hover:bg-muted")}><LifeBuoy className="w-4 h-4" /><span className="flex-1 text-left">Help centre</span><ChevronRight className={cn("w-4 h-4", "text-muted-foreground")} /></button>}
                {onToggleDark && <button onClick={() => { setOpen(false); onToggleDark(); }} className="flex w-full items-center gap-3 px-5 py-3 text-sm text-foreground transition-colors hover:bg-muted xl:hidden">{darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}<span className="flex-1 text-left">{darkMode ? "Light mode" : "Dark mode"}</span></button>}
                {(settings || help) && <div className="mx-5 my-1 border-t border-border" />}
                <button onClick={() => { setOpen(false); navigate("/profile"); }} className={cn("flex w-full items-center gap-3 px-5 py-3 text-sm transition-colors", "text-foreground hover:bg-muted")}><Lock className="w-4 h-4" /><span className="flex-1 text-left">My profile & security</span><ChevronRight className={cn("w-4 h-4", "text-muted-foreground")} /></button>
                <button onClick={() => { setView("profile"); setTab("profile"); }}
                  className={cn("flex items-center gap-3 w-full px-5 py-3 text-sm transition-colors",
                    "text-foreground hover:bg-muted"
                  )}>
                  <User className="w-4 h-4" />
                  <span className="flex-1 text-left">Profile</span>
                  <ChevronRight className={cn("w-4 h-4", "text-muted-foreground")} />
                </button>
                <div className="hidden px-5 py-2 lg:block">
                  <p className={cn("mb-1.5 text-[11px] font-semibold uppercase tracking-wide", "text-muted-foreground")}>Menu layout</p>
                  <div className="grid grid-cols-2 gap-1">
                    {NAV_LAYOUTS.map((o) => (
                      <button key={o.value} onClick={() => setLayout(o.value)} title={o.hint}
                        className={cn("rounded-lg px-2 py-1.5 text-xs font-medium transition-colors", layout === o.value ? "bg-primary text-primary-foreground" : "bg-muted/60 hover:bg-muted")}>{o.label}</button>
                    ))}
                  </div>
                </div>
                <div className={cn("mx-3 mt-2 border-t pt-3 pb-1", "border-border")}>
                  <button onClick={handleSignOut}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-red-500/25 transition hover:brightness-110 active:scale-[.98]">
                    <LogOut className="w-4 h-4" />
                    Sign out
                  </button>
                </div>
              </div>
            ) : (
            <>
            {/* Back button */}
            <button onClick={() => setView("menu")}
              className={cn("flex items-center gap-1.5 px-5 py-2 text-xs",
                "text-muted-foreground hover:text-foreground"
              )}>
              <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Back
            </button>

            {/* Tabs */}
            <div className={cn("flex border-b", "border-border")}>
              <button onClick={() => setTab("profile")}
                className={cn("flex-1 px-4 py-2.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5",
                  tab === "profile"
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}>
                <User className="w-3.5 h-3.5" /> Profile
              </button>
              <button onClick={() => setTab("password")}
                className={cn("flex-1 px-4 py-2.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5",
                  tab === "password"
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}>
                <Lock className="w-3.5 h-3.5" /> Password
              </button>
            </div>

            {/* Content */}
            <div className="px-5 py-4 space-y-3">
              {tab === "profile" ? (
                <>
                  <div>
                    <label className={cn("text-xs font-medium mb-1 block", "text-muted-foreground")}>Display Name</label>
                    <input value={displayName} onChange={e => setDisplayName(e.target.value)}
                      className={cn("w-full px-3 py-2 rounded-lg text-sm border",
                        "bg-muted border-input focus:border-primary"
                      )} />
                  </div>
                  <div>
                    <label className={cn("text-xs font-medium mb-1 block", "text-muted-foreground")}>Phone</label>
                    <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone number"
                      className={cn("w-full px-3 py-2 rounded-lg text-sm border",
                        "bg-muted border-input focus:border-primary"
                      )} />
                  </div>
                  <div>
                    <label className={cn("text-xs font-medium mb-1 block", "text-muted-foreground")}>Email</label>
                    <input value={user?.email || ""} disabled
                      className={cn("w-full px-3 py-2 rounded-lg text-sm border opacity-60",
                        "bg-muted border-input text-muted-foreground"
                      )} />
                  </div>
                  <button onClick={handleSaveProfile} disabled={saving}
                    className={cn("w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40", accentBg, accentText)}>
                    {saving ? <OrbSpinner className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                    {saving ? "Saving..." : "Save Profile"}
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label className={cn("text-xs font-medium mb-1 block", "text-muted-foreground")}>New Password</label>
                    <PasswordInput value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 6 characters"
                      className={cn("w-full px-3 py-2 rounded-lg text-sm border",
                        "bg-muted border-input focus:border-primary"
                      )} />
                  </div>
                  <div>
                    <label className={cn("text-xs font-medium mb-1 block", "text-muted-foreground")}>Confirm Password</label>
                    <PasswordInput value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter password"
                      className={cn("w-full px-3 py-2 rounded-lg text-sm border",
                        "bg-muted border-input focus:border-primary"
                      )} />
                  </div>
                  <button onClick={handleChangePassword} disabled={saving}
                    className={cn("w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40", accentBg, accentText)}>
                    {saving ? <OrbSpinner className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                    {saving ? "Updating..." : "Change Password"}
                  </button>
                </>
              )}
            </div>
            </>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
