import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { onboardingRecordPath, readOnboardingRecord, writeOnboardingRecord } from "../electron/onboarding/record";

describe("onboarding record", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "roder-onboarding-record-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps the flag in ~/.roder by default and honours RODER_CONFIG_DIR", () => {
    expect(onboardingRecordPath({}, "/home/pat")).toBe("/home/pat/.roder/desktop-onboarding.json");
    expect(onboardingRecordPath({ RODER_CONFIG_DIR: "/custom" }, "/home/pat")).toBe("/custom/desktop-onboarding.json");
    expect(onboardingRecordPath({ RODER_CONFIG_DIR: "  " }, "/home/pat")).toBe(
      "/home/pat/.roder/desktop-onboarding.json",
    );
  });

  it("reads as not onboarded when the file is missing", async () => {
    await expect(readOnboardingRecord(join(root, "nope.json"))).resolves.toEqual({
      onboarded: false,
      completedAt: null,
    });
  });

  it("round-trips a completed record and creates the folder on first write", async () => {
    const path = join(root, "fresh", ".roder", "desktop-onboarding.json");

    await writeOnboardingRecord(path, "2026-10-24T18:00:00.000Z");

    await expect(readOnboardingRecord(path)).resolves.toEqual({
      onboarded: true,
      completedAt: "2026-10-24T18:00:00.000Z",
    });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      version: 1,
      onboarded: true,
      completed_at: "2026-10-24T18:00:00.000Z",
    });
  });

  it("treats a corrupt or unknown-version file as not onboarded instead of throwing", async () => {
    const path = join(root, "desktop-onboarding.json");

    writeFileSync(path, "{ not json");
    await expect(readOnboardingRecord(path)).resolves.toEqual({ onboarded: false, completedAt: null });

    writeFileSync(path, JSON.stringify({ version: 9, onboarded: true }));
    await expect(readOnboardingRecord(path)).resolves.toEqual({ onboarded: false, completedAt: null });
  });
});
