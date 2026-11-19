/**
 * Customer-facing display sync.
 * - Same-device: BroadcastChannel (zero latency, no network).
 * - Remote (tablet/second device): Supabase Realtime broadcast channel.
 *
 * Cashier calls publish() to push state; display calls subscribe() to receive.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export type DisplayState = {
  type: "idle" | "item_added" | "running" | "paid" | "reset";
  shopName?: string;
  logoUrl?: string | null;
  lastItem?: { name: string; price: number; quantity: number } | null;
  itemCount?: number;
  subtotal?: number;
  total?: number;
  paymentMethod?: string;
  changeGiven?: number;
};

const BROADCAST_NAME = "jmsurf_pos_display";

function getBC(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try { return new BroadcastChannel(BROADCAST_NAME); } catch { return null; }
}

/** Cashier-side: returns publish(state) — broadcasts to local + remote sessions. */
export function useDisplayPublisher(sessionId: string | null) {
  const bcRef = useRef<BroadcastChannel | null>(null);
  const rtRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    bcRef.current = getBC();
    if (sessionId) {
      const ch = supabase.channel(`pos-display:${sessionId}`, { config: { broadcast: { self: false } } });
      ch.subscribe();
      rtRef.current = ch;
    }
    return () => {
      try { bcRef.current?.close(); } catch {}
      if (rtRef.current) { try { supabase.removeChannel(rtRef.current); } catch {} }
    };
  }, [sessionId]);

  return (state: DisplayState) => {
    try { bcRef.current?.postMessage(state); } catch {}
    // Only over the live connection: before it has joined, the client falls
    // back to an HTTP call that the server refuses (401).
    const ch: any = rtRef.current;
    if (ch && ch.state === "joined") { try { ch.send({ type: "broadcast", event: "state", payload: state }); } catch {} }
  };
}

/** Display-side: subscribes via BroadcastChannel + (optional) Realtime by sessionId. */
export function useDisplaySubscriber(
  sessionId: string | null,
  onState: (state: DisplayState) => void
) {
  useEffect(() => {
    const bc = getBC();
    if (bc) {
      bc.onmessage = (ev) => onState(ev.data as DisplayState);
    }
    let rt: ReturnType<typeof supabase.channel> | null = null;
    if (sessionId) {
      rt = supabase.channel(`pos-display:${sessionId}`, { config: { broadcast: { self: false } } });
      rt.on("broadcast", { event: "state" }, ({ payload }) => onState(payload as DisplayState));
      rt.subscribe();
    }
    return () => {
      try { bc?.close(); } catch {}
      if (rt) { try { supabase.removeChannel(rt); } catch {} }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
}
