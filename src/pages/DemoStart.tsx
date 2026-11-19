/**
 * /api/demo/start opened inside the app. That happens when an older service worker
 * answers the link with the app page instead of letting it reach the server. Ask the
 * server with fetch instead (never intercepted that way) and go to the demo.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { OrbLoader } from "@/components/orbs";

export default function DemoStart() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/demo/start?json=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (j?.url) window.location.replace(j.url); else setFailed(true); })
      .catch(() => setFailed(true));
  }, []);
  return (
    <div className="grid min-h-screen place-items-center bg-background p-6 text-center">
      {failed ? (
        <div>
          <h1 className="font-display text-2xl font-bold">The demo is being refreshed</h1>
          <p className="mt-2 text-muted-foreground">Try again in a minute.</p>
          <Link to="/" className="mt-4 inline-block font-semibold text-primary">Back to the website</Link>
        </div>
      ) : <OrbLoader label="Opening the live demo…" />}
    </div>
  );
}
