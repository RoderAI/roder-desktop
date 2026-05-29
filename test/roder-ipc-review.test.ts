import { expect, test, vi } from "vitest";

type RoderRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

async function loadRoderIpc(request: RoderRequest) {
  vi.resetModules();
  globalThis.window = {
    roderDesktop: {
      request,
      onNotification: () => () => undefined,
      onStderr: () => () => undefined,
    },
  };
  return (await import("../src/lib/roder-ipc")).roderIpc;
}

test("review hunk IPC wrappers send camelCase thread and paging params", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return method === "hunk/read" ? { page: null } : { hunks: [] };
  });

  await roderIpc.listHunks("thread-1", { turnId: "turn-1" });
  await roderIpc.readHunk("thread-1", "hunk-1", { offset: 40, limit: 200 });

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "hunk/list",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
      },
    },
    {
      method: "hunk/read",
      params: {
        threadId: "thread-1",
        hunkId: "hunk-1",
        offset: 40,
        limit: 200,
      },
    },
  ]);
});

test("workspace change IPC wrapper lists observed changes by thread and turn", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return { changes: [] };
  });

  await roderIpc.listWorkspaceChanges("thread-1", { turnId: "turn-1" });

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "workspace/changes/list",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
      },
    },
  ]);
});

test("review git IPC wrappers call live branch change methods", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return method === "git/changes/read"
      ? { path: params.path, patch: "", offset: 0, limit: 400, totalLines: 0, nextOffset: null }
      : { repositoryRoot: params.workspace, files: [], totals: { files: 0, additions: 0, deletions: 0 } };
  });

  await roderIpc.listGitChanges("/workspace", { limit: 250 });
  await roderIpc.readGitChange("/workspace", "src/app.ts", { offset: 20, limit: 100 });

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "git/changes/list",
      params: {
        workspace: "/workspace",
        limit: 250,
      },
    },
    {
      method: "git/changes/read",
      params: {
        workspace: "/workspace",
        path: "src/app.ts",
        offset: 20,
        limit: 100,
      },
    },
  ]);
});
