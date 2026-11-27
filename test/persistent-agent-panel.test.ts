import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PersistentAgentEditor } from "../src/components/persistent-agents-page";
import { PolicyModePicker } from "../src/components/composer-controls";
import { rightWorkspacePanelEntriesForThread } from "../src/components/right-workspace-panel-registry";
import { normalizeRouteSearch } from "../src/lib/route-search";
import type { PersistentAgentDetail } from "../src/types/persistent-agents";

test("persistent agent controls are offered only beside a persistent agent thread", () => {
  const entries = rightWorkspacePanelEntriesForThread("agent-one");
  expect(entries[0]).toMatchObject({ id: "persistentAgent", title: "Agent settings" });
  expect(rightWorkspacePanelEntriesForThread(null).some((entry) => entry.id === "persistentAgent")).toBe(false);
  expect(entries.some((entry) => entry.id === "terminal")).toBe(true);
});

test("agent settings can be opened and restored through thread route search", () => {
  const search = normalizeRouteSearch("?panelTabs=persistentAgent,files&panelActive=persistentAgent&panelOpen=true");
  expect(search.panelTabs).toEqual(["persistentAgent", "files"]);
  expect(search.panelActive).toBe("persistentAgent");
  expect(search.panelOpen).toBe(true);
});

test("persistent agent composer shows full access without offering a misleading permission selector", () => {
  let changes = 0;
  const html = renderToStaticMarkup(
    createElement(PolicyModePicker, {
      selectedMode: "bypass",
      locked: true,
      onChange: () => {
        changes++;
      },
    }),
  );
  expect(html).toContain("Full access");
  expect(html).toContain("always on for persistent agents");
  expect(html).not.toContain("Choose permission mode");
  expect(changes).toBe(0);
});

test("inline editor exposes paused agent controls and memory without navigating away from chat", () => {
  const agent: PersistentAgentDetail = {
    id: "agent-one",
    threadId: "thread-one",
    workspaceId: "website",
    name: "Website guide",
    mission: "Keep the docs current",
    enabled: false,
    intervalMinutes: 0,
    eventMethods: [],
    maxRunsPerDay: 5,
    maxRunMinutes: 10,
    runs: [],
    wakes: [],
    active: null,
    lastError: null,
    lastRunAt: null,
    sprite: null,
    memory: "Remember release notes",
    memoryPath: "/agents/website.md",
  };
  let actions = 0;
  const html = renderToStaticMarkup(
    createElement(PersistentAgentEditor, {
      initial: agent,
      status: agent,
      busy: false,
      observedAt: 0,
      showThreadLink: false,
      perform: async (action) => {
        actions++;
        return action();
      },
    }),
  );
  expect(html).toContain("Proactive work is paused");
  expect(html).toContain("Enable proactive work");
  expect(html).toContain("Run once");
  expect(html).toContain('name="memory"');
  expect(html).toContain("Remember release notes");
  expect(html).toContain('name="interval"');
  expect(html).toContain('name="runs"');
  expect(html).toContain('name="minutes"');
  expect(html).toContain("Scheduled wakes");
  expect(html).not.toContain("Open persistent agent thread");
  expect(actions).toBe(0);
});
