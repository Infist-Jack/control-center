import type { Span } from "../shared/model.ts";

export interface Turn {
  startedAt: string;
  endedAt: string;
  /** True when the next turn was opened by a real user message, so the gap counts as waiting. */
  waitsForUser: boolean;
  nextStartedAt: string | null;
}

/** A gap longer than this is the session being parked, not the agent waiting on the user. */
export const WAIT_CAP_MS = 90 * 60_000;

export function spansFromTurns(turns: Turn[]): Span[] {
  const spans: Span[] = [];
  for (const turn of turns) {
    if (turn.endedAt > turn.startedAt) spans.push({ kind: "run", start: turn.startedAt, end: turn.endedAt });
    if (turn.waitsForUser && turn.nextStartedAt && turn.nextStartedAt > turn.endedAt) {
      const gap = Date.parse(turn.nextStartedAt) - Date.parse(turn.endedAt);
      if (gap <= WAIT_CAP_MS) spans.push({ kind: "wait", start: turn.endedAt, end: turn.nextStartedAt });
    }
  }
  return spans;
}

export function sumMs(spans: Span[], kind: Span["kind"]): number {
  return spans.filter((s) => s.kind === kind).reduce((acc, s) => acc + (Date.parse(s.end) - Date.parse(s.start)), 0);
}

/** Union length of all run spans across sessions, in ms. */
export function unionRunMs(spansBySession: Span[][]): number {
  const runs = spansBySession.flat().filter((s) => s.kind === "run")
    .map((s) => [Date.parse(s.start), Date.parse(s.end)] as const)
    .sort((a, b) => a[0] - b[0]);
  let total = 0, curStart = -1, curEnd = -1;
  for (const [start, end] of runs) {
    if (curEnd < 0 || start > curEnd) {
      if (curEnd >= 0) total += curEnd - curStart;
      curStart = start; curEnd = end;
    } else if (end > curEnd) curEnd = end;
  }
  if (curEnd >= 0) total += curEnd - curStart;
  return total;
}

/** Maximum number of sessions running at the same instant. */
export function peakParallel(spansBySession: Span[][]): number {
  const events: Array<[number, number]> = [];
  for (const spans of spansBySession) {
    for (const s of spans) {
      if (s.kind !== "run") continue;
      events.push([Date.parse(s.start), 1]);
      events.push([Date.parse(s.end), -1]);
    }
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0, peak = 0;
  for (const [, delta] of events) { current += delta; if (current > peak) peak = current; }
  return peak;
}
