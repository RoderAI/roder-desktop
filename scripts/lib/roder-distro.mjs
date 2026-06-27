// Shared helpers for building roder-desktop's embedded `roder` binary from the
// pinned upstream crates.io release described by roder-distro-config.toml.
//
// Roder is consumed as a published crate; the local `roder-desktop-distro`
// crate wraps `roder::run_distribution` and is built to produce the binary the
// Electron shell bundles at resources/bin/roder. These helpers keep the config
// file and the distro crate's Cargo pin in sync and perform the build/copy.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const libDir = dirname(fileURLToPath(import.meta.url)); // scripts/lib
export const repoRoot = resolve(libDir, "..", "..");
export const configPath = resolve(repoRoot, "roder-distro-config.toml");

// Matches the `roder = "x.y.z"` dependency line in the distro crate Cargo.toml,
// or the release-tag form used when the upstream tag exists before crates.io
// has indexed the package version.
const DISTRO_REGISTRY_DEP_RE = /^(\s*roder\s*=\s*)"([^"]+)"(.*)$/m;
const DISTRO_GIT_DEP_RE = /^(\s*roder\s*=\s*)\{([^\n]+)\}(.*)$/m;

// Strip a trailing `# comment` while respecting double-quoted strings.
function stripComment(line) {
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      inString = !inString;
    } else if (char === "#" && !inString) {
      return line.slice(0, index);
    }
  }
  return line;
}

// Minimal TOML reader for the controlled roder-distro-config.toml shape
// (sections of `key = "value"` / `key = value`). Avoids adding a TOML dependency.
function parseToml(text) {
  const out = {};
  let section = out;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = {};
      out[sectionMatch[1].trim()] = section;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    section[kv[1].trim()] = value;
  }
  return out;
}

// Replace `[section].key = "..."` in TOML text, preserving the rest verbatim.
function setTomlValue(text, sectionName, key, value) {
  const lines = text.split(/\r?\n/);
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1].trim();
      continue;
    }
    if (current !== sectionName) continue;
    const keyMatch = lines[index].match(new RegExp(`^(\\s*${key}\\s*=\\s*)"[^"]*"(.*)$`));
    if (keyMatch) {
      lines[index] = `${keyMatch[1]}"${value}"${keyMatch[2]}`;
      return lines.join("\n");
    }
  }
  throw new Error(`Could not find [${sectionName}].${key} in ${configPath}`);
}

export function readDistroConfig() {
  if (!existsSync(configPath)) {
    throw new Error(`Missing ${configPath}. This file pins the upstream roder version roder-desktop embeds.`);
  }
  const toml = parseToml(readFileSync(configPath, "utf8"));
  const roder = toml.roder ?? {};
  const distro = toml.distro ?? {};
  const version = roder.version;
  if (!version) {
    throw new Error("roder-distro-config.toml is missing [roder].version");
  }
  const distroPath = distro.path ?? "roder-desktop-distro";
  return {
    version,
    crate: roder.crate ?? "roder",
    binary: roder.binary ?? "roder",
    distroPath,
    distroDir: resolve(repoRoot, distroPath),
    packageName: distro.package ?? "roder-desktop-distro",
    source: toml.source ?? {},
  };
}

function expectedDependency(config) {
  const source = config.source ?? {};
  if (source.repository && source.tag) {
    return {
      kind: "git",
      value: `{ git = "${source.repository}", tag = "${source.tag}", package = "${config.crate}" }`,
    };
  }
  return { kind: "registry", value: config.version };
}

export function readPinnedVersion(distroDir) {
  const manifestPath = resolve(distroDir, "Cargo.toml");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing distro crate manifest at ${manifestPath}`);
  }
  const text = readFileSync(manifestPath, "utf8");
  const registryMatch = text.match(DISTRO_REGISTRY_DEP_RE);
  if (registryMatch) {
    return { manifestPath, text, pinned: registryMatch[2], kind: "registry" };
  }
  const gitMatch = text.match(DISTRO_GIT_DEP_RE);
  if (gitMatch) {
    return { manifestPath, text, pinned: `{ ${gitMatch[2].trim()} }`, kind: "git" };
  }
  return { manifestPath, text, pinned: null, kind: null };
}

function ensurePinMatches(config) {
  const { pinned, kind } = readPinnedVersion(config.distroDir);
  if (!pinned) {
    throw new Error(`Could not find the \`roder\` dependency in ${config.distroPath}/Cargo.toml`);
  }
  const expected = expectedDependency(config);
  if (kind !== expected.kind || pinned !== expected.value) {
    throw new Error(
      `Version drift: roder-distro-config.toml pins roder ${config.version} but ` +
        `${config.distroPath}/Cargo.toml pins ${pinned}.\n` +
        `Run: pnpm roder:distro:update ${config.version}`,
    );
  }
}

// Write a new pinned version into BOTH the config and the distro crate manifest.
export function setDistroVersion(version) {
  const config = readDistroConfig();
  writeFileSync(configPath, setTomlValue(readFileSync(configPath, "utf8"), "roder", "version", version));
  const { manifestPath, text } = readPinnedVersion(config.distroDir);
  const expected = expectedDependency({ ...config, version });
  const replacement = `$1${expected.kind === "registry" ? `"${expected.value}"` : expected.value}$3`;
  if (DISTRO_REGISTRY_DEP_RE.test(text)) {
    writeFileSync(manifestPath, text.replace(DISTRO_REGISTRY_DEP_RE, replacement));
  } else if (DISTRO_GIT_DEP_RE.test(text)) {
    writeFileSync(manifestPath, text.replace(DISTRO_GIT_DEP_RE, replacement));
  } else {
    throw new Error(`Could not find the \`roder\` dependency in ${manifestPath}`);
  }
  return { configPath, manifestPath, version };
}

export function buildDistroBinary({ release = false, log = console.log } = {}) {
  const config = readDistroConfig();
  ensurePinMatches(config);

  const profileArgs = release ? ["--release"] : [];
  log(
    `[roder-distro] building ${config.binary} from upstream roder ${config.version} ` +
      `(${release ? "release" : "debug"})`,
  );

  const result = spawnSync(
    "cargo",
    ["build", ...profileArgs, "--manifest-path", resolve(config.distroDir, "Cargo.toml"), "--bin", config.binary],
    { cwd: config.distroDir, stdio: "inherit", env: process.env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`cargo build failed with status ${result.status ?? "unknown"}`);
  }

  const profileDir = release ? "release" : "debug";
  const builtName = process.platform === "win32" ? `${config.binary}.exe` : config.binary;
  const builtBinary = resolve(config.distroDir, "target", profileDir, builtName);
  if (!existsSync(builtBinary)) {
    throw new Error(`Expected built binary at ${builtBinary} but it is missing`);
  }
  return { config, builtBinary, builtName };
}

export function bundleRoderBinary({ release = false, log = console.log } = {}) {
  const { builtBinary, builtName } = buildDistroBinary({ release, log });

  const binDir = resolve(repoRoot, "resources", "bin");
  mkdirSync(binDir, { recursive: true });
  const output = resolve(binDir, builtName);
  copyFileSync(builtBinary, output);

  if (process.platform === "darwin") {
    const signed = spawnSync("codesign", ["--force", "--sign", "-", output], { stdio: "inherit" });
    if (signed.status !== 0) {
      throw new Error(`codesign failed with status ${signed.status ?? "unknown"}`);
    }
  }

  log(`[roder-distro] wrote ${output}`);
  return output;
}
