import { createFileRoute } from "@tanstack/react-router";
import { normalizeSettingsSectionParam } from "@/lib/route-selection";
import { SettingsPage } from "@/pages/settings/settings-page";

export const Route = createFileRoute("/settings/$section")({
  component: SettingsRoute,
});

function SettingsRoute(): React.JSX.Element {
  const { section } = Route.useParams();
  return <SettingsPage section={normalizeSettingsSectionParam(section)} />;
}
