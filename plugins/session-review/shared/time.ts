// One calendar for filtering and display, independent of each node/browser timezone.
export const REVIEW_TIMEZONE = "Asia/Singapore";
export const SINGAPORE_OFFSET = 8 * 3_600_000;

export function dateKey(at: Date): string {
  return new Date(at.getTime() + SINGAPORE_OFFSET).toISOString().slice(0, 10);
}

export function calendarBounds(range: { kind: string; from?: string; to?: string }, now = new Date()) {
  let fromKey = dateKey(now), toKey = fromKey;
  if (range.kind === "yesterday") fromKey = toKey = dateKey(new Date(now.getTime() - 86400_000));
  if (range.kind === "last7") fromKey = dateKey(new Date(now.getTime() - 6 * 86400_000));
  if (range.kind === "custom") { fromKey = range.from ?? fromKey; toKey = range.to ?? fromKey; }
  if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];
  for (const key of [fromKey, toKey]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(Date.parse(`${key}T00:00:00Z`)) || new Date(`${key}T00:00:00Z`).toISOString().slice(0, 10) !== key) throw new Error("请输入有效日期");
  }
  return { fromKey, toKey, from: `${fromKey}T00:00:00.000+08:00`, to: `${toKey}T23:59:59.999+08:00` };
}
