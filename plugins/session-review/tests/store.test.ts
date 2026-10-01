import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_PRESET_ID, Store, parsePreset, serializePreset } from "../server/store.ts";
import { Jobs } from "../server/jobs.ts";

test("presets: builtin is protected, custom presets round-trip, default switches", async () => {
  const store = new Store(await mkdtemp(join(tmpdir(), "sr-store-")));
  await store.init();
  let presets = await store.listPresets();
  assert.equal(presets.length, 1);
  assert.equal(presets[0].id, BUILTIN_PRESET_ID);
  assert.equal(presets[0].isDefault, true);
  await assert.rejects(store.savePreset({ id: BUILTIN_PRESET_ID, name: "x", body: "y" }));
  const custom = await store.savePreset({ name: "只看浪费", body: "重点看浪费\n第二行" });
  await store.setDefaultPreset(custom.id);
  presets = await store.listPresets();
  assert.equal(presets.find((p) => p.id === custom.id)?.isDefault, true);
  assert.equal(presets.find((p) => p.id === custom.id)?.body, "重点看浪费\n第二行");
  await store.deletePreset(custom.id);
  presets = await store.listPresets();
  assert.equal(presets.length, 1);
  assert.equal(presets[0].isDefault, true, "default falls back to builtin");
  await assert.rejects(store.deletePreset(BUILTIN_PRESET_ID));
});

test("preset serialisation", () => {
  const text = serializePreset({ id: "p", name: "名字", body: "正文\n---\n带分隔线", builtin: false, isDefault: false });
  const parsed = parsePreset("p", text);
  assert.equal(parsed.name, "名字");
  assert.equal(parsed.body, "正文\n---\n带分隔线");
});

test("jobs: same key reuses the running job; failures are recorded", async () => {
  const jobs = new Jobs<number>();
  let resolve!: (v: number) => void;
  const a = jobs.start("k", () => new Promise<number>((r) => { resolve = r; }));
  const b = jobs.start("k", async () => 2);
  assert.equal(a.id, b.id);
  resolve(1);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(jobs.get(a.id)?.status, "succeeded");
  const f = jobs.start("f", async () => { throw new Error("boom"); });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(jobs.get(f.id)?.status, "failed");
  assert.equal(jobs.get(f.id)?.error, "boom");
});
