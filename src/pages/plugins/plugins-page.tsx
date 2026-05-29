import { PluginsMarketplacePanel } from "@/components/plugins/plugins-marketplace-panel";
import type { PluginSection } from "@/lib/route-selection";

export function PluginsPage({ activeTab }: { activeTab: PluginSection }): React.JSX.Element {
  return <PluginsMarketplacePanel activeTab={activeTab} />;
}
