import {
  peakWeekdays,
  hasOfficialModelSet,
  holidayNoticeURL,
  peakWindows,
  rateUnit,
  type HolidayManifest,
  type ModelRates,
  type Schedule,
  type SourceProvenance,
  type VerifiedSchedule,
} from "./domain.ts";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function validCalendarDate(value: string): boolean {
  if (!datePattern.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

function validateHolidayManifest(manifest: HolidayManifest): void {
  if (manifest.timeZone !== "Asia/Shanghai") {
    throw new Error("The holiday manifest has an unsupported time zone.");
  }

  if (!validCalendarDate(manifest.startsOn) || !validCalendarDate(manifest.endsOn)) {
    throw new Error("The holiday manifest has invalid coverage dates.");
  }

  if (manifest.startsOn > manifest.endsOn) {
    throw new Error("The holiday manifest coverage is inverted.");
  }
  if (manifest.noticeURL !== holidayNoticeURL) {
    throw new Error("The holiday manifest does not match its reviewed notice.");
  }

  let previous: string | undefined;
  for (const date of manifest.dates) {
    if (!validCalendarDate(date) || date < manifest.startsOn || date > manifest.endsOn || date === previous) {
      throw new Error("The holiday manifest contains an invalid date sequence.");
    }
    previous = date;
  }
}

export function createSchedule(manifest: HolidayManifest): Schedule {
  validateHolidayManifest(manifest);

  return {
    timeZone: "UTC",
    peakWeekdays,
    peakWindows,
    holidayTimeZone: manifest.timeZone,
    holidayCoverage: {
      startsOn: manifest.startsOn,
      endsOn: manifest.endsOn,
    },
    holidays: manifest.dates,
  };
}

export function createVerifiedSchedule({
  models,
  pricing,
  holidays,
}: {
  readonly models: Readonly<Record<string, ModelRates>>;
  readonly pricing: SourceProvenance;
  readonly holidays: HolidayManifest;
}): VerifiedSchedule {
  if (!hasOfficialModelSet(models)) {
    throw new Error("A verified schedule needs the known model table.");
  }

  return {
    rateUnit,
    schedule: createSchedule(holidays),
    models,
    provenance: {
      pricing,
      holidays: {
        url: holidays.sourceURL,
        contentSha256: holidays.sourceSha256,
        retrievedAt: holidays.retrievedAt,
        noticeURL: holidays.noticeURL,
      },
    },
  };
}
