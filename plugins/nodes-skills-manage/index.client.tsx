import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Skills } from "./client/skills";

export default function contribute(client: PluginClientContext) {
  const surface = client.addSurface("main", Skills);
  const sidebar = client.addSidebarItem({id: "main", title: "公共 Skills", icon: "Library", surface: "main"});
  return () => { sidebar(); surface(); };
}
