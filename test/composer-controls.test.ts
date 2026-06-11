import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { AttachmentChip, ComposerAttachMenuItems, ComposerPlanModeMenuItem, ModelPicker } from "../src/components/composer-controls";
import { DropdownMenu, DropdownMenuGroup } from "../src/components/ui/dropdown-menu";

test("image attachments with an image URL render as thumbnails", () => {
  const html = renderToStaticMarkup(
    React.createElement(AttachmentChip, {
      attachment: {
        id: "attachment-1",
        name: "canvas.png",
        path: "/tmp/canvas.png",
        type: "image/png",
        size: 12,
        imageUrl: "data:image/png;base64,YWJj",
        source: "canvas",
      },
      onRemove: () => undefined,
    }),
  );

  expect(html).toContain("<img");
  expect(html).toContain('src="data:image/png;base64,YWJj"');
  expect(html).toContain("canvas.png");
});

test("composer attach menu offers upload and sketch actions", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      DropdownMenu,
      null,
      React.createElement(
        DropdownMenuGroup,
        null,
        React.createElement(ComposerAttachMenuItems, {
          onOpenSketch: () => undefined,
          onUploadFile: () => undefined,
        }),
      ),
    ),
  );

  expect(html).toContain("Upload file");
  expect(html).toContain("Sketch");
});

test("composer add menu exposes a checked plan mode toggle", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      DropdownMenu,
      null,
      React.createElement(
        DropdownMenuGroup,
        null,
        React.createElement(ComposerPlanModeMenuItem, {
          enabled: true,
          onToggle: () => undefined,
        }),
      ),
    ),
  );

  expect(html).toContain("Plan mode");
  expect(html).toContain('aria-selected="true"');
});

test("composer model picker preserves provider-qualified selected values", () => {
  const html = renderToStaticMarkup(
    React.createElement(ModelPicker, {
      models: [
        { id: "gpt-5.5", name: "GPT-5.5", modelProvider: "openai" },
        { id: "claude-code/sonnet", name: "Claude Code Sonnet", modelProvider: "claude-code" },
        { id: "claude-code/opus", name: "Claude Code Opus", modelProvider: "claude-code" },
      ],
      routingOptions: [],
      selectedModel: "claude-code/sonnet",
      selectedModelProvider: "claude-code",
      selectedSelectionMode: {
        type: "manual",
        provider: "claude-code",
        model: "claude-code/sonnet",
        reasoning: "high",
      },
      selectedReasoning: "high",
      onChange: () => undefined,
      onAutoChange: () => undefined,
      onReasoningChange: () => undefined,
    }),
  );

  expect(html).toContain("Claude Code Sonnet");
  expect(html).toContain('value="model:claude-code:claude-code/sonnet"');
});
