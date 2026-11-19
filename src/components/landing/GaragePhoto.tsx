import { photoSrc, photoSrcSet, type Photo } from "@/lib/photos";
import { cn } from "@/lib/utils";

/** A real garage photo: WebP, two sizes, lazy unless it is the first thing on the page. */
export default function GaragePhoto({ photo, className, sizes = "(min-width: 1024px) 50vw, 100vw", eager, imgClassName }: {
  photo: Photo; className?: string; sizes?: string; eager?: boolean; imgClassName?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      <img src={photoSrc(photo)} srcSet={photoSrcSet(photo)} sizes={sizes} alt={photo.alt}
        loading={eager ? "eager" : "lazy"} decoding="async" {...(eager ? { fetchpriority: "high" } : {})}
        className={cn("h-full w-full object-cover", imgClassName)} style={photo.focus ? { objectPosition: photo.focus } : undefined} />
    </div>
  );
}
