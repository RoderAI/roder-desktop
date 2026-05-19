import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import ts from "typescript";

async function loadManifestModule() {
  const source = readFileSync(new URL("../electron/extensions/manifest.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  });
  const directory = mkdtempSync(join(tmpdir(), "roder-extension-manifest-"));
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `extension-manifest-${Date.now()}.mjs`);
  writeFileSync(path, output.outputText);
  return import(`${path}?t=${Date.now()}`);
}

function helloManifest() {
  return JSON.parse(readFileSync(new URL("../examples/extensions/hello-roder/package.json", import.meta.url), "utf8"));
}

test("accepts the hello-roder example manifest", async () => {
  const { validateExtensionManifest } = await loadManifestModule();
  const manifest = validateExtensionManifest(helloManifest(), { appVersion: "0.1.0" });

  assert.equal(manifest.id, "roder.hello-roder-extension");
  assert.equal(manifest.contributes.commands.length, 2);
  assert.equal(manifest.contributes.tools[0].id, "hello-roder.echo");
  assert.deepEqual(manifest.capabilities, ["desktop.notification"]);
});

test("rejects path traversal in extension entry point", async () => {
  const { validateExtensionManifest, ManifestValidationError } = await loadManifestModule();
  const manifest = helloManifest();
  manifest.roder.main = "../escape.js";

  assert.throws(
    () => validateExtensionManifest(manifest, { appVersion: "0.1.0" }),
    (error) =>
      error instanceof ManifestValidationError &&
      error.issues.some((issue) => issue.path === "roder.main" && issue.message.includes("relative path inside")),
  );
});

test("rejects unsupported engines, capabilities, and undeclared activation targets", async () => {
  const { validateExtensionManifest, ManifestValidationError } = await loadManifestModule();
  const manifest = helloManifest();
  manifest.roder.engines.roder = ">=99.0.0";
  manifest.roder.capabilities = ["network.web", "root.access"];
  manifest.roder.activationEvents.push("onTool:missing.tool");

  assert.throws(
    () => validateExtensionManifest(manifest, { appVersion: "0.1.0" }),
    (error) =>
      error instanceof ManifestValidationError &&
      error.issues.some((issue) => issue.path === "roder.engines.roder") &&
      error.issues.some((issue) => issue.path === "roder.capabilities[1]") &&
      error.issues.some((issue) => issue.path === "roder.activationEvents"),
  );
});

test("rejects malformed contribution points", async () => {
  const { validateExtensionManifest, ManifestValidationError } = await loadManifestModule();
  const manifest = helloManifest();
  manifest.roder.contributes.commands[0].id = "../bad";
  manifest.roder.contributes.configuration[0].type = "token";
  manifest.roder.contributes.tools[0].inputSchema = "not schema";

  assert.throws(
    () => validateExtensionManifest(manifest, { appVersion: "0.1.0" }),
    (error) =>
      error instanceof ManifestValidationError &&
      error.issues.some((issue) => issue.path === "roder.contributes.commands[0].id") &&
      error.issues.some((issue) => issue.path === "roder.contributes.configuration[0].type") &&
      error.issues.some((issue) => issue.path === "roder.contributes.tools[0].inputSchema"),
  );
});
