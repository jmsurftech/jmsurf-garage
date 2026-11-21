import { useEffect } from "react";
import { Orb } from "@/components/Orb";
import { acceptHandoff } from "@/lib/companySwitch";
import { useBootCover } from "@/lib/bootScreen";

/** Arrival on app. (or a company's own domain) from another JMSURF Garage address, already signed in. */
export default function Handoff() {
  useBootCover();
  useEffect(() => {
    void acceptHandoff().then((next) => window.location.replace(next));
  }, []);
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Orb state="working" label="Opening your company" />
    </div>
  );
}
