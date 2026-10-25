import type { WorkspaceCreateParams } from "@/lib/roder-ipc";
import type { PersistentAgentPromote } from "@/types/persistent-agents";
import type { RoderThread, Workspace } from "@/types/roder";

export type ProjectPersistentAgentConfig = {
  workspace: WorkspaceCreateParams;
  mission: string;
  model: string;
  modelProvider: string;
  reasoning?: string;
};

export type CreatedProjectThread = Pick<PersistentAgentPromote, "threadId" | "workspaceId" | "name">;

export async function createProjectPersistentAgent(
  params: ProjectPersistentAgentConfig,
  dependencies: {
    createProject: (params: WorkspaceCreateParams) => Promise<{ threadId: string; workspaceId: string } | void>;
    promote: (params: PersistentAgentPromote) => Promise<unknown>;
    onCreated: (project: CreatedProjectThread) => void;
    snapshot: () => {
      error: string | null;
      activeThreadId: string;
      threads: RoderThread[];
      threadDetails?: Record<string, RoderThread>;
      workspaces: Workspace[];
    };
  },
  pending?: CreatedProjectThread | null,
): Promise<CreatedProjectThread> {
  const mission = params.mission.trim();
  if (!mission) throw new Error("Describe the persistent agent’s mission before creating the project.");
  if (!params.model || !params.modelProvider) throw new Error("Choose an available model for the persistent agent.");
  let project = pending;
  if (!project) {
    const before = dependencies.snapshot();
    const created = await dependencies.createProject(params.workspace);
    const after = dependencies.snapshot();
    if (after.error) throw new Error(after.error);
    const threadId = created?.threadId ?? after.activeThreadId;
    const thread = after.threadDetails?.[threadId] ?? after.threads.find((candidate) => candidate.id === threadId);
    const workspace = after.workspaces.find(
      (candidate) => candidate.id === (created?.workspaceId ?? thread?.workspaceId),
    );
    const requestedRoots = params.workspace.roots.map((root) => root.path.replace(/\/+$/u, "") || "/");
    const workspaceRoots = new Set(workspace?.roots.map((root) => root.path.replace(/\/+$/u, "") || "/"));
    if (
      !thread ||
      thread.id === before.activeThreadId ||
      !workspace ||
      before.threads.some((candidate) => candidate.id === thread.id) ||
      before.threadDetails?.[thread.id] ||
      thread.workspaceId !== workspace.id ||
      (!created && (requestedRoots.length === 0 || !requestedRoots.every((path) => workspaceRoots.has(path))))
    ) {
      throw new Error("Roder did not create a new project thread. Your previous conversation was not changed.");
    }
    project = { threadId: thread.id, workspaceId: workspace.id, name: workspace.name };
    dependencies.onCreated(project);
  }
  await dependencies.promote({
    ...project,
    mission,
    model: params.model,
    modelProvider: params.modelProvider,
    reasoning: params.reasoning || undefined,
  });
  return project;
}
