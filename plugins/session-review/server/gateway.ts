import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { redactText } from "./redact.ts";

export interface NodeTarget { id: string; name: string }
export interface Workspace { workspaceId: string; name: string; cwd?: string; project?: string }
export interface Gateway {
  nodes(signal?: AbortSignal): Promise<NodeTarget[]>;
  workspaces(node: NodeTarget, signal?: AbortSignal): Promise<Workspace[]>;
  collect(node: NodeTarget, workspace: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
export function command(file: string, args: string[], signal?: AbortSignal, timeout = 65000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("任务已中断")); return; }
    const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "", stderr = "", failure = "";
    const stop = () => { if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} } };
    const abort = () => { failure = "任务已中断"; stop(); };
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { failure = "节点响应超时，请重试"; stop(); }, timeout);
    child.stdout.on("data", data => { stdout += data; if (stdout.length > 8 * 1024 * 1024) { failure = "节点输出超过安全传输上限"; stop(); } });
    child.stderr.on("data", data => { stderr = (stderr + data).slice(-4000); });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    child.on("error", error => { cleanup(); reject(error); });
    child.on("close", code => {
      cleanup();
      let detail = stderr.replace(/^\[node\].*$/gm, "").trim();
      try { const e = JSON.parse(stdout).error; if (e) detail = typeof e === "string" ? e : `${e.code ?? ""}: ${e.message ?? "节点命令失败"}`; } catch {}
      if (failure || code) reject(new Error(redactText(failure || detail || stdout.slice(-1200) || "节点命令失败")));
      else resolve(stdout);
    });
  });
}

export function parseFrame(output: string): any {
  const lines = output.split(/\r?\n/).map(s => s.trim());
  const first = lines.indexOf("SR_BEGIN"), last = lines.indexOf("SR_END", first + 1);
  if (first < 0 || last <= first) throw new Error("节点结果不完整，请重试");
  const data = lines.slice(first + 1, last).join("");
  return JSON.parse(gunzipSync(Buffer.from(data, "base64"), { maxOutputLength: 32 * 1024 * 1024 }).toString());
}

export class PaseoGateway implements Gateway {
  private nodeSh: string;
  private execSh: string;
  private bundle: string;
  private installed = new Map<string, Promise<string>>();
  constructor(root: string) {
    this.nodeSh = join(root, ".agents/skills/paseo-nodes-use/scripts/node.sh");
    this.execSh = join(root, ".agents/skills/paseo-nodes-use/scripts/exec.sh");
    this.bundle = join(root, "plugins/session-review/dist/collector.cjs");
  }
  async nodes(signal?: AbortSignal): Promise<NodeTarget[]> {
    const rows = await command(this.nodeSh, ["list"], signal);
    return rows.trim().split("\n").filter(Boolean).map(line => { const [name, id] = line.split("\t"); return { name, id }; });
  }
  async workspaces(node: NodeTarget, signal?: AbortSignal): Promise<Workspace[]> {
    return JSON.parse(await command(this.nodeSh, [node.name, "workspace", "ls", "--json"], signal));
  }
  private execute(node: NodeTarget, workspace: string, code: string, signal?: AbortSignal): Promise<string> {
    return command(this.execSh, [node.name, "--workspace", workspace, "--timeout", "300", "--", code], signal, 330000);
  }
  private async install(node: NodeTarget, workspace: string, signal?: AbortSignal): Promise<string> {
    const bytes = await readFile(this.bundle);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const pathCode = `require('node:path').join(process.env.PASEO_HOME||require('node:path').join(require('node:os').homedir(),'.paseo'),'session-review','collectors','${digest}.cjs')`;
    const probe = `const fs=require('node:fs'),crypto=require('node:crypto'),p=${pathCode};const b=require('node:zlib').gzipSync(JSON.stringify({path:p,exists:fs.existsSync(p)&&crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')==='${digest}'})).toString('base64');console.log('SR_BEGIN\\n'+b.match(/.{1,60}/g).join('\\n')+'\\nSR_END')`;
    const found = parseFrame(await this.execute(node, workspace, `node -e ${quote(probe)}`, signal));
    if (found.exists) return found.path;
    const uploaded = await command(this.nodeSh, [node.name, "sdk-upload", "--timeout", "120", "--", this.bundle], signal, 420000);
    const result = uploaded.split("\n").filter(Boolean).map(s => JSON.parse(s)).find(e => e.event === "result");
    if (!result || result.sha256 !== `sha256:${digest}`) throw new Error("采集程序上传校验失败");
    const parts = result.parts.map((p: any) => ({ path: p.path, sha256: p.sha256 }));
    // All shell content is quoted; input is only the verified upload metadata.
    const setup = `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const parts=${JSON.stringify(parts)};try{const data=Buffer.concat(parts.map(p=>{const b=fs.readFileSync(p.path);if('sha256:'+crypto.createHash('sha256').update(b).digest('hex')!==p.sha256)throw Error('Part checksum mismatch');return b}));if(crypto.createHash('sha256').update(data).digest('hex')!=='${digest}')throw Error('Collector checksum mismatch');const out=${pathCode};fs.mkdirSync(path.dirname(out),{recursive:true,mode:448});const tmp=out+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,data,{mode:384});fs.renameSync(tmp,out);}finally{for(const p of parts){const dir=path.dirname(p.path);if(path.basename(p.path).startsWith('nsm-')&&path.basename(dir).startsWith('upload_')&&path.basename(path.dirname(dir))==='uploads')fs.rmSync(dir,{recursive:true,force:true})}}`;
    await this.execute(node, workspace, `node -e ${quote(setup)}`, signal);
    return found.path;
  }
  async collect(node: NodeTarget, workspace: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    let ready = this.installed.get(node.id);
    if (!ready) { ready = this.install(node, workspace, signal); this.installed.set(node.id, ready); }
    let path: string;
    try { path = await ready; } catch (error) { this.installed.delete(node.id); throw error; }
    const invoke = async (request: Record<string, unknown>) => {
      const encoded = Buffer.from(JSON.stringify(request)).toString("base64");
      const frame = parseFrame(await this.execute(node, workspace, `node ${quote(path)} ${quote(encoded)}`, signal));
      if (frame.error) throw new Error(frame.error);
      return frame;
    };
    const result = await invoke(input);
    if (!result.transfer) return result.value;
    if (!Number.isSafeInteger(result.length) || result.length > 16 * 1024 * 1024 || typeof result.first !== "string") throw new Error("节点结果过大，请收窄范围");
    let encoded: string = result.first;
    try {
      while (encoded.length < result.length) {
        const { chunk } = await invoke({ action: "chunk", token: result.transfer, offset: encoded.length });
        if (typeof chunk !== "string" || !chunk.length) throw new Error("节点结果被截断");
        encoded += chunk;
      }
      return JSON.parse(gunzipSync(Buffer.from(encoded, "base64"), { maxOutputLength: 32 * 1024 * 1024 }).toString()).value;
    } finally { await invoke({ action: "release", token: result.transfer }).catch(() => {}); }
  }
}
