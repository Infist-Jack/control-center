import type { PluginServerContext, PluginSettingsState } from "@getpaseo/plugin/server";
import { catalogRpc, reviewReadRpc, reviewRefreshRpc, sessionDetailRpc } from "./shared/contracts.ts";
import { reviewSettings, type settingsSchema } from "./shared/settings.ts";
import { resolveConfig, type ResolvedConfig } from "./server/config.ts";
import { Fleet, localNode } from "./server/fleet.ts";
import { PaseoGateway } from "./server/gateway.ts";
import { Snapshots } from "./server/snapshots.ts";
import { resolveHomes } from "./server/paths.ts";
import { Store } from "./server/store.ts";

export default function contribute(server: PluginServerContext) {
  const homes = resolveHomes();
  const store = new Store(homes.dataDir);
  const deps = { homes, store };
  const reads = new AbortController();

  // Settings are optional: with none, this daemon reviews itself in its own timezone.
  const settings = server.registerSettings(reviewSettings);
  let config: ResolvedConfig = resolveConfig(undefined);
  const apply = (state: PluginSettingsState<typeof settingsSchema>) => {
    config = resolveConfig(state.status === "ready" ? state.values : undefined);
    if (state.status === "invalid") config.warnings.push(`插件设置无效，已使用默认值：${state.error}`);
  };
  const current = () => config;

  const fleet = localNode(homes).then(local => new Fleet(new PaseoGateway(current, local), deps, local, { timezone: () => current().timezone, warnings: () => current().warnings }));
  const snapshots = new Snapshots(store, {
    catalog: async signal => (await fleet).catalog(signal),
    review: async (...args) => (await fleet).review(...args),
  }, () => new Date(), () => current().timezone);
  const ready = settings.read().then(apply, () => {}).then(() => store.init()).then(() => snapshots.init());
  const unsubscribe = settings.subscribe(state => {
    const before = config;
    apply(state);
    if (before.timezone !== config.timezone) void snapshots.reset();
    else if (before.nodesDir !== config.nodesDir || before.controlCenterDir !== config.controlCenterDir) void snapshots.refresh();
  });
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

  return () => { unsubscribe(); reads.abort(); snapshots.dispose(); };
}
