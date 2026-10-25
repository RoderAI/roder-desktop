import { expect, test, vi } from "vitest";
import { DesktopAgentTools } from "../electron/agents/desktop-agent-tools";

function fixture() {
  const execute = vi
    .fn<(args: unknown, context: { threadId: string; turnId: string; requestId: string }) => Promise<unknown>>()
    .mockResolvedValue({ issue: { id: "issue-1" } });
  const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>().mockResolvedValue({ resolved: true });
  const bridge = new DesktopAgentTools(
    [{ name: "desktop_issue_create", description: "Create issue", parameters: { type: "object" }, execute }],
    request,
  );
  return { execute, request, bridge };
}

const params = {
  requestId: "req-1",
  threadId: "thread-1",
  turnId: "turn-1",
  call: { id: "tool-1", name: "desktop_issue_create", arguments: { title: "Fix crash" } },
};

test("advertises desktop tools to the engine without dropping caller tools", () => {
  const { bridge } = fixture();
  const original = {
    workspaceId: "ws",
    externalTools: [{ name: "existing", description: "Existing", parameters: {} }],
  };
  const prepared = bridge.threadStartParams(original);
  expect(prepared.externalTools).toEqual([
    ...original.externalTools,
    { name: "desktop_issue_create", description: "Create issue", parameters: { type: "object" } },
  ]);
  expect(original.externalTools).toHaveLength(1);
  expect(bridge.threadStartParams(prepared).externalTools).toHaveLength(2);
});

test("executes engine-issued calls with caller identity and resolves the native tool wait", async () => {
  const { bridge, execute, request } = fixture();
  expect(await bridge.onNotification("thread/toolExecutionRequested", params)).toBe(true);
  expect(execute).toHaveBeenCalledWith(
    { title: "Fix crash" },
    { threadId: "thread-1", turnId: "turn-1", requestId: "req-1" },
  );
  expect(request).toHaveBeenCalledWith("tools/resolve", {
    requestId: "req-1",
    turnId: "turn-1",
    output: JSON.stringify({ issue: { id: "issue-1" } }),
    isError: false,
  });
});

test("deduplicates concurrent notifications and repeats resolution without repeating mutations", async () => {
  const { bridge, execute, request } = fixture();
  await Promise.all([
    bridge.onNotification("thread/toolExecutionRequested", params),
    bridge.onNotification("thread/toolExecutionRequested", params),
  ]);
  await bridge.onNotification("thread/toolExecutionRequested", params);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(3);
});

test("reports handler failures to the waiting engine instead of stranding its turn", async () => {
  const { bridge, execute, request } = fixture();
  execute.mockRejectedValueOnce(new Error("Project does not exist"));
  await bridge.onNotification("thread/toolExecutionRequested", params);
  expect(request).toHaveBeenCalledWith("tools/resolve", {
    requestId: "req-1",
    turnId: "turn-1",
    output: "Project does not exist",
    isError: true,
  });
});

test("leaves unknown tools and malformed notifications alone", async () => {
  const { bridge, execute, request } = fixture();
  expect(await bridge.onNotification("other", params)).toBe(false);
  expect(await bridge.onNotification("thread/toolExecutionRequested", { ...params, threadId: "" })).toBe(false);
  expect(await bridge.onNotification("thread/toolExecutionRequested", { ...params, call: { name: "unknown" } })).toBe(
    false,
  );
  expect(execute).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
