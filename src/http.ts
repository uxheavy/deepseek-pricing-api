import { canonicalJSON } from "./canonical.ts";
import type { PricingScheduleResponse } from "./domain.ts";
import { problem } from "./problem.ts";
import { readVerifiedSchedule } from "./storage.ts";

const endpointPath = "/v1/pricing-schedule";
const cacheControl = "public, max-age=86400, must-revalidate";

function nowHeader(): string {
  return new Date().toUTCString();
}

function quotedETag(hash: string): string {
  return `"${hash}"`;
}

function matchesIfNoneMatch(value: string | null, etag: string): boolean {
  if (value === null) return false;

  return value.split(",").some((candidate) => {
    const trimmed = candidate.trim();
    if (trimmed === "*") return true;
    return trimmed.replace(/^W\//i, "") === etag;
  });
}

function successHeaders(etag: string): Headers {
  return new Headers({
    "Cache-Control": cacheControl,
    "Content-Type": "application/json",
    Date: nowHeader(),
    ETag: etag,
  });
}

function notModified(etag: string): Response {
  return new Response(null, {
    status: 304,
    headers: {
      "Cache-Control": cacheControl,
      Date: nowHeader(),
      ETag: etag,
    },
  });
}

function servedResponse({
  request,
  response,
  representationHash,
}: {
  readonly request: Request;
  readonly response: PricingScheduleResponse;
  readonly representationHash: string;
}): Response {
  const etag = quotedETag(representationHash);
  if (matchesIfNoneMatch(request.headers.get("If-None-Match"), etag)) {
    return notModified(etag);
  }

  return new Response(canonicalJSON(response), {
    status: 200,
    headers: successHeaders(etag),
  });
}

export async function handleRequest({
  request,
  env,
}: {
  readonly request: Request;
  readonly env: {
    readonly DB: D1Database;
    readonly REQUEST_LIMIT: RateLimit;
  };
}): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname !== endpointPath || url.search !== "") {
    return problem({
      status: 404,
      title: "Not Found",
      detail: "The requested resource does not exist.",
    });
  }

  if (request.method !== "GET") {
    return problem({
      status: 405,
      title: "Method Not Allowed",
      detail: "Use GET for this resource.",
      headers: { Allow: "GET" },
    });
  }

  try {
    const address = request.headers.get("cf-connecting-ip") ?? "unknown";
    const limit = await env.REQUEST_LIMIT.limit({ key: `${url.pathname}:${address.slice(0, 128)}` });

    if (!limit.success) {
      return problem({
        status: 429,
        title: "Too Many Requests",
        detail: "Try again in 60 seconds.",
        headers: { "Retry-After": "60" },
      });
    }

    const stored = await readVerifiedSchedule(env.DB);
    if (stored === undefined) {
      return problem({
        status: 503,
        title: "Service Unavailable",
        detail: "A verified pricing schedule is not available yet. Try again in 3600 seconds.",
        headers: { "Retry-After": "3600" },
      });
    }

    return servedResponse({
      request,
      response: stored.response,
      representationHash: stored.representationHash,
    });
  } catch {
    return problem({
      status: 500,
      title: "Internal Server Error",
      detail: "The verified schedule could not be read. Try again later.",
    });
  }
}
