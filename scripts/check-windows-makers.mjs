// Guards the Windows packaging path against dependency-layout regressions.
//
// forge.config.ts imports every maker statically, so the config only loads when every maker's
// transitive requires resolve. A Windows install prunes packages that only a darwin or linux
// install would pull in, and a require that depended on one of them then fails only on Windows.
// This copies the repo, installs it the way a Windows host would, and requires each maker.
//
// Usage: node scripts/check-windows-makers.mjs [repoRoot]
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const work = mkdtempSync(join(tmpdir(), "roder-win32-makers-"));

const excluded = ["node_modules", ".git", "out", ".vite", "dist"];
const isExcluded = (source) => {
  const parts = relative(repoRoot, source).split(sep);
  return parts.some((part) => excluded.includes(part)) || relative(repoRoot, source) === join("resources", "bin");
};

let failed = false;
try {
  cpSync(repoRoot, work, { recursive: true, filter: (source) => !isExcluded(source) });

  const install = spawnSync("pnpm", ["install", "--frozen-lockfile", "--os=win32", "--cpu=x64", "--ignore-scripts"], {
    cwd: work,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (install.status !== 0) {
    console.error("win32 install failed");
    failed = true;
  } else {
    const pkg = JSON.parse(readFileSync(join(work, "package.json"), "utf8"));
    const makers = Object.keys({ ...pkg.devDependencies, ...pkg.dependencies }).filter((name) =>
      name.startsWith("@electron-forge/maker-"),
    );
    const requireFromWork = createRequire(join(work, "package.json"));
    for (const maker of makers) {
      try {
        requireFromWork(maker);
        console.log(`ok   ${maker}`);
      } catch (error) {
        failed = true;
        console.error(`FAIL ${maker}: ${error.message.split("\n")[0]}`);
      }
    }
  }
} finally {
  if (failed) {
    console.error(`Work directory kept for inspection: ${work}`);
  } else {
    rmSync(work, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
