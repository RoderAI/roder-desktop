import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, normalize, relative, resolve, sep } from "node:path";
import { zipSync } from "fflate";

export type CreateRdxPackageOptions = {
  packageRoot: string;
  outFile?: string;
};

export type CreateRdxPackageResult = {
  archivePath: string;
  files: string[];
};

const allowedRootFiles = new Set(["package.json", "README.md", "README", "LICENSE", "LICENSE.md"]);
const allowedRootDirectories = new Set(["dist", "assets"]);

export async function createRdxPackage(options: CreateRdxPackageOptions): Promise<CreateRdxPackageResult> {
  const packageRoot = resolve(options.packageRoot);
  const packageJsonPath = join(packageRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { name?: string; version?: string };
  const archiveName = `${archiveSegment(packageJson.name ?? basename(packageRoot))}-${archiveSegment(packageJson.version ?? "0.0.0")}.rdx`;
  const archivePath = resolve(options.outFile ?? join(packageRoot, archiveName));
  const files = await collectPackageFiles(packageRoot);
  if (!files.includes("package.json")) {
    throw new Error("Extension package must include package.json");
  }
  const archiveEntries: Record<string, Uint8Array> = {};
  for (const file of files) {
    archiveEntries[file] = await readFile(join(packageRoot, file));
  }
  await writeFile(archivePath, zipSync(archiveEntries, { level: 9 }));
  return {
    archivePath,
    files,
  };
}

export async function collectPackageFiles(packageRoot: string): Promise<string[]> {
  const root = resolve(packageRoot);
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }
    const entryPath = join(root, entry.name);
    if (entry.isFile() && allowedRootFiles.has(entry.name)) {
      files.push(entry.name);
    }
    if (entry.isDirectory() && allowedRootDirectories.has(entry.name)) {
      files.push(...(await collectDirectory(root, entryPath)));
    }
  }
  return files.sort();
}

async function collectDirectory(root: string, directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = join(directory, entry.name);
    const entryStat = await stat(entryPath);
    if (entryStat.isDirectory()) {
      files.push(...(await collectDirectory(root, entryPath)));
      continue;
    }
    if (entryStat.isFile()) {
      const archivePath = normalize(relative(root, entryPath)).split(sep).join("/");
      if (archivePath.startsWith("../")) {
        throw new Error(`Refusing to package path outside extension root: ${archivePath}`);
      }
      files.push(archivePath);
    }
  }
  return files;
}

function archiveSegment(value: string): string {
  return value.replace(/^@/, "").replace(/[^\w.-]+/g, "-");
}
