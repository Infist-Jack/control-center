import type { PluginServerContext } from "@getpaseo/plugin/server";
import { catalogRpc, reviewReadRpc, reviewRefreshRpc, sessionDetailRpc } from "./shared/contracts.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { Fleet, localServerId } from "./server/fleet.ts";
import { PaseoGateway } from "./server/gateway.ts";
import { Snapshots } from "./server/snapshots.ts";
import { resolveHomes } from "./server/paths.ts";
import { Store } from "./server/store.ts";

export default function contribute(server: PluginServerContext) {
  const homes = resolveHomes();
  const store = new Store(homes.dataDir);
  const deps = { homes, store };
  const reads = new AbortController();
  const fleet = localServerId().then(id => new Fleet(new PaseoGateway(process.env.SR_CONTROL_CENTER || join(homedir(), "control-center")), deps, id));
  const snapshots = new Snapshots(store, {
    catalog: async signal => (await fleet).catalog(signal),
    review: async (...args) => (await fleet).review(...args),
  });
  const ready = store.init().then(() => snapshots.init());
  // Handlers surface startup failures without an unhandled rejection.
  void ready.catch(() => {}); void fleet.catch(() => {});

  server.handle(catalogRpc, async () => {
    await ready;
    return snapshots.catalog();
  });

  server.handle(reviewReadRpc, async (scope) => {
    await ready;
    return snapshots.read(scope);
  });

  server.handle(reviewRefreshRpc, async (scope) => {
    await ready;
    void snapshots.refresh(scope);
    return {};
  });

  server.handle(sessionDetailRpc, async ({ provider, id, nodeId, offset }) => { await ready; return (await fleet).detail(nodeId, provider, id, offset, reads.signal); });

  return () => { reads.abort(); snapshots.dispose(); };
}
