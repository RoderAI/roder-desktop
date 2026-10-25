import { createFileRoute } from "@tanstack/react-router";
import { PersistentAgentsPage } from "@/components/persistent-agents-page";
import { validatePersistentAgentsSearch } from "@/lib/persistent-agents-route-search";

export const Route = createFileRoute("/persistent-agents")({
  validateSearch: validatePersistentAgentsSearch,
  component: PersistentAgentsRoute,
});

function PersistentAgentsRoute() {
  const { create } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PersistentAgentsPage
      create={create}
      onCreateHandled={() => {
        void navigate({ search: (previous) => ({ ...previous, create: undefined }), replace: true });
      }}
    />
  );
}
