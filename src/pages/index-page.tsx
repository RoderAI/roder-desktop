import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAppShell } from "@/components/app-shell-context";
import { defaultRouteForHydratedState } from "@/lib/route-selection";

export function IndexPage(): React.JSX.Element | null {
  const {
    agent: { activeThreadId, hydrated },
  } = useAppShell();
  const navigate = useNavigate();

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    void navigate({ to: defaultRouteForHydratedState({ activeThreadId }), replace: true, search: true });
  }, [activeThreadId, hydrated, navigate]);

  return null;
}
