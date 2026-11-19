import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Per-user, cross-device UI preference store.
 *
 * - Reads from localStorage immediately for fast first paint.
 * - Hydrates from `user_ui_preferences` table once auth is ready.
 * - Writes are mirrored to localStorage AND debounced-upserted to Supabase.
 */
export function useUserUIPreference<T>(key: string, defaultValue: T) {
  const { user } = useAuth();
  const localKey = `uiPref.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(localKey);
      if (raw) return { ...(defaultValue as any), ...JSON.parse(raw) } as T;
    } catch {}
    return defaultValue;
  });
  const hydrated = useRef(false);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from DB once
  useEffect(() => {
    if (!user?.id || hydrated.current) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase as any)
        .from("user_ui_preferences")
        .select("preference_value")
        .eq("user_id", user.id)
        .eq("preference_key", key)
        .maybeSingle();
      if (cancelled) return;
      if (!error && data?.preference_value) {
        setValue((prev) => ({ ...(defaultValue as any), ...(prev as any), ...(data.preference_value as any) }));
      }
      hydrated.current = true;
    })();
    return () => { cancelled = true; };
  }, [user?.id, key]);

  // Persist locally + remotely
  useEffect(() => {
    try { localStorage.setItem(localKey, JSON.stringify(value)); } catch {}
    if (!user?.id) return;
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(async () => {
      try {
        await (supabase as any)
          .from("user_ui_preferences")
          .upsert(
            { user_id: user.id, preference_key: key, preference_value: value as any },
            { onConflict: "user_id,preference_key" }
          );
      } catch {}
    }, 600);
  }, [value, user?.id, key, localKey]);

  return [value, setValue] as const;
}
