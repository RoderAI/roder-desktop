import { expect, test, vi } from "vitest";
import {
  createProjectRoderAgent,
  type ProjectRoderAgentConfig,
  type CreatedProjectThread,
} from "../src/lib/project-roder-agent";
import type { RoderThread, Workspace } from "../src/types/roder";

const workspace: Workspace = {
  id: "workspace",
  name: "App",
  roots: [{ id: "root", name: "app", path: "/work/app" }],
  defaultRootId: "root",
  updatedAt: 1,
};
const thread = { id: "created-thread", workspaceId: workspace.id } as RoderThread;
const params: ProjectRoderAgentConfig = {
  workspace: { roots: [{ path: "/work/app" }], defaultRootPath: "/work/app" },
  mission: " Maintain the app ",
  model: "model-a",
  modelProvider: "provider",
  reasoning: "high",
};

test("authoritative creation identity supports canonicalized roots and a changed active selection", async () => {
  const promote = vi.fn<(params: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
  let reads = 0;
  await createProjectRoderAgent(
    { ...params, workspace: { roots: [{ path: "/linked/app" }] } },
    {
      createProject: async () => ({ threadId: thread.id, workspaceId: workspace.id }),
      promote,
      onCreated: () => undefined,
      snapshot: () =>
        reads++ === 0
          ? { error: null, activeThreadId: "other", threads: [], workspaces: [] }
          : { error: null, activeThreadId: "other", threads: [thread], workspaces: [workspace] },
    },
  );
  expect(promote).toHaveBeenCalledWith(expect.objectContaining({ threadId: thread.id, workspaceId: workspace.id }));
});
type Dependencies = Parameters<typeof createProjectRoderAgent>[1];

test("creating a project promotes the exact new thread with its mission and model", async () => {
  const promote = vi.fn<Dependencies["promote"]>(async () => undefined);
  const created = vi.fn<Dependencies["onCreated"]>();
  const createProject = vi.fn<Dependencies["createProject"]>(async () => undefined);
  let reads = 0;
  await createProjectRoderAgent(params, {
    createProject,
    promote,
    onCreated: created,
    snapshot: () =>
      reads++ === 0
        ? { error: null, activeThreadId: "previous", threads: [], workspaces: [] }
        : { error: null, activeThreadId: thread.id, threads: [thread], workspaces: [workspace] },
  });
  expect(createProject).toHaveBeenCalledWith(params.workspace);
  expect(promote).toHaveBeenCalledWith({
    threadId: thread.id,
    workspaceId: workspace.id,
    name: workspace.name,
    mission: "Maintain the app",
    model: "model-a",
    modelProvider: "provider",
    reasoning: "high",
  });
  expect(created).toHaveBeenCalledWith({ threadId: thread.id, workspaceId: workspace.id, name: workspace.name });
});

test("a swallowed native creation error cannot close the dialog as a success", async () => {
  const promote = vi.fn<Dependencies["promote"]>();
  await expect(
    createProjectRoderAgent(params, {
      createProject: async () => undefined,
      promote,
      onCreated: vi.fn<Dependencies["onCreated"]>(),
      snapshot: () => ({ error: "Permission denied", activeThreadId: "old", threads: [], workspaces: [] }),
    }),
  ).rejects.toThrow("Permission denied");
  expect(promote).not.toHaveBeenCalled();
});

test("a missing new thread cannot accidentally promote the previous conversation", async () => {
  const promote = vi.fn<Dependencies["promote"]>();
  await expect(
    createProjectRoderAgent(params, {
      createProject: async () => undefined,
      promote,
      onCreated: vi.fn<Dependencies["onCreated"]>(),
      snapshot: () => ({
        error: null,
        activeThreadId: "old",
        threads: [{ ...thread, id: "old" }],
        workspaces: [workspace],
      }),
    }),
  ).rejects.toThrow("did not create a new project thread");
  expect(promote).not.toHaveBeenCalled();
});

test("retrying promotion reuses the created workspace and preserves its thread", async () => {
  const createProject = vi.fn<Dependencies["createProject"]>();
  const promote = vi.fn<Dependencies["promote"]>(async () => undefined);
  const pending = { threadId: thread.id, workspaceId: workspace.id, name: workspace.name };
  await createProjectRoderAgent(
    params,
    {
      createProject,
      promote,
      onCreated: vi.fn<Dependencies["onCreated"]>(),
      snapshot: vi.fn<Dependencies["snapshot"]>(),
    },
    pending,
  );
  expect(createProject).not.toHaveBeenCalled();
  expect(promote).toHaveBeenCalledWith(expect.objectContaining({ threadId: thread.id, workspaceId: workspace.id }));
});

test("failed promotion retains the newly created identity for a safe retry", async () => {
  let pending: CreatedProjectThread | null = null;
  let reads = 0;
  const createProject = vi.fn<Dependencies["createProject"]>(async () => undefined);
  const promote = vi
    .fn<Dependencies["promote"]>()
    .mockRejectedValueOnce(new Error("RoderAgent storage unavailable"))
    .mockResolvedValue(undefined);
  const dependencies: Dependencies = {
    createProject,
    promote,
    onCreated: (project) => {
      pending = project;
    },
    snapshot: () =>
      reads++ === 0
        ? { error: null, activeThreadId: "old", threads: [], workspaces: [] }
        : { error: null, activeThreadId: thread.id, threads: [thread], workspaces: [workspace] },
  };
  await expect(createProjectRoderAgent(params, dependencies)).rejects.toThrow("RoderAgent storage unavailable");
  expect(pending).toEqual({ threadId: thread.id, workspaceId: workspace.id, name: workspace.name });
  await createProjectRoderAgent(params, dependencies, pending);
  expect(createProject).toHaveBeenCalledTimes(1);
  expect(promote).toHaveBeenCalledTimes(2);
});

test("an existing-folder project can promote its new thread in a reused workspace", async () => {
  let reads = 0;
  const promote = vi.fn<Dependencies["promote"]>(async () => undefined);
  await createProjectRoderAgent(params, {
    createProject: async () => undefined,
    promote,
    onCreated: vi.fn<Dependencies["onCreated"]>(),
    snapshot: () =>
      reads++ === 0
        ? { error: null, activeThreadId: "old", threads: [], workspaces: [workspace] }
        : { error: null, activeThreadId: thread.id, threads: [thread], workspaces: [workspace] },
  });
  expect(promote).toHaveBeenCalledWith(expect.objectContaining({ threadId: thread.id, workspaceId: workspace.id }));
});

test("creation cannot promote a newly selected thread from an unrelated workspace", async () => {
  let reads = 0;
  const promote = vi.fn<Dependencies["promote"]>(async () => undefined);
  await expect(
    createProjectRoderAgent(params, {
      createProject: async () => undefined,
      promote,
      onCreated: vi.fn<Dependencies["onCreated"]>(),
      snapshot: () =>
        reads++ === 0
          ? { error: null, activeThreadId: "old", threads: [], workspaces: [] }
          : {
              error: null,
              activeThreadId: thread.id,
              threads: [thread],
              workspaces: [{ ...workspace, roots: [{ id: "other", name: "other", path: "/work/other" }] }],
            },
    }),
  ).rejects.toThrow("did not create a new project thread");
  expect(promote).not.toHaveBeenCalled();
});
