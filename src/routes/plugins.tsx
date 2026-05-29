import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { defaultPluginsRoute } from "@/lib/route-selection";

export const Route = createFileRoute("/plugins")({
  beforeLoad: ({ location }) => {
    if (location.pathname.replace(/\/+$/u, "") === "/plugins") {
      throw redirect({ to: defaultPluginsRoute(), replace: true, search: true });
    }
  },
  component: PluginsRoute,
});

function PluginsRoute(): React.JSX.Element {
  return <Outlet />;
}
