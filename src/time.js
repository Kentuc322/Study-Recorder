export function parseClockTime(value, fallback) {
  const source = value || fallback;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(source);
  if (!match) {
    throw new Error(`Invalid time "${source}". Expected HH:mm.`);
  }

  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function getDateKey(date = new Date(), timeZone = "Asia/Tokyo") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year").value;
  const month = parts.find((part) => part.type === "month").value;
  const day = parts.find((part) => part.type === "day").value;
  return `${year}-${month}-${day}`;
}

export function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day + days));
  return utcDate.toISOString().slice(0, 10);
}

export function getDateRange(endDateKey, days) {
  return Array.from({ length: days }, (_, index) => addDays(endDateKey, index - days + 1));
}

export function msUntilNextClockTime(clockTime, timeZone) {
  const now = new Date();
  const todayKey = getDateKey(now, timeZone);
  let candidate = zonedDateKeyAndTimeToInstant(todayKey, clockTime, timeZone);

  if (candidate <= now) {
    candidate = zonedDateKeyAndTimeToInstant(addDays(todayKey, 1), clockTime, timeZone);
  }

  return candidate.getTime() - now.getTime();
}

function zonedDateKeyAndTimeToInstant(dateKey, clockTime, timeZone) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, clockTime.hour, clockTime.minute, 0, 0));
  const offsetMs = getTimeZoneOffsetMs(utcGuess, timeZone);
  let instant = new Date(utcGuess.getTime() - offsetMs);

  const actualDateKey = getDateKey(instant, timeZone);
  if (actualDateKey !== dateKey) {
    const correctionDays = actualDateKey < dateKey ? 1 : -1;
    instant = new Date(instant.getTime() + correctionDays * 24 * 60 * 60 * 1000);
  }

  return instant;
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return asUtc - date.getTime();
}
