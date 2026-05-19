import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { unzipSync } from "fflate";
import ts from "typescript";

async function loadPackagerModule() {
  const directory = testModuleTemp("roder-extension-packager-");
  const source = readFileSync(new URL("../packages/extension-packager/src/index.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  });
  const path = join(directory, "packager.mjs");
  writeFileSync(path, output.outputText);
  return import(`${path}?t=${Date.now()}`);
}

function testModuleTemp(prefix) {
  const directory = join(process.cwd(), "node_modules", ".cache");
  mkdirSync(directory, { recursive: true });
  return mkdtempSync(join(directory, prefix));
}

function createPackageFixture() {
  const directory = mkdtempSync(join(tmpdir(), "roder-packager-fixture-"));
  mkdirSync(join(directory, "dist"), { recursive: true });
  mkdirSync(join(directory, "src"), { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "hello-rdx", version: "0.2.0" }, null, 2));
  writeFileSync(join(directory, "README.md"), "# Hello\n");
  writeFileSync(join(directory, "dist", "extension.js"), "export function activate() {}\n");
  writeFileSync(join(directory, "src", "extension.ts"), "export function activate() {}\n");
  return directory;
}

test("packager creates .rdx archives from built extension files", async () => {
  const { createRdxPackage } = await loadPackagerModule();
  const packageRoot = createPackageFixture();
  const outFile = join(mkdtempSync(join(tmpdir(), "roder-rdx-out-")), "hello.rdx");

  const result = await createRdxPackage({ packageRoot, outFile });
  const archive = unzipSync(new Uint8Array(readFileSync(result.archivePath)));

  assert.equal(result.archivePath, outFile);
  assert.deepEqual(Object.keys(archive).sort(), ["README.md", "dist/extension.js", "package.json"]);
  assert.deepEqual(result.files, ["README.md", "dist/extension.js", "package.json"]);
});
