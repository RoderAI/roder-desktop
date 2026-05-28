import { expect, test } from "vitest";
import * as marketplaceModule from "../src/lib/plugins-marketplace";

const baseHints = {
  skills: false,
  commands: false,
  agents: false,
  mcpServers: false,
  hooks: false,
  apps: false,
  lspServers: false,
  rules: false,
  assets: false,
};

test("selects the recommended marketplace plugin variant by variant key", () => {
  const { recommendedVariant, pluginVariantKey } = marketplaceModule;
  const plugin = {
    displayName: "Repo Tools",
    identityKey: { canonicalSlug: "repo-tools", normalizedName: "repo-tools" },
    variants: [
      variant("claude-plugins-official", "repo-tools-claude"),
      variant("cursor-plugins", "repo-tools"),
    ],
    relatedCandidates: [],
    recommendedVariantKey: "cursor-plugins:repo-tools",
    installedVariants: [],
  };

  const selected = recommendedVariant(plugin);

  expect(pluginVariantKey(selected)).toBe("cursor-plugins:repo-tools");
});

test("merges installed variants from search rows and installed plugin records", () => {
  const { installedVariantSet } = marketplaceModule;
  const plugin = {
    displayName: "Repo Tools",
    identityKey: { canonicalSlug: "repo-tools", normalizedName: "repo-tools" },
    variants: [variant("cursor-plugins", "repo-tools")],
    relatedCandidates: [],
    installedVariants: ["cursor-plugins:repo-tools"],
  };
  const installed = [
    {
      marketplaceId: "claude-plugins-official",
      pluginId: "repo-tools-claude",
      identityKey: { canonicalSlug: "repo-tools", normalizedName: "repo-tools" },
      variantKey: "claude-plugins-official:repo-tools-claude",
      installPath: "/tmp/repo-tools",
      state: "installed",
      installedAt: "2026-05-18T20:00:00Z",
    },
  ];

  const keys = installedVariantSet(plugin, installed);

  expect(keys.has("cursor-plugins:repo-tools")).toBe(true);
  expect(keys.has("claude-plugins-official:repo-tools-claude")).toBe(true);
});

test("derives plugin row install status from installed plugin records", () => {
  const { pluginInstallStatus } = marketplaceModule;
  const staleSearchPlugin = {
    displayName: "Repo Tools",
    identityKey: { canonicalSlug: "repo-tools", normalizedName: "repo-tools" },
    variants: [variant("cursor-plugins", "repo-tools")],
    relatedCandidates: [],
    recommendedVariantKey: "cursor-plugins:repo-tools",
    installedVariants: [],
  };
  const installed = [
    {
      marketplaceId: "cursor-plugins",
      pluginId: "repo-tools",
      identityKey: { canonicalSlug: "repo-tools", normalizedName: "repo-tools" },
      variantKey: "cursor-plugins:repo-tools",
      installPath: "/tmp/repo-tools",
      state: "installed",
      installedAt: "2026-05-18T20:00:00Z",
    },
  ];

  const status = pluginInstallStatus(staleSearchPlugin, staleSearchPlugin.variants[0], installed);

  expect(status.pluginInstalled).toBe(true);
  expect(status.variantInstalled).toBe(true);
  expect(status.variantKey).toBe("cursor-plugins:repo-tools");
});

test("ignores installed plugin records for unrelated plugin rows", () => {
  const { pluginInstallStatus } = marketplaceModule;
  const plugin = {
    displayName: "Repo Tools",
    identityKey: { canonicalSlug: "repo-tools", normalizedName: "repo-tools" },
    variants: [variant("cursor-plugins", "repo-tools")],
    relatedCandidates: [],
    recommendedVariantKey: "cursor-plugins:repo-tools",
    installedVariants: [],
  };
  const installed = [
    {
      marketplaceId: "cursor-plugins",
      pluginId: "theme-tools",
      identityKey: { canonicalSlug: "theme-tools", normalizedName: "theme-tools" },
      variantKey: "cursor-plugins:theme-tools",
      installPath: "/tmp/theme-tools",
      state: "installed",
      installedAt: "2026-05-18T20:00:00Z",
    },
  ];

  const status = pluginInstallStatus(plugin, plugin.variants[0], installed);

  expect(status.pluginInstalled).toBe(false);
  expect(status.variantInstalled).toBe(false);
});

test("prepares installed plugin records for the installed tab", () => {
  const { visibleInstalledPlugins } = marketplaceModule;
  const installed = [
    installedRecord("cursor-plugins", "zeta-tools", "zeta-tools", { state: "disabled" }),
    installedRecord("cursor-plugins", "alpha-tools", "alpha-tools"),
    installedRecord("cursor-plugins", "old-tools", "old-tools", { state: "uninstalled" }),
  ];

  const visible = visibleInstalledPlugins(installed);

  expect(visible.map((record) => record.variantKey)).toEqual([
    "cursor-plugins:alpha-tools",
    "cursor-plugins:zeta-tools",
  ]);
});

