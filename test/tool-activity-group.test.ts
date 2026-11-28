import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ToolActivityGroup } from "../src/components/tool-activity-group";
import type { TranscriptToolEntry } from "../src/lib/tool-message-groups";

const entries: TranscriptToolEntry[] = [
  {
    kind: "message",
    message: {
      id: "tool-1",
      role: "tool",
      status: "complete",
      text: "OLDER_TOOL_TITLE",
      toolName: "custom_tool",
      toolOutput: "OLDER_TOOL_OUTPUT",
      toolStatus: "complete",
    },
  },
];
const summary = { commands: 0, files: 0, searches: 0, label: "Used tools" };

test("old tools render as one closed row without mounting hidden tool details", () => {
  const html = renderToStaticMarkup(createElement(ToolActivityGroup, { entries, summary }));
  expect(html).toContain("Used tools");
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("OLDER_TOOL_TITLE");
  expect(html).not.toContain("OLDER_TOOL_OUTPUT");
});

test("the live tool run opens a scrollable five-row region by default", () => {
  const html = renderToStaticMarkup(createElement(ToolActivityGroup, { entries, summary, live: true }));
  expect(html).toContain('aria-label="Recent tools"');
  expect(html).toContain("max-height:7.5rem");
  expect(html).toContain("OLDER_TOOL_TITLE");
  const closed = renderToStaticMarkup(createElement(ToolActivityGroup, { entries, summary, live: true, open: false }));
  expect(closed).not.toContain('aria-label="Recent tools"');
});

test("descriptive external tool items render clean titles without dumping raw output inline", () => {
  const html = renderToStaticMarkup(
    createElement(ToolActivityGroup, {
      entries: [
        {
          kind: "message",
          message: {
            id: "tool:ag-1",
            role: "tool",
            status: "complete",
            text: "Ran git status --short",
            toolName: "git status --short",
            toolSummary: "Ran git status --short",
            toolInput: "git status --short",
            toolOutput: "M src/lib/tool-display.ts",
            toolStatus: "complete",
          },
        },
        {
          kind: "message",
          message: {
            id: "tool:ag-2",
            role: "tool",
            status: "complete",
            text: "Read provider-logo.tsx",
            toolName: "Read /Users/pz/w/roder-desktop/src/components/provider-logo.tsx",
            toolSummary: "Read provider-logo.tsx",
            toolOutput: "export function ProviderLogo() {}",
            toolStatus: "complete",
          },
        },
      ],
      summary: { commands: 1, files: 1, searches: 0, label: "Explored 1 file, ran 1 command" },
      live: true,
    }),
  );

  expect(html).toContain("Ran git status --short");
  expect(html).toContain("Read provider-logo.tsx");
  expect(html).not.toContain("export function ProviderLogo");
});
