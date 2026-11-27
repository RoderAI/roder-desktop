import type { ConversationMessage, RoderModel, RoderThread, Workspace } from "@/types/roder";

export const noop = () => {};
export const noopAsync = async () => {};

export const workspace: Workspace = {
  id: "storybook-project",
  name: "Roder Desktop",
  roots: [{ id: "storybook-root", name: "Roder Desktop", path: "/storybook/roder-desktop" }],
  defaultRootId: "storybook-root",
  updatedAt: 1760000000,
};
export const workspacePath = workspace.roots[0].path;

export const models: RoderModel[] = [
  {
    id: "example-model",
    name: "example-model",
    displayName: "Example model",
    modelProvider: "openai",
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "example-alternative",
    name: "example-alternative",
    displayName: "Example alternative",
    modelProvider: "anthropic",
  },
];

export const threads: RoderThread[] = ["Build a UI catalog", "Review the sidebar", "Update onboarding copy"].map(
  (name, idx) => ({
    id: `storybook-thread-${idx}`,
    name,
    preview: name,
    model: models[0].id,
    modelProvider: models[0].modelProvider,
    createdAt: 1760000000 - idx * 3600,
    updatedAt: 1760000000 - idx * 3600,
    status: { type: "idle", activeTurnId: null, activeFlags: [] },
    workspaceId: workspace.id,
    rootId: workspace.defaultRootId,
    cwd: workspacePath,
  }),
);

export const messages: ConversationMessage[] = [
  { id: "prompt", role: "user", text: "Add a component catalog that uses the desktop's theme.", turnId: "sample-turn" },
  {
    id: "progress",
    role: "assistant",
    phase: "commentary",
    text: "I'll start with the shared controls and use the renderer's palette.",
    turnId: "sample-turn",
  },
  {
    id: "read",
    role: "tool",
    text: "Read src/style.css",
    toolName: "read_file",
    toolCallId: "sample-read",
    toolStatus: "complete",
    toolSubject: "src/style.css",
    toolOutput: '@import "tailwindcss";',
    turnId: "sample-turn",
  },
  {
    id: "reply",
    role: "assistant",
    status: "complete",
    text: "The catalog now includes **controls and desktop screens**.\n\n- Shared buttons, fields, and menus\n- Light and dark previews\n\n```sh\npnpm storybook\n```",
    turnId: "sample-turn",
  },
];
