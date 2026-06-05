import { filePanelBasename } from "@/lib/file-panel/path";
import type { DecodedFileContent, FilePanelMarkdownViewMode } from "@/lib/file-panel/types";
import type { WorkspaceFilesReadResult } from "@/types/roder";

const markdownPreviewExtensions = new Set(["md", "markdown"]);

export function filePanelSupportsMarkdownPreview(path: string): boolean {
  const fileName = filePanelBasename(path).toLowerCase();
  const extension = fileName.includes(".") ? fileName.split(".").pop() : "";
  return extension ? markdownPreviewExtensions.has(extension) : false;
}

export function filePanelDefaultMarkdownViewMode(path: string): FilePanelMarkdownViewMode {
  return filePanelSupportsMarkdownPreview(path) ? "preview" : "source";
}

export function nextFilePanelMarkdownViewMode(mode: FilePanelMarkdownViewMode): FilePanelMarkdownViewMode {
  return mode === "preview" ? "source" : "preview";
}

export function filePanelMarkdownToggleLabel(mode: FilePanelMarkdownViewMode): string {
  return mode === "preview" ? "Show markdown source" : "Show markdown preview";
}

export function decodeWorkspaceFileContent(
  result: WorkspaceFilesReadResult,
  options: { maxBytes: number },
): DecodedFileContent {
  const bytes = Math.max(0, result.totalBytes);
  if (result.encoding !== "utf8") {
    return { status: "binary", bytes };
  }
  const text = result.text ?? "";
  if (bytes > options.maxBytes) {
    return { status: "too-large", bytes };
  }
  return { status: "text", text, bytes, truncated: result.hasMore || result.truncated || undefined };
}

export function decodeFileContent(dataBase64: string, options: { maxBytes: number }): DecodedFileContent {
  const bytes = base64ToBytes(dataBase64);
  if (bytes.length > options.maxBytes) {
    return { status: "too-large", bytes: bytes.length };
  }
  if (bytes.includes(0)) {
    return { status: "binary", bytes: bytes.length };
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.includes("\uFFFD")) {
    return { status: "binary", bytes: bytes.length };
  }
  return { status: "text", text, bytes: bytes.length };
}

export function externalFileMarkdownPreviewHref(href: unknown): string | null {
  if (typeof href !== "string") {
    return null;
  }
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function formatFilePanelBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 102.4) / 10} KB`;
  }
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

export function filePanelContentKey(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return `${text.length}:${hash}`;
}

function base64ToBytes(dataBase64: string): Uint8Array {
  if (typeof atob === "function") {
    return Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(dataBase64, "base64"));
}
