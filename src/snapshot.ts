import { canonicalHash } from "./canonical.ts";
import {
  hasOfficialModelSet,
  peakWeekdays as expectedPeakWeekdays,
  peakWindows as expectedPeakWindows,
  rateUnit,
  type ModelRates,
  type PricingScheduleResponse,
  type Schedule,
  type SourceProvenance,
  type TokenRates,
  type VerifiedSchedule,
} from "./domain.ts";

const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const modelIdentifierPattern = /^[a-z0-9][a-z0-9._-]*$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`${key} must be a string.`);
  return value;
}

function requiredStringArray(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${key} must be an array of strings.`);
  }
  return value;
}

function isCalendarDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}

function isTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function parseRates(value: unknown): TokenRates {
  const record = requiredRecord(value, "Token rates");
  const inputCacheHit = requiredString(record, "inputCacheHit");
  const inputCacheMiss = requiredString(record, "inputCacheMiss");
  const output = requiredString(record, "output");

  if (![inputCacheHit, inputCacheMiss, output].every((rate) => decimalPattern.test(rate))) {
    throw new Error("Token rates must use the public decimal grammar.");
  }

  return { inputCacheHit, inputCacheMiss, output };
}

function parseModels(value: unknown): Readonly<Record<string, ModelRates>> {
  const record = requiredRecord(value, "Models");
  const entries = Object.entries(record);

  if (!hasOfficialModelSet(record)) throw new Error("Models do not match the known model table.");

  const models: Record<string, ModelRates> = {};
  for (const [identifier, model] of entries) {
    if (!modelIdentifierPattern.test(identifier)) {
      throw new Error("Model identifiers must be official identifiers.");
    }

    const rates = requiredRecord(model, "Model rates");
    models[identifier] = {
      offPeak: parseRates(rates.offPeak),
      peak: parseRates(rates.peak),
    };
  }

  return models;
}

function parseWindows(value: unknown): Schedule["peakWindows"] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Peak windows cannot be empty.");
  }

  const windows: Array<{ start: string; end: string }> = [];
  let previousEnd: string | undefined;
  for (const candidate of value) {
    const record = requiredRecord(candidate, "Peak window");
    const start = requiredString(record, "start");
    const end = requiredString(record, "end");

    if (!timePattern.test(start) || !timePattern.test(end) || start >= end) {
      throw new Error("Peak windows must be same-day UTC intervals.");
    }
    if (previousEnd !== undefined && previousEnd > start) {
      throw new Error("Peak windows must be sorted and non-overlapping.");
    }

    windows.push({ start, end });
    previousEnd = end;
  }

  return windows;
}

function parseSchedule(value: unknown): Schedule {
  const record = requiredRecord(value, "Schedule");
  const timeZone = requiredString(record, "timeZone");
  const peakWeekdays = requiredStringArray(record, "peakWeekdays");
  const peakWindows = parseWindows(record.peakWindows);
  const holidayTimeZone = requiredString(record, "holidayTimeZone");
  const coverage = requiredRecord(record.holidayCoverage, "Holiday coverage");
  const startsOn = requiredString(coverage, "startsOn");
  const endsOn = requiredString(coverage, "endsOn");
  const holidays = requiredStringArray(record, "holidays");

  if (timeZone !== "UTC" || holidayTimeZone !== "Asia/Shanghai") {
    throw new Error("Schedule time zones do not match the public contract.");
  }
  if (
    peakWeekdays.length !== expectedPeakWeekdays.length ||
    peakWeekdays.some((weekday, index) => weekday !== expectedPeakWeekdays[index]) ||
    peakWindows.length !== expectedPeakWindows.length ||
    peakWindows.some(
      (window, index) =>
        window.start !== expectedPeakWindows[index]?.start || window.end !== expectedPeakWindows[index]?.end,
    )
  ) {
    throw new Error("Schedule windows do not match the verified pricing policy.");
  }
  if (!isCalendarDate(startsOn) || !isCalendarDate(endsOn) || startsOn > endsOn) {
    throw new Error("Holiday coverage is invalid.");
  }

  let previousHoliday: string | undefined;
  for (const holiday of holidays) {
    if (
      !isCalendarDate(holiday) ||
      holiday < startsOn ||
      holiday > endsOn ||
      (previousHoliday !== undefined && holiday <= previousHoliday)
    ) {
      throw new Error("Holiday dates are invalid.");
    }
    previousHoliday = holiday;
  }

  return {
    timeZone: "UTC",
    peakWeekdays,
    peakWindows,
    holidayTimeZone: "Asia/Shanghai",
    holidayCoverage: { startsOn, endsOn },
    holidays,
  };
}

function parseSource(value: unknown): SourceProvenance {
  const record = requiredRecord(value, "Source provenance");
  const url = requiredString(record, "url");
  const contentSha256 = requiredString(record, "contentSha256");
  const retrievedAt = requiredString(record, "retrievedAt");

  if (!url.startsWith("https://") || !sha256Pattern.test(contentSha256) || !isTimestamp(retrievedAt)) {
    throw new Error("Source provenance is invalid.");
  }

  return { url, contentSha256, retrievedAt };
}

export function parseVerifiedSchedule(value: unknown): VerifiedSchedule {
  const record = requiredRecord(value, "Pricing schedule");
  const unit = requiredRecord(record.rateUnit, "rateUnit");
  const currency = requiredString(unit, "currency");
  const perTokens = unit.perTokens;
  const models = parseModels(record.models);
  const schedule = parseSchedule(record.schedule);
  const provenance = requiredRecord(record.provenance, "Provenance");
  const pricing = parseSource(provenance.pricing);
  const holidaysRecord = requiredRecord(provenance.holidays, "Holiday provenance");
  const holidays = parseSource(holidaysRecord);
  const noticeURL = requiredString(holidaysRecord, "noticeURL");

  if (
    currency !== rateUnit.currency ||
    perTokens !== rateUnit.perTokens ||
    !noticeURL.startsWith("https://")
  ) {
    throw new Error("Pricing schedule does not meet the public contract.");
  }

  return {
    rateUnit,
    models,
    schedule,
    provenance: {
      pricing,
      holidays: { ...holidays, noticeURL },
    },
  };
}

export function parseStoredSchedule(json: string): VerifiedSchedule {
  const parsed: unknown = JSON.parse(json);
  return parseVerifiedSchedule(parsed);
}

export async function verifiedResponse({
  snapshot,
  status,
  checkedAt,
  verifiedAt,
}: {
  readonly snapshot: VerifiedSchedule;
  readonly status: "CURRENT" | "STALE";
  readonly checkedAt: string;
  readonly verifiedAt: string;
}): Promise<PricingScheduleResponse> {
  if (!isTimestamp(checkedAt) || !isTimestamp(verifiedAt)) {
    throw new Error("Stored freshness timestamps are invalid.");
  }

  const hash = await canonicalHash(snapshot);
  if (!sha256Pattern.test(hash)) {
    throw new Error("The canonical schedule hash is invalid.");
  }

  return {
    ...snapshot,
    freshness: {
      status,
      checkedAt,
      verifiedAt,
    },
  };
}
