import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Review } from "./review";

export function ReviewPanel({ theme, layout, host, workspaceId }: PluginWorkspacePanelProps) {
  return <Review theme={theme} compact={layout.compact} hostId={host.id} workspaceId={workspaceId} />;
}
