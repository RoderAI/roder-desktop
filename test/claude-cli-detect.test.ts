import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findClaudeCli } from "../electron/onboarding/claude-cli";

describe("findClaudeCli", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "roder-claude-cli-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeExecutable(dir: string, body = "#!/bin/sh\necho claude\n", name = "claude"): string {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, name);
    writeFileSync(file, body);
    chmodSync(file, 0o755);
    return file;
  }

  it("finds a working CLI on PATH, which is what the app-server will also see", async () => {
    const bin = join(root, "bin");
    const file = makeExecutable(bin);

    await expect(
      findClaudeCli({ env: { PATH: bin }, platform: "darwin", homeDir: join(root, "home") }),
    ).resolves.toEqual({ installed: true, onPath: true, runnable: true, path: file });
  });

  it("reports a CLI in a common install folder as installed but not on PATH", async () => {
    const home = join(root, "home");
    const file = makeExecutable(join(home, ".local", "bin"));

    await expect(findClaudeCli({ env: { PATH: "/usr/bin" }, platform: "darwin", homeDir: home })).resolves.toEqual({
      installed: true,
      onPath: false,
      runnable: true,
      path: file,
    });
  });

  it("reports a broken CLI as installed but not runnable", async () => {
    const bin = join(root, "bin");
    const file = makeExecutable(bin, "#!/bin/sh\nexit 3\n");

    await expect(
      findClaudeCli({ env: { PATH: bin }, platform: "darwin", homeDir: join(root, "home") }),
    ).resolves.toEqual({ installed: true, onPath: true, runnable: false, path: file });
  });

  it("reports missing when the CLI is nowhere", async () => {
    await expect(
      findClaudeCli({ env: { PATH: join(root, "empty") }, platform: "darwin", homeDir: join(root, "home") }),
    ).resolves.toEqual({ installed: false, onPath: false, runnable: false, path: null });
  });

  it("skips a non-executable file with the same name", async () => {
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "claude"), "not a program");
    chmodSync(join(bin, "claude"), 0o644);

    const status = await findClaudeCli({ env: { PATH: bin }, platform: "darwin", homeDir: join(root, "home") });
    expect(status.installed).toBe(false);
  });
});
