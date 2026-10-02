import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export async function* readJsonLines(path: string): AsyncGenerator<Record<string, unknown>> {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  input.on("error", error => lines.emit("error", error));
  try { for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object") yield value as Record<string, unknown>;
    } catch {
      // A truncated trailing line (file still being written) is not an error for review purposes.
    }
  } } finally { lines.close(); input.destroy(); }
}

export async function peekJsonLines(path: string, max: number): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for await (const value of readJsonLines(path)) {
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

export function textBlocks(content: unknown, types: string[]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object" && types.includes(String((b as Record<string, unknown>).type)))
    .map((b) => String(b.text ?? ""))
    .join("\n");
}
