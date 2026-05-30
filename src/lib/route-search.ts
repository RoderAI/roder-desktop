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

export const toolPanelValues = ["terminal", "browser", "canvas", "extensions", "review"] as const;
export const pluginProviderValues = ["all", "anthropic", "cursor", "codex", "local"] as const;
export const reviewScopeValues = ["thread", "turn", "branch"] as const;

export type RouteToolPanel = (typeof toolPanelValues)[number];
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

export const routeSearchParsers = {
  tool: parseAsStringLiteral(toolPanelValues),
  reviewScope: parseAsStringLiteral(reviewScopeValues).withDefault("thread"),
  reviewTurnId: parseAsString.withDefault(""),
  reviewPath: parseAsString.withDefault(""),
  extension: parseAsString.withDefault(""),
  extensionPanel: parseAsString.withDefault(""),
  sidebar: parseAsBoolean.withDefault(true),
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
  return patch === null ? null : { ...current, ...patch };
}

const loadRouteSearch = createLoader(routeSearchParsers);

export function normalizeRouteSearch(input: LoaderInput): RouteSearchState {
  return loadRouteSearch(input);
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
