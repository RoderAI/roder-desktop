import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoderAgentEditor } from "../src/components/roder-agents-page";
import { rightWorkspacePanelEntriesForThread } from "../src/components/right-workspace-panel-registry";
import { normalizeRouteSearch } from "../src/lib/route-search";
import type { RoderAgentDetail } from "../src/types/roder-agents";

test("Roder controls are offered only beside a Roder thread", () => {
  const entries = rightWorkspacePanelEntriesForThread("agent-one");
  expect(entries[0]).toMatchObject({ id: "roderAgent", title: "Agent settings" });
  expect(rightWorkspacePanelEntriesForThread(null).some((entry) => entry.id === "roderAgent")).toBe(false);
  expect(entries.some((entry) => entry.id === "terminal")).toBe(true);
});

test("agent settings can be opened and restored through thread route search", () => {
  const search = normalizeRouteSearch("?panelTabs=roderAgent,files&panelActive=roderAgent&panelOpen=true");
  expect(search.panelTabs).toEqual(["roderAgent", "files"]);
  expect(search.panelActive).toBe("roderAgent");
  expect(search.panelOpen).toBe(true);
});

test("inline editor exposes paused agent controls and files without navigating away from chat", () => {
  const agent: RoderAgentDetail = {
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
    files: (["INSTRUCTIONS.md", "AGENTS.md", "NOTES.md", "WORKERS.md", "DIGEST.md"] as const).map((path, at) => ({
      path,
      version: at + 1,
      bytes: 0,
      author: "user" as const,
      writtenAt: 0,
      restoredFrom: null,
    })),
  };
  let actions = 0;
  const html = renderToStaticMarkup(
    createElement(RoderAgentEditor, {
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
  expect(html).toContain("Roder file list");
  for (const path of ["INSTRUCTIONS.md", "AGENTS.md", "NOTES.md", "WORKERS.md", "DIGEST.md"])
    expect(html).toContain(path);
  expect(html).toContain("Version 3");
  expect(html).toContain("Save INSTRUCTIONS.md");
  expect(html).toContain("History");
  expect(html).not.toContain('name="mission"');
  expect(html).toContain('name="interval"');
  expect(html).toContain('name="runs"');
  expect(html).toContain('name="minutes"');
  expect(html).toContain("Scheduled wakes");
  expect(html).not.toContain("Open Roder thread");
  expect(actions).toBe(0);
});
