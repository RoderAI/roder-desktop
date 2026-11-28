import { EventEmitter } from "node:events";
import type { ChildProcess, spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { BackendSetupController, extractAuthUrl, type BackendSetupState } from "../electron/roder/backend-setup";

type FakeChild = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  killed: boolean;
  kill: () => boolean;
};

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

function waitForState(
  states: BackendSetupState[],
  predicate: (state: BackendSetupState) => boolean,
  timeoutMs = 2000,
): Promise<BackendSetupState> {
  const existing = states.find(predicate);
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const match = states.find(predicate);
      if (match) {
        clearInterval(timer);
        resolve(match);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for setup state. Observed: ${JSON.stringify(states)}`));
      }
    }, 10);
  });
}

describe("extractAuthUrl", () => {
  it("extracts Google OAuth URLs from agy login output and ignores non-https text", () => {
    const output = [
      "Open this link in a browser to log in with Google:",
      "",
      "  https://accounts.google.com/o/oauth2/auth?client_id=abc&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback.",
      "",
      "Then paste the authorization code:",
    ].join("\n");
    expect(extractAuthUrl(output)).toBe(
      "https://accounts.google.com/o/oauth2/auth?client_id=abc&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback",
    );
    expect(extractAuthUrl("no link here http://localhost:3000")).toBeNull();
  });
});

describe("BackendSetupController", () => {
  it("installs Antigravity natively, opens Google OAuth, submits code via stdin, and activates backend", async () => {
    const states: BackendSetupState[] = [];
    const openedUrls: string[] = [];
    const child = createFakeChild();
    const stdinChunks: string[] = [];
    child.stdin.on("data", (chunk: Buffer) => {
      stdinChunks.push(chunk.toString("utf8"));
    });

    const spawnProcess = vi.fn<typeof spawn>(() => child as unknown as ChildProcess);
    const connectAndActivate = vi.fn<() => Promise<{ connected: boolean; modelCount: number }>>(async () => ({
      connected: true,
      modelCount: 6,
    }));

    const controller = new BackendSetupController({
      resolveRoderBinary: () => "/app/resources/bin/roder",
      findRuntime: () => null,
      installAntigravity: async ({ onProgress }) => {
        onProgress?.({ phase: "manifest", message: "Checking release..." });
        onProgress?.({ phase: "downloading", bytes: 50, total: 100, message: "Downloading..." });
        onProgress?.({ phase: "extracting", message: "Extracting..." });
        onProgress?.({ phase: "verifying", message: "Verifying..." });
        return {
          path: "/home/test/.roder/tools/antigravity/linux_amd64/versions/1.5.18-1/antigravity",
          version: "1.5.18",
        };
      },
      openExternal: async (url) => {
        openedUrls.push(url);
      },
      probeExistingConnection: async () => ({ connected: false, modelCount: 0 }),
      connectAndActivate,
      spawnProcess,
      onStateChanged: (state) => states.push(state),
      env: { PATH: "/usr/bin", GEMINI_API_KEY: "should-be-stripped" },
    });

    const initial = await controller.start("antigravity");
    expect(initial.backend).toBe("antigravity");
    expect(states[0]?.phase).toBe("checking");

    await waitForState(states, (state) => state.phase === "downloading");
    await waitForState(states, () => spawnProcess.mock.calls.length === 1);

    const [cmd, args, opts] = spawnProcess.mock.calls[0];
    expect(cmd).toBe("/app/resources/bin/roder");
    expect(args).toEqual(["auth", "login", "antigravity"]);
    expect(opts?.env?.BROWSER).toBe("false");
    expect(opts?.env?.GEMINI_API_KEY).toBeUndefined();
    expect(opts?.env?.AGY_ACP_FORCE_FILE_STORAGE).toBe("1");

    const oauthUrl = "https://accounts.google.com/o/oauth2/auth?client_id=test-client";
    child.stdout.write(`Open this link in a browser:\n  ${oauthUrl}\nPaste code:\n`);

    const awaiting = await waitForState(states, (state) => state.phase === "awaiting-code");
    expect(awaiting.authUrl).toBe(oauthUrl);
    expect(openedUrls).toEqual([oauthUrl]);

    await controller.submitCode("4/0A-auth-code");
    expect(stdinChunks.join("")).toBe("4/0A-auth-code\n");
    expect(controller.getState().phase).toBe("submitting-code");

    child.exitCode = 0;
    child.emit("exit", 0);

    const completed = await waitForState(states, (state) => state.phase === "completed");
    expect(completed.message).toContain("6 models");
    expect(connectAndActivate).toHaveBeenCalledWith("antigravity");
  });

  it("completes immediately without spawning login when Antigravity is already signed in", async () => {
    const states: BackendSetupState[] = [];
    const spawnProcess = vi.fn<typeof spawn>();
    const connectAndActivate = vi.fn<() => Promise<{ connected: boolean; modelCount: number }>>(async () => ({
      connected: true,
      modelCount: 5,
    }));

    const controller = new BackendSetupController({
      resolveRoderBinary: () => "/app/resources/bin/roder",
      findRuntime: () => "/usr/local/bin/agy",
      openExternal: async () => undefined,
      probeExistingConnection: async () => ({ connected: true, modelCount: 5 }),
      connectAndActivate,
      spawnProcess,
      onStateChanged: (state) => states.push(state),
    });

    await controller.start("antigravity");
    const completed = await waitForState(states, (state) => state.phase === "completed");
    expect(completed.backend).toBe("antigravity");
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(connectAndActivate).toHaveBeenCalledWith("antigravity");
  });

  it("cancels an active OAuth child process cleanly and resets to idle", async () => {
    const states: BackendSetupState[] = [];
    const child = createFakeChild();
    const spawnProcess = vi.fn<typeof spawn>(() => child as unknown as ChildProcess);

    const controller = new BackendSetupController({
      resolveRoderBinary: () => "/app/resources/bin/roder",
      findRuntime: () => "/usr/local/bin/agy",
      openExternal: async () => undefined,
      probeExistingConnection: async () => ({ connected: false, modelCount: 0 }),
      connectAndActivate: async () => ({ connected: true, modelCount: 1 }),
      spawnProcess,
      onStateChanged: (state) => states.push(state),
    });

    await controller.start("antigravity");
    await waitForState(states, () => spawnProcess.mock.calls.length === 1);

    const cancelled = controller.cancel();
    expect(cancelled.phase).toBe("idle");
    expect(child.killed).toBe(true);
  });

  it("runs Codex browser login headlessly and activates Codex on exit 0", async () => {
    const states: BackendSetupState[] = [];
    const child = createFakeChild();
    const spawnProcess = vi.fn<typeof spawn>(() => child as unknown as ChildProcess);
    const connectAndActivate = vi.fn<() => Promise<{ connected: boolean; modelCount: number }>>(async () => ({
      connected: true,
      modelCount: 10,
    }));

    const controller = new BackendSetupController({
      resolveRoderBinary: () => "/app/resources/bin/roder",
      findRuntime: () => "/usr/local/bin/codex",
      openExternal: async () => undefined,
      probeExistingConnection: async () => ({ connected: false, modelCount: 0 }),
      connectAndActivate,
      spawnProcess,
      onStateChanged: (state) => states.push(state),
    });

    await controller.start("codex");
    const awaiting = await waitForState(states, (state) => state.phase === "awaiting-browser");
    expect(awaiting.backend).toBe("codex");
    expect(spawnProcess).toHaveBeenCalledWith("/usr/local/bin/codex", ["login"], expect.any(Object));

    child.stdout.write("Opening https://auth.openai.com/authorize?state=123\n");
    const withUrl = await waitForState(states, (state) => Boolean(state.authUrl));
    expect(withUrl.authUrl).toBe("https://auth.openai.com/authorize?state=123");

    child.exitCode = 0;
    child.emit("exit", 0);

    const completed = await waitForState(states, (state) => state.phase === "completed");
    expect(completed.message).toContain("10 models");
    expect(connectAndActivate).toHaveBeenCalledWith("codex");
  });

  it("reports a clear error when Codex CLI is not installed", async () => {
    const controller = new BackendSetupController({
      resolveRoderBinary: () => "/app/resources/bin/roder",
      findRuntime: () => null,
      openExternal: async () => undefined,
      probeExistingConnection: async () => ({ connected: false, modelCount: 0 }),
      connectAndActivate: async () => ({ connected: false, modelCount: 0 }),
    });

    const state = await controller.start("codex");
    expect(state.phase).toBe("error");
    expect(state.error).toContain("npm i -g @openai/codex");
  });
});
