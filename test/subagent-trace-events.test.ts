import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TraceEventContent } from "../src/components/subagent-trace-events";
import type { SubagentTraceDelta } from "../src/types/roder";

const event = (item: SubagentTraceDelta["item"]): SubagentTraceDelta => ({
  traceId: "trace",
  parent: { threadId: "parent", turnId: "turn" },
  item,
});

test("trace messages render Markdown with a readable author label", () => {
  const html = renderToStaticMarkup(
    React.createElement(TraceEventContent, {
      event: event({ type: "message", role: "assistant", content: { text: "## Findings\n\n- All tests pass" } }),
    }),
  );
  expect(html).toContain("Assistant message");
  expect(html).toContain("<h2");
  expect(html).toContain("<ul");
  expect(html).not.toContain("<pre");
});

test("trace tool errors preserve literal output and expose truncation", () => {
  const html = renderToStaticMarkup(
    React.createElement(TraceEventContent, {
      event: event({
        type: "toolResult",
        toolId: "tool",
        isError: true,
        output: { text: "**literal output**", truncated: true },
      }),
    }),
  );
  expect(html).toContain("Tool error");
  expect(html).toContain("<pre");
  expect(html).toContain("**literal output**");
  expect(html).toContain("Content truncated by the runtime.");
});
