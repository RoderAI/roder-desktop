import { expect, it, vi } from "vitest";
import {
  openMacComputerUseSettings,
  openMacFullDiskAccessSettings,
  readMacComputerUsePermissions,
} from "../electron/onboarding/macos-computer-use";

it("only reports permissions verified under the standalone driver identity", async () => {
  const status = { accessibility: true, screen_recording: false };
  const check = (attribution: string) =>
    readMacComputerUsePermissions("darwin", {
      installed: async () => true,
      status: async () => JSON.stringify({ ...status, source: { attribution } }),
    });
  expect(await check("driver-daemon")).toEqual({ installed: true, accessibility: true, screenRecording: false });
  expect(await check("caller")).toEqual({ installed: true, accessibility: null, screenRecording: null });
});

it("distinguishes a missing driver from a driver whose status could not be read", async () => {
  const status = async () => {
    throw new Error("No driver daemon");
  };
  expect(await readMacComputerUsePermissions("darwin", { installed: async () => false, status })).toEqual({
    installed: false,
    accessibility: null,
    screenRecording: null,
  });
  expect(await readMacComputerUsePermissions("darwin", { installed: async () => true, status })).toEqual({
    installed: true,
    accessibility: null,
    screenRecording: null,
  });
});

it("never probes the driver on other platforms", async () => {
  const installed = vi.fn<() => Promise<boolean>>(async () => true);
  const status = vi.fn<() => Promise<string>>(async () => "{}");
  expect(await readMacComputerUsePermissions("linux", { installed, status })).toEqual({
    installed: false,
    accessibility: null,
    screenRecording: null,
  });
  expect(installed).not.toHaveBeenCalled();
  expect(status).not.toHaveBeenCalled();
});

it("opens only the two intended macOS settings panes", async () => {
  const urls: string[] = [];
  const open = async (url: string) => {
    urls.push(url);
  };
  await openMacComputerUseSettings("darwin", "accessibility", open);
  await openMacComputerUseSettings("darwin", "screenRecording", open);
  await expect(openMacComputerUseSettings("darwin", "other", open)).rejects.toThrow("Unknown computer-use permission");
  await expect(openMacComputerUseSettings("linux", "accessibility", open)).rejects.toThrow("only available on macOS");
  expect(urls).toEqual([
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  ]);
});

it("opens the Full Disk Access pane only on macOS", async () => {
  const open = vi.fn<(url: string) => Promise<void>>(async () => {});
  await openMacFullDiskAccessSettings("darwin", "26.6.1", open);
  await openMacFullDiskAccessSettings("darwin", "12.7.6", open);
  await expect(openMacFullDiskAccessSettings("win32", "10.0.0", open)).rejects.toThrow("only available on macOS");
  expect(open.mock.calls).toEqual([
    ["x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles"],
    ["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"],
  ]);
});
