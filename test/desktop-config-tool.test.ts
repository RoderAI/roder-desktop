import { expect, test, vi } from "vitest";
import { configureDesktopFromTool, desktopConfigTool } from "../electron/agents/config-tool";

test("configuration tool advertises only the restricted live RPC surface", () => {
  expect(desktopConfigTool.parameters.properties.method.enum).toContain("settings/get");
  expect(desktopConfigTool.parameters.properties.method.enum).toContain("skills/read");
  expect(desktopConfigTool.parameters.properties.method.enum).not.toContain("providers/configure");
  expect(desktopConfigTool.parameters.properties.method.enum).not.toContain("turn/start");
});

test("reads settings and forwards live changes without dropping parameters", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>().mockResolvedValue({ mode: "live" });
  await configureDesktopFromTool({ method: "settings/get" }, request);
  expect(request).toHaveBeenLastCalledWith("settings/get", {});
  expect(
    await configureDesktopFromTool({ method: "settings/set_web_search", params: { mode: "live" } }, request),
  ).toEqual({ mode: "live" });
  expect(request).toHaveBeenLastCalledWith("settings/set_web_search", { mode: "live" });
});

test.each([
  null,
  [],
  { method: "constructor" },
  { method: "providers/configure", params: { api_key: "secret" } },
  { method: "turn/start" },
  { method: "settings/get", extra: true },
  { method: "settings/get", params: [] },
  { method: "settings/get", params: { api_key: "secret" } },
  { method: "settings/set_web_search" },
  { method: "skills/setEnabled", params: { enabled: true } },
  { method: "workflow/enable", params: { itemId: "mcp-1" } },
  { method: "workflow/enable", params: { itemId: "mcp-1", approveSideEffects: false } },
])("invalid or unapproved config calls are rejected before RPC: %j", async (args) => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>();
  await expect(configureDesktopFromTool(args, request)).rejects.toThrow(/Unsupported|Unexpected|Missing|approval/);
  expect(request).not.toHaveBeenCalled();
});

test("approved workflow enable reaches the engine's normal approval path", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>().mockResolvedValue({ enabled: true });
  const params = { workspace: "/project", itemId: "mcp-1", approveSideEffects: true };
  await configureDesktopFromTool({ method: "workflow/enable", params }, request);
  expect(request).toHaveBeenCalledWith("workflow/enable", params);
});

test("config output redacts secret fields and does not forward raw backend errors", async () => {
  const request = vi
    .fn<(method: string, params: unknown) => Promise<unknown>>()
    .mockResolvedValue({ nested: [{ apiKey: "do-not-leak", name: "provider" }] });
  expect(await configureDesktopFromTool({ method: "providers/list" }, request)).toEqual({
    nested: [{ apiKey: "[redacted]", name: "provider" }],
  });
  request.mockRejectedValue(new Error("bad config: apiKey=do-not-leak"));
  await expect(configureDesktopFromTool({ method: "settings/get" }, request)).rejects.toThrow(
    "Desktop configuration request failed (settings/get)",
  );
  await expect(configureDesktopFromTool({ method: "settings/get" }, request)).rejects.not.toThrow("do-not-leak");
});

test.each([undefined, null])(
  "workflow operations default workspace=%s to the calling thread, not the app cwd",
  async (workspace) => {
    const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method) =>
      method === "thread/read" ? { thread: { cwd: "/projects/caller" } } : { scan: { items: [] } },
    );
    const params = { workspace, includeUser: true };
    await configureDesktopFromTool({ method: "workflow/scan", params }, request, "caller");
    expect(request).toHaveBeenNthCalledWith(1, "thread/read", { threadId: "caller", includeTurns: false });
    expect(request).toHaveBeenNthCalledWith(2, "workflow/scan", { workspace: "/projects/caller", includeUser: true });
    expect(params.workspace).toBe(workspace);
  },
);

test("missing caller workspace fails closed instead of falling back to another project", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>().mockResolvedValue({ thread: {} });
  await expect(configureDesktopFromTool({ method: "workflow/scan" }, request, "caller")).rejects.toThrow(
    "Desktop configuration request failed",
  );
  expect(request).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith("thread/read", { threadId: "caller", includeTurns: false });
});

test("skill discovery is scoped to the caller unless an explicit workspace is selected", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async (method) =>
    method === "thread/read" ? { thread: { cwd: "/projects/caller" } } : { skills: [] },
  );
  await configureDesktopFromTool({ method: "skills/list" }, request, "caller");
  expect(request).toHaveBeenLastCalledWith("skills/list", { cwd: "/projects/caller" });
  request.mockClear();
  await configureDesktopFromTool({ method: "skills/list", params: { workspaceId: "explicit" } }, request, "caller");
  expect(request).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith("skills/list", { workspaceId: "explicit" });
});

test.each(["workflow/scan", "workflow/preview", "workflow/refresh"])(
  "%s never exposes credentials embedded in argv, URLs or freeform diagnostics",
  async (method) => {
    const item = {
      id: "mcp-1",
      title: "Example MCP",
      state: "detected",
      risk: "startsProcess",
      commandCapable: true,
      approvalRequired: true,
      preview: { args: ["server", "--token", "argv-secret"], url: "https://host?api_key=url-secret" },
      summary: "summary-secret",
      conflicts: [{ incoming: "conflict-secret" }],
    };
    const request = vi
      .fn<(method: string, params: unknown) => Promise<unknown>>()
      .mockResolvedValue({ scan: { items: [item], diagnostics: ["diagnostic-secret"] }, items: [item], stale: [item] });
    const result = await configureDesktopFromTool({ method, params: { workspace: "/project" } }, request, "caller");
    const encoded = JSON.stringify(result);
    expect(encoded).not.toContain("secret");
    expect(encoded).toContain("mcp-1");
    expect(encoded).toContain('"approvalRequired":true');
    expect(encoded).toContain('"risk":"startsProcess"');
    expect(request).toHaveBeenCalledOnce();
  },
);
