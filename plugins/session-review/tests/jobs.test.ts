import assert from "node:assert/strict";
import { test } from "node:test";
import { Jobs } from "../server/jobs.ts";

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
