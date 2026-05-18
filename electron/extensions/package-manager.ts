import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ManifestValidationError, validateExtensionManifest, type RoderExtensionManifest } from "./manifest";

export type ExtensionPackage = {
  manifest: RoderExtensionManifest;
  packageRoot: string;
  packageJsonPath: string;
};

export async function readExtensionPackageFromFolder(folderPath: string, appVersion: string): Promise<ExtensionPackage> {
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
