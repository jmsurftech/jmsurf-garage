/**
 * Real African garage photos used across the website, module pages and sign-in pages.
 * Owner rule: NO recognisable faces (and no other companies' logos on clothing): every photo
 * is cropped to hands, parts, cars and workshops; number plates are blurred.
 * Files live in public/photos as WebP: <name>.webp (up to 1600 px) and <name>-sm.webp (800 px).
 * All come from Wikimedia Commons under free licences; CC BY-SA needs the credit shown on
 * /photo-credits (linked from the footer). Crops are made by /root/garage-work/photos/faceless/crop.sh.
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
  hero: p("hero-brake-job", "A car raised on a lift with its front wheel off, showing the brake disc and suspension", "Photokadaffi", "Femme_mecanicienne33.jpg", undefined, "55% 60%"),
  fundi: p("fundi-nairobi", "Hands working on a brake part at the roadside in Nairobi, tools spread on the ground", "Eugene Odanga Masinde", "Mechanic_working_in_Nairobi.jpg", undefined, "50% 40%"),
  garage: p("neighbourhood-garage", "Hands fitting a brake caliper onto a wheel hub", "Photokadaffi", "Femme_mecanicienne4.jpg", undefined, "35% 50%"),
  workshop: p("workshop-floor", "An engine being rebuilt on a stand on a busy workshop floor", "Photokadaffi", "Femme_mecanicienne10.jpg", undefined, "30% 50%"),
  lift: p("service-lift", "A car on a lift with the front wheel removed, ready for brake work", "Photokadaffi", "Femme_mecanicienne34.jpg", undefined, "60% 60%"),
  parts: p("parts-bench", "Hands sorting electrical parts in a toolbox at the workshop bench", "Photokadaffi", "Femme_mecanicienne2.jpg", undefined, "50% 50%"),
  port: p("mombasa-port", "Ship-to-shore cranes and a container truck at the port of Mombasa", "Ministry of East African Affairs, Commerce and Tourism (Kenya)", "2015_07_31_Mombasa_Port_JPEG_RESIZED_0019.jpg", "Public domain", "50% 60%"),
  welding: p("body-welding", "A welder cutting metal with a torch, sparks flying", "Jackinda motherland", "The_workman.jpg"),
  wash: p("car-wash", "Cars and motorbikes being washed at a busy car wash", "Minette Lontsie", "Car_Washing.jpg", undefined, "55% 40%"),
  wheel: p("wheel-hub", "A brake disc and caliper on a car raised on a lift", "Photokadaffi", "Femme_mecanicienne33.jpg", undefined, "50% 55%"),
  inspect: p("inspection", "A hand with a tool checking the suspension and brake from under a car", "Photokadaffi", "Femme_mecanicienne3.jpg", undefined, "55% 45%"),
  engine: p("engine-work", "Gearbox and engine parts laid out on a workshop bench", "Photokadaffi", "Femme_mecanicienne7.jpg"),
  yard: p("car-yard", "Rows of cars parked under the trees in Nairobi", "Endesia94", "Cars_parked_at_Kenyatta_University,_Nairobi,_Kenya.jpg", undefined, "50% 75%"),
  spares: p("spares-market", "A cart of used parts pulled through a spare parts market, with wheels and tyres stacked by the stalls", "Akinrinade Habeeb Omobolaji", "The_porter.jpg"),
} satisfies Record<string, Photo>;

export type PhotoKey = keyof typeof PHOTOS;

export const photoSrc = (ph: Photo, size: "lg" | "sm" = "lg") => `/photos/${ph.name}${size === "sm" ? "-sm" : ""}.webp`;
export const photoSrcSet = (ph: Photo) => `/photos/${ph.name}-sm.webp 800w, /photos/${ph.name}.webp 1600w`;

/** One photo per "who it's for" card on the home page, in the same order as HOME.who. */
export const WHO_PHOTOS: Photo[] = [PHOTOS.fundi, PHOTOS.garage, PHOTOS.workshop, PHOTOS.lift, PHOTOS.spares, PHOTOS.yard, PHOTOS.welding, PHOTOS.wash, PHOTOS.inspect];

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
  towing: PHOTOS.fundi,
  car_hire: PHOTOS.yard,
  whatsapp: PHOTOS.garage,
  service: PHOTOS.inspect,
};

/** Sign-in pages rotate through these by day. */
export const AUTH_PHOTOS: Photo[] = [PHOTOS.hero, PHOTOS.lift, PHOTOS.workshop, PHOTOS.garage];