test("summarizes component hints and marketplace sources for the UI", () => {
  const { activeComponentLabels, homepageIconUrl, sourceLabel, riskLabel, variantLabel } = marketplaceModule;

  expect(activeComponentLabels({ ...baseHints, skills: true, mcpServers: true, hooks: true })).toEqual(["Skills", "MCP", "Hooks"]);
  expect(sourceLabel({ kind: "marketplacePath", marketplace_id: "local-cursor", path: "Repo Tools" })).toBe("local-cursor / Repo Tools");
  expect(variantLabel(variant("codex-plugins", "alpaca"))).toBe("alpaca");
  expect(homepageIconUrl("https://alpaca.markets/docs")).toBe("https://www.google.com/s2/favicons?domain=alpaca.markets&sz=64");
  expect(homepageIconUrl("not a url")).toBe(undefined);
  expect(sourceLabel({ kind: "npm", package: "@example/plugin", version: "1.2.3" })).toBe("@example/plugin@1.2.3");
  expect(riskLabel("startsProcess")).toBe("Starts process");
});

test("marks baked-in default marketplaces as needing explicit enablement", () => {
  const { defaultSelectionForMarketplace, marketplaceIsActive, marketplaceNeedsEnable } = marketplaceModule;
  const bakedIn = {
    id: "codex-plugins",
    isDefault: true,
    enabled: true,
    state: "bakedIn",
  };
  const refreshed = {
    id: "codex-plugins",
    isDefault: true,
    enabled: true,
    state: "refreshed",
  };

  expect(defaultSelectionForMarketplace(bakedIn)).toBe("codex");
  expect(marketplaceIsActive(bakedIn)).toBe(false);
  expect(marketplaceNeedsEnable(bakedIn)).toBe(true);
  expect(marketplaceIsActive(refreshed)).toBe(true);
  expect(marketplaceNeedsEnable(refreshed)).toBe(false);
});

test("filters marketplace plugin variants by provider", () => {
  const { pluginForProvider, pluginVariantKey } = marketplaceModule;
  const marketplaces = [
    marketplace("claude-plugins-official", "claude", true),
    marketplace("cursor-plugins", "cursor", true),
    marketplace("local-dev", "custom", false, "localPath"),
  ];
  const plugin = {
    displayName: "Repo Tools",
    identityKey: { canonicalSlug: "repo-tools", normalizedName: "repo-tools" },
    variants: [
      variant("claude-plugins-official", "repo-tools-claude"),
      variant("cursor-plugins", "repo-tools-cursor"),
      variant("local-dev", "repo-tools-local"),
    ],
    relatedCandidates: [],
    recommendedVariantKey: "claude-plugins-official:repo-tools-claude",
    installedVariants: ["cursor-plugins:repo-tools-cursor", "local-dev:repo-tools-local"],
  };

  const cursorPlugin = pluginForProvider(plugin, "cursor", marketplaces);
  const localPlugin = pluginForProvider(plugin, "local", marketplaces);

  expect(cursorPlugin.variants.map(pluginVariantKey)).toEqual(["cursor-plugins:repo-tools-cursor"]);
  expect(cursorPlugin.recommendedVariantKey).toBe("cursor-plugins:repo-tools-cursor");
  expect(cursorPlugin.installedVariants).toEqual(["cursor-plugins:repo-tools-cursor"]);
  expect(localPlugin.variants.map(pluginVariantKey)).toEqual(["local-dev:repo-tools-local"]);
});

test("builds category options and filters plugins by selected categories", () => {
  const { categoryOptionsForPlugins, pluginMatchesCategories } = marketplaceModule;
  const workflowPlugin = {
    displayName: "Repo Tools",
    identityKey: { canonicalSlug: "repo-tools", normalizedName: "repo-tools" },
    variants: [variant("codex-plugins", "repo-tools", { category: "workflow" })],
    relatedCandidates: [],
    installedVariants: [],
  };
  const dataPlugin = {
    displayName: "Warehouse",
    identityKey: { canonicalSlug: "warehouse", normalizedName: "warehouse" },
    variants: [variant("codex-plugins", "warehouse", { category: "data-tools" })],
    relatedCandidates: [],
    installedVariants: [],
  };

  expect(categoryOptionsForPlugins([workflowPlugin, dataPlugin])).toEqual(["data-tools", "workflow"]);
  expect(pluginMatchesCategories(workflowPlugin, [])).toBe(true);
  expect(pluginMatchesCategories(workflowPlugin, ["workflow"])).toBe(true);
  expect(pluginMatchesCategories(workflowPlugin, ["data-tools"])).toBe(false);
});

