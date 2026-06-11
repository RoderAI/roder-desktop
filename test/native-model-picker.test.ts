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
      selectedModel: "gpt-5.5",
      selectedModelProvider: "openai",
      onDismiss: () => undefined,
      onSelect: () => undefined,
    }),
  );

  expect(html).toContain("Choose model");
  expect(html).toContain("Search models");
  expect(html).toContain("bg-card text-card-foreground");
  expect(html).toContain("ring-border/70");
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

test("groups the native model picker by provider and includes visible configured claude-code models", () => {
  const html = renderToStaticMarkup(
    React.createElement(NativeModelPicker, {
      models: [
        { id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai" },
        { id: "claude-code/sonnet", name: "Claude Code Sonnet 4.7", displayName: "Sonnet 4.7", modelProvider: "claude-code" },
        { id: "claude-code/fable", name: "Claude Code Fable 5", displayName: "Fable 5", modelProvider: "claude-code" },
      ],
      selectedModel: "claude-code/sonnet",
      selectedModelProvider: "claude-code",
      onDismiss: () => undefined,
      onSelect: () => undefined,
    }),
  );

  expect(html).toContain("OpenAI");
  expect(html).toContain("claude-code");
  expect(html).toContain("Sonnet 4.7");
  expect(html).toContain("Fable 5");
  expect(html).not.toContain("Claude Code Sonnet");
  expect(html).not.toContain("Claude Code Fable");
  expect(html).toMatch(/Sonnet 4\.7<\/span><span class="text-muted-foreground"> - claude-code/);
});

test("does not render models hidden by desktop settings", () => {
  const html = renderToStaticMarkup(
    React.createElement(NativeModelPicker, {
      models: [
        { id: "claude-code/sonnet", name: "Claude Code Sonnet 4.7", displayName: "Sonnet 4.7", modelProvider: "claude-code" },
      ],
      selectedModel: "claude-code/sonnet",
      selectedModelProvider: "claude-code",
      onDismiss: () => undefined,
      onSelect: () => undefined,
    }),
  );

  expect(html).toContain("Sonnet 4.7");
  expect(html).not.toContain("Claude Code Sonnet");
  expect(html).not.toContain("Fable 5");
});
