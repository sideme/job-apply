const DEFAULT_TIME_ZONE = "America/Toronto";
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const values = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function offsetAt(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function localMidnightToUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const localAsUtc = Date.UTC(year, month - 1, day);
  let instantMs = localAsUtc - offsetAt(new Date(localAsUtc), timeZone);
  // Re-evaluate at the candidate instant so daylight-saving transitions are
  // handled using the offset that applies to the selected local date.
  instantMs = localAsUtc - offsetAt(new Date(instantMs), timeZone);
  return new Date(instantMs);
}

export function isValidLocalDate(value: string): boolean {
  if (!LOCAL_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function resolveJobDateTimeZone(): string {
  const configured =
    process.env.PIPELINE_SCHEDULE_TIMEZONE?.trim() || DEFAULT_TIME_ZONE;
  try {
    formatterFor(configured).format();
    return configured;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function getUtcRangeForLocalDate(
  localDate: string,
  timeZone = resolveJobDateTimeZone(),
): { start: string; end: string } {
  if (!isValidLocalDate(localDate)) {
    throw new Error("Invalid local date");
  }
  const [year, month, day] = localDate.split("-").map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: localMidnightToUtc(year, month, day, timeZone).toISOString(),
    end: localMidnightToUtc(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
      timeZone,
    ).toISOString(),
  };
}

/**
 * Return fixed-width epoch-millisecond boundaries for a displayed posting
 * date. Posting dates are normalized and rendered in UTC, so filtering must
 * use the same UTC calendar-day boundaries to match what the user sees.
 */
export function getUtcEpochRangeForDate(calendarDate: string): {
  start: string;
  end: string;
} {
  if (!isValidLocalDate(calendarDate)) {
    throw new Error("Invalid calendar date");
  }
  const [year, month, day] = calendarDate.split("-").map(Number);
  return {
    start: String(Date.UTC(year, month - 1, day)),
    end: String(Date.UTC(year, month - 1, day + 1)),
  };
}
