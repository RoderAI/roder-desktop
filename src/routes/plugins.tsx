import { useEffect } from "react";
import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { defaultPluginsRoute } from "@/lib/route-selection";

export const Route = createFileRoute("/plugins")({
  component: PluginsRoute,
});

function PluginsRoute(): React.JSX.Element | null {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isPluginsIndex = pathname.replace(/\/+$/u, "") === "/plugins";

  useEffect(() => {
    if (isPluginsIndex) {
      void navigate({ to: defaultPluginsRoute(), replace: true, search: true });
    }
  }, [isPluginsIndex, navigate]);

  return isPluginsIndex ? null : <Outlet />;
}
