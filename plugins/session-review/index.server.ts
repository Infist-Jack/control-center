import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { ReviewResult, Summary } from "./shared/model.ts";
import {
  catalogRpc, presetDefaultRpc, presetDeleteRpc, presetSaveRpc, reviewStartRpc, reviewStatusRpc, sessionDetailRpc,
  summaryGetRpc, summaryStartRpc, summaryStatusRpc,
} from "./shared/contracts.ts";
import { loadCatalog } from "./server/catalog.ts";
import { Jobs } from "./server/jobs.ts";
import { resolveHomes } from "./server/paths.ts";
import { localDateKey, resolveRange, runReview, scopeKey, sessionDetail } from "./server/review.ts";
import { Store } from "./server/store.ts";
import { runSummary, summaryCacheKey } from "./server/summarize/index.ts";
import { detectRuntimes } from "./server/summarize/runtimes.ts";

export default function contribute(server: PluginServerContext) {
  const homes = resolveHomes();
  const store = new Store(homes.dataDir);
  const ready = store.init().catch((error) => { console.error("session-review: 初始化数据目录失败", error); });
  const deps = { homes, store };
  const reviewJobs = new Jobs<ReviewResult>();
  const summaryJobs = new Jobs<{ summary: Summary; cached: boolean; stderrTail: string }>();
  let runtimesCache: { at: number; value: Awaited<ReturnType<typeof detectRuntimes>> } | null = null;

  server.handle(catalogRpc, async () => {
    await ready;
    const catalog = await loadCatalog(homes.paseoHome);
    if (!runtimesCache || Date.now() - runtimesCache.at > 60_000) runtimesCache = { at: Date.now(), value: await detectRuntimes() };
    return {
      projects: catalog.projects.filter((p) => !p.archived).map(({ id, name, rootPath }) => ({ id, name, rootPath })),
      workspaces: catalog.workspaces.map(({ id, projectId, name, cwd, archived }) => ({ id, projectId, name, cwd, archived })),
      runtimes: runtimesCache.value,
      presets: await store.listPresets(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      today: localDateKey(new Date()),
      dataDir: homes.dataDir,
    };
  });

  server.handle(reviewStartRpc, async (scope) => {
    await ready;
    const key = scopeKey(scope, resolveRange(scope.range));
    const job = reviewJobs.start(key, (j, report) => runReview(scope, deps, report, j.abort.signal));
    return { jobId: job.id };
  });

  server.handle(reviewStatusRpc, async ({ jobId }) => {
    const job = reviewJobs.get(jobId);
    if (!job) throw new Error("任务不存在或已过期，请重新运行");
    return { id: job.id, status: job.status, progress: job.progress, result: job.result, error: job.error };
  });

  server.handle(sessionDetailRpc, async ({ provider, id }) => { await ready; return sessionDetail(provider, id, store); });

  server.handle(summaryStartRpc, async (request) => {
    await ready;
    const key = `summary:${JSON.stringify([request.scope, request.runtime, request.presetId])}`;
    const job = summaryJobs.start(key, (j, report) => runSummary(request, deps, report, j.abort.signal));
    return { jobId: job.id };
  });

  server.handle(summaryStatusRpc, async ({ jobId }) => {
    const job = summaryJobs.get(jobId);
    if (!job) throw new Error("任务不存在或已过期，请重新运行");
    return {
      id: job.id, status: job.status, progress: job.progress,
      result: job.result?.summary, cached: job.result?.cached, stderrTail: job.result?.stderrTail || undefined, error: job.error,
    };
  });

  server.handle(summaryGetRpc, async (request) => {
    await ready;
    const { key } = await summaryCacheKey(request, deps);
    const cached = await store.readSummary(key);
    return { summary: cached?.summary ?? null, generatedAt: cached?.generatedAt ?? null };
  });

  server.handle(presetSaveRpc, async (input) => { await ready; return store.savePreset(input); });
  server.handle(presetDeleteRpc, async ({ id }) => { await ready; await store.deletePreset(id); return {}; });
  server.handle(presetDefaultRpc, async ({ id }) => { await ready; await store.setDefaultPreset(id); return {}; });

  return () => { reviewJobs.dispose(); summaryJobs.dispose(); };
}
