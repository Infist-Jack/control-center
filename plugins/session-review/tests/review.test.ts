import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { runReview, sessionDetail, resolveRange } from "../server/review.ts";
import { redactText } from "../server/redact.ts";
import { Store } from "../server/store.ts";
import { makeHomes } from "./fixtures.ts";

const now = () => new Date(2026, 8, 30, 20, 0, 0);

async function deps() {
  const h = await makeHomes();
  const store = new Store(join(h.paseoHome, "session-review"));
  await store.init();
  return { h, deps: { homes: { paseoHome: h.paseoHome, claudeHome: h.claudeHome, codexHome: h.codexHome, dataDir: store.dataDir }, store, now } };
}

test("review: attribution, fork nesting, hidden threads, overview", async () => {
  const { deps: d } = await deps();
  const result = await runReview({ workspaceId: "wks_1", range: { kind: "today" } }, d, () => {});
  assert.equal(result.from, "2026-09-30");
  assert.equal(result.sessions.length, 3, "claude session + codex parent + codex fork; hidden child folded");
  const claude = result.sessions.find((s) => s.provider === "claude")!;
  assert.equal(claude.unmanaged, false);
  assert.equal(claude.agentId, "agent-1");
  const parent = result.sessions.find((s) => s.id === "x1")!;
  assert.equal(parent.unmanaged, true, "no Paseo agent record");
  assert.equal(parent.hiddenThreads, 1);
  const fork = result.sessions.find((s) => s.id === "x3")!;
  assert.equal(fork.depth, 1);
  assert.equal(result.sessions.indexOf(fork), result.sessions.indexOf(parent) + 1, "fork sits right under its parent");
  assert.ok(result.overview.peakParallel >= 1);
  assert.equal(result.overview.decisions, 5 + 2 + 2);
  assert.ok(result.sessions.every((s) => s.title.length <= 60));
});

test("review: scope by project and by branch; cache reuse", async () => {
  const { deps: d } = await deps();
  const byProject = await runReview({ projectId: "prj_1", range: { kind: "today" } }, d, () => {});
  assert.equal(byProject.sessions.length, 3);
  const byBranch = await runReview({ projectId: "prj_1", range: { kind: "today" }, branch: "feat/demo" }, d, () => {});
  assert.equal(byBranch.sessions.length, 1);
  const cached = await d.store.readExtractAny("claude", "c1");
  assert.ok(cached, "extract cached after first run");
  const detail = await sessionDetail("claude", "c1", d.store);
  assert.equal(detail.messages.filter((m) => m.role === "user").length, 2);
});

test("redaction happens before caching", async () => {
  const { deps: d } = await deps();
  await runReview({ workspaceId: "wks_1", range: { kind: "today" } }, d, () => {});
  const cached = await d.store.readExtractAny("claude", "c1");
  const text = JSON.stringify(cached);
  assert.ok(!text.includes("sk-abcdefghijklmnopqrstuvwxyz1234"), "api key masked");
  assert.ok(text.includes("[已打码]"));
});

test("redact patterns", () => {
  assert.equal(redactText("Bearer abcdefghijklmnopqrstuvwxyz"), "Bearer [已打码]");
  assert.equal(redactText("socks5://user:secretpass@1.2.3.4:1080"), "socks5://[已打码]@1.2.3.4:1080");
  assert.equal(redactText("DEEPSEEK_API_KEY=abcdefgh12345678"), "DEEPSEEK_API_KEY=[已打码]");
  assert.equal(redactText("https://goat.example/insights/WdJMi1XvV-79MhfTLFGpmKkfkiEUIxDOyNJcGwcZX7o"), "https://goat.example/insights/[已打码]");
  assert.equal(redactText("普通文字 和 短id abc123"), "普通文字 和 短id abc123");
});

test("resolveRange uses local calendar days", () => {
  const r = resolveRange({ kind: "yesterday" }, new Date(2026, 9, 1, 1, 0));
  assert.equal(r.fromKey, "2026-09-30");
  assert.equal(r.toKey, "2026-09-30");
  const c = resolveRange({ kind: "custom", from: "2026-09-30", to: "2026-09-28" }, new Date());
  assert.equal(c.fromKey, "2026-09-28");
  assert.equal(c.toKey, "2026-09-30");
});

test("wait segments longer than the cap are treated as parked, not waiting", async () => {
  const { spansFromTurns, WAIT_CAP_MS } = await import("../server/spans.ts");
  const spans = spansFromTurns([
    { startedAt: "2026-09-30T04:00:00.000Z", endedAt: "2026-09-30T04:10:00.000Z", waitsForUser: true, nextStartedAt: "2026-09-30T04:40:00.000Z" },
    { startedAt: "2026-09-30T04:40:00.000Z", endedAt: "2026-09-30T04:50:00.000Z", waitsForUser: true, nextStartedAt: new Date(Date.parse("2026-09-30T04:50:00.000Z") + WAIT_CAP_MS + 1000).toISOString() },
  ]);
  assert.equal(spans.filter((s) => s.kind === "wait").length, 1);
});
