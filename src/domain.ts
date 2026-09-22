export const pricingPageURL = "https://api-docs.deepseek.com/quick_start/pricing";
export const holidayManifestURL =
  "https://raw.githubusercontent.com/NateScarlet/holiday-cn/18c8f140cd8574faf72c8bb5cd0a9bdf9d1c1b6c/2026.json";
export const holidayNoticeURL =
  "https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm";

export interface RateUnit {
  readonly currency: "USD";
  readonly perTokens: 1_000_000;
}

export const rateUnit: RateUnit = {
  currency: "USD",
  perTokens: 1_000_000,
};

export type RateField = "inputCacheHit" | "inputCacheMiss" | "output";
export type TierName = "OFF_PEAK" | "PEAK";

export interface TokenRates {
  readonly inputCacheHit: string;
  readonly inputCacheMiss: string;
  readonly output: string;
}

export interface ModelRates {
  readonly offPeak: TokenRates;
  readonly peak: TokenRates;
}

export interface PeakWindow {
  readonly start: string;
  readonly end: string;
}

export interface Schedule {
  readonly timeZone: "UTC";
  readonly peakWeekdays: readonly string[];
  readonly peakWindows: readonly PeakWindow[];
  readonly holidayTimeZone: "Asia/Shanghai";
  readonly holidayCoverage: {
    readonly startsOn: string;
    readonly endsOn: string;
  };
  readonly holidays: readonly string[];
}

export interface SourceProvenance {
  readonly url: string;
  readonly contentSha256: string;
  readonly retrievedAt: string;
}

export interface VerifiedSchedule {
  readonly rateUnit: RateUnit;
  readonly schedule: Schedule;
  readonly models: Readonly<Record<string, ModelRates>>;
  readonly provenance: {
    readonly pricing: SourceProvenance;
    readonly holidays: SourceProvenance & {
      readonly noticeURL: string;
    };
  };
}

export interface Freshness {
  readonly status: "CURRENT" | "STALE";
  readonly checkedAt: string;
  readonly verifiedAt: string;
}

export interface PricingScheduleResponse extends VerifiedSchedule {
  readonly freshness: Freshness;
}

export interface StoredSnapshotRow {
  readonly snapshot_json: string | null;
  readonly snapshot_hash: string | null;
  readonly checked_at: string;
  readonly verified_at: string | null;
  readonly last_failure_at: string | null;
}

export interface HolidayManifest {
  readonly timeZone: "Asia/Shanghai";
  readonly startsOn: string;
  readonly endsOn: string;
  readonly sourceURL: string;
  readonly sourceSha256: string;
  readonly retrievedAt: string;
  readonly noticeURL: string;
  readonly dates: readonly string[];
}

export const officialModelIdentifiers: readonly string[] = ["deepseek-flash", "deepseek-v4-pro"];

export function hasOfficialModelSet(models: Readonly<Record<string, unknown>>): boolean {
  const identifiers = Object.keys(models);
  return (
    identifiers.length === officialModelIdentifiers.length &&
    officialModelIdentifiers.every((identifier) => Object.hasOwn(models, identifier))
  );
}

export const peakWindows: readonly PeakWindow[] = [
  { start: "01:00", end: "04:00" },
  { start: "06:00", end: "10:00" },
];

export const peakWeekdays: readonly string[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
];
