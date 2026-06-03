import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { expect, test } from "vitest";
import { CommandCompletionPopup } from "../src/components/command-completion-popup";
import type { CommandDescriptor } from "../src/types/roder";

test("renders command rows with hints, descriptions, and warning labels", () => {
  const html = renderToStaticMarkup(
    React.createElement(CommandCompletionPopup, {
      visible: true,
      listboxId: "commands",
      commands: [command({ name: "review", argument_hint: "[scope]", has_shell_includes: true })],
      highlightedCommandIndex: 0,
      onHighlight() {},
      onSelect() {},
    }),
  );

  expect(html).toContain('role="listbox"');
  expect(html).toContain("/review");
  expect(html).toContain("[scope]");
  expect(html).toContain("Review changes");
  expect(html).toContain("builtin");
  expect(html).toContain("shell gated");
});

function command(patch: Partial<CommandDescriptor>): CommandDescriptor {
  return {
    name: patch.name ?? "review",
    description: patch.description ?? "Review changes",
    argument_hint: patch.argument_hint ?? "[scope]",
    source: patch.source ?? "builtin",
    model: patch.model ?? null,
    agent: patch.agent ?? null,
    has_shell_includes: patch.has_shell_includes ?? false,
    has_url_includes: patch.has_url_includes ?? false,
  };
}
