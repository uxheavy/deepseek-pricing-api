import { canonicalHash, canonicalJSON } from "./canonical.ts";
import type {
  HolidayManifest,
  PricingScheduleResponse,
  StoredSnapshotRow,
  VerifiedSchedule,
} from "./domain.ts";
import { parseStoredSchedule, verifiedResponse } from "./snapshot.ts";

interface HolidayManifestRow {
  readonly time_zone: "Asia/Shanghai";
  readonly starts_on: string;
  readonly ends_on: string;
  readonly source_url: string;
  readonly source_sha256: string;
  readonly retrieved_at: string;
  readonly notice_url: string;
}

interface HolidayDateRow {
  readonly holiday_date: string;
}

export interface StoredVerifiedSchedule {
  readonly response: PricingScheduleResponse;
  readonly representationHash: string;
}

export async function loadHolidayManifest(database: D1Database): Promise<HolidayManifest> {
  const manifest = await database
    .prepare(
      "SELECT time_zone, starts_on, ends_on, source_url, source_sha256, retrieved_at, notice_url FROM holiday_manifest WHERE singleton = 1",
    )
    .first<HolidayManifestRow>();

  if (manifest === null) {
    throw new Error("The pinned holiday manifest is unavailable.");
  }

  const dates = await database.prepare("SELECT holiday_date FROM holiday_date ORDER BY holiday_date").all<HolidayDateRow>();

  return {
    timeZone: manifest.time_zone,
    startsOn: manifest.starts_on,
    endsOn: manifest.ends_on,
    sourceURL: manifest.source_url,
    sourceSha256: manifest.source_sha256,
    retrievedAt: manifest.retrieved_at,
    noticeURL: manifest.notice_url,
    dates: dates.results.map((row) => row.holiday_date),
  };
}

export async function readVerifiedSchedule(database: D1Database): Promise<StoredVerifiedSchedule | undefined> {
  const row = await database
    .prepare(
      "SELECT snapshot_json, snapshot_hash, checked_at, verified_at, last_failure_at FROM pricing_snapshot WHERE singleton = 1",
    )
    .first<StoredSnapshotRow>();

  if (row === null || row.snapshot_json === null || row.snapshot_hash === null || row.verified_at === null) {
    return undefined;
  }

  const snapshot = parseStoredSchedule(row.snapshot_json);
  const calculatedHash = await canonicalHash(snapshot);
  if (calculatedHash !== row.snapshot_hash) {
    throw new Error("The persisted snapshot does not match its canonical hash.");
  }

  const response = await verifiedResponse({
    snapshot,
    status: row.last_failure_at === null ? "CURRENT" : "STALE",
    checkedAt: row.checked_at,
    verifiedAt: row.verified_at,
  });
  const representationHash = await canonicalHash(response);

  return { response, representationHash };
}

export async function persistVerifiedSchedule({
  database,
  snapshot,
  checkedAt,
}: {
  readonly database: D1Database;
  readonly snapshot: VerifiedSchedule;
  readonly checkedAt: string;
}): Promise<void> {
  const json = canonicalJSON(snapshot);
  const hash = await canonicalHash(snapshot);

  await database
    .prepare(
      `INSERT INTO pricing_snapshot (
        singleton,
        snapshot_json,
        snapshot_hash,
        checked_at,
        verified_at,
        last_failure_at,
        last_failure_kind
      ) VALUES (1, ?, ?, ?, ?, NULL, NULL)
      ON CONFLICT(singleton) DO UPDATE SET
        snapshot_json = CASE
          WHEN excluded.checked_at >= pricing_snapshot.checked_at
            AND excluded.snapshot_hash IS NOT pricing_snapshot.snapshot_hash
          THEN excluded.snapshot_json
          ELSE pricing_snapshot.snapshot_json
        END,
        snapshot_hash = CASE
          WHEN excluded.checked_at >= pricing_snapshot.checked_at
            AND excluded.snapshot_hash IS NOT pricing_snapshot.snapshot_hash
          THEN excluded.snapshot_hash
          ELSE pricing_snapshot.snapshot_hash
        END,
        checked_at = CASE
          WHEN excluded.checked_at >= pricing_snapshot.checked_at THEN excluded.checked_at
          ELSE pricing_snapshot.checked_at
        END,
        verified_at = CASE
          WHEN excluded.checked_at >= pricing_snapshot.checked_at
            AND excluded.snapshot_hash IS NOT pricing_snapshot.snapshot_hash
          THEN excluded.verified_at
          ELSE pricing_snapshot.verified_at
        END,
        last_failure_at = CASE
          WHEN excluded.checked_at >= pricing_snapshot.checked_at THEN NULL
          ELSE pricing_snapshot.last_failure_at
        END,
        last_failure_kind = CASE
          WHEN excluded.checked_at >= pricing_snapshot.checked_at THEN NULL
          ELSE pricing_snapshot.last_failure_kind
        END`,
    )
    .bind(json, hash, checkedAt, checkedAt)
    .run();
}

export async function recordRefreshFailure({
  database,
  checkedAt,
}: {
  readonly database: D1Database;
  readonly checkedAt: string;
}): Promise<void> {
  await database
    .prepare(
      `INSERT INTO pricing_snapshot (
        singleton,
        snapshot_json,
        snapshot_hash,
        checked_at,
        verified_at,
        last_failure_at,
        last_failure_kind
      ) VALUES (1, NULL, NULL, ?, NULL, ?, 'refresh_failed')
      ON CONFLICT(singleton) DO UPDATE SET
        checked_at = CASE
          WHEN excluded.checked_at >= pricing_snapshot.checked_at THEN excluded.checked_at
          ELSE pricing_snapshot.checked_at
        END,
        last_failure_at = CASE
          WHEN excluded.checked_at >= pricing_snapshot.checked_at THEN excluded.last_failure_at
          ELSE pricing_snapshot.last_failure_at
        END,
        last_failure_kind = CASE
          WHEN excluded.checked_at >= pricing_snapshot.checked_at THEN excluded.last_failure_kind
          ELSE pricing_snapshot.last_failure_kind
        END`,
    )
    .bind(checkedAt, checkedAt)
    .run();
}
