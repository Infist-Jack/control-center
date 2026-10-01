// Local-only check against the real session files on this machine. Prints counts; never writes outside a temp dir.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveHomes } from "../server/paths.ts";
import { runReview } from "../server/review.ts";
import { Store } from "../server/store.ts";

const day = process.argv[2] ?? "2026-09-30";
const homes = resolveHomes();
const store = new Store(await mkdtemp(join(tmpdir(), "sr-baseline-")));
await store.init();
const started = Date.now();
const result = await runReview({ range: { kind: "custom", from: day, to: day } }, { homes, store }, (p) => process.stderr.write(`\r${p.phase} ${p.done}/${p.total}      `));
process.stderr.write("\n");
const counts: Record<string, number> = {};
for (const s of result.sessions) for (const d of s.decisions) counts[`${s.provider}:${d.kind}`] = (counts[`${s.provider}:${d.kind}`] ?? 0) + 1;
console.log(JSON.stringify({
  day, elapsedMs: Date.now() - started, timezone: result.timezone, overview: result.overview, decisionCounts: counts,
  sessions: result.sessions.map((s) => ({ id: s.id.slice(0, 8), provider: s.provider, title: s.title, start: s.startedAt, end: s.endedAt, activeMin: Math.round(s.activeMs / 60000), waitMin: Math.round(s.waitMs / 60000), msgs: s.userMessages, unmanaged: s.unmanaged, depth: s.depth, hidden: s.hiddenThreads, decisions: s.decisions.length, error: s.error })),
}, null, 1));
