import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmodSync, createWriteStream, existsSync, lstatSync, mkdirSync, openSync, closeSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

export const ANTIGRAVITY_MANIFEST_BASE =
  "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests";

const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_EXECUTABLE_BYTES = 2 * 1024 * 1024 * 1024;
const VERSION_TIMEOUT_MS = 90_000;

export type AntigravityRelease = {
  version: string;
  url: string;
  digest: string;
};

export type AntigravityInstallProgress =
  | { phase: "manifest"; message: string }
  | { phase: "downloading"; bytes: number; total: number | null; message: string }
  | { phase: "extracting"; message: string }
  | { phase: "verifying"; message: string }
  | { phase: "installed"; path: string; version: string; message: string };

export type InstallAntigravityRuntimeOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  musl?: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  verifyVersion?: (binaryPath: string) => Promise<string>;
  onProgress?: (progress: AntigravityInstallProgress) => void;
};

const API_KEY_ENV_NAMES = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_CLOUD_QUOTA_PROJECT",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_GENAI_USE_GCA",
  "GCLOUD_PROJECT",
  "CLOUDSDK_CORE_PROJECT",
  "AGY_ACP_CCPA_PROJECT",
  "AGY_ACP_ENABLE_OAUTH",
] as const;

export function antigravityExecutableName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "agy.exe" : "antigravity";
}

export function antigravityReleaseTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  musl = false,
): string {
  const osName =
    platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : platform === "win32" ? "windows" : null;
  if (!osName) {
    throw new Error(`Automatic Antigravity installation is not supported on ${platform}`);
  }
  const cpuName = arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : null;
  if (!cpuName) {
    throw new Error(`Automatic Antigravity installation is not supported on ${arch}`);
  }
  const suffix = osName === "linux" && musl ? "_musl" : "";
  return `${osName}_${cpuName}${suffix}`;
}

export function managedAntigravityDirectory(
  options: {
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
    platform?: NodeJS.Platform;
    arch?: string;
    musl?: boolean;
  } = {},
): string {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const root = env.RODER_CONFIG_DIR?.trim() || env.RODER_DATA_DIR?.trim() || join(homeDir, ".roder");
  const target = antigravityReleaseTarget(options.platform, options.arch, options.musl);
  return join(root, "tools", "antigravity", target);
}

export function parseSemver(raw: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(raw.trim());
  if (!match) {
    return null;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
    return null;
  }
  if (`${major}.${minor}.${patch}` !== raw.trim()) {
    return null;
  }
  return [major, minor, patch];
}

export function isVersionAtLeast(version: [number, number, number], minimum: [number, number, number]): boolean {
  if (version[0] !== minimum[0]) return version[0] > minimum[0];
  if (version[1] !== minimum[1]) return version[1] > minimum[1];
  return version[2] >= minimum[2];
}

/**
 * Validates Google's official Antigravity CLI release manifest with the exact same
 * trust rules enforced by `roder-ext-antigravity-backend::runtime::release::Release::parse`.
 */
