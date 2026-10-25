import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { PersistentAgentCreateDialog } from "../src/components/persistent-agent-create-dialog";
import type { ProviderDescriptor, Workspace } from "../src/types/roder";

const state = vi.hoisted(() => ({
  selectedWorkspaceId: "desktop",
  selectedModel: "sol",
  selectedModelProvider: "openai",
  selectedReasoning: "medium",
  providers: [{ id: "openai", name: "OpenAI", authType: "oauth", authenticated: true }] as ProviderDescriptor[],
}));

vi.mock("../src/stores/roder-store", () => ({
  useRoderStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
    getState: () => state,
  }),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn<() => void>(),
}));
vi.mock("@base-ui/react/dialog", async (original) => {
  const actual = await original<typeof import("@base-ui/react/dialog")>();
  return {
    ...actual,
    Dialog: {
      ...actual.Dialog,
      Portal: ({ children }: { children: React.ReactNode }) => children,
      Popup: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
        React.createElement("div", { ...props, role: "dialog" }, children),
      Backdrop: () => null,
    },
  };
});

const workspace: Workspace = {
  id: "desktop",
  name: "Roder Desktop",
  defaultRootId: "root",
  updatedAt: 1,
  roots: [{ id: "root", name: "desktop", path: "/work/desktop" }],
};

function renderDialog(error: string | null = null) {
  return renderToStaticMarkup(
    React.createElement(PersistentAgentCreateDialog, {
      open: true,
      onOpenChange: () => {},
      workspaces: [workspace],
      models: [{ id: "sol", name: "Sol", modelProvider: "openai" }],
      error,
      onCreate: async () => true,
    }),
  );
}

test("PA setup selects the current project but cannot submit an empty name and mission", () => {
  const html = renderDialog();
  const submit = html.match(/<button\b[^>]*type="submit"[^>]*>/u)?.[0];
  expect(submit).toBeDefined();
  expect(submit).toContain("disabled");
  expect(html).toContain("Roder Desktop");
  expect(html).toContain("/work/desktop");
  expect(html).toContain("Starts paused");
  expect(html).toContain('name="name"');
  expect(html).toContain('name="mission"');
});

test("creation failures remain visible in the form instead of dismissing setup", () => {
  const html = renderDialog("Could not create the agent. Retry.");
  expect(html).toContain('role="alert"');
  expect(html).toContain("Could not create the agent. Retry.");
  expect(html).toContain("Create agent");
  expect(html).toContain("Cancel");
});
