import { homedir } from "node:os";
import { join } from "node:path";

export interface Homes {
  paseoHome: string;
  claudeHome: string;
  codexHome: string;
  dataDir: string;
}

export function resolveHomes(env: NodeJS.ProcessEnv = process.env): Homes {
  const home = homedir();
  const paseoHome = env.PASEO_HOME || join(home, ".paseo");
  return {
    paseoHome,
    claudeHome: env.CLAUDE_CONFIG_DIR || join(home, ".claude"),
    codexHome: env.CODEX_HOME || join(home, ".codex"),
    dataDir: join(paseoHome, "session-review"),
  };
}

export function isUnder(path: string, root: string): boolean {
  if (!root) return false;
  const normalizedRoot = root.endsWith("/") ? root : root + "/";
  return path === root || path.startsWith(normalizedRoot);
}
