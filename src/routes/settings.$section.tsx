import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { RouteFallback } from "@/components/route-fallback";
import { normalizeSettingsSectionParam } from "@/lib/route-selection";

const SettingsPage = lazy(() => import("@/pages/settings/settings-page").then((m) => ({ default: m.SettingsPage })));

export const Route = createFileRoute("/settings/$section")({
  component: SettingsRoute,
});

export function SettingsRoute(): React.JSX.Element {
  const { section } = Route.useParams();
  return (
    <Suspense fallback={<RouteFallback />}>
      <SettingsPage section={normalizeSettingsSectionParam(section)} />
    </Suspense>
  );
}
