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

test("review VCS IPC wrappers call live branch change methods", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return method === "vcs/changes/read"
      ? { path: params.path, content: "", offset: 0, totalLines: 0, nextOffset: null, binary: false }
      : {
          status: {
            provider: { id: "git", displayName: "Git" },
            workspace: { root: "/workspace" },
            changedFileCount: 0,
          },
          files: [],
          totals: { files: 0, additions: 0, deletions: 0 },
          truncated: false,
        };
  });

  await roderIpc.listVcsChanges({ workspaceId: "ws_1", id: "root_1" }, { limit: 250 });
  await roderIpc.readVcsChange({ workspaceId: "ws_1", id: "root_1" }, "src/app.ts", { offset: 20, limit: 100 });

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "vcs/changes/list",
      params: {
        workspaceId: "ws_1",
        rootId: "root_1",
        limit: 250,
      },
    },
    {
      method: "vcs/changes/read",
      params: {
        workspaceId: "ws_1",
        rootId: "root_1",
        path: "src/app.ts",
        offset: 20,
        limit: 100,
      },
    },
  ]);
});

test("filesystem IPC wrappers call documented read methods", async () => {
  const calls = [];
  const roderIpc = await loadRoderIpc(async (method, params) => {
    calls.push({ method, params });
    return method === "fs/readFile"
      ? { dataBase64: "SGVsbG8=" }
      : { entries: [{ fileName: "src", isDirectory: true, isFile: false }] };
  });

  await roderIpc.readDirectory("/workspace");
  await roderIpc.readFile("/workspace/README.md");

  expect(JSON.parse(JSON.stringify(calls))).toEqual([
    {
      method: "fs/readDirectory",
      params: {
        path: "/workspace",
      },
    },
    {
      method: "fs/readFile",
      params: {
        path: "/workspace/README.md",
      },
    },
  ]);
});
