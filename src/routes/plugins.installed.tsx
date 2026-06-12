import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { RouteFallback } from "@/components/route-fallback";

const PluginsPage = lazy(() => import("@/pages/plugins/plugins-page").then((m) => ({ default: m.PluginsPage })));

export const Route = createFileRoute("/plugins/installed")({
  component: InstalledPluginsRoute,
});

export function InstalledPluginsRoute(): React.JSX.Element {
  return (
    <Suspense fallback={<RouteFallback />}>
      <PluginsPage activeTab="installed" />
    </Suspense>
  );
}
