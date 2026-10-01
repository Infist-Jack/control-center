export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0分";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1分";
  if (minutes < 60) return `${minutes}分`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h}时${m}分` : `${h}时`;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtTime(iso)}`;
}

export const KIND_LABELS: Record<string, string> = {
  question: "提问", interrupt: "打断", denied: "拒绝", memory: "记忆", "memory-index": "记忆索引",
};
export const OUTCOME_LABELS: Record<string, string> = {
  delivered: "交付", abandoned: "废弃", overturned: "被推翻", unfinished: "未完成",
};
export const PROVIDER_LABELS: Record<string, string> = { claude: "Claude", codex: "Codex" };
