import { Puzzle } from "lucide-react";
import { useMemo, useState } from "react";
import { ExtensionsSettingsPanel } from "@/components/extensions/extensions-settings-panel";
import { ExtensionWebviewPanel } from "@/components/extensions/extension-webview-panel";
import { useExtensionsStore } from "@/stores/extensions-store";

export function ExtensionsPanel(): React.JSX.Element {
  const extensions = useExtensionsStore((state) => state.extensions);
  const panels = useMemo(
    () =>
      extensions.flatMap((extension) =>
        extension.manifest.contributes.views.panels
          .filter((panel) => panel.html)
          .map((panel) => ({
            extension,
            panel,
          })),
      ),
    [extensions],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = panels.find(({ extension, panel }) => panelKey(extension.id, panel.id) === selectedKey) ?? panels[0];

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-card">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 text-sm text-muted-foreground">
        <Puzzle className="size-4" />
        <span>Extensions</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {panels.length > 0 && (
          <section className="border-b border-border">
            <div className="flex items-center gap-2 overflow-x-auto px-3 py-2">
              {panels.map(({ extension, panel }) => {
                const key = panelKey(extension.id, panel.id);
                const active = selected && panelKey(selected.extension.id, selected.panel.id) === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`h-8 shrink-0 rounded-lg px-3 text-[12px] ${active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
                    onClick={() => setSelectedKey(key)}
                  >
                    {panel.title}
                  </button>
                );
              })}
            </div>
            {selected && (
              <div className="h-[360px] border-t border-border">
                <ExtensionWebviewPanel extensionId={selected.extension.id} panelId={selected.panel.id} title={selected.panel.title} />
              </div>
            )}
          </section>
        )}
        <ExtensionsSettingsPanel surface="sidebar" />
      </div>
    </div>
  );
}

function panelKey(extensionId: string, panelId: string): string {
  return `${extensionId}:${panelId}`;
}
