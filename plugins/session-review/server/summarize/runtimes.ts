import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeId, RuntimeInfo } from "../../shared/model.ts";

const BINARIES: Record<RuntimeId, string> = { claude: "claude", codex: "codex", opencode: "opencode" };
const TIMEOUT_MS = 10 * 60_000;

function run(cmd: string, args: string[], opts: { cwd: string; input?: string; timeoutMs: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv }):
  Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...opts.env } });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); stderr += "\n[超时，已终止]"; }, opts.timeoutMs);
    const onAbort = () => child.kill("SIGTERM");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr = (stderr + d.toString()).slice(-8000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); opts.signal?.removeEventListener("abort", onAbort); resolve({ code, stdout, stderr }); });
    child.stdin.on("error", () => {});
    if (opts.input !== undefined) child.stdin.end(opts.input); else child.stdin.end();
  });
}

export async function detectRuntimes(): Promise<RuntimeInfo[]> {
  const out: RuntimeInfo[] = [];
  for (const id of Object.keys(BINARIES) as RuntimeId[]) {
    try {
      const result = await run(BINARIES[id], ["--version"], { cwd: process.cwd(), timeoutMs: 8_000 });
      const version = (result.stdout || result.stderr).trim().split("\n")[0].slice(0, 60);
      out.push({ id, available: result.code === 0, version: result.code === 0 ? version : null });
    } catch {
      out.push({ id, available: false, version: null });
    }
  }
  return out;
}

export interface RuntimeRunResult { json: unknown; stderrTail: string }

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const start = trimmed.indexOf("{"), end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error("runtime 没有返回 JSON");
}

/** Runs one headless summarisation call. Reuses the machine's existing CLI login; no API keys are read here. */
export async function runRuntime(id: RuntimeId, prompt: string, jsonSchema: Record<string, unknown>, scratchDir: string, signal?: AbortSignal): Promise<RuntimeRunResult> {
  const work = await mkdtemp(join(scratchDir, `${id}-`));
  try {
    if (id === "claude") {
      const args = [
        "-p", "--output-format", "json", "--json-schema", JSON.stringify(jsonSchema),
        "--permission-prompts", "none", "--no-session-persistence",
        "--disallowedTools", "Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "Agent", "Skill", "ToolSearch",
      ];
      const result = await run("claude", args, { cwd: work, input: prompt, timeoutMs: TIMEOUT_MS, signal });
      if (result.code !== 0) throw new Error(`claude 退出码 ${result.code}: ${result.stderr.slice(-600) || result.stdout.slice(-600)}`);
      const envelope = extractJson(result.stdout) as Record<string, unknown>;
      if (envelope.is_error) throw new Error(String(envelope.result ?? "claude 返回错误"));
      const structured = envelope.structured_output ?? envelope.structuredOutput;
      return { json: structured ?? extractJson(String(envelope.result ?? "")), stderrTail: result.stderr.slice(-4000) };
    }
    if (id === "codex") {
      const schemaFile = join(work, "schema.json"), outFile = join(work, "out.json");
      await writeFile(schemaFile, JSON.stringify(jsonSchema), "utf8");
      const args = ["exec", "--json", "--output-schema", schemaFile, "-o", outFile, "--ephemeral", "-s", "read-only", "--skip-git-repo-check", "-C", work, "-"];
      const result = await run("codex", args, { cwd: work, input: prompt, timeoutMs: TIMEOUT_MS, signal });
      let last = "";
      try { last = await readFile(outFile, "utf8"); } catch { /* fall back to stdout */ }
      if (!last.trim()) {
        if (result.code !== 0) throw new Error(`codex 退出码 ${result.code}: ${result.stderr.slice(-600)}`);
        last = result.stdout;
      }
      return { json: extractJson(last), stderrTail: result.stderr.slice(-4000) };
    }
    // opencode: best effort; the binary was not available on the development machine, so this path is unverified.
    const result = await run("opencode", ["run", "--format", "json", prompt], { cwd: work, timeoutMs: TIMEOUT_MS, signal });
    if (result.code !== 0) throw new Error(`opencode 退出码 ${result.code}: ${result.stderr.slice(-600)}`);
    return { json: extractJson(result.stdout), stderrTail: result.stderr.slice(-4000) };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
