import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarBounds, dateKey, dayStartMs, isValidTimezone, localTimezone, nextDayStartMs, tzOffsetMs } from "../shared/time.ts";

test("time: calendar days follow the review timezone, not the host", () => {
  const at = new Date("2026-10-01T16:30:00Z");
  assert.equal(dateKey(at, "Asia/Singapore"), "2026-10-02");
  assert.equal(dateKey(at, "UTC"), "2026-10-01");
  assert.equal(dateKey(at, "America/Los_Angeles"), "2026-10-01");
  assert.equal(tzOffsetMs(at, "Asia/Singapore"), 8 * 3_600_000);
  assert.equal(tzOffsetMs(at, "America/Los_Angeles"), -7 * 3_600_000);
  assert.equal(new Date(dayStartMs("2026-10-02", "Asia/Singapore")).toISOString(), "2026-10-01T16:00:00.000Z");
  assert.equal(new Date(dayStartMs("2026-10-02", "America/Los_Angeles")).toISOString(), "2026-10-02T07:00:00.000Z");
});

test("time: ranges span whole local days and survive DST transitions", () => {
  const sg = calendarBounds({ kind: "yesterday" }, "Asia/Singapore", new Date("2026-10-01T16:30:00Z"));
  assert.deepEqual([sg.fromKey, sg.toKey], ["2026-10-01", "2026-10-01"]);
  assert.equal(sg.from, "2026-09-30T16:00:00.000Z"); assert.equal(sg.to, "2026-10-01T15:59:59.999Z");
  const week = calendarBounds({ kind: "last7" }, "UTC", new Date("2026-10-03T12:00:00Z"));
  assert.deepEqual([week.fromKey, week.toKey], ["2026-09-27", "2026-10-03"]);
  // US DST starts 2026-03-08: that local day is 23 hours long and the next day still starts at local midnight.
  const dst = calendarBounds({ kind: "custom", from: "2026-03-08", to: "2026-03-08" }, "America/New_York");
  assert.equal(dst.from, "2026-03-08T05:00:00.000Z"); assert.equal(dst.to, "2026-03-09T03:59:59.999Z");
  assert.equal(new Date(nextDayStartMs(dayStartMs("2026-03-08", "America/New_York"), "America/New_York")).toISOString(), "2026-03-09T04:00:00.000Z");
  const fall = calendarBounds({ kind: "custom", from: "2026-11-01", to: "2026-11-01" }, "America/New_York");
  assert.equal(fall.from, "2026-11-01T04:00:00.000Z"); assert.equal(fall.to, "2026-11-02T04:59:59.999Z");
  const swapped = calendarBounds({ kind: "custom", from: "2026-09-30", to: "2026-09-28" }, "UTC");
  assert.deepEqual([swapped.fromKey, swapped.toKey], ["2026-09-28", "2026-09-30"]);
  assert.throws(() => calendarBounds({ kind: "custom", from: "2026-02-30" }, "UTC"), /有效日期/);
});

test("time: timezone validation and the host default", () => {
  assert.ok(isValidTimezone("Asia/Singapore")); assert.ok(isValidTimezone("UTC"));
  assert.equal(isValidTimezone("Mars/Olympus"), false); assert.equal(isValidTimezone(""), false); assert.equal(isValidTimezone("Asia/Singapore; rm -rf"), false);
  assert.ok(isValidTimezone(localTimezone()));
});
