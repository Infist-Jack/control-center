import { gzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { loadCatalog } from "../server/catalog.ts";
import { resolveHomes } from "../server/paths.ts";
import { runReview, sessionDetail } from "../server/review.ts";
import { redactDeep, redactText } from "../server/redact.ts";
import { Store } from "../server/store.ts";
import { scopeSchema, providerSchema } from "../shared/model.ts";

const homes = resolveHomes();
const transfers = join(homes.dataDir, "transfers");
const CHUNK = 12000;
function frame(value: unknown) {
  const data = gzipSync(JSON.stringify(value)).toString("base64");
  process.stdout.write(`SR_BEGIN\n${data.match(/.{1,60}/g)!.join("\n")}\nSR_END\n`);
}
async function main() {
  const input = JSON.parse(Buffer.from(process.argv[2], "base64").toString());
  if (input.action === "chunk" || input.action === "release") {
    if (!/^[a-f0-9-]{36}$/.test(input.token)) throw new Error("Invalid transfer token");
    const path = join(transfers, `${input.token}.b64`);
    if (input.action === "release") { await unlink(path).catch(() => {}); frame({ ok: true }); return; }
    if (!Number.isSafeInteger(input.offset) || input.offset < 0) throw new Error("Invalid transfer offset");
    const data = await readFile(path, "utf8");
    frame({ chunk: data.slice(input.offset, input.offset + CHUNK) }); return;
  }
  const store = new Store(homes.dataDir);
  await store.init();
  let value;
  if (input.action === "review") {
    const scope = scopeSchema.parse(input.scope);
    const bounds = input.bounds;
    if (!bounds || !Number.isFinite(Date.parse(bounds.from)) || !Number.isFinite(Date.parse(bounds.to))) throw new Error("Invalid review bounds");
    value = await runReview(scope, { homes, store, bounds }, () => {});
    const catalog = await loadCatalog(homes.paseoHome);
    value.projects = redactDeep(catalog.projects.filter(p => !p.archived).map(p => ({ id: p.id, name: p.name, rootPath: p.rootPath })));
  } else if (input.action === "detail") {
    const offset = input.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || typeof input.id !== "string") throw new Error("Invalid detail request");
    value = await sessionDetail(providerSchema.parse(input.provider), input.id, store, offset);
  } else throw new Error("Unknown collector action");
  const data = gzipSync(JSON.stringify({ value })).toString("base64");
  if (data.length <= CHUNK) { frame({ value }); return; }
  await mkdir(transfers, { recursive: true, mode: 0o700 });
  for (const name of await readdir(transfers)) {
    if (!/^[a-f0-9-]{36}\.b64$/.test(name)) continue;
    const path = join(transfers, name);
    if ((await stat(path).catch(() => null))?.mtimeMs! < Date.now() - 86400_000) await unlink(path).catch(() => {});
  }
  const token = randomUUID();
  await writeFile(join(transfers, `${token}.b64`), data, { mode: 0o600 });
  frame({ transfer: token, length: data.length, first: data.slice(0, CHUNK) });
}
void main().catch(error => { frame({ error: redactText(error instanceof Error ? error.message : String(error)) }); });
