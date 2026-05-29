import { useNavigate } from "@tanstack/react-router";
import { useAppShell } from "@/components/app-shell-context";
import { SettingsView } from "@/components/settings-view";
import type { SettingsSection } from "@/stores/theme-store";

export function SettingsPage({ section }: { section: SettingsSection }): React.JSX.Element {
  const {
    agent: { activeThreadId },
  } = useAppShell();
  const navigate = useNavigate();

  function closeSettings(): void {
    if (activeThreadId) {
      void navigate({ to: "/threads/$threadId", params: { threadId: activeThreadId }, search: true });
      return;
    }
    void navigate({ to: "/new", search: true });
  }

  return (
    <SettingsView
      section={section}
      onClose={closeSettings}
      onSectionChange={(nextSection) =>
        void navigate({ to: "/settings/$section", params: { section: nextSection }, search: true })
      }
    />
  );
}
