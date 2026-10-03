import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ExtractedSession } from "./sources/types.ts";

/** Bump when parsing rules change so stale extracts are rebuilt even if the source file is unchanged. */
export const EXTRACT_VERSION = 5;

export class Store {
  readonly dataDir: string;
  constructor(dataDir: string) { this.dataDir = dataDir; }

  get extractsDir() { return join(this.dataDir, "extracts"); }

  async init(): Promise<void> {
    await mkdir(this.extractsDir, { recursive: true, mode: 0o700 });
  }

  async readSnapshots(): Promise<unknown> {
    try { return JSON.parse(await readFile(join(this.dataDir, "snapshots.json"), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  async writeSnapshots(value: unknown): Promise<void> {
    await this.writeAtomic(join(this.dataDir, "snapshots.json"), JSON.stringify(value));
  }

  private async writeAtomic(path: string, content: string): Promise<void> {
    const tmp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, content, { encoding: "utf8", mode: 0o600 });
      await rename(tmp, path);
    } finally { await unlink(tmp).catch(() => {}); }
  }

  private extractPath(provider: string, id: string) { return join(this.extractsDir, `${provider}-${id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`); }

  async readExtract(provider: string, id: string, mtimeMs: number, size: number): Promise<ExtractedSession | null> {
    try {
      const raw = JSON.parse(await readFile(this.extractPath(provider, id), "utf8")) as { version?: number; mtimeMs: number; size: number; session: ExtractedSession };
      if (raw.version === EXTRACT_VERSION && raw.mtimeMs === mtimeMs && raw.size === size) return raw.session;
    } catch { /* miss */ }
    return null;
  }

  async writeExtract(session: ExtractedSession, mtimeMs: number, size: number): Promise<void> {
    await this.writeAtomic(this.extractPath(session.provider, session.id), JSON.stringify({ version: EXTRACT_VERSION, mtimeMs, size, session }));
  }

  async readExtractAny(provider: string, id: string): Promise<ExtractedSession | null> {
    try {
      const raw = JSON.parse(await readFile(this.extractPath(provider, id), "utf8")) as { version: number; session: ExtractedSession };
      return raw.version === EXTRACT_VERSION ? raw.session : null;
    } catch { return null; }
  }
}
