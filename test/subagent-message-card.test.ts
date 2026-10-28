import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { SubagentMessageCard } from "../src/components/subagent-message-card";
import type { SubagentMessage } from "../src/lib/subagent-messages";

function render(message: Partial<SubagentMessage> = {}, open = false): string {
  return renderToStaticMarkup(
    React.createElement(SubagentMessageCard, {
      message: {
        id: "delivery:0",
        kind: "MESSAGE",
        sender: "/root/cloud_review",
        recipient: "/root",
        body: "**Checked**\n\n- Routing is correct\n- Tests pass",
        ...message,
      },
      open,
      onOpenChange: () => {},
    }),
  );
}

test("mailbox updates show human names, clear labels and Markdown instead of protocol text", () => {
  const html = render();
  expect(html).toContain('aria-label="Update from Cloud review"');
  expect(html).toContain("Subagent update");
  expect(html).not.toContain("**Checked**");
  expect(html).toContain("<ul");
  expect(html).toContain("Routing details");
  expect(html).toContain("/root/cloud_review");
  expect(html).not.toContain("Message Type:");
  expect(html).not.toContain("Payload:");
});

test("task assignments identify the recipient rather than the coordinating sender", () => {
  const html = render({ kind: "NEW_TASK", sender: "/root", recipient: "/root/test_runner" });
  expect(html).toContain('aria-label="Task for Test runner"');
  expect(html).toContain("Subagent task");
});

test("long results have a collapsed preview and an accessible full-message disclosure", () => {
  const body = `Summary.\n\n${"Detailed work. ".repeat(40)}\n\nFinal verification marker`;
  const collapsed = render({ body });
  const expanded = render({ body }, true);
  expect(collapsed).toContain('aria-expanded="false"');
  expect(collapsed).toContain("Summary.");
  expect(collapsed).not.toContain("Final verification marker");
  expect(collapsed).toContain("Show full message");
  expect(expanded).toContain('aria-expanded="true"');
  expect(expanded).toContain("Final verification marker");
  expect(expanded).toContain("Show less");
});

test("failed final reports preserve their error and are not labeled successful", () => {
  const html = render({
    kind: "FINAL_ANSWER",
    body: "Agent /root/cloud_review finished with status Failed.\n\nTerminal error:\nPermission denied.",
  });
  expect(html).toContain("Failed");
  expect(html).toContain("Permission denied.");
  expect(html).not.toContain("finished with status");
  expect(html).not.toContain("Completed");
});

test("empty messages and hostile HTML remain safe", () => {
  expect(render({ body: "" })).toContain("No message content.");
  const html = render({ body: 'Text <script>alert(1)</script><img src="https://attacker.invalid/track" />' });
  expect(html).not.toContain("<script");
  expect(html).not.toContain('<img src="https://attacker.invalid');
});
