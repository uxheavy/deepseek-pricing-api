import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/// The migrations must seed exactly the holidays of the pinned manifest.
///
/// `holiday_manifest.source_sha256` claims the pinned file, so a seeded set that
/// disagrees with it is a silent pricing error: a holiday the manifest lists but
/// the database omits is priced as peak. That is what happened when 0001 seeded
/// 33 of the manifest's 39 dates, so this check reads both and compares them
/// rather than trusting either one.
const migrationDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const manifestPath = fileURLToPath(new URL("./fixtures/holiday-cn-2026.json", import.meta.url));

interface ManifestDay {
  readonly date: string;
  readonly name: string;
  readonly workday?: boolean;
}

async function seededHolidays(): Promise<readonly string[]> {
  const names = (await Array.fromAsync(new Bun.Glob("*.sql").scan(migrationDirectory))).sort();
  const dates: string[] = [];

  for (const name of names) {
    const sql = await Bun.file(join(migrationDirectory, name)).text();
    const marker = /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+holiday_date\s*\(\s*holiday_date\s*\)\s*VALUES/i;
    if (!marker.test(sql)) continue;

    // One migration may contribute several such statements.
    for (const chunk of sql.split(new RegExp(marker.source, "gi")).slice(1)) {
      const body = chunk.split(";", 1)[0] ?? "";
      dates.push(...Array.from(body.matchAll(/'(\d{4}-\d{2}-\d{2})'/g), (m) => m[1] ?? ""));
    }
  }

  return Array.from(new Set(dates)).sort();
}

async function manifestHolidays(): Promise<readonly string[]> {
  const manifest = (await Bun.file(manifestPath).json()) as { days: ManifestDay[] };

  return manifest.days.filter((day) => day.workday !== true).map((day) => day.date).sort();
}

test("seeds exactly the pinned manifest's holidays", async () => {
  const [seeded, manifest] = await Promise.all([seededHolidays(), manifestHolidays()]);

  expect(seeded).toEqual(manifest);
});

test("seeds no date twice across migrations", async () => {
  const names = (await Array.fromAsync(new Bun.Glob("*.sql").scan(migrationDirectory))).sort();
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const name of names) {
    const sql = await Bun.file(join(migrationDirectory, name)).text();
    const marker = /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+holiday_date\s*\(\s*holiday_date\s*\)\s*VALUES/gi;
    if (!marker.test(sql)) continue;

    for (const chunk of sql.split(marker).slice(1)) {
      const body = chunk.split(";", 1)[0] ?? "";
      for (const match of body.matchAll(/'(\d{4}-\d{2}-\d{2})'/g)) {
        const date = match[1] ?? "";
        if (seen.has(date)) duplicates.push(date);
        seen.add(date);
      }
    }
  }

  // A duplicate is not an error by itself (0002 uses INSERT OR IGNORE), but a
  // later migration restating an earlier one means the pinned set moved and the
  // two disagree about it.
  expect(duplicates).toEqual([]);
});
