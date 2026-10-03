import type { Progress, ReviewResult, Scope, SessionCard } from "../shared/model.ts";
import { reviewResultSchema, sessionDetailSchema } from "../shared/model.ts";
import { calendarBounds, REVIEW_TIMEZONE } from "../shared/time.ts";
import { loadCatalog } from "./catalog.ts";
import type { Gateway, NodeTarget, Workspace } from "./gateway.ts";
import { command } from "./gateway.ts";
import { redactDeep, redactText } from "./redact.ts";
import { runReview, sessionDetail, type ReviewDeps } from "./review.ts";
import { peakParallel, unionRunMs } from "./spans.ts";

export const projectKey = (nodeId: string, projectId: string) => JSON.stringify([nodeId, projectId]);
export const sessionKey = (nodeId: string, provider: string, id: string) => JSON.stringify([nodeId, provider, id]);
export function chooseWorkspace(available: Workspace[], selected?: string): string | undefined {
  if (selected) {
    if (!available.some(w => w.workspaceId === selected)) throw new Error("所选工作区已不存在");
    return selected;
  }
  const matches = available.filter(w => /环境|运维|environment|maintenance/i.test(w.name));
  if (matches.length === 1) return matches[0].workspaceId;
  if (available.length === 1) return available[0].workspaceId;
  return undefined;
}

export class Fleet {
  private workspaceByNode = new Map<string, string>();
  private gateway: Gateway;
  private deps: ReviewDeps;
  private localId: string;
  constructor(gateway: Gateway, deps: ReviewDeps, localId: string) { this.gateway = gateway; this.deps = deps; this.localId = localId; }

  async catalog(signal?: AbortSignal) {
    const targets = await this.gateway.nodes(signal);
    const catalog = await loadCatalog(this.deps.homes.paseoHome);
    return {
      nodes: targets.map(n => ({ ...n, status: "pending" as const })),
      projects: redactDeep(catalog.projects.filter(p => !p.archived).map(p => ({ id: projectKey(this.localId, p.id), nodeId: this.localId, name: p.name, rootPath: p.rootPath }))),
      workspaces: catalog.workspaces.map(w => ({ id: w.id, projectId: projectKey(this.localId, w.projectId) })),
      timezone: REVIEW_TIMEZONE, today: calendarBounds({ kind: "today" }).fromKey, dataDir: this.deps.homes.dataDir,
    };
  }

