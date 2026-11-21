const DATE_KEY_PATTERN = /^(\\d{4})-(\\d{2})-(\\d{2})$/;
const LOCAL_DATE_TIME_PATTERN = /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,3}))?)?$/;
const formatterCache = new Map();
const OFFSET_SAMPLE_HOURS = 48;
const OFFSET_SAMPLE_STEP_HOURS = 6;
const MAX_GAP_ADJUSTMENT_MINUTES = 24 * 60;

function utcEpochFromParts(parts) {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, parts.millisecond ?? 0);
  return date.getTime();
}

function dateTimeFromEpoch(epochMilliseconds) {
  const date = new Date(epochMilliseconds);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  };
}

function sameLocalDateTime(left, right) {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second
    && left.millisecond === right.millisecond;
}

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

function localDateTimeKey(parts) {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}.${pad(parts.millisecond, 3)}`;
}

function getFormatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }));
  }
  return formatterCache.get(timeZone);
}

function localPartsAt(epochMilliseconds, timeZone) {
  const values = Object.fromEntries(
    getFormatter(timeZone).formatToParts(new Date(epochMilliseconds))
      .filter((part) => ['year', 'month', 'day', 'hour', 'minute', 'second'].includes(part.type))
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    ...values,
    millisecond: new Date(epochMilliseconds).getUTCMilliseconds(),
  };
}

function offsetAt(epochMilliseconds, timeZone) {
  const wholeSecond = Math.floor(epochMilliseconds / 1000) * 1000;
  return utcEpochFromParts(localPartsAt(wholeSecond, timeZone)) - wholeSecond;
}

function validateTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) {
    throw new TypeError('A valid IANA time zone is required.');
  }
  try {
    getFormatter(timeZone);
  } catch {
    formatterCache.delete(timeZone);
    throw new RangeError(`Unsupported IANA time zone: ${timeZone}`);
  }
}

function collectNearbyOffsets(targetEpoch, timeZone) {
  const offsets = new Set();
  for (let hours = -OFFSET_SAMPLE_HOURS; hours <= OFFSET_SAMPLE_HOURS; hours += OFFSET_SAMPLE_STEP_HOURS) {
    offsets.add(offsetAt(targetEpoch + hours * 60 * 60 * 1000, timeZone));
  }
  return [...offsets];
}

function matchingInstants(parts, targetEpoch, offsets, timeZone) {
  const matches = new Set();
  for (const offset of offsets) {
    const candidate = targetEpoch - offset;
    if (sameLocalDateTime(localPartsAt(candidate, timeZone), parts)) matches.add(candidate);
  }
  return [...matches].sort((left, right) => left - right);
}

function dateKeyParts(value) {
  if (typeof value !== 'string') throw new TypeError('Date must be a YYYY-MM-DD string.');
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) throw new RangeError(`Invalid calendar date: ${value}`);
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (parts.year < 1 || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  const normalized = dateTimeFromEpoch(utcEpochFromParts({ ...parts, hour: 0 }));
  if (normalized.year !== parts.year || normalized.month !== parts.month || normalized.day !== parts.day) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return parts;
}

function localDateTimeParts(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Local date-time must be an ISO-like YYYY-MM-DDTHH:mm[:ss[.SSS]] string.');
  }
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) throw new RangeError(`Invalid local date-time: ${value}`);
  const date = dateKeyParts(`${match[1]}-${match[2]}-${match[3]}`);
  const parts = {
    ...date,
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
    millisecond: Number((match[7] ?? '').padEnd(3, '0') || 0),
  };
  if (parts.hour > 23 || parts.minute > 59 || parts.second > 59) {
    throw new RangeError(`Invalid local date-time: ${value}`);
  }
  return parts;
}

/**
 * Parses and validates a date-only key without converting it to an instant.
 */
export function parseCalendarDate(value) {
  const parts = dateKeyParts(value);
  return Object.freeze({ ...parts, key: value });
}

/**
 * Returns true when the runtime can interpret the supplied IANA timezone.
 * This validates runtime support; it does not certify that its timezone database is current.
 */
export function isSupportedTimeZone(timeZone) {
  try {
    validateTimeZone(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a local wall-clock date-time using the IANA rules available to Intl.
 * DST gaps default to the first valid local minute after the gap. Repeated times
 * default to the first occurrence; callers may explicitly request the later one.
 *
 * The host Intl timezone database is used. It has no portable version identifier,
 * so this result is suitable for client preview, not a versioned authoritative
 * timezone service for persistence.
 */
export function resolveLocalDateTime({
  localDateTime,
  timeZone,
  disambiguation = 'earlier',
  gapStrategy = 'next-valid',
}) {
  if (!['earlier', 'later', 'reject'].includes(disambiguation)) {
    throw new RangeError('disambiguation must be earlier, later or reject.');
  }
  if (!['next-valid', 'reject'].includes(gapStrategy)) {
    throw new RangeError('gapStrategy must be next-valid or reject.');
  }

  validateTimeZone(timeZone);
  const requested = localDateTimeParts(localDateTime);
  const targetEpoch = utcEpochFromParts(requested);
  const offsets = collectNearbyOffsets(targetEpoch, timeZone);
  const exactMatches = matchingInstants(requested, targetEpoch, offsets, timeZone);

  if (exactMatches.length > 1 && disambiguation === 'reject') {
    throw new RangeError(`Ambiguous local date-time in ${timeZone}: ${localDateTime}`);
  }
  if (exactMatches.length) {
    const selectedIndex = exactMatches.length > 1 && disambiguation === 'later'
      ? exactMatches.length - 1
      : 0;
    const epoch = exactMatches[selectedIndex];
    const resolved = localDateTimeKey(localPartsAt(epoch, timeZone));
    return Object.freeze({
      requestedLocalDateTime: localDateTime,
      resolvedLocalDateTime: resolved,
      timeZone,
      instant: new Date(epoch).toISOString(),
      resolution: exactMatches.length > 1
        ? selectedIndex === 0 ? 'ambiguous-first' : 'ambiguous-later'
        : 'exact',
      adjustmentMinutes: 0,
      rulesSource: 'runtime-intl',
      rulesVersion: null,
      authoritative: false,
    });
  }

  if (gapStrategy === 'reject') {
    throw new RangeError(`Nonexistent local date-time in ${timeZone}: ${localDateTime}`);
  }

  for (let adjustmentMinutes = 1; adjustmentMinutes <= MAX_GAP_ADJUSTMENT_MINUTES; adjustmentMinutes += 1) {
    const nextParts = dateTimeFromEpoch(targetEpoch + adjustmentMinutes * 60 * 1000);
    const nextMatches = matchingInstants(nextParts, utcEpochFromParts(nextParts), offsets, timeZone);
    if (!nextMatches.length) continue;
    const selectedIndex = disambiguation === 'later' ? nextMatches.length - 1 : 0;
    const epoch = nextMatches[selectedIndex];
    return Object.freeze({
      requestedLocalDateTime: localDateTime,
      resolvedLocalDateTime: localDateTimeKey(localPartsAt(epoch, timeZone)),
      timeZone,
      instant: new Date(epoch).toISOString(),
      resolution: 'gap-adjusted-next-valid',
      adjustmentMinutes,
      rulesSource: 'runtime-intl',
      rulesVersion: null,
      authoritative: false,
    });
  }

  throw new RangeError(`Could not safely resolve local date-time in ${timeZone}: ${localDateTime}`);
}

/**
 * Formats an instant in a selected IANA timezone.
 */
export function formatInstantInTimeZone(instant, timeZone) {
  validateTimeZone(timeZone);
  const epoch = typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(epoch)) throw new RangeError('A valid instant is required.');
  return localDateTimeKey(localPartsAt(epoch, timeZone));
}

/**
 * Creates an all-day range using a start date and an exclusive end date.
 * No UTC midnight is created, so changing viewer timezone cannot shift its date.
 */
export function createAllDayRange(startDate, endDateExclusive) {
  const start = dateKeyParts(startDate);
  const end = dateKeyParts(endDateExclusive);
  const startEpoch = utcEpochFromParts({ ...start, hour: 0 });
  const endEpoch = utcEpochFromParts({ ...end, hour: 0 });
  if (endEpoch <= startEpoch) {
    throw new RangeError('All-day end date must be after the start date (exclusive).');
  }
  return Object.freeze({
    startDate,
    endDateExclusive,
    dayCount: (endEpoch - startEpoch) / (24 * 60 * 60 * 1000),
  });
}

/**
 * Validates a timed range represented by ISO instants (or Date objects).
 * A range may cross midnight, but end must be strictly after start.
 */
export function validateTimedRange(start, end) {
  const startsAt = start instanceof Date ? start.getTime() : Date.parse(start);
  const endsAt = end instanceof Date ? end.getTime() : Date.parse(end);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    throw new RangeError('Timed interval end must be after its start.');
  }
  return Object.freeze({ startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() });
}

/**
 * Tests overlap using half-open [start, end) intervals.
 * Adjacent ranges never conflict.
 */
export function intervalsOverlap(first, second) {
  const a = validateTimedRange(first.startsAt, first.endsAt);
  const b = validateTimedRange(second.startsAt, second.endsAt);
  return Date.parse(a.startsAt) < Date.parse(b.endsAt)
    && Date.parse(b.startsAt) < Date.parse(a.endsAt);
}
