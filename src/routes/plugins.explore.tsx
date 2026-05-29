import { createFileRoute } from "@tanstack/react-router";
import { PluginsPage } from "@/pages/plugins/plugins-page";

export const Route = createFileRoute("/plugins/explore")({
  component: ExplorePluginsRoute,
});

function ExplorePluginsRoute(): React.JSX.Element {
  return <PluginsPage activeTab="explore" />;
}
