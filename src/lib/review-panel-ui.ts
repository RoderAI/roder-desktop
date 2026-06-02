import type { VcsChangeStatus } from "@/types/roder";

export type ReviewFileSectionBounds = {
  path: string;
  top: number;
  bottom: number;
};

export type ReviewViewportBounds = {
  top: number;
  bottom: number;
};

export type ReviewDiffLoadState = {
  status: "idle" | "loading" | "ready" | "error";
};

export type ReviewDiffLoadPlan = {
  files: string[];
  selectedPath: string;
  nearbyPaths: Iterable<string>;
  diffStatesByPath: Record<string, ReviewDiffLoadState | undefined>;
};

export function reviewChangedFilesText(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"} changed`;
}

export function reviewFileTreeToggleLabel(visible: boolean): string {
  return visible ? "Hide changed files" : "Show changed files";
}

export const reviewFileTreeWidthBounds = {
  min: 180,
  defaultValue: 240,
  max: 360,
  minDiffWidth: 220,
} as const;

export function reviewFileTreeWidth(value: number, panelWidth = Number.POSITIVE_INFINITY): number {
  const maxForPanel = Number.isFinite(panelWidth)
    ? Math.max(
        reviewFileTreeWidthBounds.min,
        Math.min(reviewFileTreeWidthBounds.max, panelWidth - reviewFileTreeWidthBounds.minDiffWidth),
      )
    : reviewFileTreeWidthBounds.max;
  return Math.min(maxForPanel, Math.max(reviewFileTreeWidthBounds.min, value));
}

export function reviewFileTreeStatusLabel(status: VcsChangeStatus): string | null {
  if (status === "modified") {
    return null;
  }
  if (status === "untracked") {
    return "new";
  }
  if (status === "provider_native") {
    return "provider";
  }
  return status;
}

export function reviewLatestSelectedFilePath(
  selectedPaths: readonly string[],
  filePaths: Iterable<string>,
  fallbackPath = "",
): string {
  const filePathSet = new Set(filePaths);
  let latestSelectedFilePath = "";
  for (const path of selectedPaths) {
    if (filePathSet.has(path)) {
      latestSelectedFilePath = path;
    }
  }
  if (latestSelectedFilePath) {
    return latestSelectedFilePath;
  }
  return fallbackPath && filePathSet.has(fallbackPath) ? fallbackPath : "";
}

export function reviewActiveFilePath(
  sections: ReviewFileSectionBounds[],
  viewport: ReviewViewportBounds,
  fallbackPath = "",
): string {
  if (sections.length === 0 || viewport.bottom <= viewport.top) {
    return fallbackPath;
  }

  const viewportHeight = viewport.bottom - viewport.top;
  const anchorOffset = Math.min(Math.max(viewportHeight * 0.25, 48), viewportHeight * 0.5);
  const anchor = viewport.top + anchorOffset;
  const anchoredSection = sections.find((section) => section.top <= anchor && section.bottom > anchor);
  if (anchoredSection) {
    return anchoredSection.path;
  }

  let mostVisiblePath = fallbackPath;
  let mostVisiblePixels = 0;
  for (const section of sections) {
    const visibleTop = Math.max(section.top, viewport.top);
    const visibleBottom = Math.min(section.bottom, viewport.bottom);
    const visiblePixels = Math.max(0, visibleBottom - visibleTop);
    if (visiblePixels > mostVisiblePixels) {
      mostVisiblePath = section.path;
      mostVisiblePixels = visiblePixels;
    }
  }

  return mostVisiblePath;
}

export function reviewDiffPathsToLoad({
  files,
  selectedPath,
  nearbyPaths,
  diffStatesByPath,
}: ReviewDiffLoadPlan): string[] {
  const fileSet = new Set(files);
  const candidates = new Set<string>();
  if (selectedPath) {
    candidates.add(selectedPath);
  }
  for (const path of nearbyPaths) {
    candidates.add(path);
  }
  const unloadedPaths = files.filter((path) => {
    const state = diffStatesByPath[path];
    return fileSet.has(path) && candidates.has(path) && (!state || state.status === "idle");
  });
  if (!selectedPath || !unloadedPaths.includes(selectedPath)) {
    return unloadedPaths;
  }
  return [selectedPath, ...unloadedPaths.filter((path) => path !== selectedPath)];
}
