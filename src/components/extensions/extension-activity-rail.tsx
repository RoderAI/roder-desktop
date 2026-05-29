import { Settings } from "lucide-react";
import { getSidebarExtensions, selectedSidebarExtensionId } from "@/lib/extension-sidebar";
import { useExtensionsStore } from "@/stores/extensions-store";
import type { ExtensionCatalogRecord } from "@/types/extensions";
import { cn } from "@/lib/utils";

type ExtensionActivityRailProps = {
  active: boolean;
  activeExtensionId?: string | null;
  onSelectExtension: (extensionId: string) => void;
  onOpenSettings: () => void;
};

export function ExtensionActivityRail({
  active,
  activeExtensionId,
  onSelectExtension,
  onOpenSettings,
}: ExtensionActivityRailProps): React.JSX.Element | null {
  const extensions = useExtensionsStore((state) => state.extensions);
  const sidebarExtensions = getSidebarExtensions(extensions);
  const effectiveActiveExtensionId = selectedSidebarExtensionId(extensions, activeExtensionId);

  if (sidebarExtensions.length === 0) {
    return null;
  }

  return (
    <aside className="no-drag flex h-full w-12 shrink-0 flex-col items-center border-l border-border bg-sidebar py-2 text-sidebar-foreground">
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto sidebar-scroll">
        {sidebarExtensions.map((extension) => {
          const selected = active && extension.id === effectiveActiveExtensionId;
          return (
            <button
              key={extension.id}
              type="button"
              className={cn(
                "relative grid size-9 place-items-center rounded-lg text-base font-semibold uppercase text-sidebar-muted outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring",
                selected && "bg-sidebar-active text-sidebar-active-foreground",
              )}
              aria-label={`Open ${extension.manifest.displayName}`}
              title={extension.manifest.displayName}
              onClick={() => onSelectExtension(extension.id)}
            >
              {extensionInitial(extension)}
              <span
                className={cn(
                  "absolute bottom-1 right-1 size-1.5 rounded-full",
                  !extension.enabled
                    ? "bg-muted-foreground/40"
                    : extension.activationState === "failed"
                      ? "bg-destructive"
                      : extension.activationState === "active"
                        ? "bg-primary"
                        : "bg-muted-foreground/70",
                )}
                aria-hidden="true"
              />
              {selected && (
                <span
                  className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="mt-2 grid size-9 place-items-center rounded-lg text-sidebar-muted outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Open extension settings"
        title="Extension settings"
        onClick={onOpenSettings}
      >
        <Settings className="size-4" />
      </button>
    </aside>
  );
}

function extensionInitial(extension: ExtensionCatalogRecord): string {
  const source = extension.manifest.displayName || extension.manifest.name || extension.id;
  return source.trim().slice(0, 1) || "E";
}
