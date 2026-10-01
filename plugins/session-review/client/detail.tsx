import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { sessionDetailRpc } from "../shared/contracts";
import type { SessionCard } from "../shared/model";
import { KIND_LABELS, fmtTime } from "./format";
import { Muted, Pill } from "./ui";

export function DetailModal({ session, theme, onClose }: { session: SessionCard | null; theme: PluginTheme; onClose(): void }) {
  const getDetail = useRpc(sessionDetailRpc);
  const detail = useQuery({
    queryKey: ["session-review", "detail", session?.provider, session?.id],
    queryFn: () => getDetail({ provider: session!.provider, id: session!.id }),
    enabled: !!session,
  });
  const c = theme.colors;
  return (
    <Modal title={session?.title ?? "会话"} open={!!session} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Content scrollable>
        {detail.isLoading && <Muted theme={theme}>读取中…</Muted>}
        {detail.error && <Text style={{ color: c.statusDanger }}>{String(detail.error)}</Text>}
        {detail.data && (
          <View style={{ gap: 10 }}>
            <Muted theme={theme}>{detail.data.cwd}</Muted>
            {detail.data.decisions.length > 0 && (
              <View style={{ gap: 4 }}>
                <Text style={{ color: c.foreground, fontWeight: "600" }}>决策点</Text>
                {detail.data.decisions.map((d) => (
                  <View key={d.id} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                    <Text style={{ color: c.foregroundMuted, fontSize: 11, width: 40, marginTop: 2 }}>{fmtTime(d.at)}</Text>
                    <Pill label={KIND_LABELS[d.kind] ?? d.kind} theme={theme} />
                    <Text style={{ color: c.foreground, fontSize: 12, flex: 1 }}>{d.excerpt}{d.answer ? `\n你：${d.answer}` : ""}</Text>
                  </View>
                ))}
              </View>
            )}
            <Text style={{ color: c.foreground, fontWeight: "600" }}>消息</Text>
            {detail.data.messages.map((m, i) => (
              <View key={`${m.at}-${i}`} style={{ backgroundColor: m.role === "user" ? c.surface2 : c.surface1, borderRadius: 8, padding: 8, gap: 2 }}>
                <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{fmtTime(m.at)} · {m.role === "user" ? "你" : m.role === "assistant" ? "agent" : "系统"}</Text>
                <Text style={{ color: c.foreground, fontSize: 13 }}>{m.text}</Text>
              </View>
            ))}
          </View>
        )}
      </Modal.Content>
    </Modal>
  );
}
