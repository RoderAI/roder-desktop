import type { ExtensionCatalogRecord } from "@/types/extensions";

export function getSidebarExtensions(extensions: ExtensionCatalogRecord[]): ExtensionCatalogRecord[] {
  return extensions.filter(hasSidebarRelevantContribution);
}

export function selectedSidebarExtensionId(
  extensions: ExtensionCatalogRecord[],
  requestedExtensionId: string | null | undefined,
): string | null {
  const sidebarExtensions = getSidebarExtensions(extensions);
  return (
    sidebarExtensions.find((extension) => extension.id === requestedExtensionId)?.id ?? sidebarExtensions[0]?.id ?? null
  );
}

export function hasSidebarRelevantContribution(extension: ExtensionCatalogRecord): boolean {
  const contributions = extension.manifest.contributes;
  return (
    contributions.views.panels.some((panel) => Boolean(panel.html)) ||
    contributions.commands.length > 0 ||
    contributions.tools.length > 0
  );
}
