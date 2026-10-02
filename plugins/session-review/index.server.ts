import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { ReviewResult } from "./shared/model.ts";
import { catalogRpc, reviewStartRpc, reviewStatusRpc, sessionDetailRpc } from "./shared/contracts.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { Fleet, localServerId } from "./server/fleet.ts";
import { PaseoGateway } from "./server/gateway.ts";
import { calendarBounds } from "./shared/time.ts";
import { Jobs } from "./server/jobs.ts";
import { resolveHomes } from "./server/paths.ts";
import { scopeKey } from "./server/review.ts";
import { Store } from "./server/store.ts";

export default function contribute(server: PluginServerContext) {
  const homes = resolveHomes();
  const store = new Store(homes.dataDir);
  const ready = store.init();
  const deps = { homes, store };
  const reviewJobs = new Jobs<ReviewResult>();
  const reads = new AbortController();
  const fleet = localServerId().then(id => new Fleet(new PaseoGateway(process.env.SR_CONTROL_CENTER || join(homedir(), "control-center")), deps, id));
  // Handlers surface startup failures without an unhandled rejection.
  void ready.catch(() => {}); void fleet.catch(() => {});

  server.handle(catalogRpc, async () => {
    await ready;
    return (await fleet).catalog(reads.signal);
  });

  server.handle(reviewStartRpc, async (scope) => {
    await ready;
    const key = scopeKey(scope, calendarBounds(scope.range));
    const manager = await fleet;
    const job = reviewJobs.start(key, (j, report) => manager.review(scope, report, j.abort.signal));
    return { jobId: job.id };
  });

  server.handle(reviewStatusRpc, async ({ jobId }) => {
    const job = reviewJobs.get(jobId);
    if (!job) throw new Error("任务不存在或已过期，请重新运行");
    return { id: job.id, status: job.status, progress: job.progress, result: job.result, error: job.error };
  });

  server.handle(sessionDetailRpc, async ({ provider, id, nodeId, offset }) => { await ready; return (await fleet).detail(nodeId, provider, id, offset, reads.signal); });

  return () => { reads.abort(); reviewJobs.dispose(); };
}