export function parseAntigravityRelease(
  value: unknown,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  musl = false,
): AntigravityRelease {
  antigravityReleaseTarget(platform, arch, musl);
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Antigravity release manifest");
  }
  const record = value as Record<string, unknown>;
  const version = typeof record.version === "string" ? record.version : "";
  if (!version) {
    throw new Error("Release manifest missing version");
  }
  const parsed = parseSemver(version);
  if (!parsed || !isVersionAtLeast(parsed, [1, 5, 1])) {
    throw new Error("Antigravity release must be a stable version 1.5.1 or newer");
  }
  const url = typeof record.url === "string" ? record.url : "";
  if (!url) {
    throw new Error("Release manifest missing URL");
  }
  const digest = typeof record.sha512 === "string" ? record.sha512 : "";
  if (digest.length !== 128 || !/^[0-9a-fA-F]{128}$/u.test(digest)) {
    throw new Error("Invalid release SHA-512 digest");
  }

  const osName = platform === "darwin" ? "darwin" : platform === "win32" ? "windows" : "linux";
  const folderCpu = arch === "arm64" ? "arm" : "x64";
  const assetCpu = arch === "arm64" ? "arm64" : "x64";
  const suffix = osName === "linux" && musl ? "_musl" : "";
  const folderSuffix = suffix ? "-musl" : "";
  const assetOs = osName === "darwin" ? "mac" : osName;
  const extension = osName === "windows" ? "exe" : "tar.gz";

  const prefix = `https://storage.googleapis.com/antigravity-public/antigravity-cli/${version}-`;
  if (!url.startsWith(prefix)) {
    throw new Error("Untrusted Antigravity release URL");
  }
  const rest = url.slice(prefix.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex <= 0) {
    throw new Error("Invalid Antigravity release URL");
  }
  const build = rest.slice(0, slashIndex);
  const asset = rest.slice(slashIndex + 1);
  const expected = `${osName}-${folderCpu}${folderSuffix}/cli_${assetOs}_${assetCpu}${suffix}.${extension}`;
  if (!/^\d+$/u.test(build) || asset !== expected) {
    throw new Error("Untrusted Antigravity release URL");
  }

  return {
    version,
    url,
    digest: digest.toLowerCase(),
  };
}

export function cleanAntigravityEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...baseEnv };
  for (const key of API_KEY_ENV_NAMES) {
    delete next[key];
  }
  next.AGY_ACP_FORCE_FILE_STORAGE = "1";
  next.SSH_CONNECTION = baseEnv.SSH_CONNECTION?.trim() || "127.0.0.1 0 127.0.0.1 0";
  return next;
}

export function parseAntigravityVersionOutput(output: string): string {
  for (const token of output.split(/\s+/u)) {
    const trimmed = token.replace(/^v/u, "");
    const parsed = parseSemver(trimmed);
    if (parsed) {
      if (!isVersionAtLeast(parsed, [1, 5, 1])) {
        throw new Error(`Antigravity ${trimmed} is too old; version 1.5.1 or newer is required.`);
      }
      return trimmed;
    }
  }
  throw new Error("Antigravity CLI did not report a valid version");
}

export async function verifyAntigravityBinaryVersion(
  binaryPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const scratch = await mkdtemp(join(tmpdir(), "roder-agy-ver-"));
  try {
    const childEnv: NodeJS.ProcessEnv = {
      ...cleanAntigravityEnv(env),
      AGY_CLI_DISABLE_AUTO_UPDATE: "true",
      BROWSER: "false",
      TMPDIR: scratch,
      TMP: scratch,
      TEMP: scratch,
    };
    const stdout = await new Promise<string>((resolvePromise, rejectPromise) => {
      const child = spawn(binaryPath, ["--version"], {
        env: childEnv,
        stdio: ["ignore", "pipe", "ignore"],
      });
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (output.length > 65_536) {
          child.kill("SIGKILL");
          rejectPromise(new Error("Antigravity version output exceeded its size limit"));
        }
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        rejectPromise(new Error("Antigravity version check timed out"));
      }, VERSION_TIMEOUT_MS);
      child.once("error", (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolvePromise(output);
        } else {
          rejectPromise(new Error(`Antigravity --version exited with code ${code ?? "unknown"}`));
        }
      });
    });
    return parseAntigravityVersionOutput(stdout);
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Pure, dependency-free single-file POSIX `.tar.gz` extractor enforcing exact parity with
 * `roder-ext-antigravity-backend::runtime::archive::extract`:
 * - Rejects anything other than a single regular file matching `expectedName`.
 * - Validates header checksum, exact payload length, and zero-filled trailing tar blocks.
 */
