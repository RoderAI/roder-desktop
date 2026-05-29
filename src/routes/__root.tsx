import { createRootRoute } from "@tanstack/react-router";
import { NuqsAdapter } from "nuqs/adapters/tanstack-router";
import { App } from "@/App";
import { validateRouteSearch } from "@/lib/route-search";

export const Route = createRootRoute({
  validateSearch: validateRouteSearch,
  component: RootRoute,
});

function RootRoute(): React.JSX.Element {
  return (
    <NuqsAdapter
      defaultOptions={{
        scroll: false,
      }}
    >
      <App />
    </NuqsAdapter>
  );
}
