import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { AgentBackendsManager } from "../electron/roder/agent-backends";
import { RoderAppServerClient } from "../electron/roder/app-server-client";
import type { RoderThread, RoderTurn } from "../src/types/roder";

vi.mock("electron", () => ({ app: { isPackaged: false, getVersion: () => "live-smoke" } }));

test.skipIf(process.env.RODER_DESKTOP_LIVE_CLAUDE !== "1")(
  "runs Claude through the bundled Desktop sidecar",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "roder-desktop-live-"));
    const config = join(directory, "config");
    await mkdir(config);
    await writeFile(join(config, "config.toml"), '[policy_modes]\ndefault = "bypass"\n');
    await writeFile(join(directory, "sample.txt"), "RODER_DESKTOP_CLAUDE_OK\n");
    Object.defineProperty(process, "resourcesPath", { value: directory, configurable: true });
    const notify = vi.fn<(event: { method: string; params: unknown }) => void>();
    const backend = "claude-code";
    const manager = new AgentBackendsManager({
      createClient: (selected) =>
        new RoderAppServerClient({ backend: selected, getExtraEnv: () => ({ RODER_CONFIG_DIR: config }) }),
      onNotification: notify,
    });
    try {
      await expect(manager.selectBackend(backend)).resolves.toMatchObject({ activeBackend: backend });
      const { thread } = (await manager.handleRequest(backend, "thread/start", {
        workspaceId: "live",
        cwd: directory,
        model: "haiku",
      })) as { thread: RoderThread };
      const identity = { threadId: thread.id };
      await manager.handleRequest(backend, "turn/start", {
        ...identity,
        prompt: "Use Read on sample.txt once then reply with its only line. Do not modify files.",
      });
      const event = <T>(method: string): T | undefined =>
        notify.mock.calls.find(([item]) => item.method === method)?.[0].params as T | undefined;
      const wait = { timeout: 35_000, interval: 160 };
      const approval = await vi.waitFor(() => {
        const entry = event<{ approvalId: string; reason: string }>("thread/approvalRequested");
        expect(entry?.reason).toContain("Trust this workspace");
        return entry!;
      }, wait);
      expect(manager.backendForApproval(approval.approvalId)).toBe(backend);
      await manager.handleRequest(backend, "thread/resolve_approval", {
        approvalId: approval.approvalId,
        approved: true,
      });
      const result = await vi.waitFor(() => {
        const entry = event<{ turn: RoderTurn }>("turn/completed");
        expect(entry?.turn.status).toBe("completed");
        return entry!;
      }, wait);
      expect(result.turn.usage?.total_tokens).toBeGreaterThan(0);
      expect(event<{ workingStatus: string }>("turn/progress")?.workingStatus).toContain("…");
      for (const [command, heading] of [
        ["workflows", "Dynamic workflows"],
        ["tasks", "Background"],
      ]) {
        await manager.handleRequest(backend, "thread/terminal/input", {
          ...identity,
          input: { kind: "command", command },
        });
        await vi.waitFor(async () => {
          const frame = (await manager.handleRequest(backend, "thread/terminal/read", identity)) as { lines: string[] };
          expect(frame.lines.some((line) => line.trim() === heading)).toBe(true);
        }, wait);
        await manager.handleRequest(backend, "thread/terminal/input", {
          ...identity,
          input: { kind: "key", key: "Escape" },
        });
        await vi.waitFor(async () => {
          await expect(manager.handleRequest(backend, "thread/terminal/read", identity)).resolves.toMatchObject({
            readyForTurn: true,
          });
        }, wait);
      }
      await manager.handleRequest(backend, "thread/unload", identity);
      const page = (await manager.handleRequest(backend, "thread/history/read", identity)) as { thread: RoderThread };
      expect(page.thread.turns?.[0]?.usage).toEqual(result.turn.usage);
      expect(JSON.stringify(page.thread.turns)).toContain("RODER_DESKTOP_CLAUDE_OK");
    } finally {
      await manager.stopAll();
      Reflect.deleteProperty(process, "resourcesPath");
      await rm(directory, { recursive: true, force: true });
    }
  },
  90_000,
);
