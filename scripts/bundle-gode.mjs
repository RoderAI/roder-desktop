import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const godeSource = resolve(process.env.GODE_SOURCE_DIR ?? resolve(root, "..", "gode"));
const output = resolve(root, "resources", "bin", process.platform === "win32" ? "gode.exe" : "gode");

if (!existsSync(resolve(godeSource, "go.mod"))) {
  console.warn(`[bundle:gode] skipping: no Go module at ${godeSource}`);
  process.exit(0);
}

mkdirSync(dirname(output), { recursive: true });

let result = buildFrom(godeSource, "live checkout");
if (result.status !== 0 && existsSync(resolve(godeSource, ".git"))) {
  console.warn("[bundle:gode] live checkout build failed; retrying from clean git HEAD archive");
  const cleanSource = exportCleanHead(godeSource);
  try {
    result = buildFrom(cleanSource, "clean HEAD archive");
  } finally {
    rmSync(cleanSource, { force: true, recursive: true });
  }
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`[bundle:gode] wrote ${output}`);

function buildFrom(cwd, label) {
  console.log(`[bundle:gode] building ${label} at ${cwd}`);
  return spawnSync("go", ["build", "-o", output, "./cmd/gode"], {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      CGO_ENABLED: process.env.CGO_ENABLED ?? "0",
    },
  });
}

function exportCleanHead(source) {
  const cleanSource = mkdtempSync(resolve(tmpdir(), "gode-desktop-bundle-"));
  const archive = resolve(cleanSource, "source.tar");
  const archived = spawnSync("git", ["archive", "--format=tar", "HEAD", "--output", archive], {
    cwd: source,
    stdio: "inherit",
  });
  if (archived.status !== 0) {
    process.exit(archived.status ?? 1);
  }
  const extracted = spawnSync("tar", ["-xf", archive, "-C", cleanSource], {
    stdio: "inherit",
  });
  if (extracted.status !== 0) {
    process.exit(extracted.status ?? 1);
  }
  rmSync(archive, { force: true });
  return cleanSource;
}
