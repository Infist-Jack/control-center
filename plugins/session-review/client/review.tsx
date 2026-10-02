import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { catalogRpc, reviewStartRpc, reviewStatusRpc } from "../shared/contracts";
import type { Range, Scope, SessionCard, ReviewResult } from "../shared/model";
import { Decisions } from "./decisions";
import { DetailModal } from "./detail";
import { fmtDuration } from "./format";
import { Gantt } from "./gantt";
import { Button, Choice, Muted, SectionTitle } from "./ui";

export interface ReviewProps {
  theme: PluginTheme;
  compact: boolean;
  hostId: string;
  /** Workspace panel: scope is fixed to that workspace's project. Sidebar surface: null, user picks a project. */
  workspaceId: string | null;
}

const RANGE_OPTIONS = [
  { label: "今天", value: "today" }, { label: "昨天", value: "yesterday" }, { label: "最近 7 天", value: "last7" }, { label: "自定义", value: "custom" },
] as const;

// Paseo remounts panels when the layout flips between compact and wide; keep the chosen scope across remounts.
interface Remembered { pickedProject: string | null; rangeKind: Range["kind"]; customFrom: string; customTo: string; nodeId: string | null; workspaces: Record<string, string> }
const remembered = new Map<string, Remembered>();
const rememberedJobs = new Map<string, string>();
const NODE_LABELS = { pending: "等待", running: "读取中", succeeded: "完成", offline: "离线", failed: "失败", needs_workspace: "选择工作区" };

