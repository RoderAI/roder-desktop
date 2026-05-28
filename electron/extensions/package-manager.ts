import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import { ManifestValidationError, validateExtensionManifest, type RoderExtensionManifest } from "./manifest";

export type ExtensionPackage = {
  manifest: RoderExtensionManifest;
  packageRoot: string;
  packageJsonPath: string;
};

export type ArchiveExtractionOptions = {
  appVersion: string;
  installBasePath: string;
};

export async function readExtensionPackageFromFolder(
  folderPath: string,
  appVersion: string,
): Promise<ExtensionPackage> {
  const packageRoot = resolve(folderPath);
  const packageJsonPath = join(packageRoot, "package.json");
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read extension package.json at ${packageJsonPath}: ${(error as Error).message}`);
  }

  try {
    return {
      manifest: validateExtensionManifest(packageJson, { packageRoot, appVersion }),
      packageRoot,
      packageJsonPath,
    };
  } catch (error) {
    if (error instanceof ManifestValidationError) {
      throw new Error(error.message);
    }
    throw error;
  }
}

export async function extractExtensionPackageArchive(
  archivePath: string,
  options: ArchiveExtractionOptions,
): Promise<ExtensionPackage> {
  if (!archivePath.endsWith(".rdx")) {
    throw new Error("Extension archive must use the .rdx extension");
  }
  const archive = unzipSync(new Uint8Array(await readFile(archivePath)));
  const entries = Object.entries(archive);
  const packageJsonEntry = entries.find(([name]) => normalizeArchiveEntryName(name) === "package.json");
  if (!packageJsonEntry) {
    throw new Error("Extension archive must include package.json at the archive root");
  }
  const packageJson = JSON.parse(Buffer.from(packageJsonEntry[1]).toString("utf8")) as unknown;
  const manifest = validateArchiveManifest(packageJson, options.appVersion);
  const stagingRoot = join(options.installBasePath, ".staging", `${manifest.id}-${Date.now()}`);
  const packageRoot = join(options.installBasePath, manifest.id);

  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  try {
    for (const [name, data] of entries) {
      const relativePath = safeArchiveEntryName(name);
      if (!relativePath) {
        continue;
      }
      const destination = join(stagingRoot, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, Buffer.from(data));
    }
    const extensionPackage = await readExtensionPackageFromFolder(stagingRoot, options.appVersion);
    if (extensionPackage.manifest.id !== manifest.id) {
      throw new Error("Extension archive manifest changed during extraction");
    }
    await mkdir(options.installBasePath, { recursive: true });
    await rm(packageRoot, { recursive: true, force: true });
    await rename(stagingRoot, packageRoot);
    return {
      manifest: extensionPackage.manifest,
      packageRoot,
      packageJsonPath: join(packageRoot, "package.json"),
    };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

function validateArchiveManifest(packageJson: unknown, appVersion: string): RoderExtensionManifest {
  try {
    return validateExtensionManifest(packageJson, { appVersion });
  } catch (error) {
    if (error instanceof ManifestValidationError) {
      throw new Error(error.message);
    }
    throw error;
  }
}

function safeArchiveEntryName(name: string): string | null {
  if (name.endsWith("/")) {
    return null;
  }
  const normalized = normalizeArchiveEntryName(name);
  if (!normalized) {
    return null;
  }
  if (
    isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith(`..${sep}`) ||
    normalized.startsWith("../")
  ) {
    throw new Error(`Unsafe extension archive entry: ${name}`);
  }
  return normalized;
}

function normalizeArchiveEntryName(name: string): string {
  return normalize(name.replace(/\\/g, "/")).split(sep).join("/");
}