export async function extractAntigravityArchive(
  archivePath: string,
  destinationDir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  const expectedName = antigravityExecutableName(platform);
  const destinationBinary = join(destinationDir, expectedName);

  if (platform === "win32") {
    const info = await stat(archivePath);
    if (info.size === 0 || info.size > MAX_EXECUTABLE_BYTES) {
      throw new Error("Antigravity executable exceeded its size limit or was empty");
    }
    await rename(archivePath, destinationBinary);
    return destinationBinary;
  }

  const rawTarGz = await readFile(archivePath);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const gunzip = createGunzip();
    let headerBuf = Buffer.alloc(0);
    let headerParsed = false;
    let fileSize = 0;
    let bytesWritten = 0;
    let paddingRemaining = 0;
    let trailingBytes = 0;
    let outStream: ReturnType<typeof createWriteStream> | null = null;
    let failed = false;

    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      gunzip.destroy();
      outStream?.destroy();
      rejectPromise(error);
    };

    const writeOut = (chunk: Buffer) => {
      if (!outStream) {
        outStream = createWriteStream(destinationBinary, { flags: "wx", mode: 0o700 });
        outStream.on("error", (error) => fail(error));
      }
      outStream.write(chunk);
    };

    gunzip.on("data", (chunk: Buffer) => {
      if (failed) return;
      let offset = 0;

      if (!headerParsed) {
        const needed = 512 - headerBuf.length;
        const take = Math.min(needed, chunk.length);
        headerBuf = Buffer.concat([headerBuf, chunk.subarray(0, take)]);
        offset += take;
        if (headerBuf.length < 512) {
          return;
        }
        try {
          const parsed = parseTarHeader(headerBuf);
          if (parsed.name !== expectedName || !parsed.isRegularFile) {
            fail(new Error("Antigravity archive must contain only its regular executable"));
            return;
          }
          if (parsed.size === 0 || parsed.size > MAX_EXECUTABLE_BYTES) {
            fail(new Error("Antigravity executable exceeded its size limit or was empty"));
            return;
          }
          fileSize = parsed.size;
          paddingRemaining = (512 - (fileSize % 512)) % 512;
          headerParsed = true;
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }
      }

      if (offset < chunk.length && bytesWritten < fileSize) {
        const remainingFile = fileSize - bytesWritten;
        const take = Math.min(remainingFile, chunk.length - offset);
        writeOut(chunk.subarray(offset, offset + take));
        bytesWritten += take;
        offset += take;
      }

      if (offset < chunk.length && bytesWritten === fileSize && paddingRemaining > 0) {
        const take = Math.min(paddingRemaining, chunk.length - offset);
        paddingRemaining -= take;
        offset += take;
      }

      if (offset < chunk.length && bytesWritten === fileSize && paddingRemaining === 0) {
        const trailing = chunk.subarray(offset);
        trailingBytes += trailing.length;
        if (trailingBytes > 1024 * 1024) {
          fail(new Error("Unexpected trailing data in Antigravity archive"));
          return;
        }
        for (let i = 0; i < trailing.length; i += 1) {
          if (trailing[i] !== 0) {
            fail(new Error("Antigravity archive contains extra entries"));
            return;
          }
        }
      }
    });

    gunzip.on("error", (error) => fail(error));
    gunzip.on("end", () => {
      if (failed) return;
      if (!headerParsed) {
        fail(new Error("Antigravity archive is empty"));
        return;
      }
      if (bytesWritten !== fileSize) {
        fail(new Error("Antigravity executable archive is truncated"));
        return;
      }
      if (!outStream) {
        fail(new Error("Antigravity archive produced no output"));
        return;
      }
      outStream.end(() => {
        try {
          chmodSync(destinationBinary, 0o700);
          resolvePromise();
        } catch (error) {
          rejectPromise(error);
        }
      });
    });

    Readable.from(rawTarGz).pipe(gunzip);
  });

  await unlink(archivePath).catch(() => undefined);
  return destinationBinary;
}

