import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractAntigravityArchive,
  installAntigravityRuntime,
  parseAntigravityRelease,
  parseAntigravityVersionOutput,
  type AntigravityInstallProgress,
} from "../electron/roder/antigravity-installer";
import { findAntigravityRuntime } from "../electron/roder/agent-backends";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "roder-agy-installer-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function buildTarHeader(options: { name: string; size: number; typeflag?: string; corruptChecksum?: boolean }): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(options.name, 0, Math.min(100, options.name.length), "utf8");
  header.write("0000755\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  const sizeOctal = options.size.toString(8).padStart(11, "0");
  header.write(`${sizeOctal}\0`, 124, "ascii");
  header.write("00000000000\0", 136, "ascii");
  header.fill(32, 148, 156);
  header.write(options.typeflag ?? "0", 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");

  let checksum = 0;
  for (let i = 0; i < 512; i += 1) {
    checksum += header[i];
  }
  if (options.corruptChecksum) {
    checksum += 7;
  }
  const checksumOctal = checksum.toString(8).padStart(6, "0");
  header.write(`${checksumOctal}\0 `, 148, "ascii");
  return header;
}

function buildTarGz(
  entries: Array<{ name: string; content: Buffer; typeflag?: string; corruptChecksum?: boolean }>,
): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    blocks.push(
      buildTarHeader({
        name: entry.name,
        size: entry.content.length,
        typeflag: entry.typeflag,
        corruptChecksum: entry.corruptChecksum,
      }),
    );
    blocks.push(entry.content);
    const padding = (512 - (entry.content.length % 512)) % 512;
    if (padding > 0) {
      blocks.push(Buffer.alloc(padding, 0));
    }
  }
  blocks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(blocks));
}

function sha512Hex(data: Buffer): string {
  return createHash("sha512").update(data).digest("hex");
}

describe("parseAntigravityRelease", () => {
  const validDigest = "a".repeat(128);

  it("accepts official macOS, Linux, and Windows manifests", () => {
    expect(
      parseAntigravityRelease(
        {
          version: "1.5.18",
          url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-999/darwin-arm/cli_mac_arm64.tar.gz",
          sha512: validDigest.toUpperCase(),
        },
        "darwin",
        "arm64",
      ),
    ).toEqual({
      version: "1.5.18",
      url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-999/darwin-arm/cli_mac_arm64.tar.gz",
      digest: validDigest,
    });

    expect(
      parseAntigravityRelease(
        {
          version: "1.5.18",
          url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-42/linux-x64/cli_linux_x64.tar.gz",
          sha512: validDigest,
        },
        "linux",
        "x64",
      ).version,
    ).toBe("1.5.18");

    expect(
      parseAntigravityRelease(
        {
          version: "1.5.18",
          url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-42/windows-x64/cli_windows_x64.exe",
          sha512: validDigest,
        },
        "win32",
        "x64",
      ).version,
    ).toBe("1.5.18");
  });

  it("rejects old versions, untrusted URLs, wrong asset paths, and invalid digests", () => {
    expect(() =>
      parseAntigravityRelease(
        {
          version: "1.5.0",
          url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.0-1/linux-x64/cli_linux_x64.tar.gz",
          sha512: validDigest,
        },
        "linux",
        "x64",
      ),
    ).toThrow(/1\.5\.1/u);

    expect(() =>
      parseAntigravityRelease(
        {
          version: "1.5.18",
          url: "https://evil.example/antigravity-cli/1.5.18-1/linux-x64/cli_linux_x64.tar.gz",
          sha512: validDigest,
        },
        "linux",
        "x64",
      ),
    ).toThrow(/untrusted/iu);

    expect(() =>
      parseAntigravityRelease(
        {
          version: "1.5.18",
          url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-1/darwin-arm/cli_mac_arm64.tar.gz",
          sha512: validDigest,
        },
        "linux",
        "x64",
      ),
    ).toThrow(/untrusted/iu);

    expect(() =>
      parseAntigravityRelease(
        {
          version: "1.5.18",
          url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-1/linux-x64/cli_linux_x64.tar.gz",
          sha512: "deadbeef",
        },
        "linux",
        "x64",
      ),
    ).toThrow(/sha-512/iu);
  });
});

describe("parseAntigravityVersionOutput", () => {
  it("extracts valid semver versions and rejects outdated or missing versions", () => {
    expect(parseAntigravityVersionOutput("antigravity 1.5.18 (build 123)")).toBe("1.5.18");
    expect(parseAntigravityVersionOutput("v1.6.0\n")).toBe("1.6.0");
    expect(() => parseAntigravityVersionOutput("antigravity 1.4.9")).toThrow(/too old/iu);
    expect(() => parseAntigravityVersionOutput("unknown build")).toThrow(/valid version/iu);
  });
});

