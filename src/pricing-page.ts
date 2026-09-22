import { officialModelIdentifiers, type ModelRates, type RateField, type TierName, type TokenRates } from "./domain.ts";

interface Metric {
  readonly label: string;
  readonly field: RateField;
}

interface PartialRates {
  inputCacheHit?: string;
  inputCacheMiss?: string;
  output?: string;
}

interface PartialModelRates {
  readonly offPeak: PartialRates;
  readonly peak: PartialRates;
}

const metrics: readonly Metric[] = [
  { label: "1M INPUT TOKENS (CACHE HIT)", field: "inputCacheHit" },
  { label: "1M INPUT TOKENS (CACHE MISS)", field: "inputCacheMiss" },
  { label: "1M OUTPUT TOKENS", field: "output" },
];

const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const modelIdentifierPattern = /^[a-z0-9][a-z0-9._-]*$/;
const publishedSchedule =
  "Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays.";

function decodeHTML(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, token: string) => {
    const normalized = token.toLowerCase();

    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    if (normalized === "nbsp") return " ";
    if (normalized.startsWith("#x")) return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
    return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
  });
}

function tableText(value: string): string {
  return decodeHTML(value.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function tableRows(table: string): readonly (readonly string[])[] {
  return Array.from(table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), (row) => {
    const body = row[1] ?? "";

    return Array.from(body.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi), (cell) =>
      tableText(cell[1] ?? ""),
    );
  }).filter((cells) => cells.length > 0);
}

function validatePublishedSchedule(html: string): void {
  if (!tableText(html).includes(publishedSchedule)) {
    throw new Error("The pricing source does not match the published peak-hours rule.");
  }
}

function pricingTable(html: string): readonly (readonly string[])[] {
  const table = Array.from(html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi), (match) => match[1] ?? "").find(
    (candidate) => tableText(candidate).includes("PRICING(2)"),
  );

  if (table === undefined) {
    throw new Error("The pricing source does not contain its published pricing table.");
  }

  return tableRows(table);
}

function modelIdentifier(value: string): string {
  const identifier = value.replace(/\(\d+\)$/, "").trim();

  if (!modelIdentifierPattern.test(identifier)) {
    throw new Error("The pricing source contains an invalid model identifier.");
  }

  return identifier;
}

function modelColumns(rows: readonly (readonly string[])[]): readonly string[] {
  const row = rows.find((cells) => cells.includes("MODEL"));

  if (row === undefined) {
    throw new Error("The pricing source does not declare model columns.");
  }

  const modelIndex = row.indexOf("MODEL");
  const models = row.slice(modelIndex + 1).map(modelIdentifier);

  if (
    models.length !== officialModelIdentifiers.length ||
    models.some((model, index) => model !== officialModelIdentifiers[index])
  ) {
    throw new Error("The pricing source does not match the known model table.");
  }

  return models;
}

function tierFrom(cells: readonly string[]): TierName | undefined {
  const tier = cells.find((cell) => cell.includes("PEAK"));
  if (tier === undefined) return undefined;
  if (tier === "OFF-PEAK") return "OFF_PEAK";
  if (tier === "PEAK") return "PEAK";
  throw new Error("The pricing source does not match a known OFF-PEAK or PEAK tier.");
}

function exactPrice(value: string): string {
  const match = /^\$(.+)$/.exec(value);

  if (match === null || !decimalPattern.test(match[1])) {
    throw new Error("The pricing source contains a price outside the public decimal grammar.");
  }

  return match[1];
}

function mutableRates(matrix: Record<string, PartialModelRates>, model: string): PartialModelRates {
  const existing = matrix[model];

  if (existing !== undefined) return existing;

  const created: PartialModelRates = {
    offPeak: {},
    peak: {},
  };
  matrix[model] = created;
  return created;
}

function addPrice({
  matrix,
  model,
  tier,
  field,
  value,
}: {
  readonly matrix: Record<string, PartialModelRates>;
  readonly model: string;
  readonly tier: TierName;
  readonly field: RateField;
  readonly value: string;
}): void {
  const target = tier === "OFF_PEAK" ? mutableRates(matrix, model).offPeak : mutableRates(matrix, model).peak;

  if (target[field] !== undefined) {
    throw new Error("The pricing source declares a duplicated rate.");
  }

  target[field] = value;
}

function completeRates(rates: PartialRates): TokenRates {
  const { inputCacheHit, inputCacheMiss, output } = rates;

  if (inputCacheHit === undefined || inputCacheMiss === undefined || output === undefined) {
    throw new Error("The pricing source declares an incomplete token-rate row.");
  }

  return { inputCacheHit, inputCacheMiss, output };
}

function completeModelRates(rates: PartialModelRates | undefined): ModelRates {
  if (rates === undefined) {
    throw new Error("The pricing source omits a declared model from a rate row.");
  }

  return {
    offPeak: completeRates(rates.offPeak),
    peak: completeRates(rates.peak),
  };
}

export function parsePricingPage(html: string): Readonly<Record<string, ModelRates>> {
  validatePublishedSchedule(html);
  const rows = pricingTable(html);
  const models = modelColumns(rows);
  const matrix: Record<string, PartialModelRates> = {};
  let activeMetric: Metric | undefined;

  for (const cells of rows) {
    const declaredMetric = metrics.find((metric) => cells.includes(metric.label));
    if (declaredMetric !== undefined) activeMetric = declaredMetric;

    const tier = tierFrom(cells);
    if (tier === undefined) {
      if (cells.some((cell) => cell.startsWith("$"))) {
        throw new Error("The pricing source does not match a known OFF-PEAK or PEAK tier.");
      }
      continue;
    }
    if (activeMetric === undefined) {
      throw new Error("The pricing source has a tier without its token category.");
    }

    const tierIndex = cells.indexOf(tier === "OFF_PEAK" ? "OFF-PEAK" : "PEAK");
    const values = cells.slice(tierIndex + 1);

    if (values.length !== models.length) {
      throw new Error("The pricing source has a price row that does not match its models.");
    }

    for (const [index, model] of models.entries()) {
      const rawPrice = values[index];
      if (rawPrice === undefined) {
        throw new Error("The pricing source has a missing model price.");
      }

      addPrice({
        matrix,
        model,
        tier,
        field: activeMetric.field,
        value: exactPrice(rawPrice),
      });
    }
  }

  const parsed: Record<string, ModelRates> = {};
  for (const model of models) {
    parsed[model] = completeModelRates(matrix[model]);
  }

  return parsed;
}
