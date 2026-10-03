import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXTRACT_VERSION, Store } from "../server/store.ts";
import type { ExtractedSession } from "../server/sources/types.ts";

const session = (id: string): ExtractedSession => ({ id, provider: "claude", file: `/x/${id}.jsonl`, cwd: "/x", branch: null, startedAt: "2026-09-30T00:00:00.000Z", endedAt: "2026-09-30T01:00:00.000Z",
  title: "t", messages: [], turns: [], decisions: [], userMessages: 0, forkedFrom: null, hiddenThreads: [], error: null });

test("store: extract files carry their version, legacy files migrate, older versions are dropped and newer ones are kept", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-store-"));
  try {
    const extracts = join(root, "extracts"); await mkdir(extracts, { recursive: true });
    await writeFile(join(extracts, "claude-legacy-current.json"), JSON.stringify({ version: EXTRACT_VERSION, mtimeMs: 1, size: 1, session: session("legacy-current") }));
    await writeFile(join(extracts, "claude-legacy-old.json"), JSON.stringify({ version: EXTRACT_VERSION - 1, mtimeMs: 1, size: 1, session: session("legacy-old") }));
    await writeFile(join(extracts, "claude-broken.json"), "not json");
    await writeFile(join(extracts, `claude-older.v${EXTRACT_VERSION - 1}.json`), JSON.stringify({ version: EXTRACT_VERSION - 1, mtimeMs: 1, size: 1, session: session("older") }));
    await writeFile(join(extracts, `claude-newer.v${EXTRACT_VERSION + 1}.json`), JSON.stringify({ version: EXTRACT_VERSION + 1, mtimeMs: 1, size: 1, session: session("newer") }));
    const store = new Store(root); await store.init();
    assert.deepEqual((await readdir(extracts)).sort(), [`claude-legacy-current.v${EXTRACT_VERSION}.json`, `claude-newer.v${EXTRACT_VERSION + 1}.json`]);
    assert.equal((await store.readExtract("claude", "legacy-current", 1, 1))?.id, "legacy-current");
    assert.equal(await store.readExtractAny("claude", "newer"), null, "a newer plugin's cache is neither read nor touched");
    await store.writeExtract(session("fresh"), 2, 3);
    assert.ok((await readdir(extracts)).includes(`claude-fresh.v${EXTRACT_VERSION}.json`));
    assert.equal((await store.readExtract("claude", "fresh", 2, 3))?.id, "fresh");
    assert.equal(await store.readExtract("claude", "fresh", 2, 4), null, "changed source invalidates");
    assert.equal((await new Store(root).readExtractAny("claude", "fresh"))?.id, "fresh");
  } finally { await rm(root, { recursive: true, force: true }); }
});
