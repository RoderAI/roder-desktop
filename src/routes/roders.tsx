import { createFileRoute } from "@tanstack/react-router";
import { RoderAgentsPage } from "@/components/roder-agents-page";
import { validateRoderAgentsSearch } from "@/lib/roder-agents-route-search";

export const Route = createFileRoute("/roders")({
  validateSearch: validateRoderAgentsSearch,
  component: RoderAgentsRoute,
});

function RoderAgentsRoute() {
  const { create } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <RoderAgentsPage
      create={create}
      onCreateHandled={() => {
        void navigate({ search: (previous) => ({ ...previous, create: undefined }), replace: true });
      }}
    />
  );
}
