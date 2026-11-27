import { expect, test, vi } from "vitest";
import { cloudMachineConfigSkill } from "../electron/agents/cloud-machine-config";
import { configureDesktopFromTool, desktopConfigTool } from "../electron/agents/config-tool";

test("desktop config saves an existing Blaxel sandbox as a retained machine profile", async () => {
  const method = "desktop/cloud-machines/save";
  const machine = { id: "m1", name: "Dev", providerId: "blaxel", workspace: "/workspace" };
  const request = vi
    .fn<(method: string, params: unknown) => Promise<unknown>>()
    .mockResolvedValueOnce({ workspace: "my-team", sandboxes: [{ name: "dev-box" }] })
    .mockResolvedValueOnce({ machine: { ...machine, config: { private: "omit" } } });
  await expect(
    configureDesktopFromTool(
      { method, params: { providerId: "blaxel", name: "Dev", workspace: "/workspace", sandboxName: "dev-box" } },
      request,
    ),
  ).resolves.toEqual({ machine });
  expect(request).toHaveBeenCalledWith(method, {
    name: "Dev",
    providerId: "blaxel",
    workspace: "/workspace",
    config: { sandbox_name: "dev-box", workspace: "my-team", working_dir: "/workspace", cleanup: "keep" },
  });
});

test("a missing Blaxel sandbox is not saved or provisioned", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>().mockResolvedValue({ workspace: "my-team", sandboxes: [{ name: "other-box" }] });
  await expect(
    configureDesktopFromTool(
      {
        method: "desktop/cloud-machines/save",
        params: { providerId: "blaxel", name: "Dev", workspace: "/workspace", sandboxName: "dev-box" },
      },
      request,
    ),
  ).rejects.toThrow("No matching sandbox");
  expect(request.mock.calls).toEqual([["desktop/cloud-machines/blaxel/sandboxes", {}]]);
});

test("machine credential status only exposes connection metadata", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>().mockResolvedValue({
    statuses: [{ providerId: "blaxel", configured: true, preview: "sensitive", apiKey: "secret" }],
    localSsh: { identityFiles: ["/private/.ssh/id"] },
  });
  await expect(
    configureDesktopFromTool({ method: "desktop/cloud-machines/credentials/status" }, request),
  ).resolves.toEqual({
    statuses: [{ providerId: "blaxel", configured: true }],
  });
});

test.each([
  { config: { apiKey: "do-not-pass" }, sandboxName: "dev-box" },
  { sandboxName: "https://example.com/?token=do-not-pass" },
  { sandboxName: "dev-box", workspace: "relative/path" },
])("machine tool rejects arbitrary configuration, unsafe identifiers and invalid paths", async (params) => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>();
  await expect(
    configureDesktopFromTool(
      {
        method: "desktop/cloud-machines/save",
        params: { name: "Dev", providerId: "blaxel", workspace: "/workspace", ...params },
      },
      request,
    ),
  ).rejects.toThrow(Error);
  expect(request).not.toHaveBeenCalled();
});

test("config skill documents Desktop machine configuration", async () => {
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>().mockResolvedValue({
    skill: { descriptor: { name: "roder-config", source: "builtIn" }, body: "Base skill" },
  });
  const result = await configureDesktopFromTool(
    { method: "skills/read", params: { selector: { name: { name: "roder-config" } } } },
    request,
  );
  expect(result).toMatchObject({ skill: { body: `Base skill\n\n${cloudMachineConfigSkill}` } });
});
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
