import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { zipSync } from "fflate";
import ts from "typescript";

async function loadCatalogModule() {
  const directory = testModuleTemp("roder-extension-catalog-");
  writeTranspiledModule("../electron/extensions/manifest.ts", join(directory, "manifest.mjs"));
  writeTranspiledModule("../electron/extensions/package-manager.ts", join(directory, "package-manager.mjs"), {
    "./manifest": "./manifest.mjs",
  });
  writeTranspiledModule("../electron/extensions/catalog.ts", join(directory, "catalog.mjs"), {
    "./manifest": "./manifest.mjs",
    "./package-manager": "./package-manager.mjs",
  });
  return import(`${join(directory, "catalog.mjs")}?t=${Date.now()}`);
}

function testModuleTemp(prefix) {
  const directory = join(process.cwd(), "node_modules", ".cache");
  mkdirSync(directory, { recursive: true });
  return mkdtempSync(join(directory, prefix));
}

function writeTranspiledModule(sourcePath, outputPath, replacements = {}) {
  let source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");
  for (const [from, to] of Object.entries(replacements)) {
    source = source.replaceAll(`"${from}"`, `"${to}"`);
  }
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  });
  writeFileSync(outputPath, output.outputText);
}

function createExtensionFixture() {
  const directory = mkdtempSync(join(tmpdir(), "hello-roder-extension-"));
  writeFileSync(join(directory, "extension.js"), "export function activate() {}\n");
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify(
      {
        name: "hello-roder-extension",
        version: "0.1.0",
        description: "Catalog test extension.",
        roder: {
          displayName: "Hello Roder",
          publisher: "roder",
          engines: { roder: ">=0.0.0" },
          main: "extension.js",
          activationEvents: ["onCommand:hello-roder.sayHello"],
          capabilities: ["desktop.notification"],
          contributes: {
            commands: [{ id: "hello-roder.sayHello", title: "Say Hello" }],
            tools: [],
            configuration: [{ key: "hello-roder.greeting", title: "Greeting", type: "text", default: "Hi" }],
            views: { panels: [] },
          },
        },
      },
      null,
      2,
    ),
  );
  return directory;
}

test("catalog installs a local extension folder and persists its record", async () => {
  const { ExtensionCatalog } = await loadCatalogModule();
  const userDataPath = mkdtempSync(join(tmpdir(), "roder-user-data-"));
  const fixturePath = createExtensionFixture();
  const now = () => new Date("2026-05-18T21:45:00.000Z");
  const catalog = new ExtensionCatalog({ userDataPath, appVersion: "0.1.0", now });

  const installed = await catalog.installFromFolder(fixturePath);
  assert.equal(installed.id, "roder.hello-roder-extension");
  assert.equal(installed.enabled, true);
  assert.equal(installed.source.type, "dev");
  assert.equal(installed.source.path, fixturePath);
  assert.deepEqual(installed.capabilities, [{ capability: "desktop.notification", status: "pending" }]);
  assert.equal(installed.preferences["hello-roder.greeting"], "Hi");

  const reloaded = new ExtensionCatalog({ userDataPath, appVersion: "0.1.0", now });
  const snapshot = await reloaded.list();
  assert.equal(snapshot.extensions.length, 1);
  assert.equal(snapshot.extensions[0].manifest.displayName, "Hello Roder");
});

test("catalog installs an .rdx archive into app storage", async () => {
  const { ExtensionCatalog } = await loadCatalogModule();
  const userDataPath = mkdtempSync(join(tmpdir(), "roder-user-data-"));
  const fixturePath = createExtensionFixture();
  const archivePath = join(mkdtempSync(join(tmpdir(), "roder-rdx-")), "hello.rdx");
  writeFileSync(
    archivePath,
    zipSync({
      "package.json": readFileSync(join(fixturePath, "package.json")),
      "extension.js": readFileSync(join(fixturePath, "extension.js")),
    }),
  );
  const catalog = new ExtensionCatalog({ userDataPath, appVersion: "0.1.0" });

  const installed = await catalog.installFromArchive(archivePath);
  assert.equal(installed.id, "roder.hello-roder-extension");
  assert.equal(installed.source.type, "archive");
  assert.equal(installed.source.archivePath, archivePath);
  assert.match(installed.source.path, /extensions\/installed\/roder\.hello-roder-extension$/);

  const snapshot = await catalog.list();
  assert.equal(snapshot.extensions[0].source.type, "archive");
  assert.equal(snapshot.extensions[0].manifest.displayName, "Hello Roder");
});

test("catalog can disable, re-enable, reload, update preferences, and uninstall", async () => {
  const { ExtensionCatalog } = await loadCatalogModule();
  const catalog = new ExtensionCatalog({
    userDataPath: mkdtempSync(join(tmpdir(), "roder-user-data-")),
    appVersion: "0.1.0",
    now: () => new Date("2026-05-18T21:46:00.000Z"),
  });
  const installed = await catalog.installFromFolder(createExtensionFixture());

  const disabled = await catalog.disable(installed.id);
  assert.equal(disabled.enabled, false);
  const enabled = await catalog.enable(installed.id);
  assert.equal(enabled.enabled, true);
  const updated = await catalog.updatePreference(installed.id, "hello-roder.greeting", "Aloha");
  assert.equal(updated.preferences["hello-roder.greeting"], "Aloha");
  const reloaded = await catalog.reload(installed.id);
  assert.equal(reloaded.activationState, "inactive");
  assert.match((await catalog.readLogs(installed.id)).join("\n"), /Reload requested/);

  const snapshot = await catalog.uninstall(installed.id);
  assert.equal(snapshot.extensions.length, 0);
});

test("catalog rejects folders with invalid manifests", async () => {
  const { ExtensionCatalog } = await loadCatalogModule();
  const catalog = new ExtensionCatalog({
    userDataPath: mkdtempSync(join(tmpdir(), "roder-user-data-")),
    appVersion: "0.1.0",
  });
  const fixturePath = createExtensionFixture();
  const manifest = JSON.parse(readFileSync(join(fixturePath, "package.json"), "utf8"));
  manifest.roder.main = "../escape.js";
  writeFileSync(join(fixturePath, "package.json"), JSON.stringify(manifest, null, 2));

  await assert.rejects(() => catalog.installFromFolder(fixturePath), /relative path inside the extension package/);
});

test("catalog rejects .rdx archives with unsafe paths", async () => {
  const { ExtensionCatalog } = await loadCatalogModule();
  const catalog = new ExtensionCatalog({
    userDataPath: mkdtempSync(join(tmpdir(), "roder-user-data-")),
    appVersion: "0.1.0",
  });
  const fixturePath = createExtensionFixture();
  const archivePath = join(mkdtempSync(join(tmpdir(), "roder-rdx-")), "unsafe.rdx");
  writeFileSync(
    archivePath,
    zipSync({
      "package.json": readFileSync(join(fixturePath, "package.json")),
      "../escape.js": Buffer.from("export function activate() {}\n"),
    }),
  );

  await assert.rejects(() => catalog.installFromArchive(archivePath), /Unsafe extension archive entry/);
});
