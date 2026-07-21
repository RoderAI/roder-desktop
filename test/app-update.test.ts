import { expect, test } from "vitest";
import {
  compareSemver,
  isUpdateNewer,
  parseUpdateFeed,
  resolveUpdateStatusFromFeed,
  shouldShowUpdateButton,
  updateButtonLabel,
} from "../src/lib/app-update";

test("compareSemver orders dotted versions", () => {
  expect(compareSemver("0.1.2", "0.1.1")).toBe(1);
  expect(compareSemver("v0.1.1", "0.1.1")).toBe(0);
  expect(compareSemver("0.1.0", "0.1.1")).toBe(-1);
});

test("isUpdateNewer detects newer feed versions", () => {
  expect(isUpdateNewer("0.1.2", "0.1.1")).toBe(true);
  expect(isUpdateNewer("0.1.1", "0.1.1")).toBe(false);
  expect(isUpdateNewer("0.1.0", "0.1.1")).toBe(false);
});

test("parseUpdateFeed reads Squirrel.Mac JSON", () => {
  expect(
    parseUpdateFeed({
      url: "https://dl.roder.sh/desktop/latest/Roder-macos-arm64.zip",
      name: "0.1.2",
      notes: "notes",
      pub_date: "2026-07-21T00:00:00Z",
    }),
  ).toEqual({
    url: "https://dl.roder.sh/desktop/latest/Roder-macos-arm64.zip",
    version: "0.1.2",
    notes: "notes",
  });
  expect(parseUpdateFeed({})).toBeNull();
});

test("resolveUpdateStatusFromFeed marks available when feed is newer", () => {
  expect(
    resolveUpdateStatusFromFeed({
      currentVersion: "0.1.1",
      feed: { version: "0.1.2" },
    }),
  ).toEqual({
    state: "available",
    currentVersion: "0.1.1",
    availableVersion: "0.1.2",
  });
  expect(
    resolveUpdateStatusFromFeed({
      currentVersion: "0.1.1",
      feed: { version: "0.1.1" },
    }).state,
  ).toBe("upToDate");
});

test("sidebar update button visibility and labels", () => {
  expect(shouldShowUpdateButton({ state: "upToDate", currentVersion: "0.1.1" })).toBe(false);
  expect(
    shouldShowUpdateButton({
      state: "available",
      currentVersion: "0.1.1",
      availableVersion: "0.1.2",
    }),
  ).toBe(true);
  expect(
    updateButtonLabel({
      state: "available",
      currentVersion: "0.1.1",
      availableVersion: "0.1.2",
    }),
  ).toBe("Update to 0.1.2");
  expect(
    updateButtonLabel({
      state: "ready",
      currentVersion: "0.1.1",
      availableVersion: "0.1.2",
    }),
  ).toBe("Restart to update");
});
