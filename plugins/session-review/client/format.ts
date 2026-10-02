import { REVIEW_TIMEZONE } from "../shared/time";
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return new Intl.DateTimeFormat("en-GB", { timeZone: REVIEW_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export function fmtDate(iso: string | number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: REVIEW_TIMEZONE, month: "2-digit", day: "2-digit" }).formatToParts(d);
  return `${parts.find(p => p.type === "month")!.value}-${parts.find(p => p.type === "day")!.value}`;
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0分";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1分";
  if (minutes < 60) return `${minutes}分`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h}时${m}分` : `${h}时`;
}

export const KIND_LABELS: Record<string, string> = {
  question: "提问", interrupt: "打断", denied: "拒绝", memory: "记忆", "memory-index": "记忆索引",
};
export const PROVIDER_LABELS: Record<string, string> = { claude: "Claude", codex: "Codex" };
