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

test("summarizes component hints and marketplace sources for the UI", async () => {
  const { activeComponentLabels, sourceLabel, riskLabel } = await loadMarketplaceModule();

  assert.deepEqual(activeComponentLabels({ ...baseHints, skills: true, mcpServers: true, hooks: true }), ["Skills", "MCP", "Hooks"]);
  assert.equal(sourceLabel({ kind: "marketplacePath", marketplace_id: "local-cursor", path: "Repo Tools" }), "local-cursor / Repo Tools");
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
});

function variant(marketplaceId, pluginId) {
  return {
    marketplaceId,
    pluginId,
    kind: marketplaceId.startsWith("cursor") ? "cursor" : "claude",
    source: { kind: "marketplacePath", marketplace_id: marketplaceId, path: pluginId },
    componentHints: baseHints,
    capabilityHints: [],
    risk: "passive",
  };
}
