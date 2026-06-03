import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { NativeCommandOutput } from "../src/components/native-command-output";

test("renders native command output with body text and rows", () => {
  const html = renderToStaticMarkup(
    React.createElement(NativeCommandOutput, {
      output: {
        title: "Background tasks",
        body: "2 active tasks.",
        tone: "info",
        rows: [
          {
            id: "task-1",
            title: "Review current changes",
            detail: "running",
            meta: "task-1",
          },
        ],
      },
    }),
  );

  expect(html).toContain("Background tasks");
  expect(html).toContain("2 active tasks.");
  expect(html).toContain("Review current changes");
  expect(html).toContain("running");
  expect(html).toContain("task-1");
  expect(html).toContain('aria-live="polite"');
});

test("does not render an empty output container", () => {
  const html = renderToStaticMarkup(React.createElement(NativeCommandOutput, { output: null }));

  expect(html).toBe("");
});
