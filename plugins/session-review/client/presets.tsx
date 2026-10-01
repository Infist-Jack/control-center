import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import { presetDefaultRpc, presetDeleteRpc, presetSaveRpc } from "../shared/contracts";
import type { Preset } from "../shared/model";
import { Button, Muted, Pill } from "./ui";

interface Props { open: boolean; presets: Preset[]; theme: PluginTheme; onClose(): void; onChanged(): void }

export function PresetsModal({ open, presets, theme, onClose, onChanged }: Props) {
  const save = useRpc(presetSaveRpc), remove = useRpc(presetDeleteRpc), setDefault = useRpc(presetDefaultRpc);
  const toast = useToast();
  const c = theme.colors;
  const [editing, setEditing] = useState<{ id?: string; name: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true); setError("");
    try { await fn(); toast.show(done, { variant: "success" }); onChanged(); setEditing(null); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="归纳提示词预设" open={open} onOpenChange={(v) => { if (!v) { setEditing(null); onClose(); } }}>
      <Modal.Content scrollable>
        <View style={{ gap: 10 }}>
          <Muted theme={theme}>预设只写归纳的注重点；输出结构由插件固定，换预设不会改变页面。</Muted>
          {presets.map((p) => (
            <View key={p.id} style={{ backgroundColor: c.surface1, borderRadius: 8, padding: 10, gap: 6, borderWidth: 1, borderColor: c.border }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Text style={{ color: c.foreground, fontWeight: "600" }}>{p.name}</Text>
                {p.builtin && <Pill label="内置" theme={theme} />}
                {p.isDefault && <Pill label="默认" theme={theme} tone="accent" />}
              </View>
              <Text numberOfLines={3} style={{ color: c.foregroundMuted, fontSize: 12 }}>{p.body}</Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {!p.builtin && <Button label="编辑" theme={theme} disabled={busy} onPress={() => setEditing({ id: p.id, name: p.name, body: p.body })} />}
                <Button label="复制为新预设" theme={theme} disabled={busy} onPress={() => setEditing({ name: `${p.name} 副本`, body: p.body })} />
                {!p.isDefault && <Button label="设为默认" theme={theme} disabled={busy} onPress={() => void act(() => setDefault({ id: p.id }), "已设为默认")} />}
                {!p.builtin && <Button label="删除" variant="danger" theme={theme} disabled={busy} onPress={() => void act(() => remove({ id: p.id }), "已删除")} />}
              </View>
            </View>
          ))}
          {!editing && <Button label="新建预设" variant="primary" theme={theme} disabled={busy} onPress={() => setEditing({ name: "", body: "" })} />}
          {editing && (
            <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 }}>
              <Text style={{ color: c.foreground, fontWeight: "600" }}>{editing.id ? "编辑预设" : "新建预设"}</Text>
              <TextInput value={editing.name} onChangeText={(name) => setEditing({ ...editing, name })} placeholder="名称" placeholderTextColor={c.foregroundMuted}
                style={{ color: c.foreground, borderWidth: 1, borderColor: c.border, borderRadius: 6, padding: 8, backgroundColor: c.surface0 }} />
              <TextInput value={editing.body} onChangeText={(body) => setEditing({ ...editing, body })} placeholder="归纳时的注重点，例如：重点看我在哪里浪费了时间" placeholderTextColor={c.foregroundMuted}
                multiline textAlignVertical="top"
                style={{ color: c.foreground, borderWidth: 1, borderColor: c.border, borderRadius: 6, padding: 8, minHeight: 120, backgroundColor: c.surface0 }} />
              {error ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{error}</Text> : null}
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Button label="保存" variant="primary" theme={theme} disabled={busy || !editing.name.trim() || !editing.body.trim()}
                  onPress={() => void act(() => save({ id: editing.id, name: editing.name.trim(), body: editing.body }), "已保存")} />
                <Button label="取消" theme={theme} disabled={busy} onPress={() => { setEditing(null); setError(""); }} />
              </View>
            </View>
          )}
        </View>
      </Modal.Content>
    </Modal>
  );
}
