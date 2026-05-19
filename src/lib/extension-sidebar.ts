import type { ExtensionCatalogRecord } from "@/types/extensions";

export function getSidebarExtensions(extensions: ExtensionCatalogRecord[]): ExtensionCatalogRecord[] {
  return extensions.filter(hasSidebarRelevantContribution);
}

export function hasSidebarRelevantContribution(extension: ExtensionCatalogRecord): boolean {
  const contributions = extension.manifest.contributes;
  return (
    contributions.views.panels.some((panel) => Boolean(panel.html)) ||
    contributions.commands.length > 0 ||
    contributions.tools.length > 0
  );
}
