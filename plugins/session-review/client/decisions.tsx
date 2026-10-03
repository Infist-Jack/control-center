import type { PluginTheme } from "@getpaseo/plugin";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Decision, SessionCard } from "../shared/model";
import { KIND_LABELS, fmtTime } from "./format";
import { Muted, Pill, type Tone } from "./ui";

interface Props { sessions: SessionCard[]; theme: PluginTheme; timezone: string; selected: string | null; onSelect(key: string | null): void }

const TONES: Record<string, Tone> = { question: "accent", interrupt: "warning", denied: "danger", memory: "success", "memory-index": "muted" };

export function Decisions({ sessions, theme, timezone, selected, onSelect }: Props) {
  const c = theme.colors;
  const [showIndex, setShowIndex] = useState(false);
  const rows: Array<{ key: string; session: SessionCard; decision: Decision }> = [];
  for (const s of sessions) for (const d of s.decisions) rows.push({ key: `${s.id}:${d.id}`, session: s, decision: d });
  rows.sort((a, b) => a.decision.at.localeCompare(b.decision.at));
  const visible = rows.filter((r) => showIndex || r.decision.kind !== "memory-index");
  const hiddenCount = rows.length - visible.length;

  if (rows.length === 0) return <Muted theme={theme}>没有确定性的决策点：agent 没提问、你没打断、也没写记忆。</Muted>;
  return (
    <View style={{ gap: 6 }}>
      {visible.map(({ key, session, decision }) => {
        const active = key === selected;
        return (
          <Pressable key={key} accessibilityRole="button" onPress={() => onSelect(active ? null : key)}
            style={{ borderLeftWidth: 3, borderLeftColor: active ? c.statusWarning : c.border, paddingLeft: 8, paddingVertical: 4, backgroundColor: active ? c.surface1 : "transparent", borderRadius: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Text style={{ color: c.foregroundMuted, fontSize: 11, width: 40 }}>{fmtTime(decision.at, timezone)}</Text>
              <Pill label={KIND_LABELS[decision.kind] ?? decision.kind} theme={theme} tone={TONES[decision.kind] ?? "muted"} />
              <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11, flexShrink: 1 }}>{session.title.slice(0, 24)}</Text>
            </View>
            <Text style={{ color: c.foreground, fontSize: 13, marginTop: 2 }}>{decision.excerpt}</Text>
            {decision.answer ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>你：{decision.answer}</Text> : null}
            {decision.detail && decision.kind !== "question" ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{decision.detail}</Text> : null}
            {decision.next ? <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>随后：{decision.next}</Text> : null}
          </Pressable>
        );
      })}
      {hiddenCount > 0 || showIndex ? (
        <Pressable accessibilityRole="button" onPress={() => setShowIndex((v) => !v)}>
          <Text style={{ color: c.accent, fontSize: 12 }}>{showIndex ? "隐藏记忆索引改动" : `显示 ${hiddenCount} 条记忆索引改动`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
