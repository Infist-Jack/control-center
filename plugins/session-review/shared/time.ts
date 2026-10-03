// One calendar for filtering and display: the configured review timezone, independent of each node or browser.

export function localTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

export function isValidTimezone(tz: string): boolean {
  if (!tz || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(tz, f);
  }
  return f;
}

/** Wall-clock fields of an instant in `tz`. */
export function zonedParts(at: Date, tz: string) {
  const parts = formatter(tz).formatToParts(at);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** Offset of `tz` from UTC at this instant, in milliseconds. */
export function tzOffsetMs(at: Date, tz: string): number {
  const p = zonedParts(at, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000;
}

export function dateKey(at: Date, tz: string): string {
  const p = zonedParts(at, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The instant at which calendar day `key` starts in `tz`. */
export function dayStartMs(key: string, tz: string): number {
  const naive = Date.parse(`${key}T00:00:00Z`);
  let utc = naive - tzOffsetMs(new Date(naive), tz);
  utc = naive - tzOffsetMs(new Date(utc), tz); // A second pass settles DST transitions.
  return utc;
}

/** Start of the calendar day after the one containing `ms`. */
export function nextDayStartMs(ms: number, tz: string): number {
  // 36 hours past a day's start lands in the following day whatever the DST shift.
  return dayStartMs(dateKey(new Date(dayStartMs(dateKey(new Date(ms), tz), tz) + 36 * 3_600_000), tz), tz);
}

export interface CalendarBounds { fromKey: string; toKey: string; from: string; to: string; timezone: string }

export function calendarBounds(range: { kind: string; from?: string; to?: string }, tz: string, now = new Date()): CalendarBounds {
  const todayKey = dateKey(now, tz);
  const shift = (days: number) => dateKey(new Date(dayStartMs(todayKey, tz) + days * 86400_000 + 12 * 3_600_000), tz);
  let fromKey = todayKey, toKey = todayKey;
  if (range.kind === "yesterday") fromKey = toKey = shift(-1);
  if (range.kind === "last7") fromKey = shift(-6);
  if (range.kind === "custom") { fromKey = range.from ?? fromKey; toKey = range.to ?? fromKey; }
  if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];
  for (const key of [fromKey, toKey]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(Date.parse(`${key}T00:00:00Z`)) || new Date(`${key}T00:00:00Z`).toISOString().slice(0, 10) !== key) throw new Error("请输入有效日期");
  }
  const from = dayStartMs(fromKey, tz);
  const to = nextDayStartMs(dayStartMs(toKey, tz), tz) - 1;
  return { fromKey, toKey, from: new Date(from).toISOString(), to: new Date(to).toISOString(), timezone: tz };
}
