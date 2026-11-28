import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import type { MacComputerUsePermissions } from "../../src/lib/macos-computer-use";

const driver = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
const exec = promisify(execFile);

const driverChecks = {
  installed: () =>
    access(driver, constants.X_OK).then(
      () => true,
      () => false,
    ),
  status: async () => {
    // Do not pass provider credentials or driver overrides to the status client.
    const { HOME, LANG, TMPDIR } = process.env;
    const { stdout } = await exec(driver, ["permissions", "status", "--json"], {
      env: { HOME, LANG, TMPDIR, PATH: "/usr/bin:/bin", CUA_DRIVER_RS_TELEMETRY_ENABLED: "0" },
      timeout: 3_000,
      maxBuffer: 32_768,
    });
    return stdout;
  },
};

export async function readMacComputerUsePermissions(
  platform: NodeJS.Platform,
  checks = driverChecks,
): Promise<MacComputerUsePermissions> {
  const installed = platform === "darwin" && (await checks.installed());
  const unknown = { installed, accessibility: null, screenRecording: null };
  if (!installed) return unknown;
  try {
    const status = JSON.parse(await checks.status()) as {
      source?: { attribution?: unknown };
      accessibility?: unknown;
      screen_recording?: unknown;
    } | null;
    // A CLI fallback can report the launching app's grants instead of CuaDriver's.
    if (status?.source?.attribution !== "driver-daemon") return unknown;
    return {
      installed,
      accessibility: typeof status.accessibility === "boolean" ? status.accessibility : null,
      screenRecording: typeof status.screen_recording === "boolean" ? status.screen_recording : null,
    };
  } catch {
    return unknown;
  }
}

export async function openMacComputerUseSettings(
  platform: NodeJS.Platform,
  permission: unknown,
  open: (url: string) => Promise<void>,
): Promise<void> {
  if (platform !== "darwin") throw new Error("These privacy settings are only available on macOS.");
  const pane =
    permission === "accessibility"
      ? "Privacy_Accessibility"
      : permission === "screenRecording"
        ? "Privacy_ScreenCapture"
        : null;
  if (!pane) throw new Error("Unknown computer-use permission.");
  await open(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
}

export async function openMacFullDiskAccessSettings(
  platform: NodeJS.Platform,
  systemVersion: string,
  open: (url: string) => Promise<void>,
): Promise<void> {
  if (platform !== "darwin") throw new Error("Full Disk Access is only available on macOS.");
  const pane =
    Number.parseInt(systemVersion, 10) < 13
      ? "com.apple.preference.security"
      : "com.apple.settings.PrivacySecurity.extension";
  await open(`x-apple.systempreferences:${pane}?Privacy_AllFiles`);
}
