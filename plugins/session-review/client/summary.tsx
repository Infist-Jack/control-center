import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { summaryGetRpc, summaryStartRpc, summaryStatusRpc } from "../shared/contracts";
import type { Preset, RuntimeId, RuntimeInfo, Scope, SessionCard, Summary } from "../shared/model";
import { OUTCOME_LABELS, fmtDateTime } from "./format";
import { Button, Choice, Muted, SectionTitle } from "./ui";

interface Props {
  scope: Scope; sessions: SessionCard[]; runtimes: RuntimeInfo[]; presets: Preset[]; theme: PluginTheme; compact: boolean;
  onSummary(summary: Summary | null): void; onManagePresets(): void;
}

export function SummarySection({ scope, sessions, runtimes, presets, theme, compact, onSummary, onManagePresets }: Props) {
  const c = theme.colors;
  const start = useRpc(summaryStartRpc), status = useRpc(summaryStatusRpc), get = useRpc(summaryGetRpc);
  const available = runtimes.filter((r) => r.available);
  const [runtime, setRuntime] = useState<RuntimeId | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => { if (!runtime) setRuntime(available.find((r) => r.id === "claude")?.id ?? available[0]?.id ?? null); }, [available, runtime]);
  useEffect(() => { if (!presetId || !presets.some((p) => p.id === presetId)) setPresetId(presets.find((p) => p.isDefault)?.id ?? presets[0]?.id ?? null); }, [presets, presetId]);

  const cached = useQuery({
    queryKey: ["session-review", "summary", scope, runtime, presetId, sessions.map((s) => s.id).join(",")],
    queryFn: () => get({ scope, runtime: runtime!, presetId: presetId! }),
    enabled: !!runtime && !!presetId && sessions.length > 0,
  });
  const job = useQuery({
    queryKey: ["session-review", "summary-job", jobId],
    queryFn: () => status({ jobId: jobId! }),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1200 : false),
  });
  const kickoff = useMutation({
    mutationFn: () => start({ scope, runtime: runtime!, presetId: presetId! }),
    onSuccess: (r) => setJobId(r.jobId),
  });

  const result: Summary | null = job.data?.status === "succeeded" && job.data.result ? job.data.result : cached.data?.summary ?? null;
  useEffect(() => { onSummary(result); }, [result, onSummary]);
  useEffect(() => { if (job.data?.status === "succeeded") void cached.refetch(); }, [job.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = job.data?.status === "running" || kickoff.isPending;
  const error = kickoff.error ? String(kickoff.error) : job.data?.status === "failed" ? job.data.error : null;

  return (
    <View style={{ gap: 8 }}>
      <SectionTitle theme={theme} trailing={<Button label="管理预设" theme={theme} onPress={onManagePresets} />}>归纳（可选）</SectionTitle>
      {available.length === 0 ? (
        <Muted theme={theme}>这台机器上没有可用的 runtime（claude / codex / opencode）。</Muted>
      ) : (
        <View style={{ flexDirection: compact ? "column" : "row", gap: 10, flexWrap: "wrap", alignItems: compact ? "stretch" : "center" }}>
          <Muted theme={theme}>runtime</Muted>
          <Choice theme={theme} value={runtime} onChange={setRuntime} options={runtimes.map((r) => ({ label: r.id, value: r.id, disabled: !r.available }))} />
          <Muted theme={theme}>预设</Muted>
          <Choice theme={theme} value={presetId} onChange={setPresetId} options={presets.map((p) => ({ label: p.name, value: p.id }))} />
          <Button label={running ? `归纳中… ${job.data?.progress.phase ?? ""}` : "运行归纳"} variant="primary" theme={theme}
            disabled={running || !runtime || !presetId || sessions.length === 0} onPress={() => kickoff.mutate()} />
        </View>
      )}
      {error ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{error}</Text> : null}
      {job.data?.status === "failed" && job.data.stderrTail ? <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{job.data.stderrTail}</Text> : null}
      {result ? (
        <View style={{ gap: 8, backgroundColor: c.surface1, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: c.border }}>
          <Text style={{ color: c.foreground, fontSize: 15, fontWeight: "600" }}>{result.day.oneLine}</Text>
          <Muted theme={theme}>
            {job.data?.status === "succeeded" ? (job.data.cached ? "命中缓存" : "刚刚生成") : cached.data?.generatedAt ? `上次归纳 ${fmtDateTime(cached.data.generatedAt)}` : ""}
          </Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {result.day.buckets.filter((b) => b.minutes > 0).map((b) => (
              <View key={b.name} style={{ backgroundColor: c.surface2, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ color: c.foreground, fontSize: 12 }}>{b.name} {b.minutes} 分</Text>
              </View>
            ))}
          </View>
          {result.day.overturned.length > 0 && (
            <View style={{ gap: 4 }}>
              <Text style={{ color: c.foreground, fontWeight: "600", fontSize: 13 }}>被推翻的决定</Text>
              {result.day.overturned.map((o, i) => (
                <Text key={i} style={{ color: c.foreground, fontSize: 13 }}>• {o.decision}<Text style={{ color: c.foregroundMuted }}>　后来：{o.laterEvidence}</Text></Text>
              ))}
            </View>
          )}
          {result.day.longestWaits.length > 0 && (
            <View style={{ gap: 4 }}>
              <Text style={{ color: c.foreground, fontWeight: "600", fontSize: 13 }}>等待最久</Text>
              {result.day.longestWaits.map((w, i) => (
                <Text key={i} style={{ color: c.foreground, fontSize: 13 }}>• {w.minutes} 分：{w.what}</Text>
              ))}
            </View>
          )}
          <View style={{ gap: 4 }}>
            <Text style={{ color: c.foreground, fontWeight: "600", fontSize: 13 }}>每个会话</Text>
            {result.sessions.map((s) => {
              const card = sessions.find((x) => x.id === s.id);
              return (
                <Text key={s.id} style={{ color: c.foreground, fontSize: 13 }}>
                  • <Text style={{ color: c.foregroundMuted }}>[{OUTCOME_LABELS[s.outcome] ?? s.outcome}]</Text> {card?.title ?? s.id}：{s.goal}
                  {s.overturnedBy ? <Text style={{ color: c.foregroundMuted }}>　被推翻：{s.overturnedBy}</Text> : null}
                  <Text style={{ color: c.foregroundMuted }}>　重来：{s.ifAgain}</Text>
                </Text>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}
