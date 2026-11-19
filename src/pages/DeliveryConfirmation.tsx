import { useState, useRef, useEffect } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle, PenTool, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { OrbSpinner } from "@/components/orbs";

export default function DeliveryConfirmation() {
  const { noteId } = useParams<{ noteId: string }>();
  const [receiverName, setReceiverName] = useState("");
  const [receiverIdNumber, setReceiverIdNumber] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  const { data: delivery, isLoading } = useQuery({
    queryKey: ["delivery-confirm", noteId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("delivery_notes")
        .select("*")
        .eq("id", noteId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!noteId,
  });

  // Check if already confirmed
  const { data: existing } = useQuery({
    queryKey: ["delivery-confirmation-existing", noteId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("delivery_confirmations")
        .select("id")
        .eq("delivery_note_id", noteId)
        .maybeSingle();
      return data;
    },
    enabled: !!noteId,
  });

  useEffect(() => {
    if (existing) setConfirmed(true);
  }, [existing]);

  // Canvas drawing logic
  const getPos = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const startDraw = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDraw = () => setIsDrawing(false);

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiverName.trim() || !receiverIdNumber.trim()) {
      setError("Name and ID number are required");
      return;
    }
    if (!hasSignature) {
      setError("Please sign to confirm receipt");
      return;
    }

    setSubmitting(true);
    setError("");

    const signatureData = canvasRef.current?.toDataURL("image/png") || "";

    // Get GPS location if available
    let lat: number | null = null;
    let lng: number | null = null;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
      });
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
    } catch {}

    const { data: submitResp, error: insertErr } = await supabase.functions.invoke(
      "submit-delivery-confirmation",
      {
        body: {
          delivery_note_id: noteId,
          receiver_name: receiverName.trim(),
          receiver_id_number: receiverIdNumber.trim(),
          receiver_phone: receiverPhone.trim() || null,
          signature_data: signatureData,
          location_lat: lat,
          location_lng: lng,
        },
      }
    );

    if (insertErr || (submitResp as any)?.error) {
      setError((submitResp as any)?.error || insertErr?.message || "Could not submit confirmation");
      setSubmitting(false);
      return;
    }

    setConfirmed(true);
    setSubmitting(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <OrbSpinner className="w-8 h-8 text-gray-400" />
      </div>
    );
  }

  if (!delivery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Delivery Not Found</h1>
          <p className="text-gray-500">This delivery note does not exist or the link is invalid.</p>
        </div>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Delivery Confirmed!</h1>
          <p className="text-gray-500 text-sm">Thank you for confirming receipt of your delivery.</p>
          <p className="text-gray-400 text-xs mt-4">DN: {delivery.delivery_number}</p>
        </div>
      </div>
    );
  }

  const items = Array.isArray(delivery.items) ? delivery.items : [];

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto">
        <div className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-900">Confirm Delivery Receipt</h1>
            <p className="text-sm text-gray-500 mt-1">DN: {delivery.delivery_number}</p>
          </div>

          {/* Items summary */}
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Items Delivered ({items.length})</p>
            {items.map((it: any, i: number) => (
              <div key={i} className="flex justify-between text-sm py-0.5">
                <span className="text-gray-600">{it.name || it.product_name}</span>
                <span className="text-gray-400">× {it.quantity}</span>
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Your Full Name *</label>
              <input required value={receiverName} onChange={e => setReceiverName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">ID / Passport Number *</label>
              <input required value={receiverIdNumber} onChange={e => setReceiverIdNumber(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Phone Number</label>
              <input value={receiverPhone} onChange={e => setReceiverPhone(e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            {/* Signature Pad */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
                  <PenTool className="w-4 h-4" /> Signature *
                </label>
                {hasSignature && (
                  <button type="button" onClick={clearSignature} className="text-xs text-red-500 flex items-center gap-1 hover:underline">
                    <Trash2 className="w-3 h-3" /> Clear
                  </button>
                )}
              </div>
              <div className="border-2 border-dashed border-gray-300 rounded-xl overflow-hidden bg-white">
                <canvas
                  ref={canvasRef}
                  width={350}
                  height={150}
                  className="w-full touch-none cursor-crosshair"
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={stopDraw}
                  onMouseLeave={stopDraw}
                  onTouchStart={startDraw}
                  onTouchMove={draw}
                  onTouchEnd={stopDraw}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">Draw your signature above</p>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button type="submit" disabled={submitting}
              className="w-full py-3 rounded-xl bg-green-600 text-white font-medium text-sm hover:bg-green-700 disabled:opacity-40 flex items-center justify-center gap-2">
              {submitting ? <OrbSpinner className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
              {submitting ? "Confirming..." : "Confirm Receipt"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