function parseTarHeader(block: Buffer): { name: string; size: number; isRegularFile: boolean } {
  const storedChecksum = parseOctal(block.subarray(148, 156));
  let computedChecksum = 0;
  for (let i = 0; i < 512; i += 1) {
    computedChecksum += i >= 148 && i < 156 ? 32 : block[i];
  }
  if (!Number.isFinite(storedChecksum) || storedChecksum !== computedChecksum) {
    throw new Error("Invalid Antigravity tar header checksum");
  }
  const rawName = readTarString(block.subarray(0, 100));
  const prefix = readTarString(block.subarray(345, 500));
  const name = prefix ? `${prefix}/${rawName}` : rawName;
  const typeflag = block[156];
  const isRegularFile = typeflag === 0 || typeflag === 48; // NUL or '0'
  const size = parseTarSize(block.subarray(124, 136));
  return { name, size, isRegularFile };
}

function readTarString(buf: Buffer): string {
  const end = buf.indexOf(0);
  return buf.subarray(0, end === -1 ? buf.length : end).toString("utf8");
}

function parseOctal(buf: Buffer): number {
  const str = readTarString(buf).trim();
  if (!str) return Number.NaN;
  if (!/^[0-7]+$/u.test(str)) return Number.NaN;
  return Number.parseInt(str, 8);
}

function parseTarSize(buf: Buffer): number {
  if ((buf[0] & 0x80) !== 0) {
    // GNU/POSIX base-256 size encoding
    let value = BigInt(buf[0] & 0x7f);
    for (let i = 1; i < buf.length; i += 1) {
      value = (value << 8n) | BigInt(buf[i]);
    }
    return Number(value);
  }
  const parsed = parseOctal(buf);
  if (!Number.isFinite(parsed)) {
    throw new Error("Invalid Antigravity tar entry size");
  }
  return parsed;
}

let installSequence = 1;

function ensurePrivateDir(dirPath: string, platform: NodeJS.Platform): void {
  if (existsSync(dirPath)) {
    if (!lstatSync(dirPath).isDirectory()) {
      throw new Error("Antigravity installation path is not a real directory");
    }
    return;
  }
  mkdirSync(dirPath, { recursive: true, mode: platform === "win32" ? undefined : 0o700 });
}

