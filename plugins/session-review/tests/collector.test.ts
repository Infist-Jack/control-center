import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { rm, readdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { makeHomes } from "./fixtures.ts";
import { Store } from "../server/store.ts";
import { parseFrame } from "../server/gateway.ts";
import { runReview } from "../server/review.ts";

test("collector: large redacted detail crosses framed chunks and cleans up transport data", async () => {
  const h = await makeHomes();
  const store = new Store(join(h.paseoHome, "session-review")); await store.init();
  try {
    await runReview({ range: { kind: "custom", from: "2026-09-30", to: "2026-09-30" } }, { homes: { ...h, dataDir: store.dataDir }, store }, () => {});
    const session = (await store.readExtractAny("claude", "c1"))!;
    session.messages = Array.from({ length: 105 }, (_, i) => ({ at: `2026-09-30T02:00:00.000Z`, role: "assistant", text: `${i}:${randomBytes(1000).toString("base64")}` }));
    await store.writeExtract(session, 1, 1);
    const invoke = async (input: Record<string, unknown>) => {
      const { stdout, stderr } = await promisify(execFile)(process.execPath, [new URL("../scripts/collector.ts", import.meta.url).pathname, Buffer.from(JSON.stringify(input)).toString("base64")], {
        env: { ...process.env, NODE_TEST_CONTEXT: undefined, PASEO_HOME: h.paseoHome, CLAUDE_CONFIG_DIR: h.claudeHome, CODEX_HOME: h.codexHome }, maxBuffer: 1024 * 1024,
      });
      assert.ok(stdout.includes("SR_BEGIN"), `Collector output: ${JSON.stringify({ stdout: stdout.slice(0, 300), stderr: stderr.slice(0, 500), exe: process.execPath })}`);
      return parseFrame(stdout);
    };
    const result = await invoke({ action: "detail", provider: "claude", id: "c1", offset: 0 });
    assert.ok(result.transfer);
    let encoded = result.first;
    while (encoded.length < result.length) encoded += (await invoke({ action: "chunk", token: result.transfer, offset: encoded.length })).chunk;
    const page = JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString()).value;
    assert.equal(page.messages.length, 100); assert.equal(page.totalMessages, 105); assert.equal(page.nextOffset, 100);
    await invoke({ action: "release", token: result.transfer });
    assert.equal((await readdir(join(store.dataDir, "transfers"))).length, 0);
    const next = await invoke({ action: "detail", provider: "claude", id: "c1", offset: 100 });
    assert.equal(next.value.messages.length, 5); assert.equal(next.value.nextOffset, null);
    assert.throws(() => parseFrame("SR_BEGIN\nincomplete"));
  } finally { await rm(h.root, { recursive: true, force: true }); }
});
