import { createFileRoute } from "@tanstack/react-router";
import { PluginsPage } from "@/pages/plugins/plugins-page";

export const Route = createFileRoute("/plugins/installed")({
  component: InstalledPluginsRoute,
});

function InstalledPluginsRoute(): React.JSX.Element {
  return <PluginsPage activeTab="installed" />;
}
