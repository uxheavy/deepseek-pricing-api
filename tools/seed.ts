#!/usr/bin/env bun
//
// Manual seed: populate the DEPLOYED database with a verified snapshot.
//
//   pnpm run seed -- --stage production [--dry-run]
//
// A scheduled Worker only refreshes on its cron, and Cloudflare offers no way to
// invoke a deployed `scheduled()` handler on demand. A fresh deployment
// therefore serves 503 with `Retry-After: 3600` until the first cron fires,
// which can be up to a day. This tool closes that gap by running the same
// refresh the cron runs and writing the result to the deployed database.
//
// It is deliberately NOT part of `alchemy deploy`: seeding is an operator
// decision, the refresh depends on a reachable upstream, and a failed seed must
// not fail a deployment. Run it when you want the service serving now.
//
// The public Worker still exposes only the anonymous read route from ADR-0001.
// This tool talks to the Cloudflare D1 API with the operator's own credentials,
// so it adds no write route to the service itself.
//
// What it does NOT do: it does not weaken validation. It calls
// `buildVerifiedSchedule`, so a snapshot is written only if the published page
// still parses against the reviewed contract, using the same canonical hashing
// and the same pinned holiday manifest as production.

import { canonicalHash, canonicalJSON } from "../src/canonical.ts";
import { parseStoredSchedule, verifiedResponse } from "../src/snapshot.ts";
import { buildVerifiedSchedule } from "../src/refresh.ts";
import { loadHolidayManifest } from "../src/storage.ts";
import type { StoredSnapshotRow } from "../src/domain.ts";

interface Arguments {
  readonly stage: string;
  readonly dryRun: boolean;
}

function parseArguments(argv: readonly string[]): Arguments {
  let stage = "production";
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--stage") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--stage needs a value, for example --stage production");
      }
      stage = value;
      index += 1;
    } else if (flag === "--dry-run") {
      dryRun = true;
    } else if (flag === "--help" || flag === "-h") {
      console.log("usage: pnpm run seed -- --stage <stage> [--dry-run]");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }

  return { stage, dryRun };
}

interface CloudflareCredentials {
  readonly accountId: string;
  readonly token: string;
  readonly profile: string;
}

/**
 * Reads the operator's Cloudflare credentials from the Alchemy profile.
 *
 * The state-store credential file holds the state store's own token, which the
 * Cloudflare API rejects; the OAuth access token in the profile file is the one
 * that authorises D1.
 */
async function readCredentials(): Promise<CloudflareCredentials> {
  const home = process.env.HOME ?? "";
  const profileName = process.env.ALCHEMY_PROFILE ?? "default";
  const profilePath = `${home}/.alchemy/profiles/${profileName}/cloudflare.json`;
  const file = Bun.file(profilePath);

  if (!(await file.exists())) {
    throw new Error(`no Cloudflare profile at ${profilePath}; run \`alchemy profile create\` first`);
  }

  const profile = (await file.json()) as {
    values?: { access?: string; accountId?: string };
  };
  const token = profile.values?.access;
  const accountId = profile.values?.accountId;

  if (token === undefined || accountId === undefined) {
    throw new Error(`profile ${profileName} has no Cloudflare access token; re-authenticate it`);
  }

  return { accountId, token, profile: profileName };
}

/**
 * Reads the holiday manifest from the deployed database.
 *
 * The seed must use the same reviewed manifest the service serves from, so the
 * snapshot it writes cannot claim different holiday coverage than the migration
 * seeded.
 */
