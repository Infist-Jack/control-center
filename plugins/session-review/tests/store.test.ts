import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXTRACT_VERSION, Store } from "../server/store.ts";
import type { ExtractedSession } from "../server/sources/types.ts";

const session = (id: string): ExtractedSession => ({ id, provider: "claude", file: `/x/${id}.jsonl`, cwd: "/x", branch: null, startedAt: "2026-09-30T00:00:00.000Z", endedAt: "2026-09-30T01:00:00.000Z",
  title: "t", messages: [], turns: [], decisions: [], userMessages: 0, forkedFrom: null, hiddenThreads: [], error: null });

test("store: versioned extracts coexist with legacy readers and every other cache version", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-store-"));
  try {
    const extracts = join(root, "extracts"); await mkdir(extracts, { recursive: true });
    await writeFile(join(extracts, "claude-legacy-current.json"), JSON.stringify({ version: EXTRACT_VERSION, mtimeMs: 1, size: 1, session: session("legacy-current") }));
    await writeFile(join(extracts, "claude-legacy-old.json"), JSON.stringify({ version: EXTRACT_VERSION - 1, mtimeMs: 1, size: 1, session: session("legacy-old") }));
    await writeFile(join(extracts, "claude-broken.json"), "not json");
    await writeFile(join(extracts, `claude-older.v${EXTRACT_VERSION - 1}.json`), JSON.stringify({ version: EXTRACT_VERSION - 1, mtimeMs: 1, size: 1, session: session("older") }));
    await writeFile(join(extracts, `claude-newer.v${EXTRACT_VERSION + 1}.json`), JSON.stringify({ version: EXTRACT_VERSION + 1, mtimeMs: 1, size: 1, session: session("newer") }));
    const store = new Store(root); await store.init();
    assert.deepEqual((await readdir(extracts)).sort(), ["claude-broken.json", "claude-legacy-current.json", `claude-legacy-current.v${EXTRACT_VERSION}.json`, "claude-legacy-old.json", `claude-newer.v${EXTRACT_VERSION + 1}.json`, `claude-older.v${EXTRACT_VERSION - 1}.json`]);
    assert.equal((await store.readExtract("claude", "legacy-current", 1, 1))?.id, "legacy-current");
    assert.equal(await store.readExtractAny("claude", "newer"), null, "a newer plugin's cache is neither read nor touched");
    await store.writeExtract(session("fresh"), 2, 3);
    assert.ok((await readdir(extracts)).includes(`claude-fresh.v${EXTRACT_VERSION}.json`));
    assert.equal((await store.readExtract("claude", "fresh", 2, 3))?.id, "fresh");
    assert.equal(await store.readExtract("claude", "fresh", 2, 4), null, "changed source invalidates");
    assert.equal((await new Store(root).readExtractAny("claude", "fresh"))?.id, "fresh");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("store: legacy migration neither removes an older reader's cache nor overwrites fresh versioned data", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-store-"));
  try {
    const store = new Store(root); await store.init();
    const legacy = join(store.extractsDir, "claude-shared.json");
    const original = JSON.stringify({ version: EXTRACT_VERSION, mtimeMs: 1, size: 1, session: session("shared") });
    await writeFile(legacy, original);
    await Promise.all([store.init(), new Store(root).init()]);
    assert.equal(await readFile(legacy, "utf8"), original, "the still-running legacy collector can read details");
    await store.writeExtract({ ...session("shared"), title: "fresh" }, 2, 2);
    await store.init();
    assert.equal((await store.readExtract("claude", "shared", 2, 2))?.title, "fresh");
    assert.equal(JSON.parse(await readFile(legacy, "utf8")).session.title, "t", "atomic writes keep the legacy file independent");
  } finally { await rm(root, { recursive: true, force: true }); }
});
