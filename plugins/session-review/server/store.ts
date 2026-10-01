import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Preset, Summary } from "../shared/model.ts";
import type { ExtractedSession } from "./sources/types.ts";

export const BUILTIN_PRESET_ID = "builtin-general";
export const BUILTIN_PRESET_NAME = "通用复盘";
export const BUILTIN_PRESET_BODY = [
  "从时间使用的角度复盘这一天的 agent 会话。重点关注：",
  "1. 每个会话最初要做什么，最后落在了哪里；被后来的会话或决定推翻的，说明被什么推翻。",
  "2. 用户在哪些地方等待最久、在哪些地方打断或纠正了 agent，这些点说明了什么。",
  "3. 如果重来一次，顺序或做法上最值得改的一两件事。",
  "用中文，结论先行，不复述过程细节，不夸奖。",
].join("\n");

export class Store {
  readonly dataDir: string;
  constructor(dataDir: string) { this.dataDir = dataDir; }

  get extractsDir() { return join(this.dataDir, "extracts"); }
  get summariesDir() { return join(this.dataDir, "summaries"); }
  get promptsDir() { return join(this.dataDir, "prompts"); }
  get scratchDir() { return join(this.dataDir, "scratch"); }

  async init(): Promise<void> {
    for (const dir of [this.extractsDir, this.summariesDir, this.promptsDir, this.scratchDir]) await mkdir(dir, { recursive: true });
    await this.ensureBuiltinPreset();
  }

  private async writeAtomic(path: string, content: string): Promise<void> {
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, path);
  }

  // ---- extraction cache -------------------------------------------------
  private extractPath(provider: string, id: string) { return join(this.extractsDir, `${provider}-${id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`); }

  async readExtract(provider: string, id: string, mtimeMs: number, size: number): Promise<ExtractedSession | null> {
    try {
      const raw = JSON.parse(await readFile(this.extractPath(provider, id), "utf8")) as { mtimeMs: number; size: number; session: ExtractedSession };
      if (raw.mtimeMs === mtimeMs && raw.size === size) return raw.session;
    } catch { /* miss */ }
    return null;
  }

  async writeExtract(session: ExtractedSession, mtimeMs: number, size: number): Promise<void> {
    await this.writeAtomic(this.extractPath(session.provider, session.id), JSON.stringify({ mtimeMs, size, session }));
  }

  async readExtractAny(provider: string, id: string): Promise<ExtractedSession | null> {
    try {
      const raw = JSON.parse(await readFile(this.extractPath(provider, id), "utf8")) as { session: ExtractedSession };
      return raw.session;
    } catch { return null; }
  }

  // ---- summaries ----------------------------------------------------------
  async readSummary(key: string): Promise<{ summary: Summary; generatedAt: string } | null> {
    try { return JSON.parse(await readFile(join(this.summariesDir, `${key}.json`), "utf8")); } catch { return null; }
  }
  async writeSummary(key: string, summary: Summary): Promise<string> {
    const generatedAt = new Date().toISOString();
    await this.writeAtomic(join(this.summariesDir, `${key}.json`), JSON.stringify({ summary, generatedAt }));
    return generatedAt;
  }

  // ---- presets ------------------------------------------------------------
  private async readDefaultId(): Promise<string> {
    try { return (JSON.parse(await readFile(join(this.dataDir, "prompts.json"), "utf8")) as { defaultId?: string }).defaultId || BUILTIN_PRESET_ID; } catch { return BUILTIN_PRESET_ID; }
  }

  async ensureBuiltinPreset(): Promise<void> {
    const path = join(this.promptsDir, `${BUILTIN_PRESET_ID}.md`);
    try { await stat(path); } catch {
      await this.writeAtomic(path, serializePreset({ id: BUILTIN_PRESET_ID, name: BUILTIN_PRESET_NAME, body: BUILTIN_PRESET_BODY, builtin: true, isDefault: true }));
    }
  }

  async listPresets(): Promise<Preset[]> {
    const defaultId = await this.readDefaultId();
    let files: string[] = [];
    try { files = await readdir(this.promptsDir); } catch { files = []; }
    const presets: Preset[] = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const parsed = parsePreset(file.replace(/\.md$/, ""), await readFile(join(this.promptsDir, file), "utf8"));
      presets.push({ ...parsed, isDefault: parsed.id === defaultId });
    }
    if (!presets.some((p) => p.isDefault) && presets.length) presets[0].isDefault = true;
    return presets.sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name));
  }

  async getPreset(id: string): Promise<Preset | null> {
    return (await this.listPresets()).find((p) => p.id === id) ?? null;
  }

  async savePreset(input: { id?: string; name: string; body: string }): Promise<Preset> {
    const existing = input.id ? await this.getPreset(input.id) : null;
    if (existing?.builtin) throw new Error("内置预设不能修改，请先复制一份");
    const id = existing?.id ?? `p-${createHash("sha1").update(`${input.name}-${Date.now()}`).digest("hex").slice(0, 10)}`;
    const preset: Preset = { id, name: input.name.trim(), body: input.body, builtin: false, isDefault: existing?.isDefault ?? false };
    await this.writeAtomic(join(this.promptsDir, `${id}.md`), serializePreset(preset));
    return preset;
  }

  async deletePreset(id: string): Promise<void> {
    const preset = await this.getPreset(id);
    if (!preset) return;
    if (preset.builtin) throw new Error("内置预设不能删除");
    await rm(join(this.promptsDir, `${id}.md`), { force: true });
    if (preset.isDefault) await this.setDefaultPreset(BUILTIN_PRESET_ID);
  }

  async setDefaultPreset(id: string): Promise<void> {
    if (!(await this.getPreset(id))) throw new Error("预设不存在");
    await this.writeAtomic(join(this.dataDir, "prompts.json"), JSON.stringify({ defaultId: id }));
  }
}

export function serializePreset(preset: Preset): string {
  return `---\nname: ${preset.name.replace(/\n/g, " ")}\nbuiltin: ${preset.builtin}\n---\n${preset.body}\n`;
}

export function parsePreset(id: string, text: string): Omit<Preset, "isDefault"> {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const front = match ? match[1] : "";
  const body = (match ? match[2] : text).replace(/\n$/, "");
  const name = front.match(/^name:\s*(.*)$/m)?.[1]?.trim() || id;
  const builtin = /^builtin:\s*true/m.test(front);
  return { id, name, body, builtin };
}

export function hashKey(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
}
