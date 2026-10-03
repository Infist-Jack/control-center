import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ReviewSettings } from "../shared/settings.ts";
import { isValidTimezone, localTimezone } from "../shared/time.ts";

/** node.sh's own default, so a control node keeps working with no settings at all. */
export const DEFAULT_NODES_DIR = "/home/ubuntu/paseo-deployment";
export const REGISTRY_FILE = "relay-allowed-hosts.json";

export interface ResolvedConfig {
  controlCenterDir: string;
  nodesDir: string;
  /** The user or environment named the directory, so a missing registry is reported instead of silently ignored. */
  nodesDirExplicit: boolean;
  timezone: string;
  warnings: string[];
}

export function resolveConfig(values: Partial<ReviewSettings> | undefined, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const warnings: string[] = [];
  const pick = (value: string | undefined) => value?.trim() || undefined;
  const controlCenterDir = pick(values?.controlCenterDir) ?? pick(env.SR_CONTROL_CENTER) ?? join(homedir(), "control-center");
  const configuredNodes = pick(values?.nodesDir) ?? pick(env.PASEO_DEPLOY_DIR);
  let timezone = pick(values?.timezone) ?? pick(env.SR_TIMEZONE) ?? localTimezone();
  if (!isValidTimezone(timezone)) { warnings.push(`时区「${timezone}」无效，已改用本机时区 ${localTimezone()}`); timezone = localTimezone(); }
  return { controlCenterDir, nodesDir: configuredNodes ?? DEFAULT_NODES_DIR, nodesDirExplicit: !!configuredNodes, timezone, warnings };
}

export const registryPath = (config: Pick<ResolvedConfig, "nodesDir">) => join(config.nodesDir, REGISTRY_FILE);

export async function readable(path: string): Promise<boolean> {
  try { await access(path, constants.R_OK); return true; } catch { return false; }
}
