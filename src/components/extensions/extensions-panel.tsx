import { Puzzle } from "lucide-react";
import { ExtensionsSettingsPanel } from "@/components/extensions/extensions-settings-panel";

export function ExtensionsPanel(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-card">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 text-sm text-muted-foreground">
        <Puzzle className="size-4" />
        <span>Extensions</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ExtensionsSettingsPanel surface="sidebar" />
      </div>
    </div>
  );
}