function formatMiB(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))}`;
}

export async function installAntigravityRuntime(options: InstallAntigravityRuntimeOptions = {}): Promise<{
  path: string;
  version: string;
}> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const musl = options.musl ?? false;
  const fetchImpl = options.fetchImpl ?? fetch;
  const onProgress = options.onProgress;
  const verifyVersion = options.verifyVersion ?? ((bin) => verifyAntigravityBinaryVersion(bin, env));

  const target = antigravityReleaseTarget(platform, arch, musl);
  const root = managedAntigravityDirectory({ env, homeDir, platform, arch, musl });

  onProgress?.({ phase: "manifest", message: "Checking Google's official Antigravity release..." });

  const manifestUrl = `${ANTIGRAVITY_MANIFEST_BASE}/${target}.json`;
  const manifestRes = await fetchImpl(manifestUrl, {
    redirect: "error",
    signal: options.signal,
  });
  if (!manifestRes.ok) {
    throw new Error(`Official Antigravity manifest returned HTTP ${manifestRes.status}`);
  }
  const manifestLengthHeader = manifestRes.headers.get("content-length");
  if (manifestLengthHeader && Number(manifestLengthHeader) > MAX_MANIFEST_BYTES) {
    throw new Error("Antigravity release manifest exceeded its size limit");
  }
  const manifestBytes = Buffer.from(await manifestRes.arrayBuffer());
  if (manifestBytes.length > MAX_MANIFEST_BYTES) {
    throw new Error("Antigravity release manifest exceeded its size limit");
  }
  const manifestJson = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  const release = parseAntigravityRelease(manifestJson, platform, arch, musl);

  ensurePrivateDir(root, platform);

  const stageId = `${Date.now()}-${process.pid}-${installSequence++}`;
  const stageDir = join(root, `.install-${stageId}`);
  const tempActiveRecord = join(root, `.active-${stageId}.json`);
  let published = false;

  mkdirSync(stageDir, { mode: platform === "win32" ? undefined : 0o700 });

  try {
    const archivePath = join(stageDir, "download");
    const downloadRes = await fetchImpl(release.url, {
      redirect: "error",
      signal: options.signal,
    });
    if (!downloadRes.ok) {
      throw new Error(`Official Antigravity download returned HTTP ${downloadRes.status}`);
    }
    const contentLengthHeader = downloadRes.headers.get("content-length");
    const total =
      contentLengthHeader && Number.isFinite(Number(contentLengthHeader)) && Number(contentLengthHeader) > 0
        ? Number(contentLengthHeader)
        : null;
    if (total !== null && total > MAX_DOWNLOAD_BYTES) {
      throw new Error("Official Antigravity download exceeded its size limit");
    }
    if (!downloadRes.body) {
      throw new Error("Antigravity download returned an empty response body");
    }

    const hash = createHash("sha512");
    const fd = openSync(archivePath, "wx", platform === "win32" ? undefined : 0o600);
    closeSync(fd);
    const out = createWriteStream(archivePath, { flags: "w" });
    let downloaded = 0;
    let lastProgressEmit = 0;
    onProgress?.({
      phase: "downloading",
      bytes: 0,
      total,
      message: total
        ? `Downloading Antigravity ${release.version} (0 / ${formatMiB(total)} MiB)...`
        : `Downloading Antigravity ${release.version}...`,
    });

    const reader = downloadRes.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!value || value.byteLength === 0) {
          continue;
        }
        downloaded += value.byteLength;
        if (downloaded > MAX_DOWNLOAD_BYTES) {
          throw new Error("Antigravity runtime download exceeded its size limit");
        }
        hash.update(value);
        if (!out.write(value)) {
          await new Promise<void>((resolveDrain, rejectDrain) => {
            out.once("drain", resolveDrain);
            out.once("error", rejectDrain);
          });
        }
        const now = Date.now();
        if (now - lastProgressEmit >= 120 || (total !== null && downloaded === total)) {
          lastProgressEmit = now;
          onProgress?.({
            phase: "downloading",
            bytes: downloaded,
            total,
            message: total
              ? `Downloading Antigravity ${release.version} (${formatMiB(downloaded)} / ${formatMiB(total)} MiB)...`
              : `Downloading Antigravity ${release.version} (${formatMiB(downloaded)} MiB)...`,
          });
        }
      }
    } finally {
      reader.releaseLock();
      await new Promise<void>((resolveEnd, rejectEnd) => {
        out.once("error", rejectEnd);
        out.end(() => resolveEnd());
      });
    }

    if (downloaded === 0 || (total !== null && downloaded !== total)) {
      throw new Error("Antigravity download was empty or truncated");
    }
    const actualDigest = hash.digest("hex");
    if (actualDigest !== release.digest) {
      throw new Error("Antigravity SHA-512 verification failed; no runtime was installed");
    }

    onProgress?.({ phase: "extracting", message: "Extracting and verifying Antigravity..." });
    const stagedBinary = await extractAntigravityArchive(archivePath, stageDir, platform);

    onProgress?.({ phase: "verifying", message: "Checking Antigravity CLI version..." });
    const actualVersion = await verifyVersion(stagedBinary);
    if (actualVersion !== release.version) {
      throw new Error(`Downloaded Antigravity version ${actualVersion} does not match manifest ${release.version}`);
    }

    const versionsDir = join(root, "versions");
    await mkdir(versionsDir, { recursive: true, mode: platform === "win32" ? undefined : 0o700 });
    const releaseId = `${release.version}-${stageId}`;
    const finalDir = join(versionsDir, releaseId);
    await rename(stageDir, finalDir);
    const finalBinary = join(finalDir, antigravityExecutableName(platform));
    await writeFile(tempActiveRecord, JSON.stringify({ release: releaseId }), { encoding: "utf8" });
    await rename(tempActiveRecord, join(root, "active.json"));
    published = true;

    onProgress?.({
      phase: "installed",
      path: finalBinary,
      version: actualVersion,
      message: `Antigravity ${actualVersion} installed`,
    });
    return { path: finalBinary, version: actualVersion };
  } finally {
    if (!published) {
      await rm(tempActiveRecord, { force: true }).catch(() => undefined);
      await rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
