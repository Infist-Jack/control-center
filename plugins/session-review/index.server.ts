import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { ReviewResult } from "./shared/model.ts";
import { catalogRpc, reviewStartRpc, reviewStatusRpc, sessionDetailRpc } from "./shared/contracts.ts";
import { loadCatalog } from "./server/catalog.ts";
import { Jobs } from "./server/jobs.ts";
import { resolveHomes } from "./server/paths.ts";
import { localDateKey, resolveRange, runReview, scopeKey, sessionDetail } from "./server/review.ts";
import { Store } from "./server/store.ts";

export default function contribute(server: PluginServerContext) {
  const homes = resolveHomes();
  const store = new Store(homes.dataDir);
  const ready = store.init().catch((error) => { console.error("session-review: 初始化数据目录失败", error); });
  const deps = { homes, store };
  const reviewJobs = new Jobs<ReviewResult>();

  server.handle(catalogRpc, async () => {
    await ready;
    const catalog = await loadCatalog(homes.paseoHome);
    return {
      projects: catalog.projects.filter((p) => !p.archived).map(({ id, name, rootPath }) => ({ id, name, rootPath })),
      workspaces: catalog.workspaces.map(({ id, projectId }) => ({ id, projectId })),
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

  return () => { reviewJobs.dispose(); };
}
