import { expect, test } from "bun:test";
import { canonicalHash, canonicalJSON } from "../src/canonical.ts";
import { parsePricingPage } from "../src/pricing-page.ts";
import { createVerifiedSchedule } from "../src/schedule.ts";

const fixture = Bun.file(new URL("./fixtures/pricing-page.html", import.meta.url));

test("parses the pinned official pricing-page fixture", async () => {
  const models = parsePricingPage(await fixture.text());

  expect(models).toEqual({
    "deepseek-flash": {
      offPeak: {
        inputCacheHit: "0.003",
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
  });
});

test("rejects an incomplete published rate row", async () => {
  const malformed = (await fixture.text()).replace("$3.96", "not-a-price");

  expect(() => parsePricingPage(malformed)).toThrow("public decimal grammar");
});

test("rejects a pricing-table model change until the contract is reviewed", async () => {
  const changed = (await fixture.text()).replace("deepseek-v4-pro", "changed-model");

  expect(() => parsePricingPage(changed)).toThrow("known model table");
});

test("rejects a peak-hours change until its contract is reviewed", async () => {
  const changed = (await fixture.text()).replace("01:00 - 04:00", "02:00 - 04:00");

  expect(() => parsePricingPage(changed)).toThrow("published peak-hours rule");
});

test("rejects an added pricing tier until its semantics are reviewed", async () => {
  const changed = (await fixture.text()).replace(
    "</table>",
    "<tr><td>1M OUTPUT TOKENS</td><td>SUPER-PEAK</td><td>$9</td><td>$9</td></tr></table>",
  );

  expect(() => parsePricingPage(changed)).toThrow("known OFF-PEAK or PEAK tier");
});

test("uses the approved wire names for units and peak weekdays", () => {
  const schedule: unknown = createVerifiedSchedule({
    models: {
      "deepseek-flash": {
        offPeak: { inputCacheHit: "0.003", inputCacheMiss: "0.15", output: "0.6" },
        peak: { inputCacheHit: "0.006", inputCacheMiss: "0.3", output: "1.2" },
      },
      "deepseek-v4-pro": {
        offPeak: { inputCacheHit: "0.022", inputCacheMiss: "0.66", output: "1.98" },
        peak: { inputCacheHit: "0.044", inputCacheMiss: "1.32", output: "3.96" },
      },
    },
    pricing: {
      url: "https://example.test/pricing",
      contentSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      retrievedAt: "2026-01-01T00:00:00.000Z",
    },
    holidays: {
      timeZone: "Asia/Shanghai",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      sourceURL: "https://example.test/holidays",
      sourceSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      retrievedAt: "2026-01-01T00:00:00.000Z",
      noticeURL: "https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm",
      dates: ["2026-01-01"],
    },
  });

  expect(schedule).toMatchObject({
    rateUnit: { currency: "USD", perTokens: 1_000_000 },
    schedule: {
      peakWeekdays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    },
  });
});

test("uses RFC 8785 canonical JSON for hashes", async () => {
  const value = { b: [3, { z: null, a: "x" }], a: 1 };

  expect(canonicalJSON(value)).toBe('{"a":1,"b":[3,{"a":"x","z":null}]}');
  expect(await canonicalHash(value)).toBe("b1c5071ddb6d08f2717b42209057f70a2082901110ba8cfc865465010e32c2dc");
});