export function Review({ theme, compact, hostId, workspaceId }: ReviewProps) {
  const c = theme.colors;
  const catalogCall = useRpc(catalogRpc), startCall = useRpc(reviewStartRpc), statusCall = useRpc(reviewStatusRpc);
  const catalog = useQuery({ queryKey: ["session-review", "catalog", hostId], queryFn: () => catalogCall({}) });

  const memoryKey = `${hostId}:${workspaceId ?? "surface"}`;
  const initial = remembered.get(memoryKey);
  const [pickedProject, setPickedProject] = useState<string | null>(initial?.pickedProject ?? null);
  const [rangeKind, setRangeKind] = useState<Range["kind"]>(initial?.rangeKind ?? "today");
  const [customFrom, setCustomFrom] = useState(initial?.customFrom ?? ""), [customTo, setCustomTo] = useState(initial?.customTo ?? "");
  const [nodeId, setNodeId] = useState<string | null>(initial?.nodeId ?? null);
  const [workspaces, setWorkspaces] = useState<Record<string, string>>(initial?.workspaces ?? {});
  useEffect(() => { remembered.set(memoryKey, { pickedProject, rangeKind, customFrom, customTo, nodeId, workspaces }); }, [memoryKey, pickedProject, rangeKind, customFrom, customTo, nodeId, workspaces]);

  const [jobId, setJobId] = useState<string | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<string | null>(null);
  const [openSession, setOpenSession] = useState<SessionCard | null>(null);

  const [scannedProjects, setScannedProjects] = useState<NonNullable<ReviewResult["projects"]>>([]);
  const projects = useMemo(() => [...new Map([...(catalog.data?.projects ?? []), ...scannedProjects].map(p => [p.id, p])).values()], [catalog.data, scannedProjects]);
  const fixedProject = workspaceId ? catalog.data?.workspaces.find((w) => w.id === workspaceId)?.projectId ?? null : null;
  const projectId = workspaceId ? fixedProject : pickedProject;

  const scope: Scope = useMemo(() => ({
    projectId,
    nodeIds: !workspaceId && nodeId ? [nodeId] : undefined,
    workspaces,
    range: rangeKind === "custom"
      ? { kind: "custom", from: /^\d{4}-\d{2}-\d{2}$/.test(customFrom) ? customFrom : undefined, to: /^\d{4}-\d{2}-\d{2}$/.test(customTo) ? customTo : undefined }
      : { kind: rangeKind },
  }), [projectId, rangeKind, customFrom, customTo, nodeId, workspaceId, workspaces]);

  const currentScope = useRef("");
  currentScope.current = JSON.stringify(scope);
  const jobMemoryKey = `${memoryKey}:${catalog.data?.today ?? ""}`;
  const start = useMutation({ mutationFn: (s: Scope) => startCall(s), onSuccess: (r, s) => {
    const key = `${jobMemoryKey}:${JSON.stringify(s)}`;
    rememberedJobs.set(key, r.jobId);
    if (JSON.stringify(s) === currentScope.current) setJobId(r.jobId);
  } });
  const scopeKey = JSON.stringify(scope);
  const catalogReady = !!catalog.data;
  useEffect(() => {
    if (!catalogReady) return;
    const known = rememberedJobs.get(`${jobMemoryKey}:${scopeKey}`);
    setJobId(known ?? null);
    if (!known) start.mutate(scope);
  }, [scopeKey, catalogReady, jobMemoryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const job = useQuery({
    queryKey: ["session-review", "job", hostId, jobId],
    queryFn: () => statusCall({ jobId: jobId! }),
    enabled: !!jobId,
    retry: false,
    refetchInterval: (q) => (!q.state.error && q.state.data?.status === "running" ? 1200 : false),
  });
  const result = job.data?.status === "succeeded" ? job.data.result : undefined;
  const sessions = result?.sessions ?? [];
  useEffect(() => { if (result?.projects) setScannedProjects(old => [...new Map([...old, ...result.projects!].map(p => [p.id, p])).values()]); }, [result]);
  const loading = (!job.error && job.data?.status === "running") || start.isPending || (!!jobId && job.isLoading) || catalog.isLoading;
  const error = catalog.error ? String(catalog.error) : start.error ? String(start.error) : job.data?.status === "failed" ? job.data.error : job.error ? String(job.error) : null;
  const projectName = projects.find((p) => p.id === projectId)?.name;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: compact ? 12 : 20, gap: 14 }}>
      <View style={{ gap: 8 }}>
        <Muted theme={theme}>时间均为 {catalog.data?.timezone ?? "Asia/Singapore"}</Muted>
        {workspaceId === null && <Choice theme={theme} value={nodeId ?? "__all"}
          onChange={v => { setNodeId(v === "__all" ? null : v); setPickedProject(null); }}
          options={[{ label: "全部节点", value: "__all" }, ...(catalog.data?.nodes ?? []).map(n => ({ label: n.name, value: n.id }))]} />}
        {workspaceId === null ? (
          <View style={{ gap: 6 }}>
            <Muted theme={theme}>项目</Muted>
            <Choice theme={theme} value={pickedProject ?? "all"} onChange={(v) => setPickedProject(v === "all" ? null : v)}
              options={[{ label: "全部项目", value: "all" }, ...projects.filter(p => !nodeId || p.nodeId === nodeId).map((p) => ({ label: p.name, value: p.id }))]} />
          </View>
        ) : (
          <Muted theme={theme}>项目 · {projectName ?? "全部"}</Muted>
        )}
        <View style={{ flexDirection: compact ? "column" : "row", gap: 10, alignItems: compact ? "stretch" : "center", flexWrap: "wrap" }}>
          <Choice theme={theme} value={rangeKind} onChange={(v) => setRangeKind(v)} options={RANGE_OPTIONS} />
          {rangeKind === "custom" && (
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
              <TextInput value={customFrom} onChangeText={setCustomFrom} placeholder="2026-09-30" placeholderTextColor={c.foregroundMuted} style={{ color: c.foreground, borderWidth: 1, borderColor: c.border, borderRadius: 6, padding: 6, width: 110, backgroundColor: c.surface1 }} />
              <Muted theme={theme}>至</Muted>
              <TextInput value={customTo} onChangeText={setCustomTo} placeholder="2026-09-30" placeholderTextColor={c.foregroundMuted} style={{ color: c.foreground, borderWidth: 1, borderColor: c.border, borderRadius: 6, padding: 6, width: 110, backgroundColor: c.surface1 }} />
            </View>
          )}
          <Button label={loading ? "读取中…" : "刷新"} theme={theme} disabled={loading} onPress={() => start.mutate(scope)} />
        </View>
        {loading && job.data?.progress ? <Muted theme={theme}>{job.data.progress.phase}{job.data.progress.total ? ` ${job.data.progress.done}/${job.data.progress.total}` : ""}</Muted> : null}
        {error ? <Text style={{ color: c.statusDanger, fontSize: 13 }}>{error}</Text> : null}
        {(job.data?.progress.nodes ?? result?.nodes ?? catalog.data?.nodes ?? []).map(n => (
          <View key={n.id} style={{ gap: 4, paddingVertical: 4 }}>
            <Text style={{ color: n.status === "offline" || n.status === "failed" ? c.statusWarning : c.foreground, fontSize: 12 }}>{n.name} · {NODE_LABELS[n.status]}{n.sessions !== undefined ? ` · ${n.sessions} 个会话` : ""}</Text>
            {n.error && <Muted theme={theme}>{n.error}</Muted>}
            {n.status === "needs_workspace" && <Choice theme={theme} value={workspaces[n.id] ?? ""}
              options={[{ label: "选择现有工作区", value: "" }, ...(n.workspaces ?? []).map(w => ({ label: w.name, value: w.workspaceId }))]}
              onChange={v => { if (v) setWorkspaces(old => ({ ...old, [n.id]: v })); }} />}
          </View>
        ))}
        {result?.complete === false && <Text style={{ color: c.statusWarning, fontSize: 12 }}>部分节点未完成，以下统计仅包含成功节点。点击刷新可重试。</Text>}
      </View>

      {result && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
          <Stat label="时间跨度" value={result.from === result.to ? result.from : `${result.from} 至 ${result.to}`} theme={theme} />
          <Stat label="会话" value={String(result.overview.sessions)} theme={theme} />
          <Stat label="最大并行" value={String(result.overview.peakParallel)} theme={theme} />
          <Stat label="总活跃" value={fmtDuration(result.overview.activeMs)} theme={theme} />
          <Stat label="等你" value={fmtDuration(result.overview.waitMs)} theme={theme} />
          <Stat label="决策点" value={String(result.overview.decisions)} theme={theme} />
          {result.overview.unparsable > 0 && <Stat label="无法解析" value={String(result.overview.unparsable)} theme={theme} danger />}
        </View>
      )}

      {result && (
        <View style={{ gap: 8 }}>
          <SectionTitle theme={theme}>会话</SectionTitle>
          <Gantt sessions={sessions} theme={theme} compact={compact} selectedDecision={selectedDecision}
            onPickDecision={(sid, did) => setSelectedDecision(`${sid}:${did}`)} onOpenDetail={setOpenSession} />
          <SectionTitle theme={theme}>决策点</SectionTitle>
          <Decisions sessions={sessions} theme={theme} selected={selectedDecision} onSelect={setSelectedDecision} />
        </View>
      )}

      <DetailModal session={openSession} hostId={hostId} theme={theme} onClose={() => setOpenSession(null)} />
    </ScrollView>
  );
}

function Stat({ label, value, theme, danger }: { label: string; value: string; theme: PluginTheme; danger?: boolean }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: danger ? theme.colors.statusDanger : theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>{value}</Text>
    </View>
  );
}
