/**
 * Real garage photos used across the website, module pages and sign-in pages.
 * Files live in public/photos as WebP: <name>.webp (1600 px wide) and <name>-sm.webp (800 px).
 * All come from Wikimedia Commons under free licences; CC BY-SA needs the credit shown on
 * /photo-credits (linked from the footer). Add new photos here with their credit.
 */
export type Photo = {
  name: string;
  alt: string;
  author: string;
  license: "CC BY-SA 4.0" | "CC BY-SA 3.0" | "CC BY-SA 2.0" | "Public domain";
  source: string;
  /** CSS object-position, to keep the subject in frame when cropped. */
  focus?: string;
};

const p = (name: string, alt: string, author: string, file: string, license: Photo["license"] = "CC BY-SA 4.0", focus?: string): Photo =>
  ({ name, alt, author, license, source: `https://commons.wikimedia.org/wiki/File:${file}`, focus });

export const PHOTOS = {
  hero: p("hero-brake-job", "Mechanics replacing brake parts on a car raised on a lift in a modern workshop", "Photokadaffi", "Femme_mecanicienne33.jpg", undefined, "60% 45%"),
  fundi: p("fundi-nairobi", "A mechanic repairing a car wheel hub at the roadside in Nairobi", "Eugene Odanga Masinde", "Mechanic_working_in_Nairobi.jpg", undefined, "65% 50%"),
  garage: p("neighbourhood-garage", "Two mechanics working on the front brakes of a car", "Photokadaffi", "Femme_mecanicienne34.jpg"),
  workshop: p("workshop-floor", "A mechanic rebuilding an engine on a busy workshop floor", "Photokadaffi", "Femme_mecanicienne10.jpg", undefined, "40% 50%"),
  lift: p("service-lift", "A mechanic checking the underside of a car on a lift", "Photokadaffi", "Femme_mecanicienne28.jpg", undefined, "45% 40%"),
  parts: p("parts-bench", "A technician testing parts at the workshop bench", "Photokadaffi", "Femme_mecanicienne2.jpg", undefined, "35% 50%"),
  port: p("mombasa-port", "Port staff at the container terminal in Mombasa", "Ministry of East African Affairs, Commerce and Tourism (Kenya)", "2015_07_31_Mombasa_Port_JPEG_RESIZED_0019.jpg", "Public domain"),
  welding: p("body-welding", "A welder cutting metal with a torch, sparks flying", "Jackinda motherland", "The_workman.jpg"),
  wash: p("car-wash", "Attendants washing cars and motorbikes at a busy car wash", "Minette Lontsie", "Car_Washing.jpg"),
  tow: p("tow-truck", "A tow truck on a city road", "Matti Blume", "DongFeng_tow_truck,_Korle-Klottey_(P1090871).jpg"),
  wheel: p("wheel-hub", "A mechanic fitting a wheel hub and brake disc", "Photokadaffi", "Femme_mecanicienne4.jpg", undefined, "40% 50%"),
  inspect: p("inspection", "A mechanic inspecting a brake and suspension from under the car", "Photokadaffi", "Femme_mecanicienne3.jpg", undefined, "60% 40%"),
  engine: p("engine-work", "A mechanic working on an engine in the workshop", "Photokadaffi", "Femme_mecanicienne7.jpg"),
  yard: p("car-yard", "Rows of cars parked under the trees in Nairobi", "Endesia94", "Cars_parked_at_Kenyatta_University,_Nairobi,_Kenya.jpg", undefined, "50% 75%"),
  spares: p("spares-market", "A porter pulling a cart through a busy spare parts market, with wheels and tyres stacked by the stalls", "Akinrinade Habeeb Omobolaji", "The_porter.jpg"),
  roadside: p("roadside-help", "People helping with a car that has a flat battery by the roadside", "Alexandra Cadet", "Tourist_car_with_flat_battery_at_Mount_Longonot_National_Park.jpg", undefined, "55% 55%"),
} satisfies Record<string, Photo>;

export type PhotoKey = keyof typeof PHOTOS;

export const photoSrc = (ph: Photo, size: "lg" | "sm" = "lg") => `/photos/${ph.name}${size === "sm" ? "-sm" : ""}.webp`;
export const photoSrcSet = (ph: Photo) => `/photos/${ph.name}-sm.webp 800w, /photos/${ph.name}.webp 1600w`;

/** One photo per "who it's for" card on the home page, in the same order as HOME.who. */
export const WHO_PHOTOS: Photo[] = [PHOTOS.fundi, PHOTOS.garage, PHOTOS.workshop, PHOTOS.lift, PHOTOS.spares, PHOTOS.yard, PHOTOS.welding, PHOTOS.wash, PHOTOS.tow];

/** A photo for each module page that has a fitting one; others keep the drawn screen. */
export const MODULE_PHOTOS: Record<string, Photo> = {
  garage_core: PHOTOS.inspect,
  workshop_pro: PHOTOS.workshop,
  inventory: PHOTOS.spares,
  vehicle_yard: PHOTOS.yard,
  commerce: PHOTOS.spares,
  website: PHOTOS.garage,
  imports: PHOTOS.port,
  insurance: PHOTOS.lift,
  body_paint: PHOTOS.welding,
  car_wash: PHOTOS.wash,
  tyres: PHOTOS.wheel,
  fleet_contracts: PHOTOS.workshop,
  towing: PHOTOS.tow,
  car_hire: PHOTOS.roadside,
  whatsapp: PHOTOS.garage,
  service: PHOTOS.inspect,
};

/** Sign-in pages rotate through these by day. */
export const AUTH_PHOTOS: Photo[] = [PHOTOS.hero, PHOTOS.lift, PHOTOS.workshop, PHOTOS.garage];
