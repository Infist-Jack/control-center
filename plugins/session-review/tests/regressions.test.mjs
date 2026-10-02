import { test } from "node:test";
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Regression scenarios verified against the original PR during review.
const root = new URL('..', import.meta.url).pathname;
const mod = (p) => import(pathToFileURL(join(root, p)).href);
const { makeHomes, codexLines } = await mod('tests/fixtures.ts');
const { runReview, extractOne } = await mod('server/review.ts');
const { parseCodex } = await mod('server/sources/codex.ts');
const { Store } = await mod('server/store.ts');
const { spansFromTurns, sumMs } = await mod('server/spans.ts');
const scope = { range: { kind: 'custom', from: '2026-09-30', to: '2026-09-30' } };
const run = (d, s = scope) => runReview(s, d, () => {});
async function fixture(fn) {
  const h = await makeHomes();
  const store = new Store(join(h.paseoHome, 'session-review'));
  await store.init();
  try { await fn(h, { homes: { ...h, dataDir: store.dataDir }, store }); }
  finally { await rm(h.root, { recursive: true, force: true }); }
}
const claude = (id, cwd, timestamp, type, text) => ({ sessionId: id, cwd, timestamp, type, message: { role: type, content: text } });
const emit = (timestamp, type, payload) => ({ timestamp, type, payload });
const save = (path, records) => writeFile(path, records.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join('\n') + '\n');
const candidate = async (file, id, cwd) => ({ provider: 'codex', file, id, cwd, startedAt: '2026-09-30T02:00:00.000Z', mtimeMs: (await stat(file)).mtimeMs, size: (await stat(file)).size, hiddenChildOf: null, forkedFrom: null });

test("review regression: redaction, resumed history, activity, branches, forks and concurrent writes", async () => {
await fixture(async (h, d) => {
  await save(join(h.claudeHome, 'projects/-work-proj/gap.jsonl'), [
    claude('gap', h.cwd, '2026-09-28T02:00:00.000Z', 'user', 'Monday'),
    claude('gap', h.cwd, '2026-09-28T02:01:00.000Z', 'assistant', 'Done'),
    claude('gap', h.cwd, '2026-09-30T02:00:00.000Z', 'user', 'Wednesday'),
    claude('gap', h.cwd, '2026-09-30T02:01:00.000Z', 'assistant', 'Done'),
  ]);
  const result = await run(d, { range: { kind: 'custom', from: '2026-09-29', to: '2026-09-29' } });
  const ghost = result.sessions.find(s => s.id === 'gap');
  assert.equal(ghost, undefined);
  assert.equal(result.overview.sessions, 0);
});

await fixture(async (h, d) => {
  const file = join(h.codexHome, 'sessions/2026/09/30/rollout-2026-09-30T10-00-01-x2.jsonl');
  const rows = (await readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
  delete rows[0].payload.parent_thread_id;
  rows[0].payload.source = { subagent: { thread_spawn: { parent_thread_id: 'x1', depth: 1 } } };
  await save(file, rows);
  const result = await run(d);
  assert.ok(!result.sessions.some(s => s.id === 'x2'));
});

await fixture(async (h, d) => {
  const dir = join(h.codexHome, 'sessions/2026/08/01');
  await mkdir(dir, { recursive: true });
  const rows = codexLines('old-resumed', h.cwd).map(JSON.parse);
  rows[0].timestamp = rows[0].payload.timestamp = '2026-08-01T02:00:00.000Z';
  await save(join(dir, 'rollout-2026-08-01T10-00-00-old-resumed.jsonl'), rows);
  const result = await run(d);
  assert.ok(result.sessions.some(s => s.id === 'old-resumed'));
});

await fixture(async (h, d) => {
  const file = join(h.codexHome, 'sessions/2026/09/30/rollout-2026-09-30T10-00-00-x1.jsonl');
  const rows = (await readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
  rows[0].payload.git = { branch: 'feat/demo' };
  await save(file, rows);
  const result = await run(d);
  const extracted = await d.store.readExtractAny('codex', 'x1');
  assert.equal(extracted.branch, 'feat/demo');
  assert.ok(result.sessions.some(s => s.id === 'x1'));
});

await fixture(async (h) => {
  const file = join(h.root, 'crash.jsonl');
  await save(file, [
    emit('2026-09-30T02:00:00.000Z', 'session_meta', { id: 'crash', cwd: h.cwd }),
    emit('2026-09-30T02:00:00.000Z', 'event_msg', { type: 'task_started' }),
    emit('2026-09-30T02:01:00.000Z', 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Last output before crash' }] }),
    emit('2026-09-30T22:00:00.000Z', 'event_msg', { type: 'task_started' }),
    emit('2026-09-30T22:01:00.000Z', 'event_msg', { type: 'task_complete' }),
  ]);
  const result = await parseCodex(await candidate(file, 'crash', h.cwd));
  const activeMinutes = sumMs(spansFromTurns(result.turns), 'run') / 60000;
  assert.equal(activeMinutes, 2);
});

await fixture(async (h, d) => {
  const file = join(h.codexHome, 'sessions/2026/09/30/rollout-2026-09-30T10-00-03-x4.jsonl');
  await save(file, codexLines('x4', h.cwd, { forkedFrom: 'x3' }));
  const result = await run(d);
  assert.ok(result.sessions.some(s => s.id === 'x3'));
  assert.ok(result.sessions.some(s => s.id === 'x4'));
});

let raceErrors = 0;
for (let i = 0; i < 10; i++) await fixture(async (h, d) => {
  const results = await Promise.all([run(d), run(d, { ...scope, projectId: 'prj_1' })]);
  raceErrors += results.flatMap(r => r.sessions).filter(s => s.error || s.warning).length;
});
assert.equal(raceErrors, 0);

await fixture(async (h, d) => {
  const file = join(h.root, 'secret.jsonl');
  const secret = 'synthetic-secret-DO-NOT-USE-1234';
  await save(file, [
    claude('secret', h.cwd, '2026-09-30T02:00:00.000Z', 'user', `Config: {"API_KEY":"${secret}"}`),
    claude('secret', h.cwd, '2026-09-30T02:01:00.000Z', 'assistant', 'Done'),
  ]);
  const c = { ...await candidate(file, 'secret', h.cwd), provider: 'claude' };
  await extractOne(c, d.store);
  const cached = JSON.stringify(await d.store.readExtractAny('claude', 'secret'));
  assert.ok(!cached.includes(secret));
});


});
