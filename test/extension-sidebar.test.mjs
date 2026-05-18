import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";

async function loadSidebarModule() {
  const directory = join(process.cwd(), "node_modules", ".cache");
  mkdirSync(directory, { recursive: true });
  const moduleDirectory = mkdtempSync(join(directory, "roder-extension-sidebar-"));
  const source = readFileSync(new URL("../src/lib/extension-sidebar.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  });
  const path = join(moduleDirectory, "extension-sidebar.mjs");
  writeFileSync(path, output.outputText);
  return import(`${path}?t=${Date.now()}`);
}

function extensionRecord(id, contributes) {
  return {
    id,
    manifest: {
      contributes: {
        commands: [],
        tools: [],
        themes: [],
        views: { panels: [] },
        ...contributes,
      },
    },
  };
}

test("filters theme-only extensions out of sidebar contributions", async () => {
  const { getSidebarExtensions } = await loadSidebarModule();
  const extensions = [
    extensionRecord("theme-only", {
      themes: [{ id: "aurora-dark", label: "Aurora Dark", scheme: "dark", path: "themes/dark.json" }],
    }),
    extensionRecord("html-panel", {
      views: { panels: [{ id: "event-log.panel", title: "Event Log", html: "assets/panel.html" }] },
    }),
    extensionRecord("command-only", {
      commands: [{ id: "hello.sayHello", title: "Say Hello" }],
    }),
    extensionRecord("tool-only", {
      tools: [{ id: "hello.echo", title: "Echo", description: "Echo text", inputSchema: { type: "object" } }],
    }),
    extensionRecord("metadata-only-panel", {
      views: { panels: [{ id: "missing-html", title: "No HTML" }] },
    }),
  ];

  assert.deepEqual(getSidebarExtensions(extensions).map((extension) => extension.id), ["html-panel", "command-only", "tool-only"]);
});
