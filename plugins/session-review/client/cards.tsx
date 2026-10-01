import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import type { SessionCard, Summary } from "../shared/model";
import { OUTCOME_LABELS, PROVIDER_LABELS, fmtDuration, fmtTime } from "./format";
import { Card, Muted, Pill } from "./ui";

interface Props { sessions: SessionCard[]; summary: Summary | null; theme: PluginTheme; onOpen(session: SessionCard): void }

export function Cards({ sessions, summary, theme, onOpen }: Props) {
  if (sessions.length === 0) return <Muted theme={theme}>范围内没有会话。</Muted>;
  const outcomes = new Map((summary?.sessions ?? []).map((s) => [s.id, s.outcome]));
  return (
    <View style={{ gap: 8 }}>
      {sessions.map((s) => {
        const outcome = outcomes.get(s.id) ?? s.outcome;
        return (
          <View key={s.id} style={{ paddingLeft: s.depth ? 16 : 0 }}>
            <Card theme={theme} onPress={() => onOpen(s)}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Pill label={PROVIDER_LABELS[s.provider] ?? s.provider} theme={theme} tone="accent" />
                {s.depth > 0 && <Pill label="分叉" theme={theme} />}
                {s.unmanaged && <Pill label="未纳管" theme={theme} tone="warning" />}
                {s.error && <Pill label="无法解析" theme={theme} tone="danger" />}
                {outcome && <Pill label={OUTCOME_LABELS[outcome] ?? outcome} theme={theme} tone={outcome === "delivered" ? "success" : outcome === "overturned" ? "warning" : "muted"} />}
              </View>
              <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>{s.title}</Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                {fmtTime(s.startedAt)}–{fmtTime(s.endedAt)} · 活跃 {fmtDuration(s.activeMs)} · 等你 {fmtDuration(s.waitMs)} · 你发了 {s.userMessages} 条 · 决策点 {s.decisions.filter((d) => d.kind !== "memory-index").length}
              </Text>
            </Card>
          </View>
        );
      })}
    </View>
  );
}
