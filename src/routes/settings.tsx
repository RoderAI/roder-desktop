import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { RouteFallback } from "@/components/route-fallback";

// Lazy so the settings shell + theme editor stay out of the initial chunk.
const SettingsPage = lazy(() => import("@/pages/settings/settings-page").then((m) => ({ default: m.SettingsPage })));

export const Route = createFileRoute("/settings")({
  component: SettingsIndexRoute,
});

export function SettingsIndexRoute(): React.JSX.Element {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname !== "/settings") {
    return <Outlet />;
  }
  return (
    <Suspense fallback={<RouteFallback />}>
      <SettingsPage section="general" />
    </Suspense>
  );
}
