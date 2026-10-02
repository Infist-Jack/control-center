import type { PluginTheme } from "@getpaseo/plugin";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

export type Tone = "accent" | "muted" | "warning" | "danger" | "success";

function toneColors(theme: PluginTheme, tone: Tone): { bg: string; fg: string } {
  const c = theme.colors;
  switch (tone) {
    case "accent": return { bg: c.accent, fg: c.accentForeground };
    case "warning": return { bg: c.statusWarning, fg: c.surface0 };
    case "danger": return { bg: c.statusDanger, fg: c.surface0 };
    case "success": return { bg: c.statusSuccess, fg: c.surface0 };
    default: return { bg: c.surface2, fg: c.foregroundMuted };
  }
}

export function Pill({ label, theme, tone = "muted" }: { label: string; theme: PluginTheme; tone?: Tone }) {
  const { bg, fg } = toneColors(theme, tone);
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" }}>
      <Text style={{ color: fg, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

export function Button({ label, onPress, theme, variant = "ghost", disabled = false }: {
  label: string; onPress: () => void; theme: PluginTheme; variant?: "primary" | "ghost" | "danger"; disabled?: boolean;
}) {
  const c = theme.colors;
  const bg = variant === "primary" ? c.accent : variant === "danger" ? c.statusDanger : c.surface1;
  const fg = variant === "primary" ? c.accentForeground : variant === "danger" ? c.surface0 : c.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{ backgroundColor: bg, opacity: disabled ? 0.5 : 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, borderWidth: variant === "ghost" ? 1 : 0, borderColor: c.border }}
    >
      <Text style={{ color: fg, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function Choice<Value extends string>({ value, options, onChange, theme }: {
  value: Value | null; options: ReadonlyArray<{ label: string; value: Value; disabled?: boolean }>; onChange: (value: Value) => void; theme: PluginTheme;
}) {
  const c = theme.colors;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active, disabled: option.disabled }}
            disabled={option.disabled}
            onPress={() => onChange(option.value)}
            style={{ backgroundColor: active ? c.accent : c.surface1, opacity: option.disabled ? 0.4 : 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: active ? c.accent : c.border }}
          >
            <Text style={{ color: active ? c.accentForeground : c.foreground, fontSize: 12 }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SectionTitle({ children, theme, trailing }: { children: ReactNode; theme: PluginTheme; trailing?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 15, fontWeight: "600" }}>{children}</Text>
      {trailing}
    </View>
  );
}

export function Muted({ children, theme, size = 12 }: { children: ReactNode; theme: PluginTheme; size?: number }) {
  return <Text style={{ color: theme.colors.foregroundMuted, fontSize: size }}>{children}</Text>;
}
