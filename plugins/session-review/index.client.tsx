import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ReviewPanel } from "./client/panel";
import { ReviewSurface } from "./client/surface";

export default function contribute(client: PluginClientContext) {
  const panel = client.addWorkspacePanel({ id: "review", title: "复盘", icon: "History", context: "workspace", Component: ReviewPanel });
  const surface = client.addSurface("review", ReviewSurface);
  const sidebar = client.addSidebarItem({ id: "review", title: "复盘", icon: "History", surface: "review" });
  const command = client.addCommandCenterItem({
    id: "open-review", title: "打开会话复盘", icon: "History", context: "workspace",
    onSelect({ openPanel }) { openPanel("review"); },
  });
  return () => { command(); sidebar(); surface(); panel(); };
}
