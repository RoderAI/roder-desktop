import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { ProjectPicker } from "../src/pages/chat/chat-page";

const menu = vi.hoisted(() => ({
  items: [] as { label?: string; grouped: boolean; onClick: (event: React.MouseEvent<HTMLElement>) => void }[],
}));

vi.mock("@base-ui/react/menu", async () => {
  const { createContext, createElement, useContext } = await import("react");
  const GroupContext = createContext(false);
  const container = ({ children }: { children?: React.ReactNode }) => createElement("div", null, children);
  return {
    Menu: {
      Root: container,
      Portal: container,
      Positioner: container,
      Popup: container,
      Trigger: ({ children }: { children?: React.ReactNode }) => createElement("button", null, children),
      Group: ({ children }: { children?: React.ReactNode }) =>
        createElement(GroupContext.Provider, { value: true }, children),
      Item: ({
        children,
        onClick,
        "aria-label": label,
      }: {
        children?: React.ReactNode;
        onClick: (event: React.MouseEvent<HTMLElement>) => void;
        "aria-label"?: string;
      }) => {
        menu.items.push({ label, grouped: useContext(GroupContext), onClick });
        return createElement("button", { role: "menuitem", onClick, "aria-label": label }, children);
      },
    },
  };
});

beforeEach(() => {
  menu.items = [];
});

test("project picker keeps Add project outside the scrollable project list and invokes the existing creation callback", () => {
  const onNewProject = vi.fn<() => void>();
  const onSelectFolder = vi.fn<(path: string) => void>();
  const html = renderToStaticMarkup(
    React.createElement(ProjectPicker, {
      projects: [{ name: "Desktop", path: "/desktop", threadCount: 2, updatedAt: 1 }],
      activeFolderPath: "/desktop",
      activeFolderLabel: "Desktop",
      onSelectFolder,
      onNewProject,
    }),
  );
  expect(html).toContain("Desktop");
  expect(html).toContain("Add project");
  expect(menu.items[0].grouped).toBe(true);
  const add = menu.items.find((item) => item.label === "Add project");
  expect(add?.grouped).toBe(false);
  expect(onNewProject).not.toHaveBeenCalled();
  add?.onClick({ defaultPrevented: false } as React.MouseEvent<HTMLElement>);
  expect(onNewProject).toHaveBeenCalledTimes(1);
  expect(onSelectFolder).not.toHaveBeenCalled();
  menu.items[0].onClick({ defaultPrevented: false } as React.MouseEvent<HTMLElement>);
  expect(onSelectFolder).toHaveBeenCalledWith("/desktop");
});

test("empty project picker still provides the Add project action", () => {
  const html = renderToStaticMarkup(
    React.createElement(ProjectPicker, {
      projects: [],
      activeFolderPath: "",
      activeFolderLabel: "Select project",
      onSelectFolder: () => undefined,
      onNewProject: () => undefined,
    }),
  );
  expect(html).toContain("No projects yet");
  expect(menu.items.map((item) => item.label)).toEqual(["Add project"]);
});
