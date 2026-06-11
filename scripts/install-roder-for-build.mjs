import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceParent = dirname(root);
const sourceDirectoryName = basename(root).endsWith("-desktop")
  ? basename(root).slice(0, -"desktop".length).replace(/-$/, "")
  : "gode";
const siblingSource = resolve(workspaceParent, sourceDirectoryName);
const roderSource = resolve(process.env.RODER_SOURCE_DIR ?? siblingSource);
const bindir = resolve(root, "resources", "bin");
const binaryName = process.platform === "win32" ? "roder.exe" : "roder";
const output = resolve(bindir, binaryName);

if (!existsSync(resolve(roderSource, "Makefile"))) {
  console.warn(`[build:roder] skipping: no Makefile at ${roderSource}`);
  process.exit(0);
}

mkdirSync(bindir, { recursive: true });

console.log(`[build:roder] running make install at ${roderSource}`);
const result = spawnSync(
  "make",
  ["install", `BINDIR=${bindir}`, `INSTALL_BIN=${binaryName}`],
  {
    cwd: roderSource,
    stdio: "inherit",
    env: process.env,
  },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (process.platform === "darwin") {
  const signed = spawnSync("codesign", ["--force", "--sign", "-", output], {
    stdio: "inherit",
  });
  if (signed.status !== 0) {
    process.exit(signed.status ?? 1);
  }
}

console.log(`[build:roder] wrote ${output}`);
