import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isUnder } from "./paths.ts";

export interface ProjectInfo { id: string; name: string; rootPath: string; archived: boolean }
export interface WorkspaceInfo { id: string; projectId: string; name: string; cwd: string; archived: boolean }
export interface AgentLink { agentId: string; workspaceId: string | null; provider: string; cwd: string }

export interface Catalog {
  projects: ProjectInfo[];
  workspaces: WorkspaceInfo[];
  /** provider session id → Paseo agent */
  agents: Map<string, AgentLink>;
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; } catch { return fallback; }
}

/** Reads the daemon home's own registry files; Paseo 0.9.2 keeps the provider session id only there. */
export async function loadCatalog(paseoHome: string): Promise<Catalog> {
  type RawProject = { projectId: string; rootPath: string; displayName?: string; customName?: string | null; archivedAt?: string | null };
  type RawWorkspace = { workspaceId: string; projectId: string; cwd: string; displayName?: string; title?: string | null; archivedAt?: string | null };
  const rawProjects = await readJsonFile<RawProject[]>(join(paseoHome, "projects", "projects.json"), []);
  const rawWorkspaces = await readJsonFile<RawWorkspace[]>(join(paseoHome, "projects", "workspaces.json"), []);
  const projects = rawProjects.map((p) => ({ id: p.projectId, name: p.customName || p.displayName || p.rootPath, rootPath: p.rootPath, archived: !!p.archivedAt }));
  const workspaces = rawWorkspaces.map((w) => ({ id: w.workspaceId, projectId: w.projectId, name: w.title || w.displayName || w.cwd, cwd: w.cwd, archived: !!w.archivedAt }));

  const agents = new Map<string, AgentLink>();
  const agentsDir = join(paseoHome, "agents");
  let groups: string[] = [];
  try { groups = await readdir(agentsDir); } catch { groups = []; }
  for (const group of groups) {
    const dir = join(agentsDir, group);
    let files: string[] = [];
    try { files = await readdir(dir); } catch { continue; }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const record = await readJsonFile<Record<string, unknown> | null>(join(dir, file), null);
      if (!record) continue;
      const persistence = (record.persistence ?? {}) as Record<string, unknown>;
      const sessionId = typeof persistence.sessionId === "string" ? persistence.sessionId : null;
      if (!sessionId) continue;
      agents.set(sessionId, {
        agentId: String(record.id ?? file.replace(/\.json$/, "")),
        workspaceId: typeof record.workspaceId === "string" ? record.workspaceId : null,
        provider: String(record.provider ?? ""),
        cwd: String(record.cwd ?? ""),
      });
    }
  }
  return { projects, workspaces, agents };
}

export interface Attribution { agentId: string | null; workspaceId: string | null; projectId: string | null; unmanaged: boolean }

export function attribute(catalog: Catalog, sessionId: string, cwd: string): Attribution {
  const link = catalog.agents.get(sessionId);
  if (link) {
    const workspace = link.workspaceId ? catalog.workspaces.find((w) => w.id === link.workspaceId) : undefined;
    return { agentId: link.agentId, workspaceId: link.workspaceId, projectId: workspace?.projectId ?? projectFor(catalog, cwd), unmanaged: false };
  }
  const ordered = [...catalog.workspaces].sort((a, b) => Number(a.archived) - Number(b.archived) || b.cwd.length - a.cwd.length);
  const workspace = ordered.find((w) => isUnder(cwd, w.cwd));
  if (workspace) return { agentId: null, workspaceId: workspace.id, projectId: workspace.projectId, unmanaged: true };
  return { agentId: null, workspaceId: null, projectId: projectFor(catalog, cwd), unmanaged: true };
}

function projectFor(catalog: Catalog, cwd: string): string | null {
  const ordered = [...catalog.projects].sort((a, b) => b.rootPath.length - a.rootPath.length);
  return ordered.find((p) => isUnder(cwd, p.rootPath))?.id ?? null;
}

export function inScope(catalog: Catalog, attribution: Attribution, cwd: string, scope: { workspaceId?: string | null; projectId?: string | null }): boolean {
  if (scope.workspaceId) {
    if (attribution.workspaceId === scope.workspaceId) return true;
    const workspace = catalog.workspaces.find((w) => w.id === scope.workspaceId);
    return !!workspace && attribution.projectId === workspace.projectId && isUnder(cwd, workspace.cwd);
  }
  if (scope.projectId) return attribution.projectId === scope.projectId;
  return true;
}
