import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RoderThemeDefinition } from "@roderai/extension-api";
import type { ExtensionCatalogRecord } from "./catalog";

export type ExtensionTheme = RoderThemeDefinition & {
  id: string;
  extensionId: string;
  label: string;
};

export async function readExtensionTheme(extension: ExtensionCatalogRecord, themeId: string): Promise<ExtensionTheme> {
  const contribution = extension.manifest.contributes.themes.find((theme) => theme.id === themeId);
  if (!contribution) {
    throw new Error(`Theme ${themeId} is not contributed by ${extension.id}`);
  }
  const packageRoot = resolve(extension.source.path);
  const themePath = resolve(packageRoot, contribution.path);
  if (!themePath.startsWith(`${packageRoot}/`) && themePath !== packageRoot) {
    throw new Error(`Theme ${themeId} points outside the extension package`);
  }
  const parsed = JSON.parse(await readFile(themePath, "utf8")) as unknown;
  const definition = validateThemeDefinition(parsed, themeId);
  if (definition.scheme !== contribution.scheme) {
    throw new Error(`Theme ${themeId} scheme does not match its manifest contribution`);
  }
  return {
    ...definition,
    id: themeId,
    extensionId: extension.id,
    label: contribution.label,
  };
}

function validateThemeDefinition(value: unknown, themeId: string): RoderThemeDefinition {
  const record = asRecord(value);
  const colors = asRecord(record?.colors);
  if (!record || !colors) {
    throw new Error(`Theme ${themeId} must be an object with colors`);
  }
  const scheme = record.scheme;
  if (scheme !== "light" && scheme !== "dark") {
    throw new Error(`Theme ${themeId} must declare scheme light or dark`);
  }
  const definition: RoderThemeDefinition = {
    name: requiredString(record.name, `Theme ${themeId} name`),
    scheme,
    colors: {
      accent: requiredHex(colors.accent, `Theme ${themeId} colors.accent`),
      background: requiredHex(colors.background, `Theme ${themeId} colors.background`),
      foreground: requiredHex(colors.foreground, `Theme ${themeId} colors.foreground`),
      sidebar: requiredHex(colors.sidebar, `Theme ${themeId} colors.sidebar`),
    },
  };
  if (typeof record.uiFont === "string") {
    definition.uiFont = record.uiFont;
  }
  if (typeof record.codeFont === "string") {
    definition.codeFont = record.codeFont;
  }
  if (typeof record.translucentSidebar === "boolean") {
    definition.translucentSidebar = record.translucentSidebar;
  }
  if (typeof record.contrast === "number") {
    definition.contrast = clamp(record.contrast, 0, 100);
  }
  if (typeof record.uiFontSize === "number") {
    definition.uiFontSize = clamp(record.uiFontSize, 11, 18);
  }
  if (typeof record.codeFontSize === "number") {
    definition.codeFontSize = clamp(record.codeFontSize, 11, 18);
  }
  return definition;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requiredHex(value: unknown, label: string): string {
  const stringValue = requiredString(value, label);
  if (!/^#[0-9a-fA-F]{6}$/.test(stringValue)) {
    throw new Error(`${label} must be a 6-digit hex color`);
  }
  return stringValue;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
