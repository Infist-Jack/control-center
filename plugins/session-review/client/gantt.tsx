import type { PluginTheme } from "@getpaseo/plugin";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { SessionCard } from "../shared/model";
import { fmtDuration, fmtTime } from "./format";
import { Muted } from "./ui";

interface Props {
  sessions: SessionCard[];
  theme: PluginTheme;
  compact: boolean;
  selectedDecision: string | null;
  onPickDecision(sessionId: string, decisionId: string): void;
}

const LABEL_WIDTH = 120;
const ROW_HEIGHT = 22;

export function Gantt({ sessions, theme, compact, selectedDecision, onPickDecision }: Props) {
  const c = theme.colors;
  const [width, setWidth] = useState(0);
  if (sessions.length === 0) return <Muted theme={theme}>范围内没有会话。</Muted>;

  if (compact) {
    return (
      <View style={{ gap: 4 }}>
        {sessions.map((s) => (
          <View key={s.id} style={{ flexDirection: "row", gap: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.border }}>
            <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12, flex: 2 }}>{s.title}</Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 12, flex: 1 }}>{fmtTime(s.startedAt)}–{fmtTime(s.endedAt)}</Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 12, width: 56, textAlign: "right" }}>{fmtDuration(s.activeMs)}</Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 12, width: 56, textAlign: "right" }}>等{fmtDuration(s.waitMs)}</Text>
          </View>
        ))}
      </View>
    );
  }

  const starts = sessions.map((s) => Date.parse(s.startedAt));
  const ends = sessions.map((s) => Date.parse(s.endedAt));
  const domainStart = Math.min(...starts);
  const domainEnd = Math.max(Math.max(...ends), domainStart + 60_000);
  const span = domainEnd - domainStart;
  const x = (iso: string) => ((Date.parse(iso) - domainStart) / span) * width;

  const ticks: number[] = [];
  const firstHour = new Date(domainStart); firstHour.setMinutes(0, 0, 0);
  for (let t = firstHour.getTime(); t <= domainEnd; t += 3_600_000) if (t >= domainStart) ticks.push(t);
  const tickStep = Math.max(1, Math.ceil(ticks.length / Math.max(1, Math.floor(width / 60))));

  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: LABEL_WIDTH }} />
        <View style={{ flex: 1, height: 16 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 && ticks.map((t, i) => i % tickStep === 0 && (
            <Text key={t} style={{ position: "absolute", left: ((t - domainStart) / span) * width, color: c.foregroundMuted, fontSize: 10 }}>
              {fmtTime(new Date(t).toISOString())}
            </Text>
          ))}
        </View>
      </View>
      {sessions.map((s) => (
        <View key={s.id} style={{ flexDirection: "row", alignItems: "center", height: ROW_HEIGHT }}>
          <Text numberOfLines={1} style={{ width: LABEL_WIDTH, paddingRight: 8, paddingLeft: s.depth ? 12 : 0, color: s.error ? c.statusDanger : c.foregroundMuted, fontSize: 11 }}>
            {s.depth ? "↳ " : ""}{s.title.slice(0, 20)}
          </Text>
          <View style={{ flex: 1, height: ROW_HEIGHT - 6, backgroundColor: c.surface1, borderRadius: 4, overflow: "visible" }}>
            {width > 0 && ticks.map((t) => (
              <View key={`tick-${t}`} style={{ position: "absolute", left: ((t - domainStart) / span) * width, top: 0, bottom: 0, width: 1, backgroundColor: c.border }} />
            ))}
            {width > 0 && s.spans.map((sp, i) => {
              const left = x(sp.start);
              const w = Math.max(2, x(sp.end) - left);
              return (
                <View
                  key={`${sp.kind}-${i}`}
                  accessibilityLabel={`${sp.kind === "run" ? "运行" : "等待"} ${fmtTime(sp.start)} 到 ${fmtTime(sp.end)}`}
                  style={{ position: "absolute", left, width: w, top: sp.kind === "run" ? 0 : 4, bottom: sp.kind === "run" ? 0 : 4, borderRadius: 3, backgroundColor: sp.kind === "run" ? c.accent : c.surface2, borderWidth: sp.kind === "wait" ? 1 : 0, borderColor: c.border }}
                />
              );
            })}
            {width > 0 && s.decisions.filter((d) => d.kind !== "memory-index").map((d) => {
              const active = selectedDecision === `${s.id}:${d.id}`;
              return (
                <Pressable
                  key={d.id}
                  accessibilityRole="button"
                  accessibilityLabel={`决策点 ${fmtTime(d.at)} ${d.excerpt}`}
                  onPress={() => onPickDecision(s.id, d.id)}
                  hitSlop={6}
                  style={{ position: "absolute", left: x(d.at) - 5, top: (ROW_HEIGHT - 6) / 2 - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: active ? c.statusWarning : c.foreground, borderWidth: 1.5, borderColor: c.surface0 }}
                />
              );
            })}
          </View>
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
        <Legend color={c.accent} label="运行" theme={theme} />
        <Legend color={c.surface2} label="等待你" theme={theme} border />
        <Legend color={c.foreground} label="决策点" theme={theme} round />
      </View>
    </View>
  );
}

function Legend({ color, label, theme, border, round }: { color: string; label: string; theme: PluginTheme; border?: boolean; round?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ width: round ? 8 : 14, height: 8, borderRadius: round ? 4 : 2, backgroundColor: color, borderWidth: border ? 1 : 0, borderColor: theme.colors.border }} />
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{label}</Text>
    </View>
  );
}
