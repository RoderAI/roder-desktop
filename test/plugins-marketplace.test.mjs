import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import ts from "typescript";

async function loadMarketplaceModule() {
  const source = readFileSync(new URL("../src/lib/plugins-marketplace.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  });
  const directory = mkdtempSync(join(tmpdir(), "roder-plugins-marketplace-"));
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `plugins-marketplace-${Date.now()}.mjs`);
  writeFileSync(path, output.outputText);
  return import(`${path}?t=${Date.now()}`);
}

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

test("selects the recommended marketplace plugin variant by variant key", async () => {
  const { recommendedVariant, pluginVariantKey } = await loadMarketplaceModule();
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

  assert.equal(pluginVariantKey(selected), "cursor-plugins:repo-tools");
});

test("merges installed variants from search rows and installed plugin records", async () => {
  const { installedVariantSet } = await loadMarketplaceModule();
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

  assert.equal(keys.has("cursor-plugins:repo-tools"), true);
  assert.equal(keys.has("claude-plugins-official:repo-tools-claude"), true);
});

test("derives plugin row install status from installed plugin records", async () => {
  const { pluginInstallStatus } = await loadMarketplaceModule();
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

  assert.equal(status.pluginInstalled, true);
  assert.equal(status.variantInstalled, true);
  assert.equal(status.variantKey, "cursor-plugins:repo-tools");
});

test("ignores installed plugin records for unrelated plugin rows", async () => {
  const { pluginInstallStatus } = await loadMarketplaceModule();
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

  assert.equal(status.pluginInstalled, false);
  assert.equal(status.variantInstalled, false);
});

test("prepares installed plugin records for the installed tab", async () => {
  const { visibleInstalledPlugins } = await loadMarketplaceModule();
  const installed = [
    installedRecord("cursor-plugins", "zeta-tools", "zeta-tools", { state: "disabled" }),
    installedRecord("cursor-plugins", "alpha-tools", "alpha-tools"),
    installedRecord("cursor-plugins", "old-tools", "old-tools", { state: "uninstalled" }),
  ];

  const visible = visibleInstalledPlugins(installed);

  assert.deepEqual(visible.map((record) => record.variantKey), [
    "cursor-plugins:alpha-tools",
    "cursor-plugins:zeta-tools",
  ]);
});

test("summarizes component hints and marketplace sources for the UI", async () => {
  const { activeComponentLabels, homepageIconUrl, sourceLabel, riskLabel, variantLabel } = await loadMarketplaceModule();

  assert.deepEqual(activeComponentLabels({ ...baseHints, skills: true, mcpServers: true, hooks: true }), ["Skills", "MCP", "Hooks"]);
  assert.equal(sourceLabel({ kind: "marketplacePath", marketplace_id: "local-cursor", path: "Repo Tools" }), "local-cursor / Repo Tools");
  assert.equal(variantLabel(variant("codex-plugins", "alpaca")), "alpaca");
  assert.equal(homepageIconUrl("https://alpaca.markets/docs"), "https://www.google.com/s2/favicons?domain=alpaca.markets&sz=64");
  assert.equal(homepageIconUrl("not a url"), undefined);
  assert.equal(sourceLabel({ kind: "npm", package: "@example/plugin", version: "1.2.3" }), "@example/plugin@1.2.3");
  assert.equal(riskLabel("startsProcess"), "Starts process");
});

test("marks baked-in default marketplaces as needing explicit enablement", async () => {
  const { defaultSelectionForMarketplace, marketplaceIsActive, marketplaceNeedsEnable } = await loadMarketplaceModule();
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

  assert.equal(defaultSelectionForMarketplace(bakedIn), "codex");
  assert.equal(marketplaceIsActive(bakedIn), false);
  assert.equal(marketplaceNeedsEnable(bakedIn), true);
  assert.equal(marketplaceIsActive(refreshed), true);
  assert.equal(marketplaceNeedsEnable(refreshed), false);
});

test("filters marketplace plugin variants by provider", async () => {
  const { pluginForProvider, pluginVariantKey } = await loadMarketplaceModule();
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

  assert.deepEqual(cursorPlugin.variants.map(pluginVariantKey), ["cursor-plugins:repo-tools-cursor"]);
  assert.equal(cursorPlugin.recommendedVariantKey, "cursor-plugins:repo-tools-cursor");
  assert.deepEqual(cursorPlugin.installedVariants, ["cursor-plugins:repo-tools-cursor"]);
  assert.deepEqual(localPlugin.variants.map(pluginVariantKey), ["local-dev:repo-tools-local"]);
});

test("builds category options and filters plugins by selected categories", async () => {
  const { categoryOptionsForPlugins, pluginMatchesCategories } = await loadMarketplaceModule();
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

  assert.deepEqual(categoryOptionsForPlugins([workflowPlugin, dataPlugin]), ["data-tools", "workflow"]);
  assert.equal(pluginMatchesCategories(workflowPlugin, []), true);
  assert.equal(pluginMatchesCategories(workflowPlugin, ["workflow"]), true);
  assert.equal(pluginMatchesCategories(workflowPlugin, ["data-tools"]), false);
});

test("builds marketplace lookup maps for plugin row derivation", async () => {
  const { buildMarketplacePluginLookups, pluginVariantKey } = await loadMarketplaceModule();
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

  assert.deepEqual([...lookups.installedByVariantKey.keys()].sort(), [
    "claude-plugins-official:repo-tools-claude",
    "cursor-plugins:repo-tools-cursor",
  ]);
  assert.deepEqual(
    lookups.installedByCanonicalSlug.get("repo-tools").map((record) => record.variantKey).sort(),
    ["claude-plugins-official:repo-tools-claude", "cursor-plugins:repo-tools-cursor"],
  );
  assert.deepEqual(
    [...lookups.marketplaceMatchByVariantKey.keys()].sort(),
    plugin.variants.concat(plugin.relatedCandidates).map(pluginVariantKey).sort(),
  );
  assert.equal(
    lookups.marketplaceMatchesByCanonicalSlug.get("repo-tools")[0].plugin.displayName,
    "Repo Tools",
  );
});

test("derives installed matches and stable row keys from marketplace lookups", async () => {
  const {
    buildMarketplacePluginLookups,
    marketplacePluginForInstalled,
    pluginInstallStatusFromLookups,
    pluginSearchRowKey,
  } = await loadMarketplaceModule();
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

  assert.equal(match.variant.pluginId, "repo-tools-cursor");
  assert.equal(status.pluginInstalled, true);
  assert.equal(status.variantInstalled, true);
  assert.equal(status.variantKey, "cursor-plugins:repo-tools-cursor");
  assert.equal(pluginSearchRowKey(plugin), "repo-tools:cursor-plugins:repo-tools-cursor|local-dev:repo-tools-local");
});

test("builds source code links for marketplace plugin variants", async () => {
  const { sourceCodeUrl } = await loadMarketplaceModule();
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

  assert.equal(
    sourceCodeUrl({ kind: "marketplacePath", marketplace_id: "codex-plugins", path: "browser" }, marketplaces),
    "https://github.com/openai/plugins/tree/main/plugins/browser",
  );
  assert.equal(
    sourceCodeUrl({ kind: "git", url: "https://github.com/example/tools.git", path: "plugins/lint", refName: "stable" }, []),
    "https://github.com/example/tools/tree/stable/plugins/lint",
  );
  assert.equal(sourceCodeUrl({ kind: "npm", package: "@example/plugin", version: "1.2.3" }, []), "https://www.npmjs.com/package/%40example%2Fplugin");
  assert.equal(sourceCodeUrl({ kind: "git", url: "git@example.com:internal/tools.git", path: "plugins/lint" }, []), undefined);
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
