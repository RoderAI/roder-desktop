export const GRID_SIZE = 24;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function decodeBase64Text(dataBase64: string): string {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0)));
  } catch {
    return atob(dataBase64);
  }
}
