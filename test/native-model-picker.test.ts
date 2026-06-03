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
      selectedModelProvider: "openai",
      onDismiss: () => undefined,
      onSelect: () => undefined,
    }),
  );

  expect(html).toContain("Choose model");
  expect(html).toContain("Search models");
  expect(html).toContain("Claude Sonnet 5");
  expect(html).toMatch(/GPT-5\.5<\/span><span class="text-muted-foreground"> - openai/);
  expect(html).toContain("openai");
  expect(html).not.toContain("Current");
  expect(html).toContain("Close model picker");
});

test("marks only the selected provider with the selected-row indicator for duplicate model ids", () => {
  const html = renderToStaticMarkup(
    React.createElement(NativeModelPicker, {
      models: [
        { id: "gpt-5.5", name: "GPT-5.5", modelProvider: "codex" },
        { id: "gpt-5.5", name: "gpt-5.5", modelProvider: "opencode" },
      ],
      open: true,
      selectedModel: "gpt-5.5",
      selectedModelProvider: "opencode",
      onDismiss: () => undefined,
      onSelect: () => undefined,
    }),
  );

  expect(html.match(/lucide-check/g)).toHaveLength(1);
  expect(html).toMatch(/GPT-5\.5<\/span><span class="text-muted-foreground"> - codex/);
  expect(html).toMatch(/gpt-5\.5<\/span><span class="text-muted-foreground"> - opencode/);
  expect(html).not.toMatch(/GPT-5\.5<\/span><span class="text-muted-foreground"> - gpt-5\.5/);
  expect(html).not.toContain("Current");
});

test("does not render when closed", () => {
  const html = renderToStaticMarkup(
    React.createElement(NativeModelPicker, {
      models: [{ id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai" }],
      open: false,
      selectedModel: "gpt-5.5",
      selectedModelProvider: "openai",
      onDismiss: () => undefined,
      onSelect: () => undefined,
    }),
  );

  expect(html).toBe("");
});
