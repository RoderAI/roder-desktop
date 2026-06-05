export function normalizeRelativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts: string[] = [];
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (parts.length > 0 && parts.at(-1) !== "..") {
        parts.pop();
      } else {
        parts.push("..");
      }
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}

export function filePanelBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

export function joinAbsolutePath(rootPath: string, relativePath: string): string {
  const root = rootPath.replace(/[\\/]+$/, "");
  return relativePath ? `${root}/${relativePath}` : root;
}

export function absolutePathForDirectory(rootPath: string, relativePath: string): string {
  const root = rootPath.replace(/[\\/]+$/, "");
  return relativePath ? `${root}/${relativePath}` : root;
}

export function isWithinRoot(rootPath: string, absolutePath: string): boolean {
  const root = rootPath.replace(/[\\/]+$/, "");
  return absolutePath === root || absolutePath.startsWith(`${root}/`);
}
