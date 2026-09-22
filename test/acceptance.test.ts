import { expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { acceptanceStack } from "./acceptance/stack.ts";

const { afterAll, beforeAll, beforeEach, deploy, destroy, test } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
  stage: `pricing-schedule-acceptance-${process.pid}`,
});

const deployment = beforeAll(deploy(acceptanceStack));
afterAll(destroy(acceptanceStack));

interface Endpoints {
  readonly controlURL: string;
  readonly pricingURL: string;
}

function endpoints(): Effect.Effect<Endpoints, Error> {
  return Effect.gen(function* () {
    const output = yield* deployment;
    if (output.controlURL === undefined || output.pricingURL === undefined) {
      return yield* Effect.fail(new Error("The local acceptance stack did not expose both Worker URLs."));
    }

    return {
      controlURL: output.controlURL,
      pricingURL: new URL("/v1/pricing-schedule", output.pricingURL).toString(),
    };
  });
}

function request(url: string, init?: RequestInit): Effect.Effect<Response, Error> {
  return Effect.tryPromise({
    try: () => fetch(url, init),
    catch: () => new Error("The local Worker request failed."),
  });
}

function clientHeaders(ip: string): Headers {
  return new Headers({ "cf-connecting-ip": ip });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseJSON(response: Response): Effect.Effect<Record<string, unknown>, Error> {
  return Effect.tryPromise({
    try: async () => {
      const parsed: unknown = await response.json();
      if (!isRecord(parsed)) {
        throw new Error("Expected an object JSON response.");
      }
      return parsed;
    },
    catch: () => new Error("The Worker response was not an object JSON body."),
  });
}

function modelInputCacheHit(body: Record<string, unknown>): string | undefined {
  const models = body.models;
  if (!isRecord(models)) return undefined;
  const model = models["deepseek-flash"];
  if (!isRecord(model)) return undefined;
  const offPeak = model.offPeak;
  if (!isRecord(offPeak)) return undefined;
  return typeof offPeak.inputCacheHit === "string" ? offPeak.inputCacheHit : undefined;
}

function freshness(body: Record<string, unknown>): Record<string, unknown> | undefined {
  const value = body.freshness;
  return isRecord(value) ? value : undefined;
}

beforeEach(
  Effect.gen(function* () {
    const { controlURL } = yield* endpoints();
    const response = yield* request(`${controlURL}/clear`, { method: "POST" });
    if (response.status !== 204) {
      return yield* Effect.fail(new Error("The acceptance control could not clear its run-owned snapshot."));
    }
  }),
);

test(
  "returns a retryable problem while no verified schedule exists",
  Effect.gen(function* () {
    const { pricingURL } = yield* endpoints();
    const response = yield* request(pricingURL, { headers: clientHeaders("203.0.113.1") });

    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    expect(response.headers.get("Retry-After")).toBe("3600");
    const body = yield* responseJSON(response);
    expect(body).toMatchObject({ status: 503, title: "Service Unavailable" });
  }),
);

test(
  "serves a verified snapshot and a bodyless conditional response",
  Effect.gen(function* () {
    const { controlURL, pricingURL } = yield* endpoints();
    yield* request(`${controlURL}/seed/baseline`, { method: "POST" });

    const response = yield* request(pricingURL, { headers: clientHeaders("203.0.113.2") });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400, must-revalidate");
    expect(response.headers.get("Date")).not.toBeNull();
    const etag = response.headers.get("ETag");
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
    const body = yield* responseJSON(response);
    expect(body.rateUnit).toEqual({ currency: "USD", perTokens: 1_000_000 });
    expect(modelInputCacheHit(body)).toBe("0.003");
    expect(freshness(body)?.status).toBe("CURRENT");

    const conditional = yield* request(pricingURL, {
      headers: new Headers({
        "If-None-Match": etag ?? "",
        "cf-connecting-ip": "203.0.113.3",
      }),
    });
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get("ETag")).toBe(etag);
    expect(conditional.headers.get("Cache-Control")).toBe("public, max-age=86400, must-revalidate");
    expect(conditional.headers.get("Date")).not.toBeNull();
    expect(conditional.headers.get("Content-Type")).toBeNull();
    expect(yield* Effect.promise(() => conditional.text())).toBe("");
  }),
);

test(
  "does not serve partial state after a refresh failure",
  Effect.gen(function* () {
    const { controlURL, pricingURL } = yield* endpoints();
    yield* request(`${controlURL}/seed/baseline`, { method: "POST" });
    yield* request(`${controlURL}/failure`, { method: "POST" });

    const response = yield* request(pricingURL, { headers: clientHeaders("203.0.113.4") });
    expect(response.status).toBe(200);
    const body = yield* responseJSON(response);
    expect(modelInputCacheHit(body)).toBe("0.003");
    expect(freshness(body)?.status).toBe("STALE");
  }),
);

test(
  "keeps a newer verified snapshot when a late refresh arrives",
  Effect.gen(function* () {
    const { controlURL, pricingURL } = yield* endpoints();
    yield* request(`${controlURL}/seed/baseline`, { method: "POST" });
    yield* request(`${controlURL}/seed/same`, { method: "POST" });

    const same = yield* request(pricingURL, { headers: clientHeaders("203.0.113.5") });
    const sameBody = yield* responseJSON(same);
    expect(freshness(sameBody)).toMatchObject({
      checkedAt: "2026-06-01T01:00:00.000Z",
      verifiedAt: "2026-06-01T00:00:00.000Z",
    });

    yield* request(`${controlURL}/seed/replacement`, { method: "POST" });
    yield* request(`${controlURL}/seed/older`, { method: "POST" });

    const response = yield* request(pricingURL, { headers: clientHeaders("203.0.113.6") });
    const body = yield* responseJSON(response);
    expect(modelInputCacheHit(body)).toBe("0.004");
    expect(freshness(body)).toMatchObject({
      status: "CURRENT",
      checkedAt: "2026-06-01T02:00:00.000Z",
      verifiedAt: "2026-06-01T02:00:00.000Z",
    });
  }),
);

test(
  "uses the documented method and request limits",
  Effect.gen(function* () {
    const { pricingURL } = yield* endpoints();
    const missingResponse = yield* request(new URL("/v1/missing", pricingURL).toString());
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.headers.get("Content-Type")).toBe("application/problem+json");

    const methodResponse = yield* request(pricingURL, { method: "POST" });
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get("Allow")).toBe("GET");
    expect(methodResponse.headers.get("Content-Type")).toBe("application/problem+json");

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = yield* request(pricingURL, { headers: clientHeaders("203.0.113.7") });
      statuses.push(response.status);
    }

    expect(statuses).toEqual([503, 503, 503, 503, 503, 429]);
  }),
);
