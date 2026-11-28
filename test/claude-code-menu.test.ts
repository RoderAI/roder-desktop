import { expect, test } from "vitest";
import { claudeCommandCatalog, claudeMenuInvocation, claudeMenuText } from "../src/lib/claude-code-menu";
import { commandInvocation } from "../src/lib/roder-commands";

test("Claude slash commands resolve to the real workflow or background menu", () => {
  const catalog = claudeCommandCatalog([]);
  expect(claudeMenuInvocation(commandInvocation("/workflows", catalog)!)).toEqual({
    command: "workflows",
    arguments: "",
  });
  for (const name of ["tasks", "agents", "subagents"]) {
    expect(claudeMenuInvocation(commandInvocation(`/${name}`, catalog)!)).toEqual({ command: "tasks", arguments: "" });
  }
});

test("shows the current native menu or selected earlier task without the underlying conversation", () => {
  const frame = {
    readyForTurn: false,
    closed: false,
    lines: [
      "Earlier transcript message",
      "❯ /tasks",
      "──────",
      "  Background",
      "    ❯ Earlier in this session (1)",
      "  Esc to close",
      "",
    ],
  };
  expect(claudeMenuText(frame, "tasks")).toBe("Background\n  ❯ Earlier in this session (1)\nEsc to close");
  expect(
    claudeMenuText(
      { ...frame, lines: [...frame.lines.slice(0, 3), "  Earlier in this session", "    Finished task"] },
      "tasks",
    ),
  ).toBe("Earlier in this session\n  Finished task");
});
