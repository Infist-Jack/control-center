import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClaude, scanClaude } from "../server/sources/claude.ts";
import { parseCodex, scanCodex } from "../server/sources/codex.ts";
import { spansFromTurns } from "../server/spans.ts";
import { makeHomes } from "./fixtures.ts";

const from = new Date(Date.UTC(2026, 8, 29, 16)), to = new Date(Date.UTC(2026, 8, 30, 16));

test("claude: user messages, questions, denial, memory, interrupt, turns", async () => {
  const h = await makeHomes();
  const [candidate] = await scanClaude(h.claudeHome, from, to);
  assert.ok(candidate, "scan finds the session");
  assert.equal(candidate.id, "c1");
  const session = await parseClaude(candidate);
  assert.equal(session.userMessages, 2, "injected and system text is not counted as the user's");
  assert.equal(session.title, "帮我做一个 demo 页面");
  assert.equal(session.branch, "feat/demo");
  const kinds = session.decisions.map((d) => d.kind);
  assert.deepEqual(kinds, ["question", "denied", "memory", "memory-index", "interrupt"]);
  const question = session.decisions[0];
  assert.equal(question.excerpt, "页面放在哪个目录？");
  assert.equal(question.answer, "web/ (Recommended)");
  assert.equal(question.next, "就用 web/。");
  assert.match(session.decisions[1].excerpt, /^Bash rsync/);
  assert.equal(session.decisions[1].detail, "[Production Deploy]");
  assert.equal(session.decisions[2].excerpt, "部署前先问 Jack");
  assert.equal(session.decisions[2].detail, "deploy-rule.md");
  assert.equal(session.decisions[4].excerpt, "token=sk-abcdefghijklmnopqrstuvwxyz1234 不该出现。");
  const spans = spansFromTurns(session.turns);
  const waits = spans.filter((s) => s.kind === "wait");
  assert.equal(waits.length, 1, "one wait: from the question until the user's next real message");
  assert.equal(spans.filter((s) => s.kind === "run").length, 3, "three runs: first ask, after answer, after notification");
  assert.ok(session.messages.some((m) => m.role === "system"), "task notification kept as a system message");
});

test("codex: question + reply, interrupt, hidden child, fork", async () => {
  const h = await makeHomes();
  const candidates = await scanCodex(h.codexHome, from, to);
  assert.equal(candidates.length, 3);
  const parent = candidates.find((c) => c.id === "x1")!;
  const child = candidates.find((c) => c.id === "x2")!;
  const fork = candidates.find((c) => c.id === "x3")!;
  assert.equal(child.hiddenChildOf, "x1");
  assert.equal(fork.forkedFrom, "x1");
  const session = await parseCodex(parent);
  assert.equal(session.userMessages, 2, "question reply counts as a user message");
  assert.equal(session.title, "梳理项目上下文");
  assert.deepEqual(session.decisions.map((d) => d.kind), ["question", "interrupt"]);
  assert.equal(session.decisions[0].excerpt, "文档权限开了吗？");
  assert.equal(session.decisions[0].answer, "开了");
  assert.equal(session.decisions[1].excerpt, "结论如下。");
  assert.equal(session.turns.length, 2);
  assert.equal(spansFromTurns(session.turns).filter((s) => s.kind === "wait").length, 1);
});
