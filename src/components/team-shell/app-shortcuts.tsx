import { MonitorCog, PanelsTopLeft, Settings, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TeamAppId, TeamAppShortcut } from "@/lib/team-view-model";

type AppShortcutsProps = {
  shortcuts: TeamAppShortcut[];
  onOpenAppDrawer: (appId?: TeamAppId) => void;
};

const icons: Record<TeamAppId, React.ReactNode> = {
  terminal: <SquareTerminal className="size-4" />,
  browser: <PanelsTopLeft className="size-4" />,
  canvas: <MonitorCog className="size-4" />,
  settings: <Settings className="size-4" />,
};

export function AppShortcuts({ shortcuts, onOpenAppDrawer }: AppShortcutsProps): React.JSX.Element {
  return (
    <div className="team-scrollbar border-t border-border bg-card/50 px-4 py-2">
      <div className="mx-auto flex max-w-[1040px] flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Apps</span>
        {shortcuts.map((shortcut) => (
          <Button
            key={shortcut.id}
            variant="subtle"
            size="compact"
            className="h-8 gap-2 px-2.5 text-xs"
            title={shortcut.description}
            onClick={() => onOpenAppDrawer(shortcut.id)}
          >
            {icons[shortcut.id]}
            {shortcut.label}
            {shortcut.hotkey && <span className="text-[11px] text-muted-foreground">{shortcut.hotkey}</span>}
          </Button>
        ))}
      </div>
    </div>
  );
}
