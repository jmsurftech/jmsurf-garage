import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const sb = supabase as any;

export type Note = {
  id: string; title: string | null; body: string; color: NoteColor; tag: string | null; pinned: boolean; done: boolean;
  remind_at: string | null; remind_by: string[]; reminded_at: string | null; remind_error: string | null; created_at: string; updated_at: string;
};
export type NoteColor = "yellow" | "green" | "pink" | "purple" | "blue" | "orange" | "gray";

/** Sticky-note colours: paper, darker edge, and the dot in the picker (light and dark themes). */
export const COLORS: Record<NoteColor, { paper: string; dot: string; label: string }> = {
  yellow: { paper: "bg-[#fff6b3] border-[#f2df6b] dark:bg-[#4a4216] dark:border-[#6b5f1f]", dot: "bg-[#f7d94c]", label: "Yellow" },
  green: { paper: "bg-[#d9f5cf] border-[#a8e096] dark:bg-[#1f3d1b] dark:border-[#2f5c29]", dot: "bg-[#7ed36a]", label: "Green" },
  pink: { paper: "bg-[#ffd9e8] border-[#f7a8c8] dark:bg-[#4a1f31] dark:border-[#6e2e48]", dot: "bg-[#f47fae]", label: "Pink" },
  purple: { paper: "bg-[#e9ddff] border-[#c7b0f7] dark:bg-[#33244f] dark:border-[#4b3673]", dot: "bg-[#a98bf0]", label: "Purple" },
  blue: { paper: "bg-[#d6ecff] border-[#a3cff5] dark:bg-[#17334d] dark:border-[#244b70]", dot: "bg-[#6db5f2]", label: "Blue" },
  orange: { paper: "bg-[#ffe2c4] border-[#f6bd85] dark:bg-[#4d2e14] dark:border-[#70431d]", dot: "bg-[#f5a352]", label: "Orange" },
  gray: { paper: "bg-[#ececec] border-[#d2d2d2] dark:bg-[#2f3136] dark:border-[#45474d]", dot: "bg-[#a3a3a3]", label: "Gray" },
};
export const TAGS = ["Today", "To do", "Follow-up", "Call", "Meeting", "Idea", "Personal"];

/** How many notes have a reminder due within a day (the top-bar badge). */
export function useNotesDue() {
  const { user } = useAuth() as any;
  return useQuery({
    queryKey: ["notes", user?.id, "due"], enabled: !!user?.id,
    queryFn: async () => (await sb.from("notes").select("id", { count: "exact", head: true }).eq("user_id", user.id).not("done", "is", true).is("reminded_at", null).lt("remind_at", new Date(Date.now() + 86400000).toISOString())).count || 0,
  });
}

export function useNotes(enabled = true) {
  const { user } = useAuth() as any;
  return useQuery({
    queryKey: ["notes", user?.id], enabled: !!user?.id && enabled,
    queryFn: async () => ((await sb.from("notes").select("*").eq("user_id", user.id).order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(1000)).data || []) as Note[],
  });
}

export function useNoteActions() {
  const qc = useQueryClient();
  // The list changes on screen at once, then is read again from the database.
  const local = (fn: (list: Note[]) => Note[]) => qc.setQueriesData<Note[]>({ queryKey: ["notes"] }, (old) => (Array.isArray(old) ? fn(old) : old));
  const refresh = () => qc.refetchQueries({ queryKey: ["notes"], type: "all" });
  return {
    add: async (n: Partial<Note>) => {
      const { data, error } = await sb.from("notes").insert(n).select("*").single();
      if (error) throw error;
      local((l) => [data as Note, ...l]); void refresh();
      return data as Note;
    },
    update: async (id: string, patch: Partial<Note>) => {
      const updated_at = new Date().toISOString();
      local((l) => l.map((x) => (x.id === id ? { ...x, ...patch, updated_at } : x)));
      const { error } = await sb.from("notes").update({ ...patch, updated_at }).eq("id", id);
      if (error) { void refresh(); throw error; }
      void refresh();
    },
    remove: async (id: string) => {
      local((l) => l.filter((x) => x.id !== id));
      const { error } = await sb.from("notes").delete().eq("id", id);
      if (error) { void refresh(); throw error; }
      void refresh();
    },
    refresh,
  };
}

export const whenLabel = (iso: string) => {
  const d = new Date(iso); const now = new Date();
  const day = d.toDateString() === now.toDateString() ? "Today" : d.toDateString() === new Date(now.getTime() + 86400000).toDateString() ? "Tomorrow" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${day} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};
