import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { AppSidebar } from "../src/components/app-sidebar";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, search: _search, ...props }: ComponentProps<"a"> & { to: string; search?: unknown }) =>
    createElement("a", { ...props, href: to }),
}));

vi.mock("../src/stores/roder-store", () => ({
  useRoderStore: (selector: (state: { workspaces: [] }) => unknown) => selector({ workspaces: [] }),
}));

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
  expect(html).not.toContain(">Add Project<");
  expect(html).toContain("New Agent");
});
