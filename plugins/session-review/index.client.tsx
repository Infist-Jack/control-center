import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ReviewPanel } from "./client/panel";
import { ReviewSettingsScreen } from "./client/settings";
import { ReviewSurface } from "./client/surface";

export default function contribute(client: PluginClientContext) {
  const panel = client.addWorkspacePanel({ id: "review", title: "复盘", icon: "History", context: "workspace", Component: ReviewPanel });
  const surface = client.addSurface("review", ReviewSurface);
  const sidebar = client.addSidebarItem({ id: "review", title: "复盘", icon: "History", surface: "review" });
  const settings = client.addSettingsScreen({ id: "session-review", title: "复盘", icon: "History", Component: ReviewSettingsScreen });
  const command = client.addCommandCenterItem({
    id: "open-review", title: "打开会话复盘", icon: "History", context: "workspace",
    onSelect({ openPanel }) { openPanel("review"); },
  });
  return () => { command(); settings(); sidebar(); surface(); panel(); };
}
