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
const allowedRootDirectories = new Set(["dist", "assets", "themes"]);

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
  const archiveEntries = Object.fromEntries(
    await Promise.all(files.map(async (file) => [file, await readFile(join(packageRoot, file))] as const)),
  );
  await writeFile(archivePath, zipSync(archiveEntries, { level: 9 }));
  return {
    archivePath,
    files,
  };
}

export async function collectPackageFiles(packageRoot: string): Promise<string[]> {
  const root = resolve(packageRoot);
  const files = (
    await Promise.all(
      (
        await readdir(root, { withFileTypes: true })
      ).map(async (entry) => {
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          return [];
        }
        const entryPath = join(root, entry.name);
        if (entry.isFile() && allowedRootFiles.has(entry.name)) {
          return [entry.name];
        }
        if (entry.isDirectory() && allowedRootDirectories.has(entry.name)) {
          return collectDirectory(root, entryPath);
        }
        return [];
      }),
    )
  ).flat();
  return files.sort();
}

async function collectDirectory(root: string, directory: string): Promise<string[]> {
  return (
    await Promise.all(
      (
        await readdir(directory, { withFileTypes: true })
      ).map(async (entry) => {
        if (entry.name.startsWith(".")) {
          return [];
        }
        const entryPath = join(directory, entry.name);
        const entryStat = await stat(entryPath);
        if (entryStat.isDirectory()) {
          return collectDirectory(root, entryPath);
        }
        if (!entryStat.isFile()) {
          return [];
        }
        const archivePath = normalize(relative(root, entryPath)).split(sep).join("/");
        if (archivePath.startsWith("../")) {
          throw new Error(`Refusing to package path outside extension root: ${archivePath}`);
        }
        return [archivePath];
      }),
    )
  ).flat();
}

function archiveSegment(value: string): string {
  return value.replace(/^@/, "").replace(/[^\w.-]+/g, "-");
}
