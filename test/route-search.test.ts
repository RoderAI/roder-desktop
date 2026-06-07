import { expect, test } from "vitest";
import {
  closeWorkspacePanelTab,
  closeWorkspacePanelShell,
  mergeRouteSearchUpdate,
  normalizeRouteSearch,
  openWorkspacePanelShell,
  openWorkspacePanelTab,
  routeSearchParsers,
  selectWorkspacePanelTab,
} from "../src/lib/route-search";

test("route search defaults preserve practical app layout state", () => {
  expect(normalizeRouteSearch({})).toEqual({
    panelTabs: [],
    panelActive: null,
    panelOpen: false,
    reviewScope: "thread",
    reviewTurnId: "",
    reviewPath: "",
    extension: "",
    extensionPanel: "",
    sidebar: true,
    rightWidth: 560,
    provider: "all",
    q: "",
    categories: [],
  });
});

test("route search rejects unknown literals and clamps workspace panel width", () => {
  expect(
    normalizeRouteSearch({
      panelTabs: "browser,debugger,review,files,browser",
      panelActive: "debugger",
      reviewScope: "file",
      reviewTurnId: "turn-1",
      reviewPath: "src/app.ts",
      sidebar: "false",
      rightWidth: "3000",
      provider: "github",
      categories: "codex,local",
    }),
  ).toEqual({
    panelTabs: ["browser", "review", "files"],
    panelActive: "browser",
    panelOpen: false,
    reviewScope: "thread",
    reviewTurnId: "turn-1",
    reviewPath: "src/app.ts",
    extension: "",
    extensionPanel: "",
    sidebar: false,
    rightWidth: 2400,
    provider: "all",
    q: "",
    categories: ["codex", "local"],
  });
});

test("route search accepts supported practical URL state values", () => {
  expect(
    normalizeRouteSearch({
      panelTabs: "terminal,browser,files,extensions",
      panelActive: "files",
      panelOpen: "true",
      reviewScope: "branch",
      reviewPath: "src/review-panel.tsx",
      extension: "github",
      extensionPanel: "settings",
      sidebar: "false",
      rightWidth: "640",
      provider: "codex",
      q: "lint",
      categories: "developer-tools,automation",
    }),
  ).toEqual({
    panelTabs: ["terminal", "browser", "files", "extensions"],
    panelActive: "files",
    panelOpen: true,
    reviewScope: "branch",
    reviewTurnId: "",
    reviewPath: "src/review-panel.tsx",
    extension: "github",
    extensionPanel: "settings",
    sidebar: false,
    rightWidth: 640,
    provider: "codex",
    q: "lint",
    categories: ["developer-tools", "automation"],
  });
});

test("route search updates merge with current state for hash-history URL writes", () => {
  const current = normalizeRouteSearch({
    panelTabs: "review",
    panelActive: "review",
    reviewScope: "branch",
    rightWidth: "640",
  });

  expect(mergeRouteSearchUpdate(current, { reviewPath: "src/review-panel.tsx" })).toEqual({
    ...current,
    reviewPath: "src/review-panel.tsx",
  });
  expect(mergeRouteSearchUpdate(current, (state) => ({ rightWidth: state.rightWidth + 20 }))).toEqual({
    ...current,
    rightWidth: 660,
  });
  expect(mergeRouteSearchUpdate(current, null)).toBeNull();
});

test("route search updates keep workspace panel fields normalized", () => {
  const current = normalizeRouteSearch({
    panelTabs: "browser",
    panelActive: "browser",
    panelOpen: "true",
  });

  expect(mergeRouteSearchUpdate(current, { panelActive: "review" })).toEqual({
    ...current,
    panelActive: "browser",
    panelOpen: true,
  });
  expect(mergeRouteSearchUpdate(current, { panelTabs: [] })).toEqual({
    ...current,
    panelTabs: [],
    panelActive: null,
    panelOpen: true,
  });
  expect(mergeRouteSearchUpdate(current, closeWorkspacePanelShell())).toEqual({
    ...current,
    panelOpen: false,
  });
});

test("workspace panel open action appends and focuses without duplicating tabs", () => {
  const current = normalizeRouteSearch({
    panelTabs: "terminal,browser",
    panelActive: "terminal",
    panelOpen: "true",
  });

  expect(openWorkspacePanelTab(current, "review")).toEqual({
    panelTabs: ["terminal", "browser", "review"],
    panelActive: "review",
    panelOpen: true,
  });
  expect(openWorkspacePanelTab(current, "browser")).toEqual({
    panelTabs: ["terminal", "browser"],
    panelActive: "browser",
    panelOpen: true,
  });
  expect(openWorkspacePanelTab(current, "files")).toEqual({
    panelTabs: ["terminal", "browser", "files"],
    panelActive: "files",
    panelOpen: true,
  });
});

test("workspace panel tab serializer tolerates already serialized tab values", () => {
  expect(routeSearchParsers.panelTabs.serialize("terminal,browser" as never)).toBe("terminal,browser");
});

test("workspace panel close action selects the nearest remaining tab", () => {
  const current = normalizeRouteSearch({
    panelTabs: "terminal,browser,review,extensions",
    panelActive: "review",
    panelOpen: "true",
  });

  expect(closeWorkspacePanelTab(current, "review")).toEqual({
    panelTabs: ["terminal", "browser", "extensions"],
    panelActive: "extensions",
    panelOpen: true,
  });
  expect(closeWorkspacePanelTab({ ...current, panelActive: "terminal" }, "terminal")).toEqual({
    panelTabs: ["browser", "review", "extensions"],
    panelActive: "browser",
    panelOpen: true,
  });
  expect(
    closeWorkspacePanelTab(normalizeRouteSearch({ panelTabs: "browser", panelActive: "browser" }), "browser"),
  ).toEqual({
    panelTabs: [],
    panelActive: null,
    panelOpen: false,
  });
  expect(
    closeWorkspacePanelTab(normalizeRouteSearch({ panelTabs: "browser,files", panelActive: "files" }), "files"),
  ).toEqual({
    panelTabs: ["browser"],
    panelActive: "browser",
    panelOpen: false,
  });
});

test("workspace panel select action only activates open tabs", () => {
  const current = normalizeRouteSearch({
    panelTabs: "terminal,browser",
    panelActive: "terminal",
  });

  expect(selectWorkspacePanelTab(current, "browser")).toEqual({ panelActive: "browser" });
  expect(selectWorkspacePanelTab({ panelTabs: ["terminal", "files"] }, "files")).toEqual({ panelActive: "files" });
  expect(selectWorkspacePanelTab(current, "review")).toEqual(null);
});

test("workspace panel shell can open without tabs for the add state", () => {
  expect(openWorkspacePanelShell()).toEqual({
    panelOpen: true,
  });
  expect(closeWorkspacePanelShell()).toEqual({
    panelOpen: false,
  });
});
