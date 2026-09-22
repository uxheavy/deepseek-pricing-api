import { expect, test } from "bun:test";
import { buildVerifiedSchedule } from "../src/refresh.ts";
import { pricingPageURL } from "../src/domain.ts";

/// The refresh's own request semantics.
///
/// These are the parts of the refresh that only the edge runtime exercises, and
/// they are asserted here because a passing end-to-end fetch is not evidence
/// that the request itself is well-formed: on the first real deployment the cron
/// produced a recorded failure with no snapshot, because `redirect: "error"` is
/// rejected by workerd outright while Bun accepts it. Asserting the option
/// directly is the check that would have caught it.
function recordingFetcher(): { calls: RequestInit[]; fetch: (url: string, init?: RequestInit) => Promise<Response> } {
  const calls: RequestInit[] = [];
  return {
    calls,
    fetch: async (url: string, init?: RequestInit) => {
      calls.push({ ...init, url } as RequestInit & { url: string });
      return new Response("<!doctype html><title>stub</title>", { status: 200 });
    },
  };
}

const holidays = {
  timeZone: "Asia/Shanghai" as const,
  startsOn: "2026-01-01",
  endsOn: "2026-12-31",
  sourceURL: "https://example.test/holidays",
  sourceSha256: "0".repeat(64),
  retrievedAt: "2026-01-01T00:00:00.000Z",
  noticeURL: "https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm",
  dates: [] as string[],
};

function stubDatabase(): D1Database {
  return {
    prepare: () => ({
      first: async () => ({
        time_zone: holidays.timeZone,
        starts_on: holidays.startsOn,
        ends_on: holidays.endsOn,
        source_url: holidays.sourceURL,
        source_sha256: holidays.sourceSha256,
        retrieved_at: holidays.retrievedAt,
        notice_url: holidays.noticeURL,
      }),
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      bind: () => ({ run: async () => ({ success: true }) }),
    }),
  } as unknown as D1Database;
}

test("never asks the runtime to follow or error on redirects", async () => {
  const { calls, fetch } = recordingFetcher();

  await buildVerifiedSchedule({ database: stubDatabase(), fetcher: fetch }).catch(() => undefined);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe(pricingPageURL);
  // `"error"` is not a legal value for the Workers runtime, and `"follow"` would
  // let a moved page change what is parsed without review. `"manual"` is the
  // only value that is both accepted at the edge and safe.
  expect(calls[0]?.redirect).toBe("manual");
});

test("refuses a redirect instead of parsing whatever it points at", async () => {
  const fetcher = async () =>
    new Response(null, { status: 302, headers: { Location: "https://example.test/elsewhere" } });

  await expect(buildVerifiedSchedule({ database: stubDatabase(), fetcher })).rejects.toThrow(
    "redirected",
  );
});

test("refuses a non-success response", async () => {
  const fetcher = async () => new Response("nope", { status: 500 });

  await expect(buildVerifiedSchedule({ database: stubDatabase(), fetcher })).rejects.toThrow(
    "successful response",
  );
});