function deployedDatabase(credentials: CloudflareCredentials, stage: string) {
  const databaseName = `DeepSeekPricingApi-PricingDatabase-${stage}-`;

  return {
    /** Looks up the deployed D1 database for this stage. */
    async resolveDatabaseId(): Promise<string> {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/d1/database`,
        { headers: { Authorization: `Bearer ${credentials.token}` } },
      );
      const body = (await response.json()) as {
        success: boolean;
        errors?: { message: string }[];
        result?: { name: string; uuid: string }[];
      };

      if (!body.success) {
        throw new Error(`D1 list failed: ${body.errors?.map((e) => e.message).join(", ") ?? "unknown"}`);
      }

      const match = (body.result ?? []).find((database) => database.name.startsWith(databaseName));
      if (match === undefined) {
        throw new Error(
          `no deployed D1 named ${databaseName}*; deploy stage ${stage} first, or check the stage name`,
        );
      }

      return match.uuid;
    },

    /** Runs one statement against the deployed database. */
    async query<T>(
      databaseId: string,
      sql: string,
      params: readonly (string | null)[] = [],
    ): Promise<T[]> {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/d1/database/${databaseId}/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credentials.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sql, params }),
        },
      );
      const body = (await response.json()) as {
        success: boolean;
        errors?: { message: string }[];
        result?: { results?: T[] }[];
      };

      if (!body.success) {
        throw new Error(`D1 query failed: ${body.errors?.map((e) => e.message).join(", ") ?? "unknown"}`);
      }

      return body.result?.[0]?.results ?? [];
    },
  };
}

/**
 * A `D1Database`-shaped reader over the deployed database.
 *
 * `buildVerifiedSchedule` and `loadHolidayManifest` take a `D1Database`, so the
 * seed reuses them unchanged by adapting the remote API to the interface they
 * already read. Only `prepare().first()/.all()` are needed for reads.
 */
function remoteReader(database: ReturnType<typeof deployedDatabase>, databaseId: string): D1Database {
  const query = (sql: string) => database.query<Record<string, unknown>>(databaseId, sql);

  return {
    prepare(sql: string) {
      return {
        first: async () => (await query(sql))[0] ?? null,
        all: async () => ({ results: await query(sql) }),
        run: async () => {
          throw new Error("the seed reads through this adapter; use the write path instead");
        },
        bind: () => {
          throw new Error("the seed reads through this adapter; use the write path instead");
        },
      };
    },
  } as unknown as D1Database;
}

async function main(): Promise<void> {
  const { stage, dryRun } = parseArguments(process.argv.slice(2));
  const credentials = await readCredentials();
  const database = deployedDatabase(credentials, stage);
  const databaseId = await database.resolveDatabaseId();

  console.log(`stage      ${stage}`);
  console.log(`profile    ${credentials.profile}`);
  console.log(`database   ${databaseId}`);
  console.log("");

  // Read the deployed manifest, so the seeded snapshot carries the coverage and
  // holiday dates that the migrations actually applied.
  const holidays = await loadHolidayManifest(remoteReader(database, databaseId));
  console.log(`manifest   ${holidays.dates.length} holidays, ${holidays.startsOn}..${holidays.endsOn}`);

  const existing = await database.query<StoredSnapshotRow>(
    databaseId,
    "SELECT snapshot_json, snapshot_hash, checked_at, verified_at, last_failure_at FROM pricing_snapshot WHERE singleton = 1",
  );
  const current = existing[0];
  console.log(
    current?.snapshot_hash == null
      ? "current    no snapshot"
      : `current    ${String(current.snapshot_hash).slice(0, 16)}… verified ${current.verified_at}`,
  );

  // The real refresh path: fetch, validate against the reviewed contract, hash.
  const snapshot = await buildVerifiedSchedule({
    database: remoteReader(database, databaseId),
  });
  const checkedAt = new Date().toISOString();
  const payload = canonicalJSON(snapshot);

  console.log(`fetched    ${snapshot.provenance.pricing.contentSha256.slice(0, 16)}…`);
  console.log(`models     ${Object.keys(snapshot.models).sort().join(", ")}`);

  // Round-trip through the reader the Worker uses, so a snapshot the service
  // could not parse is never written. This runs the same parse the read path
  // runs, against the exact bytes about to be stored.
  const parsed = parseStoredSchedule(payload);
  const response = await verifiedResponse({
    snapshot: parsed,
    status: "CURRENT",
    checkedAt,
    verifiedAt: checkedAt,
  });
  const representationHash = await canonicalHash(response);
  console.log(`verified   parses as the service reads it; response hash ${representationHash.slice(0, 16)}…`);

  if (dryRun) {
    console.log("\ndry run: nothing written");
    return;
  }

  // Same singleton upsert the service uses, including the late-write guard, so
  // a seed cannot overwrite a newer snapshot that a cron wrote meanwhile.
  await database.query(
    databaseId,
    `INSERT INTO pricing_snapshot (
       singleton, snapshot_json, snapshot_hash, checked_at, verified_at, last_failure_at, last_failure_kind
     ) VALUES (1, ?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(singleton) DO UPDATE SET
       snapshot_json = CASE
         WHEN excluded.checked_at >= pricing_snapshot.checked_at
           AND excluded.snapshot_hash IS NOT pricing_snapshot.snapshot_hash
         THEN excluded.snapshot_json ELSE pricing_snapshot.snapshot_json END,
       snapshot_hash = CASE
         WHEN excluded.checked_at >= pricing_snapshot.checked_at
           AND excluded.snapshot_hash IS NOT pricing_snapshot.snapshot_hash
         THEN excluded.snapshot_hash ELSE pricing_snapshot.snapshot_hash END,
       checked_at = CASE
         WHEN excluded.checked_at >= pricing_snapshot.checked_at THEN excluded.checked_at
         ELSE pricing_snapshot.checked_at END,
       verified_at = CASE
         WHEN excluded.checked_at >= pricing_snapshot.checked_at
           AND excluded.snapshot_hash IS NOT pricing_snapshot.snapshot_hash
         THEN excluded.verified_at ELSE pricing_snapshot.verified_at END,
       last_failure_at = CASE
         WHEN excluded.checked_at >= pricing_snapshot.checked_at THEN NULL
         ELSE pricing_snapshot.last_failure_at END,
       last_failure_kind = CASE
         WHEN excluded.checked_at >= pricing_snapshot.checked_at THEN NULL
         ELSE pricing_snapshot.last_failure_kind END`,
    [payload, await canonicalHash(snapshot), checkedAt, checkedAt],
  );

  const written = await database.query<StoredSnapshotRow>(
    databaseId,
    "SELECT snapshot_hash, checked_at, verified_at, last_failure_at FROM pricing_snapshot WHERE singleton = 1",
  );
  console.log("");
  console.log(`seeded     ${String(written[0]?.snapshot_hash).slice(0, 16)}… verified ${written[0]?.verified_at}`);
  console.log(`read       https://deepseek-pricing-api.uxheavy.workers.dev/v1/pricing-schedule`);
}

await main();
