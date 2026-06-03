import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { SettingsPage } from "@/pages/settings/settings-page";

export const Route = createFileRoute("/settings")({
  component: SettingsIndexRoute,
});

export function SettingsIndexRoute(): React.JSX.Element {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname !== "/settings") {
    return <Outlet />;
  }
  return <SettingsPage section="general" />;
}
