import { expect, test } from "vitest";
import {
  parseSubagentMessages,
  subagentDisplayName,
  subagentMessageResult,
  subagentMessagesForMessage,
} from "../src/lib/subagent-messages";

const envelope = (body: string, kind = "MESSAGE", sender = "/root/cloud_review") =>
  `Message Type: ${kind}\nTask name: /root\nSender: ${sender}\nPayload:\n${body}`;

test("parses the complete mailbox envelope without flattening Markdown", () => {
  const body = "**Checked**\n\n- First\n  - Nested\n\n```ts\nconst ready = true;\n```";
  expect(parseSubagentMessages(envelope(body))).toEqual([
    { id: "delivery:0", kind: "MESSAGE", recipient: "/root", sender: "/root/cloud_review", body },
  ]);
});

test("parses batched deliveries and Windows newlines", () => {
  expect(
    parseSubagentMessages(`${envelope("Progress")}\n\n${envelope("Done", "FINAL_ANSWER")}`)?.map((item) => item.kind),
  ).toEqual(["MESSAGE", "FINAL_ANSWER"]);
  expect(parseSubagentMessages(envelope("Done").replaceAll("\n", "\r\n"))?.[0].body).toBe("Done");
});

test.each([
  "Normal user prompt",
  `Please explain this:\n${envelope("Example")}`,
  `\`\`\`\n${envelope("Example")}\n\`\`\``,
  "Message Type: MESSAGE\nTask name: /root\nPayload:\nMissing sender",
  envelope("Unknown", "OTHER"),
  envelope("Invalid sender", "MESSAGE", "someone"),
])("does not reinterpret ordinary prompts or incomplete envelopes: %s", (text) => {
  expect(parseSubagentMessages(text)).toBeNull();
});

test("does not split envelope-shaped examples inside payload code fences", () => {
  const body = `An example:\n\n\`\`\`text\n${envelope("Example")}\n\`\`\`\n\nKeep this intact.`;
  expect(parseSubagentMessages(envelope(body))).toHaveLength(1);
  expect(parseSubagentMessages(envelope(body))?.[0].body).toBe(body);
});

test("preserves empty payloads and embedded protocol labels", () => {
  expect(parseSubagentMessages(envelope(""))?.[0].body).toBe("");
  expect(parseSubagentMessages(envelope("Payload:\nSender: keep this"))?.[0].body).toBe("Payload:\nSender: keep this");
});

test("does not restyle assistant examples or discard user attachments", () => {
  expect(subagentMessagesForMessage({ role: "assistant", text: envelope("Example") })).toBeNull();
  expect(
    subagentMessagesForMessage({
      role: "user",
      text: envelope("Example"),
      images: [{ imageUrl: "data:image/png;base64,AA==" }],
    }),
  ).toBeNull();
});

test("formats canonical task names for display without losing full paths", () => {
  expect(subagentDisplayName("/root/cloud_review")).toBe("Cloud review");
  expect(subagentDisplayName("/root/team/release-check")).toBe("Release check");
  expect(subagentDisplayName("/root")).toBe("Coordinator");
});

test("extracts the final result and terminal status without hiding errors", () => {
  const message = parseSubagentMessages(
    envelope(
      "Agent /root/cloud_review finished with status Failed.\n\nFinal result:\nPartial work\n\nTerminal error:\nBuild failed.",
      "FINAL_ANSWER",
    ),
  )![0];
  expect(subagentMessageResult(message)).toEqual({
    status: "Failed",
    body: "Partial work\n\nTerminal error:\nBuild failed.",
  });
});

test("does not strip a result report for a different sender", () => {
  const body = "Agent /root/another finished with status Completed.\n\nFinal result:\nQuoted report.";
  expect(subagentMessageResult(parseSubagentMessages(envelope(body, "FINAL_ANSWER"))![0])).toEqual({ body });
});
