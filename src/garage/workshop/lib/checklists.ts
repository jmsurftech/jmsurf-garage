/**
 * Ready-made checklists a garage can start from (and change): multi-point inspection,
 * pre-purchase inspection, NTSA inspection preparation, and the quality check before "ready".
 */
export interface CheckItem { section: string; label: string }
export type Rag = "green" | "amber" | "red" | "na";
export interface CheckResult extends CheckItem { status: Rag | null; note?: string; photos?: string[] }

const items = (section: string, labels: string[]): CheckItem[] => labels.map((label) => ({ section, label }));

export const STARTER_TEMPLATES: { name: string; kind: string; items: CheckItem[] }[] = [
  {
    name: "Multi-point inspection", kind: "multi_point",
    items: [
      ...items("Under the bonnet", ["Engine oil level and condition", "Coolant level and leaks", "Brake fluid", "Power steering fluid", "Battery and terminals", "Drive belts", "Hoses", "Air filter", "Engine mounts"]),
      ...items("Brakes and suspension", ["Front brake pads / discs", "Rear brakes", "Handbrake", "Shock absorbers", "Ball joints and bushes", "Steering play", "CV joints and boots"]),
      ...items("Tyres", ["Front left tyre", "Front right tyre", "Rear left tyre", "Rear right tyre", "Spare tyre", "Wheel alignment (wear pattern)"]),
      ...items("Underneath", ["Exhaust system", "Oil leaks", "Gearbox / differential leaks", "Chassis and body rust"]),
      ...items("Lights and electrics", ["Headlights", "Brake lights", "Indicators and hazards", "Horn", "Wipers and washers", "Dashboard warning lights", "Air conditioning"]),
    ],
  },
  {
    name: "Pre-purchase inspection", kind: "pre_purchase",
    items: [
      ...items("Documents", ["Logbook matches chassis and engine numbers", "Mileage looks genuine", "Service history"]),
      ...items("Body", ["Accident repairs / repaint", "Panel gaps", "Rust", "Glass and mirrors", "Flood signs"]),
      ...items("Engine and gearbox", ["Cold start", "Smoke from exhaust", "Engine noises", "Gear changes", "Clutch", "Leaks"]),
      ...items("Running gear", ["Brakes", "Suspension", "Steering", "Tyres"]),
      ...items("Inside", ["Seats and trim", "Electrics and windows", "Air conditioning", "Warning lights", "Airbag light"]),
      ...items("Road test", ["Pulls to one side", "Vibrations", "Noises over bumps", "Brake feel"]),
    ],
  },
  {
    name: "NTSA inspection preparation", kind: "ntsa",
    items: [
      ...items("Safety", ["Brakes (service and handbrake)", "Steering", "Tyres (tread and same size per axle)", "Seat belts", "Speed governor fitted and sealed", "Fire extinguisher", "Life-saver triangles", "First aid kit"]),
      ...items("Lights", ["Headlights (dip and main)", "Brake lights", "Indicators", "Reflectors", "Number plate light"]),
      ...items("Body", ["Windscreen (no cracks in view)", "Wipers", "Mirrors", "Number plates fixed and readable", "Body and bumpers secure", "Doors open and lock"]),
      ...items("Emissions and noise", ["Exhaust smoke", "Exhaust noise and leaks"]),
      ...items("PSV (if public service)", ["Seats fixed and counted", "Yellow band / route marks", "Emergency exits", "Passenger handrails"]),
    ],
  },
];

export const DEFAULT_QC: string[] = [
  "All approved work done", "No warning lights on the dashboard", "Fluid levels topped up", "No leaks", "Wheel nuts torqued",
  "Old parts bagged for the customer", "Car clean inside (no grease marks)", "Seat cover, mats and steering cover removed", "Road test done",
];

/** Counts per colour, for the inspection summary. */
export function ragCounts(results: CheckResult[]) {
  const c = { green: 0, amber: 0, red: 0, na: 0, open: 0 };
  for (const r of results) { if (r.status) c[r.status]++; else c.open++; }
  return c;
}

/** Turns red and amber results into estimate lines: red = must do, amber = advised. */
export function linesFromInspection(results: CheckResult[]) {
  return results.filter((r) => r.status === "red" || r.status === "amber").map((r) => ({
    kind: "labour" as const,
    description: `${r.label}${r.note ? ` (${r.note})` : ""}`,
    priority: r.status === "red" ? ("must" as const) : ("advised" as const),
  }));
}
