export type AppUpdateStatus =
  | { state: "idle"; currentVersion: string }
  | { state: "checking"; currentVersion: string }
  | { state: "upToDate"; currentVersion: string }
  | {
      state: "available";
      currentVersion: string;
      availableVersion: string;
    }
  | {
      state: "downloading";
      currentVersion: string;
      availableVersion: string;
    }
  | {
      state: "ready";
      currentVersion: string;
      availableVersion: string;
    }
  | { state: "error"; currentVersion: string; message: string };

export const MACOS_UPDATE_FEED_URL = "https://dl.roder.sh/desktop/latest/updates.json";

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

/** Compare two semver-ish strings. Returns 1 if a>b, -1 if a<b, 0 if equal. */
export function compareSemver(a: string, b: string): number {
  const left = normalizeVersion(a)
    .split(/[.+-]/)
    .map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
  const right = normalizeVersion(b)
    .split(/[.+-]/)
    .map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
  const len = Math.max(left.length, right.length, 3);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff > 0) return 1;
    if (diff < 0) return -1;
  }
  return 0;
}

export function isUpdateNewer(availableVersion: string, currentVersion: string): boolean {
  return compareSemver(availableVersion, currentVersion) > 0;
}

export function parseUpdateFeed(payload: unknown): { version: string; notes: string; url: string } | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const version = typeof record.name === "string" ? normalizeVersion(record.name) : "";
  const url = typeof record.url === "string" ? record.url : "";
  if (!version || !url) {
    return null;
  }
  return {
    version,
    url,
    notes: typeof record.notes === "string" ? record.notes : `Roder Desktop ${version}`,
  };
}

export function shouldShowUpdateButton(status: AppUpdateStatus | null | undefined): boolean {
  if (!status) return false;
  return status.state === "available" || status.state === "downloading" || status.state === "ready";
}

export function updateButtonLabel(status: AppUpdateStatus): string {
  switch (status.state) {
    case "available":
      return `Update to ${normalizeVersion(status.availableVersion)}`;
    case "downloading":
      return `Downloading ${normalizeVersion(status.availableVersion)}…`;
    case "ready":
      return `Restart to update`;
    default:
      return "Update";
  }
}

export function resolveUpdateStatusFromFeed(options: {
  currentVersion: string;
  feed: { version: string } | null;
}): AppUpdateStatus {
  const currentVersion = normalizeVersion(options.currentVersion);
  if (!options.feed) {
    return { state: "upToDate", currentVersion };
  }
  if (isUpdateNewer(options.feed.version, currentVersion)) {
    return {
      state: "available",
      currentVersion,
      availableVersion: normalizeVersion(options.feed.version),
    };
  }
  return { state: "upToDate", currentVersion };
}