test("builds marketplace lookup maps for plugin row derivation", () => {
  const { buildMarketplacePluginLookups, pluginVariantKey } = marketplaceModule;
  const plugin = {
    displayName: "Repo Tools",
    identityKey: { canonicalSlug: "repo-tools", normalizedName: "repo-tools" },
    variants: [
      variant("cursor-plugins", "repo-tools-cursor"),
      variant("local-dev", "repo-tools-local"),
    ],
    relatedCandidates: [variant("claude-plugins-official", "repo-tools-claude")],
    recommendedVariantKey: "cursor-plugins:repo-tools-cursor",
    installedVariants: [],
  };
  const installed = [
    installedRecord("cursor-plugins", "repo-tools-cursor", "repo-tools"),
    installedRecord("claude-plugins-official", "repo-tools-claude", "repo-tools"),
    installedRecord("cursor-plugins", "old-tools", "repo-tools", { state: "uninstalled" }),
  ];

  const lookups = buildMarketplacePluginLookups([plugin], installed);

  expect([...lookups.installedByVariantKey.keys()].sort()).toEqual([
    "claude-plugins-official:repo-tools-claude",
    "cursor-plugins:repo-tools-cursor",
  ]);
  expect(lookups.installedByCanonicalSlug.get("repo-tools").map((record) => record.variantKey).sort()).toEqual(["claude-plugins-official:repo-tools-claude", "cursor-plugins:repo-tools-cursor"]);
  expect([...lookups.marketplaceMatchByVariantKey.keys()].sort()).toEqual(plugin.variants.concat(plugin.relatedCandidates).map(pluginVariantKey).sort());
  expect(lookups.marketplaceMatchesByCanonicalSlug.get("repo-tools")[0].plugin.displayName).toBe("Repo Tools");
});

test("derives installed matches and stable row keys from marketplace lookups", () => {
  const {
    buildMarketplacePluginLookups,
    marketplacePluginForInstalled,
    pluginInstallStatusFromLookups,
    pluginSearchRowKey,
  } = marketplaceModule;
  const plugin = {
    displayName: "Repo Tools",
    identityKey: { canonicalSlug: "repo-tools", normalizedName: "repo-tools" },
    variants: [
      variant("cursor-plugins", "repo-tools-cursor"),
      variant("local-dev", "repo-tools-local"),
    ],
    relatedCandidates: [],
    recommendedVariantKey: "cursor-plugins:repo-tools-cursor",
    installedVariants: [],
  };
  const installed = [installedRecord("cursor-plugins", "repo-tools-cursor", "repo-tools")];
  const lookups = buildMarketplacePluginLookups([plugin], installed);

  const match = marketplacePluginForInstalled(installed[0], lookups);
  const status = pluginInstallStatusFromLookups(plugin, plugin.variants[0], lookups);

  expect(match.variant.pluginId).toBe("repo-tools-cursor");
  expect(status.pluginInstalled).toBe(true);
  expect(status.variantInstalled).toBe(true);
  expect(status.variantKey).toBe("cursor-plugins:repo-tools-cursor");
  expect(pluginSearchRowKey(plugin)).toBe("repo-tools:cursor-plugins:repo-tools-cursor|local-dev:repo-tools-local");
});

test("builds source code links for marketplace plugin variants", () => {
  const { sourceCodeUrl } = marketplaceModule;
  const marketplaces = [
    {
      id: "codex-plugins",
      source: {
        kind: "github",
        repo: "openai/plugins",
        refName: "main",
        pluginRoot: "plugins",
      },
    },
  ];

  expect(sourceCodeUrl({ kind: "marketplacePath", marketplace_id: "codex-plugins", path: "browser" }, marketplaces)).toBe("https://github.com/openai/plugins/tree/main/plugins/browser");
  expect(sourceCodeUrl({ kind: "git", url: "https://github.com/example/tools.git", path: "plugins/lint", refName: "stable" }, [])).toBe("https://github.com/example/tools/tree/stable/plugins/lint");
  expect(sourceCodeUrl({ kind: "npm", package: "@example/plugin", version: "1.2.3" }, [])).toBe("https://www.npmjs.com/package/%40example%2Fplugin");
  expect(sourceCodeUrl({ kind: "git", url: "git@example.com:internal/tools.git", path: "plugins/lint" }, [])).toBe(undefined);
});

function variant(marketplaceId, pluginId, overrides = {}) {
  return {
    marketplaceId,
    pluginId,
    kind: marketplaceId.startsWith("cursor") ? "cursor" : marketplaceId.startsWith("codex") ? "codex" : marketplaceId.startsWith("local") ? "custom" : "claude",
    source: { kind: "marketplacePath", marketplace_id: marketplaceId, path: pluginId },
    category: null,
    tags: [],
    componentHints: baseHints,
    capabilityHints: [],
    risk: "passive",
    ...overrides,
  };
}

function marketplace(id, kind, isDefault, sourceKind = "github") {
  return {
    id,
    kind,
    isDefault,
    source: sourceKind === "localPath" ? { kind: "localPath", path: `/tmp/${id}` } : { kind: "github", repo: `example/${id}` },
  };
}

function installedRecord(marketplaceId, pluginId, canonicalSlug, overrides = {}) {
  return {
    marketplaceId,
    pluginId,
    identityKey: { canonicalSlug, normalizedName: canonicalSlug },
    variantKey: `${marketplaceId}:${pluginId}`,
    installPath: `/tmp/${pluginId}`,
    state: "installed",
    installedAt: "2026-05-18T20:00:00Z",
    ...overrides,
  };
}
