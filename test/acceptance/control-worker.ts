import { refreshSchedule } from "../../src/refresh.ts";
import { createVerifiedSchedule } from "../../src/schedule.ts";
import { loadHolidayManifest, persistVerifiedSchedule } from "../../src/storage.ts";

const fixtureSourceHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const checkpoints: Readonly<Record<string, { readonly inputCacheHit: string; readonly checkedAt: string }>> = {
  baseline: { inputCacheHit: "0.003", checkedAt: "2026-06-01T00:00:00.000Z" },
  same: { inputCacheHit: "0.003", checkedAt: "2026-06-01T01:00:00.000Z" },
  replacement: { inputCacheHit: "0.004", checkedAt: "2026-06-01T02:00:00.000Z" },
  older: { inputCacheHit: "0.009", checkedAt: "2026-06-01T01:30:00.000Z" },
};

async function fixtureSchedule({ database, inputCacheHit }: { readonly database: D1Database; readonly inputCacheHit: string }) {
  const holidays = await loadHolidayManifest(database);

  return createVerifiedSchedule({
    models: {
      "deepseek-flash": {
        offPeak: {
          inputCacheHit,
          inputCacheMiss: "0.15",
          output: "0.6",
        },
        peak: {
          inputCacheHit: "0.006",
          inputCacheMiss: "0.3",
          output: "1.2",
        },
      },
      "deepseek-v4-pro": {
        offPeak: {
          inputCacheHit: "0.022",
          inputCacheMiss: "0.66",
          output: "1.98",
        },
        peak: {
          inputCacheHit: "0.044",
          inputCacheMiss: "1.32",
          output: "3.96",
        },
      },
    },
    pricing: {
      url: "https://example.test/pricing",
      contentSha256: fixtureSourceHash,
      retrievedAt: "2026-06-01T00:00:00.000Z",
    },
    holidays,
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response(null, { status: 405 });

    const path = new URL(request.url).pathname;
    if (path === "/clear") {
      await env.DB.prepare("DELETE FROM pricing_snapshot").run();
      return new Response(null, { status: 204 });
    }

    if (path === "/failure") {
      const refreshed = await refreshSchedule({
        database: env.DB,
        fetcher: async () => new Response("Unavailable", { status: 503 }),
        observedAt: new Date("2026-06-01T03:00:00.000Z"),
      });
      return new Response(null, { status: refreshed ? 500 : 204 });
    }

    const checkpoint = checkpoints[path.slice("/seed/".length)];
    if (checkpoint === undefined) return new Response(null, { status: 404 });

    await persistVerifiedSchedule({
      database: env.DB,
      snapshot: await fixtureSchedule({ database: env.DB, inputCacheHit: checkpoint.inputCacheHit }),
      checkedAt: checkpoint.checkedAt,
    });
    return new Response(null, { status: 204 });
  },
} satisfies ExportedHandler<{ DB: D1Database }>;
