import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { unzipSync } from "fflate";
import { createRdxPackage } from "../packages/extension-packager/src";

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
  const packageRoot = createPackageFixture();
  const outFile = join(mkdtempSync(join(tmpdir(), "roder-rdx-out-")), "hello.rdx");

  const result = await createRdxPackage({ packageRoot, outFile });
  const archive = unzipSync(new Uint8Array(readFileSync(result.archivePath)));

  expect(result.archivePath).toBe(outFile);
  expect(Object.keys(archive).sort()).toEqual(["README.md", "dist/extension.js", "package.json"]);
  expect(result.files).toEqual(["README.md", "dist/extension.js", "package.json"]);
});
