import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { AppSidebar } from "../src/components/app-sidebar";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, search: _search, ...props }: ComponentProps<"a"> & { to: string; search?: unknown }) =>
    createElement("a", { ...props, href: to }),
}));

vi.mock("../src/stores/roder-store", () => ({
  useRoderStore: (selector: (state: { workspaces: [] }) => unknown) => selector({ workspaces: [] }),
}));

vi.mock("../src/components/sidebar-update-button", () => ({
  SidebarUpdateButton: () => createElement("button", { type: "button", "data-update-pill": true }, "Update"),
}));

afterEach(() => vi.unstubAllGlobals());

test("project creation lives in the Projects section instead of a duplicate top-level action", () => {
  const action = vi.fn<() => void>();
  const html = renderToStaticMarkup(
    createElement(AppSidebar, {
      threads: [],
      activeThreadId: "",
      activeView: "chat",
      hasMoreThreads: false,
      loadingMoreThreads: false,
      reserveTitlebarSpace: false,
      onSelectThread: action,
      onArchiveThread: action,
      onLoadMoreThreads: action,
      onNewProject: action,
      onNewThread: action,
      onNewThreadInFolder: action,
      onOpenPlugins: action,
      onOpenSettings: action,
    }),
  );

  expect(html).toContain('aria-label="Projects"');
  expect(html).toContain('aria-label="Add project"');
  expect(html).toContain('aria-label="Show archived projects"');
  expect(html).not.toContain(">Add Project<");
  expect(html).toContain("New Agent");
  // The update action belongs in the current footer, beside (not inside) Settings.
  expect(html).toMatch(/Settings<\/span><\/button><button[^>]*data-update-pill="true"/);
});

test("archived folder groups stay hidden after reload, including newly loaded conversations", () => {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => (key === "sidebar-archived-projects" ? '["/workspace/hidden"]' : null),
    },
  });
  const action = vi.fn<() => void>();
  const html = renderToStaticMarkup(
    createElement(AppSidebar, {
      threads: [
        { id: "hidden-old", cwd: "/workspace/hidden", name: "Old hidden conversation" },
        { id: "hidden-new", cwd: "/workspace/hidden", name: "New hidden conversation" },
        { id: "visible", cwd: "/workspace/visible", name: "Visible conversation" },
      ].map((thread) => ({
        ...thread,
        preview: "",
        updatedAt: 100,
        turns: [],
        status: { type: "idle" as const, activeTurnId: null, activeFlags: [] },
      })),
      activeThreadId: "hidden-old",
      activeView: "chat",
      hasMoreThreads: false,
      loadingMoreThreads: false,
      reserveTitlebarSpace: false,
      onSelectThread: action,
      onArchiveThread: action,
      onLoadMoreThreads: action,
      onNewProject: action,
      onNewThread: action,
      onNewThreadInFolder: action,
      onOpenPlugins: action,
      onOpenSettings: action,
    }),
  );
  expect(html).not.toContain("hidden conversation");
  expect(html).toContain("Visible conversation");
  expect(html).toContain('aria-label="Archive project visible"');
  expect(html).toContain('aria-label="New agent in visible"');
});
