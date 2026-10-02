// Redaction runs before anything is written to disk or handed to a runtime.
const MASK = "[已打码]";

const patterns: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g,
  /([?&](?:token|key|secret|password|pwd|access_token|api_key|apikey)=)[^&\s"']+/gi,
  /(["']?\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)\b["']?\s*[=:]\s*["']?)[^\s"'&,}]+/gi,
  /(\w+:\/\/)([^:/\s@]+):([^@/\s]+)@/g,
];

function redactUrlSegments(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>)\]]+/g, (url) =>
    url.replace(/(?<=\/)[A-Za-z0-9_-]{24,}(?=\/|\?|#|$)/g, MASK),
  );
}

export function redactText(text: string): string {
  let out = text;
  for (const pattern of patterns) {
    out = out.replace(pattern, (...args: unknown[]) => {
      // args: match, ...captureGroups, offset, input[, namedGroups]
      const tail = typeof args[args.length - 1] === "object" ? 3 : 2;
      const groups = args.slice(1, args.length - tail) as Array<string | undefined>;
      const keep = groups[0];
      if (keep === undefined) return MASK;
      if (pattern.source.startsWith("(\\w+:\\/\\/)")) return `${keep}${MASK}@`;
      return `${keep}${MASK}`;
    });
  }
  return redactUrlSegments(out);
}

export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v);
    return out as T;
  }
  return value;
}