describe("extractAntigravityArchive", () => {
  it("extracts a valid single-entry antigravity tar.gz with executable permissions", async () => {
    const dir = await makeTempDir();
    const payload = Buffer.from("#!/bin/sh\necho antigravity 1.5.18\n", "utf8");
    const archivePath = join(dir, "download");
    await writeFile(archivePath, buildTarGz([{ name: "antigravity", content: payload }]));

    const extracted = await extractAntigravityArchive(archivePath, dir, "linux");
    expect(extracted).toBe(join(dir, "antigravity"));
    expect(await readFile(extracted)).toEqual(payload);
    const info = await stat(extracted);
    expect(process.platform === "win32" ? 0o700 : info.mode & 0o777).toBe(0o700);
  });

  it("rejects symlinks, unexpected filenames, corrupt checksums, and extra entries", async () => {
    const dir = await makeTempDir();
    const payload = Buffer.from("binary-data", "utf8");

    const symlinkArchive = join(dir, "symlink.tgz");
    await writeFile(symlinkArchive, buildTarGz([{ name: "antigravity", content: payload, typeflag: "2" }]));
    await expect(extractAntigravityArchive(symlinkArchive, dir, "linux")).rejects.toThrow(/regular executable/iu);

    const wrongNameArchive = join(dir, "wrong-name.tgz");
    await writeFile(wrongNameArchive, buildTarGz([{ name: "other-bin", content: payload }]));
    await expect(extractAntigravityArchive(wrongNameArchive, dir, "linux")).rejects.toThrow(/regular executable/iu);

    const badChecksumArchive = join(dir, "bad-checksum.tgz");
    await writeFile(badChecksumArchive, buildTarGz([{ name: "antigravity", content: payload, corruptChecksum: true }]));
    await expect(extractAntigravityArchive(badChecksumArchive, dir, "linux")).rejects.toThrow(/checksum/iu);

    const extraEntryArchive = join(dir, "extra.tgz");
    await writeFile(
      extraEntryArchive,
      buildTarGz([
        { name: "antigravity", content: payload },
        { name: "extra", content: Buffer.from("nope", "utf8") },
      ]),
    );
    await expect(extractAntigravityArchive(extraEntryArchive, dir, "linux")).rejects.toThrow(/extra entries/iu);
  });
});

describe("installAntigravityRuntime", () => {
  it("downloads, verifies SHA-512, extracts, checks version, and publishes active.json", async () => {
    const rootDir = await makeTempDir();
    const payload = Buffer.from("#!/bin/sh\necho antigravity 1.5.18\n", "utf8");
    const archive = buildTarGz([{ name: "antigravity", content: payload }]);
    const digest = sha512Hex(archive);
    const downloadUrl =
      "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-777/linux-x64/cli_linux_x64.tar.gz";

    const progressEvents: AntigravityInstallProgress[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/linux_amd64.json")) {
        return new Response(JSON.stringify({ version: "1.5.18", url: downloadUrl, sha512: digest }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === downloadUrl) {
        return new Response(new Uint8Array(archive), {
          status: 200,
          headers: { "content-length": String(archive.length) },
        });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await installAntigravityRuntime({
      env: { RODER_CONFIG_DIR: rootDir },
      platform: "linux",
      arch: "x64",
      fetchImpl,
      verifyVersion: async () => "1.5.18",
      onProgress: (event) => progressEvents.push(event),
    });

    expect(result.version).toBe("1.5.18");
    expect(await readFile(result.path)).toEqual(payload);
    expect(
      findAntigravityRuntime({
        env: { RODER_CONFIG_DIR: rootDir, PATH: "" },
        homeDir: rootDir,
        platform: "linux",
        arch: "x64",
      }),
    ).toBe(result.path);

    const phases = progressEvents.map((event) => event.phase);
    expect(phases).toContain("manifest");
    expect(phases).toContain("downloading");
    expect(phases).toContain("extracting");
    expect(phases).toContain("verifying");
    expect(phases[phases.length - 1]).toBe("installed");
  });

  it("refuses to install when SHA-512 verification fails", async () => {
    const rootDir = await makeTempDir();
    const archive = buildTarGz([{ name: "antigravity", content: Buffer.from("fake", "utf8") }]);
    const downloadUrl =
      "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.18-777/linux-x64/cli_linux_x64.tar.gz";

    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/linux_amd64.json")) {
        return new Response(JSON.stringify({ version: "1.5.18", url: downloadUrl, sha512: "0".repeat(128) }), {
          status: 200,
        });
      }
      return new Response(new Uint8Array(archive), {
        status: 200,
        headers: { "content-length": String(archive.length) },
      });
    };

    await expect(
      installAntigravityRuntime({
        env: { RODER_CONFIG_DIR: rootDir },
        platform: "linux",
        arch: "x64",
        fetchImpl,
        verifyVersion: async () => "1.5.18",
      }),
    ).rejects.toThrow(/sha-512/iu);

    expect(
      findAntigravityRuntime({
        env: { RODER_CONFIG_DIR: rootDir, PATH: "" },
        homeDir: rootDir,
        platform: "linux",
        arch: "x64",
      }),
    ).toBeNull();
  });
});
