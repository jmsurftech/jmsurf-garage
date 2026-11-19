/**
 * OpenStreetMap maps (Leaflet) for water deliveries: a location picker for
 * customers and a delivery map for riders and reception. Free tiles, no API
 * key; turn-by-turn directions open in Google Maps on the phone.
 */
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrbSpinner } from "@/components/orbs";

export interface LatLng { lat: number; lng: number }

/** Nairobi CBD, used until the customer shares or pins a location. */
export const DEFAULT_CENTER: LatLng = { lat: -1.2864, lng: 36.8172 };

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const pin = (color: string, label?: string) => L.divIcon({
  className: "",
  iconSize: [30, 40],
  iconAnchor: [15, 38],
  html: `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 0C6.7 0 0 6.7 0 15c0 11 15 25 15 25s15-14 15-25C30 6.7 23.3 0 15 0z" fill="${color}" stroke="white" stroke-width="2"/>
    ${label ? `<text x="15" y="19" font-size="11" font-family="Arial" font-weight="700" fill="white" text-anchor="middle">${label}</text>` : `<circle cx="15" cy="15" r="5" fill="white"/>`}
  </svg>`,
});
const DOT = L.divIcon({
  className: "",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  html: `<span style="display:block;width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 0 0 6px rgba(37,99,235,.25)"></span>`,
});

/** Google Maps turn-by-turn directions to a point (opens the app on phones). */
export const directionsUrl = (p: LatLng) =>
  `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(6)},${p.lng.toFixed(6)}&travelmode=driving`;

/** Asks the browser for the device's position once. */
export function getPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This device cannot share its location."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1 ? "Location permission was refused. Allow location for this site, or drag the pin." : "Could not read your location. Drag the pin instead.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

function Recenter({ to, zoom }: { to: LatLng | null; zoom?: number }) {
  const map = useMap();
  useEffect(() => { if (to) map.setView([to.lat, to.lng], zoom ?? Math.max(map.getZoom(), 16)); }, [to?.lat, to?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
function ClickToMove({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}
function FitBoth({ a, b }: { a: LatLng; b: LatLng | null }) {
  const map = useMap();
  const key = b ? `${a.lat},${a.lng},${b.lat.toFixed(3)},${b.lng.toFixed(3)}` : `${a.lat},${a.lng}`;
  useEffect(() => {
    if (b) map.fitBounds(L.latLngBounds([a.lat, a.lng], [b.lat, b.lng]).pad(0.25), { maxZoom: 17 });
    else map.setView([a.lat, a.lng], 16);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Customer picks where to deliver: "use my location", tap or drag the pin. */
export function LocationPicker({ value, onChange, className, autoLocate }: {
  value: LatLng | null; onChange: (p: LatLng) => void; className?: string; autoLocate?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [center, setCenter] = useState<LatLng | null>(value);
  const locate = async () => {
    setBusy(true); setErr(null);
    try { const p = await getPosition(); onChange(p); setCenter(p); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (autoLocate && !value) locate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const icon = useMemo(() => pin("#dc2626"), []);
  const start = value || DEFAULT_CENTER;
  return (
    <div className={cn("space-y-2", className)}>
      <div className="relative h-64 overflow-hidden rounded-xl border border-border sm:h-72">
        <MapContainer center={[start.lat, start.lng]} zoom={value ? 16 : 12} className="h-full w-full" scrollWheelZoom>
          <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
          <Recenter to={center} />
          <ClickToMove onPick={(p) => { setErr(null); onChange(p); }} />
          {value && (
            <Marker position={[value.lat, value.lng]} icon={icon} draggable
              eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); setErr(null); onChange({ lat: ll.lat, lng: ll.lng }); } }} />
          )}
        </MapContainer>
        <button type="button" onClick={locate} disabled={busy}
          className="absolute right-2 top-2 z-[500] inline-flex items-center gap-1.5 rounded-lg bg-background/95 px-3 py-2 text-xs font-semibold shadow-md hover:bg-background">
          {busy ? <OrbSpinner className="h-4 w-4" /> : <Crosshair className="h-4 w-4" />} Use my location
        </button>
      </div>
      <p className={cn("text-xs", err ? "text-destructive" : "text-muted-foreground")}>
        {err || (value ? "Drag the pin or tap the map to fine-tune where we deliver." : "Tap \"Use my location\", or tap the map where we should deliver.")}
      </p>
    </div>
  );
}

/** Delivery map: the customer's pin, the rider's live position, and a Navigate button. */
export function DeliveryMap({ to, label, me, className, showNavigate = true }: {
  to: LatLng; label?: string; me?: LatLng | null; className?: string; showNavigate?: boolean;
}) {
  const icon = useMemo(() => pin("#dc2626", label), [label]);
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-border", className || "h-72")}>
      <MapContainer center={[to.lat, to.lng]} zoom={16} className="h-full w-full" scrollWheelZoom>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        <FitBoth a={to} b={me || null} />
        <Marker position={[to.lat, to.lng]} icon={icon} />
        {me && <Marker position={[me.lat, me.lng]} icon={DOT} />}
      </MapContainer>
      {showNavigate && (
        <a href={directionsUrl(to)} target="_blank" rel="noopener noreferrer"
          className="absolute bottom-3 right-3 z-[500] inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg">
          <Navigation className="h-4 w-4" /> Navigate
        </a>
      )}
    </div>
  );
}

/** Follows the device's position while mounted (rider screen). */
export function useWatchPosition(on = true) {
  const [pos, setPos] = useState<LatLng | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!on || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setError(null); },
      (e) => setError(e.code === 1 ? "Allow location to see yourself on the map." : null),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [on]);
  return { pos, error };
}

/** Straight-line distance in km (good enough for "2.4 km away"). */
export function distanceKm(a: LatLng, b: LatLng) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function FitAll({ points }: { points: LatLng[] }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|");
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], 15);
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])).pad(0.2), { maxZoom: 16 });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Several delivery stops on one map (numbered pins), plus the rider's own position. */
export function MultiMap({ stops, me, className, onPick }: {
  stops: { id: string; at: LatLng; label: string; color?: string }[];
  me?: LatLng | null; className?: string; onPick?: (id: string) => void;
}) {
  const all = useMemo(() => [...stops.map((s) => s.at), ...(me ? [me] : [])], [stops, me]);
  const start = all[0] || DEFAULT_CENTER;
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-border", className || "h-80")}>
      <MapContainer center={[start.lat, start.lng]} zoom={13} className="h-full w-full" scrollWheelZoom>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        <FitAll points={all} />
        {stops.map((s) => (
          <Marker key={s.id} position={[s.at.lat, s.at.lng]} icon={pin(s.color || "#dc2626", s.label)}
            eventHandlers={onPick ? { click: () => onPick(s.id) } : undefined} />
        ))}
        {me && <Marker position={[me.lat, me.lng]} icon={DOT} />}
      </MapContainer>
    </div>
  );
}
