/**
 * /photo-credits: who took each photo on the website and under which licence.
 * CC BY-SA asks for the author, the licence and a link; the list comes from src/lib/photos.ts.
 */
import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { PHOTOS, photoSrc } from "@/lib/photos";
import { Nav, Footer, useSiteContact } from "@/pages/Landing";

const LICENCE_URL: Record<string, string> = {
  "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
  "CC BY-SA 3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
  "CC BY-SA 2.0": "https://creativecommons.org/licenses/by-sa/2.0/",
};

export default function PhotoCredits() {
  const contact = useSiteContact();
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const list = Object.values(PHOTOS);
  return (
    <div className="min-h-screen overflow-x-clip bg-background font-body text-foreground">
      <Helmet>
        <title>Photo credits · JMSURF Garage</title>
        <meta name="description" content="The photographers behind the pictures on the JMSURF Garage website, and the licences they shared them under." />
        <link rel="canonical" href="https://jmsurfgarage.co.ke/photo-credits" />
      </Helmet>
      <Nav />
      <main className="mx-auto max-w-5xl px-4 pb-20 pt-28 sm:px-6 sm:pt-36">
        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-primary">Thank you</p>
        <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Photo credits</h1>
        <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
          The photos on this website are real garages and workshops, shared on Wikimedia Commons by the people below.
          Photos marked CC BY-SA may be reused under the same licence; we resized and cropped them for the web.
        </p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {list.map((ph) => (
            <li key={ph.name} className="flex gap-4 rounded-2xl border border-border bg-card p-3">
              <img src={photoSrc(ph, "sm")} alt={ph.alt} loading="lazy" className="h-20 w-28 shrink-0 rounded-xl object-cover" style={ph.focus ? { objectPosition: ph.focus } : undefined} />
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-foreground">{ph.alt}</p>
                <p className="mt-1 text-muted-foreground">
                  By {ph.author} ·{" "}
                  {LICENCE_URL[ph.license] ? <a href={LICENCE_URL[ph.license]} className="underline hover:text-foreground" rel="license noopener" target="_blank">{ph.license}</a> : ph.license}
                  {" "}· <a href={ph.source} className="underline hover:text-foreground" target="_blank" rel="noopener">Source</a>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </main>
      <Footer phone={contact.phone} email={contact.email} />
    </div>
  );
}
