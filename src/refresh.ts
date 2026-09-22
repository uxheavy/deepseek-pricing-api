import { sha256 } from "./canonical.ts";
import { pricingPageURL, type SourceProvenance, type VerifiedSchedule } from "./domain.ts";
import { parsePricingPage } from "./pricing-page.ts";
import { createVerifiedSchedule } from "./schedule.ts";
import { loadHolidayManifest, persistVerifiedSchedule, recordRefreshFailure } from "./storage.ts";

type PricingPageFetcher = (input: string, init?: RequestInit) => Promise<Response>;

function timestamp(date: Date): string {
  return date.toISOString();
}

async function fetchPricingPage(fetcher: PricingPageFetcher): Promise<{
  readonly html: string;
  readonly provenance: SourceProvenance;
}> {
  const response = await fetcher(pricingPageURL, {
    headers: { Accept: "text/html" },
    redirect: "error",
  });

  if (!response.ok) {
    throw new Error("The official pricing source did not return a successful response.");
  }

  const content = new Uint8Array(await response.arrayBuffer());
  const html = new TextDecoder("utf-8", { fatal: true }).decode(content);

  return {
    html,
    provenance: {
      url: pricingPageURL,
      contentSha256: await sha256(content),
      retrievedAt: timestamp(new Date()),
    },
  };
}

export async function buildVerifiedSchedule({
  database,
  fetcher = fetch,
}: {
  readonly database: D1Database;
  readonly fetcher?: PricingPageFetcher;
}): Promise<VerifiedSchedule> {
  const source = await fetchPricingPage(fetcher);
  const [models, holidays] = await Promise.all([parsePricingPage(source.html), loadHolidayManifest(database)]);

  return createVerifiedSchedule({
    models,
    pricing: source.provenance,
    holidays,
  });
}

export async function refreshSchedule({
  database,
  fetcher = fetch,
  observedAt = new Date(),
}: {
  readonly database: D1Database;
  readonly fetcher?: PricingPageFetcher;
  readonly observedAt?: Date;
}): Promise<boolean> {
  const checkedAt = timestamp(observedAt);

  try {
    const snapshot = await buildVerifiedSchedule({ database, fetcher });
    await persistVerifiedSchedule({ database, snapshot, checkedAt });
    return true;
  } catch {
    await recordRefreshFailure({ database, checkedAt });
    return false;
  }
}
