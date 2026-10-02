import { randomUUID } from "node:crypto";
import type { Progress } from "../shared/model.ts";

export interface Job<T> {
  id: string;
  key: string;
  status: "running" | "succeeded" | "failed";
  progress: Progress;
  result?: T;
  error?: string;
  extra?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  abort: AbortController;
}

const TTL_MS = 60 * 60_000;
const KEEP = 50;

export class Jobs<T> {
  private entries = new Map<string, Job<T>>();
  private disposed = false;

  get(id: string): Job<T> | undefined { return this.entries.get(id); }

  /** Returns the running job for `key` if one exists, otherwise starts `run`. */
  start(key: string, run: (job: Job<T>, report: (progress: Progress) => void) => Promise<T>): Job<T> {
    if (this.disposed) throw new Error("插件正在停止，请重新连接");
    this.sweep();
    const running = [...this.entries.values()].find((j) => j.key === key && j.status === "running");
    if (running) return running;
    const now = Date.now();
    const job: Job<T> = { id: randomUUID(), key, status: "running", progress: { phase: "准备", done: 0, total: 0 }, createdAt: now, updatedAt: now, abort: new AbortController() };
    this.entries.set(job.id, job);
    void run(job, (progress) => { job.progress = progress; job.updatedAt = Date.now(); })
      .then((result) => { job.result = result; job.status = "succeeded"; })
      .catch((error) => { job.status = "failed"; job.error = error instanceof Error ? error.message : String(error); })
      .finally(() => { job.updatedAt = Date.now(); });
    return job;
  }

  private sweep(): void {
    const finished = [...this.entries.values()].filter((j) => j.status !== "running").sort((a, b) => a.updatedAt - b.updatedAt);
    for (const [index, job] of finished.entries()) {
      if (Date.now() - job.updatedAt > TTL_MS || index < finished.length - KEEP) this.entries.delete(job.id);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const job of this.entries.values()) job.abort.abort();
  }
}
