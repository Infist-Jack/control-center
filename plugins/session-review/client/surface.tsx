import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Review } from "./review";

export function ReviewSurface({ theme, layout, host }: PluginSurfaceProps) {
  return <Review theme={theme} compact={layout.compact} hostId={host.id} workspaceId={null} />;
}