  async review(scope: Scope, report: (p: Progress) => void, signal?: AbortSignal, snapshot = false): Promise<ReviewResult> {
    const targets = await this.gateway.nodes(signal);
    if (scope.nodeIds?.some(id => !targets.some(n => n.id === id))) throw new Error("节点清单已变更，请刷新页面");
    let project: string[] | undefined;
    if (scope.projectId) {
      try { project = JSON.parse(scope.projectId); } catch { throw new Error("项目选择已过期，请重新选择"); }
      if (!Array.isArray(project) || project.length !== 2 || project.some(p => typeof p !== "string") || !targets.some(n => n.id === project![0])) throw new Error("项目选择已过期，请重新选择");
    }
    const selected = targets.filter(n => (!scope.nodeIds || scope.nodeIds.includes(n.id)) && (!project || n.id === project[0]));
    const bounds = calendarBounds(scope.range, this.deps.now?.());
    const states: NonNullable<ReviewResult["nodes"]> = selected.map(n => ({ ...n, status: "pending" }));
    const results = new Map<string, ReviewResult>();
    const emit = () => report({ phase: "扫描节点", done: states.filter(s => !["pending", "running"].includes(s.status)).length, total: states.length, nodes: states.map(s => ({ ...s })) });
    emit();
    const scan = async (node: NodeTarget) => {
      const state = states.find(n => n.id === node.id)!;
      state.status = "running"; emit();
      try {
        const localScope = { range: scope.range, projectId: project?.[1] };
        let result: ReviewResult;
        if (node.id === this.localId) {
          result = await runReview(localScope, { ...this.deps, bounds, sessionLimit: snapshot ? Infinity : undefined }, () => {}, signal);
          const catalog = await loadCatalog(this.deps.homes.paseoHome);
          result.projects = redactDeep(catalog.projects.filter(p => !p.archived).map(p => ({ id: p.id, name: p.name, rootPath: p.rootPath })));
        } else {
          const available = await this.gateway.workspaces(node, signal);
          const workspace = chooseWorkspace(available, scope.workspaces?.[node.id] ?? this.workspaceByNode.get(node.id));
          if (!workspace) { state.status = "needs_workspace"; state.workspaces = available.map(w => ({ workspaceId: w.workspaceId, name: w.name })); state.error = "请选择一个现有工作区用于读取会话"; return; }
          this.workspaceByNode.set(node.id, workspace);
          result = reviewResultSchema.parse(await this.gateway.collect(node, workspace, { action: "review", scope: localScope, bounds, snapshot }, signal));
        }
        results.set(node.id, result);
        state.status = "succeeded"; state.sessions = result.sessions.length;
      } catch (error) {
        state.error = redactText(error instanceof Error ? error.message : String(error));
        state.status = /cannot connect|DAEMON_NOT_RUNNING|timed out|timeout|超时|offline/i.test(state.error) ? "offline" : "failed";
        if (state.status === "offline") state.error = "节点暂时无法连接，可上线后刷新重试";
      } finally { emit(); }
    };
    // Two bounded workers: one unavailable node does not hold up every other node.
    const queue = [...selected];
    await Promise.all([0, 1].map(async () => { while (queue.length && !signal?.aborted) await scan(queue.shift()!); }));
    if (signal?.aborted) throw new Error("任务已中断");
    const sessions: SessionCard[] = [];
    const projects: NonNullable<ReviewResult["projects"]> = [];
    for (const node of selected) {
      const result = results.get(node.id); if (!result) continue;
      projects.push(...(result.projects ?? []).map(p => ({ ...p, id: projectKey(node.id, p.id), nodeId: node.id })));
      sessions.push(...result.sessions.map(s => ({ ...s,
        sourceId: s.id, id: sessionKey(node.id, s.provider, s.id), nodeId: node.id, nodeName: node.name,
        projectId: s.projectId ? projectKey(node.id, s.projectId) : null,
        forkedFrom: s.forkedFrom ? sessionKey(node.id, s.provider, s.forkedFrom) : null,
      })));
    }
    const spans = sessions.map(s => s.spans);
    return { scope, from: bounds.fromKey, to: bounds.toKey, timezone: REVIEW_TIMEZONE, generatedAt: new Date().toISOString(),
      sessions, projects, nodes: states, complete: states.every(n => n.status === "succeeded"),
      overview: { sessions: sessions.length, peakParallel: peakParallel(spans), activeMs: unionRunMs(spans), waitMs: sessions.reduce((a, s) => a + s.waitMs, 0), decisions: sessions.reduce((a, s) => a + s.decisions.length, 0), unparsable: sessions.filter(s => s.error).length },
    };
  }

  async detail(nodeId: string | undefined, provider: "claude" | "codex", id: string, offset: number, signal?: AbortSignal) {
    if (!nodeId || nodeId === this.localId) return sessionDetail(provider, id, this.deps.store, offset);
    const node = (await this.gateway.nodes(signal)).find(n => n.id === nodeId);
    if (!node) throw new Error("节点已不在登记清单中");
    const available = await this.gateway.workspaces(node, signal);
    const workspace = chooseWorkspace(available, this.workspaceByNode.get(nodeId));
    if (!workspace) throw new Error("请先为此节点选择工作区并刷新");
    return sessionDetailSchema.parse(await this.gateway.collect(node, workspace, { action: "detail", provider, id, offset }, signal));
  }
}

export async function localServerId(): Promise<string> {
  const status = JSON.parse(await command("paseo", ["status", "--json"]));
  if (typeof status.serverId !== "string") throw new Error("无法识别中控节点身份");
  return status.serverId;
}
