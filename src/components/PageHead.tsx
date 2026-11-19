import { Helmet } from "react-helmet-async";
import { useSyncExternalStore } from "react";
import { subscribeBrand, getBrandName, brandShortName } from "@/lib/brand";

interface PageHeadProps {
  title: string;
  description: string;
  path?: string;
  noindex?: boolean;
}

const SITE = "https://garage.jmsurf.co.ke";

function useBrandName() {
  return useSyncExternalStore(subscribeBrand, getBrandName, () => null);
}

/**
 * Per-route head tags. Sets a unique title, description, og:title,
 * og:description, og:url and self-referencing canonical for the page.
 * Inside a shop workspace the tab reads "<Company> | <Page>".
 */
export default function PageHead({ title, description, path, noindex }: PageHeadProps) {
  const url = path ? `${SITE}${path}` : undefined;
  const brand = brandShortName(useBrandName());
  const pageLabel = title.split(/[·|–—]|(\s-\s)/)[0].trim() || title;
  const tabTitle = brand && pageLabel.startsWith(brand) ? pageLabel : `${brand ? brand.toUpperCase() : "JMSURF Garage"} | ${pageLabel}`;
  return (
    <Helmet>
      <title>{tabTitle}</title>
      <meta name="description" content={description} />
      {url && <link rel="canonical" href={url} />}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      {url && <meta property="og:url" content={url} />}
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {noindex && <meta name="robots" content="noindex,nofollow" />}
    </Helmet>
  );
}
