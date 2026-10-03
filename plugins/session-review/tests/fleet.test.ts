import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { makeHomes } from "./fixtures.ts";
import { Store } from "../server/store.ts";
import { Fleet, chooseWorkspace, projectKey } from "../server/fleet.ts";
import type { Gateway } from "../server/gateway.ts";
import { runReview, sessionDetail } from "../server/review.ts";
import { calendarBounds } from "../shared/time.ts";

test("fleet: identical IDs stay separate, offline node yields partial results and detail routes to its source", async () => {
  const h = await makeHomes();
  const store = new Store(join(h.paseoHome, "session-review")); await store.init();
  const deps = { homes: { ...h, dataDir: store.dataDir }, store, now: () => new Date("2026-09-30T12:00:00Z") };
  const calls: Array<{ node: string; input: Record<string, any> }> = [];
  const gateway: Gateway = {
    nodes: async () => [{ id: "local", name: "中控" }, { id: "remote", name: "远端" }, { id: "offline", name: "不可达" }],
    workspaces: async n => { if (n.id === "offline") throw new Error("Cannot connect to daemon"); return [{ workspaceId: "w1", name: "环境运维" }]; },
    collect: async (n, _w, input: Record<string, any>) => {
      calls.push({ node: n.id, input });
      if (input.action === "detail") return sessionDetail(input.provider, input.id, store, input.offset);
      const r = await runReview(input.scope, { ...deps, bounds: input.bounds }, () => {});
      r.projects = [{ id: "prj_1", name: "同名项目", rootPath: "/workspace" }];
      return r;
    },
  };
  try {
    const fleet = new Fleet(gateway, deps, "local");
    const progress: string[] = [];
    const result = await fleet.review({ range: { kind: "today" } }, p => progress.push(p.nodes?.find(n => n.id === "remote")?.status ?? ""));
    assert.equal(result.sessions.length, 6);
    assert.equal(new Set(result.sessions.map(s => s.id)).size, 6);
    assert.equal(new Set(result.projects?.map(p => p.id)).size, 2);
    assert.equal(result.complete, false);
    assert.equal(result.nodes?.find(n => n.id === "offline")?.status, "offline");
    assert.ok(progress.includes("running")); assert.ok(progress.includes("succeeded"));
    assert.equal(calls[0].input.bounds.from, "2026-09-30T00:00:00.000+08:00");
    const session = result.sessions.find(s => s.nodeId === "remote" && s.provider === "claude")!;
    await fleet.detail(session.nodeId, session.provider, session.sourceId!, 0);
    assert.equal(calls.at(-1)?.node, "remote"); assert.equal(calls.at(-1)?.input.id, "c1");
    const filtered = await fleet.review({ range: { kind: "today" }, projectId: projectKey("remote", "prj_1") }, () => {});
    assert.equal(filtered.nodes?.length, 1); assert.equal(filtered.sessions.length, 3);
    assert.equal(filtered.complete, true);
  } finally { await rm(h.root, { recursive: true, force: true }); }
});

test("workspace selection never guesses between unrelated workspaces", () => {
  const rows = [{ workspaceId: "a", name: "项目 A" }, { workspaceId: "b", name: "项目 B" }];
  assert.equal(chooseWorkspace(rows), undefined);
  assert.equal(chooseWorkspace(rows, "b"), "b");
  assert.throws(() => chooseWorkspace(rows, "missing"));
  assert.equal(chooseWorkspace([...rows, { workspaceId: "ops", name: "环境运维" }]), "ops");
});

test("Singapore dates ignore host timezone", () => {
  const bounds = calendarBounds({ kind: "today" }, new Date("2026-10-01T16:30:00Z"));
  assert.equal(bounds.fromKey, "2026-10-02");
  assert.equal(new Date(bounds.from).toISOString(), "2026-10-01T16:00:00.000Z");
  assert.throws(() => calendarBounds({ kind: "custom", from: "2026-02-30" }));
});
