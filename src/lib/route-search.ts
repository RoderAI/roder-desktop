import {
  createLoader,
  createParser,
  createStandardSchemaV1,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  type LoaderInput,
  type inferParserType,
} from "nuqs";

export const workspacePanelValues = ["terminal", "browser", "canvas", "extensions", "review"] as const;
export const pluginProviderValues = ["all", "anthropic", "cursor", "codex", "local"] as const;
export const reviewScopeValues = ["thread", "turn", "branch"] as const;

export type RouteWorkspacePanel = (typeof workspacePanelValues)[number];
export type RoutePluginProvider = (typeof pluginProviderValues)[number];
export type RouteReviewScope = (typeof reviewScopeValues)[number];

export const sidebarWidthBounds = {
  min: 220,
  defaultValue: 274,
  max: 420,
} as const;

export const toolPanelWidthBounds = {
  min: 360,
  defaultValue: 560,
  max: 1200,
} as const;

const parseAsWorkspacePanelTabs = createParser({
  parse(value) {
    return coerceWorkspacePanels(value);
  },
  serialize(value) {
    return coerceWorkspacePanels(value).join(",");
  },
});

export const routeSearchParsers = {
  panelTabs: parseAsWorkspacePanelTabs.withDefault([]),
  panelActive: parseAsStringLiteral(workspacePanelValues),
  panelOpen: parseAsBoolean.withDefault(false),
  reviewScope: parseAsStringLiteral(reviewScopeValues).withDefault("thread"),
  reviewTurnId: parseAsString.withDefault(""),
  reviewPath: parseAsString.withDefault(""),
  extension: parseAsString.withDefault(""),
  extensionPanel: parseAsString.withDefault(""),
  sidebar: parseAsBoolean.withDefault(true),
  // Legacy URL width values are accepted as first-load fallbacks; live resizing is locally persisted.
  leftWidth: parseAsClampedInteger(sidebarWidthBounds.min, sidebarWidthBounds.max).withDefault(
    sidebarWidthBounds.defaultValue,
  ),
  rightWidth: parseAsClampedInteger(toolPanelWidthBounds.min, toolPanelWidthBounds.max).withDefault(
    toolPanelWidthBounds.defaultValue,
  ),
  provider: parseAsStringLiteral(pluginProviderValues).withDefault("all"),
  q: parseAsString.withDefault(""),
  categories: parseAsArrayOf(parseAsString).withDefault([]),
};

export type RouteSearchState = inferParserType<typeof routeSearchParsers>;
export const validateRouteSearch = createStandardSchemaV1(routeSearchParsers, { partialOutput: true });

type RouteSearchPatch = Partial<{ [Key in keyof RouteSearchState]: RouteSearchState[Key] | null }>;
export type RouteSearchUpdate = RouteSearchPatch | ((current: RouteSearchState) => RouteSearchPatch | null) | null;

export function mergeRouteSearchUpdate(current: RouteSearchState, update: RouteSearchUpdate): RouteSearchPatch | null {
  if (update === null) {
    return null;
  }
  const patch = typeof update === "function" ? update(current) : update;
  if (patch === null) {
    return null;
  }
  const merged = { ...current, ...patch };
  return {
    ...merged,
    ...normalizeWorkspacePanelState(merged.panelTabs ?? [], merged.panelActive ?? null, merged.panelOpen ?? false),
  };
}

const loadRouteSearch = createLoader(routeSearchParsers);

export function normalizeRouteSearch(input: LoaderInput): RouteSearchState {
  const loaded = loadRouteSearch(input);
  const panelState = normalizeWorkspacePanelState(loaded.panelTabs, loaded.panelActive, loaded.panelOpen);
  return { ...loaded, ...panelState };
}

export function normalizeWorkspacePanelState(
  panelTabs: readonly RouteWorkspacePanel[],
  panelActive: RouteWorkspacePanel | null,
  panelOpen = false,
): Pick<RouteSearchState, "panelTabs" | "panelActive" | "panelOpen"> {
  const normalizedTabs = coerceWorkspacePanels(panelTabs);
  const normalizedActive =
    panelActive && normalizedTabs.includes(panelActive) ? panelActive : (normalizedTabs[0] ?? null);
  return {
    panelTabs: normalizedTabs,
    panelActive: normalizedActive,
    panelOpen,
  };
}

export function openWorkspacePanelShell(): Pick<RouteSearchState, "panelOpen"> {
  return { panelOpen: true };
}

export function closeWorkspacePanelShell(): Pick<RouteSearchState, "panelOpen"> {
  return { panelOpen: false };
}

export function openWorkspacePanelTab(
  current: Pick<RouteSearchState, "panelTabs">,
  panel: RouteWorkspacePanel,
): Pick<RouteSearchState, "panelTabs" | "panelActive" | "panelOpen"> {
  const panelTabs = coerceWorkspacePanels(current.panelTabs);
  return {
    panelTabs: panelTabs.includes(panel) ? panelTabs : [...panelTabs, panel],
    panelActive: panel,
    panelOpen: true,
  };
}

export function selectWorkspacePanelTab(
  current: Pick<RouteSearchState, "panelTabs">,
  panel: RouteWorkspacePanel,
): Pick<RouteSearchState, "panelActive"> | null {
  return coerceWorkspacePanels(current.panelTabs).includes(panel) ? { panelActive: panel } : null;
}

export function closeWorkspacePanelTab(
  current: Pick<RouteSearchState, "panelTabs" | "panelActive" | "panelOpen">,
  panel: RouteWorkspacePanel,
): Pick<RouteSearchState, "panelTabs" | "panelActive" | "panelOpen"> {
  const currentPanelTabs = coerceWorkspacePanels(current.panelTabs);
  const closingIndex = currentPanelTabs.indexOf(panel);
  if (closingIndex === -1) {
    return normalizeWorkspacePanelState(currentPanelTabs, current.panelActive, current.panelOpen);
  }
  const panelTabs = currentPanelTabs.filter((openPanel) => openPanel !== panel);
  if (current.panelActive !== panel) {
    return normalizeWorkspacePanelState(panelTabs, current.panelActive, current.panelOpen);
  }
  return {
    panelTabs,
    panelActive: panelTabs[closingIndex] ?? panelTabs[closingIndex - 1] ?? null,
    panelOpen: panelTabs.length > 0 && current.panelOpen,
  };
}

function parseAsClampedInteger(min: number, max: number) {
  return createParser({
    parse(value) {
      const parsed = parseAsInteger.parse(value);
      return parsed === null ? null : clamp(parsed, min, max);
    },
    serialize: (value) => String(clamp(value, min, max)),
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function uniqueWorkspacePanels(values: readonly RouteWorkspacePanel[] | string): RouteWorkspacePanel[] {
  const normalizedValues =
    typeof values === "string" ? values.split(",").filter(isRouteWorkspacePanel) : values.filter(isRouteWorkspacePanel);
  return normalizedValues.filter((value, index) => normalizedValues.indexOf(value) === index);
}

function coerceWorkspacePanels(value: unknown): RouteWorkspacePanel[] {
  if (typeof value === "string" || Array.isArray(value)) {
    return uniqueWorkspacePanels(value);
  }
  return [];
}

function isRouteWorkspacePanel(value: string): value is RouteWorkspacePanel {
  return workspacePanelValues.includes(value as RouteWorkspacePanel);
}
