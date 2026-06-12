import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { RouteFallback } from "@/components/route-fallback";

// Lazy so the plugins marketplace stays out of the initial chunk.
const PluginsPage = lazy(() => import("@/pages/plugins/plugins-page").then((m) => ({ default: m.PluginsPage })));

export const Route = createFileRoute("/plugins/explore")({
  component: ExplorePluginsRoute,
});

export function ExplorePluginsRoute(): React.JSX.Element {
  return (
    <Suspense fallback={<RouteFallback />}>
      <PluginsPage activeTab="explore" />
    </Suspense>
  );
}
