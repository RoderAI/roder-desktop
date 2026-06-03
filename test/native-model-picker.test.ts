import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { NativeModelPicker } from "../src/components/native-model-picker";

test("renders a dedicated native model picker with the current model", () => {
  const html = renderToStaticMarkup(
    React.createElement(NativeModelPicker, {
      models: [
        { id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai" },
        { id: "claude-sonnet-5", name: "Claude Sonnet 5", modelProvider: "anthropic" },
      ],
      open: true,
      selectedModel: "gpt-5.5",
      onDismiss: () => undefined,
      onSelect: () => undefined,
    }),
  );

  expect(html).toContain("Choose model");
  expect(html).toContain("Search models");
  expect(html).toContain("Claude Sonnet 5");
  expect(html).toContain("gpt-5.5");
  expect(html).toContain("openai");
  expect(html).toContain("Current");
  expect(html).toContain("Close model picker");
});

test("does not render when closed", () => {
  const html = renderToStaticMarkup(
    React.createElement(NativeModelPicker, {
      models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai" }],
      open: false,
      selectedModel: "gpt-5.5",
      onDismiss: () => undefined,
      onSelect: () => undefined,
    }),
  );

  expect(html).toBe("");
});
