import type { ConversationMessage } from "@/types/roder";

export type SubagentMessage = {
  id: string;
  kind: "MESSAGE" | "NEW_TASK" | "FINAL_ANSWER";
  recipient: string;
  sender: string;
  body: string;
};

export function parseSubagentMessages(value: string): SubagentMessage[] | null {
  if (!value.startsWith("Message Type: ")) return null;
  const text = value.replace(/\r\n/gu, "\n");
  const header =
    /(?:^|\n\n)Message Type: (MESSAGE|NEW_TASK|FINAL_ANSWER)\nTask name: (\/root(?:\/[^\s/]+)*)\nSender: (\/root(?:\/[^\s/]+)*)\nPayload:(?:\n|$)/gu;
  const fences = codeFenceRanges(text);
  const matches = [...text.matchAll(header)].filter(
    (match) => !fences.some(([start, end]) => match.index >= start && match.index < end),
  );
  if (matches[0]?.index !== 0) return null;
  return matches.map((match, index) => ({
    // Mailbox deliveries have no upstream ID; offsets are stable within a persisted message.
    id: `delivery:${match.index}`,
    kind: match[1] as SubagentMessage["kind"],
    recipient: match[2],
    sender: match[3],
    body: text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length),
  }));
}

export function subagentMessagesForMessage(
  message: Pick<ConversationMessage, "role" | "text" | "images"> | undefined,
): SubagentMessage[] | null {
  if (!message || (message.role !== "user" && message.role !== "system") || message.images?.length) return null;
  return parseSubagentMessages(message.text);
}

export function subagentDisplayName(path: string): string {
  if (path === "/root") return "Coordinator";
  const name = (path.split("/").at(-1) || path).replace(/[_-]+/gu, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function subagentMessageResult(message: SubagentMessage): { body: string; status?: string } {
  if (message.kind !== "FINAL_ANSWER") return { body: message.body };
  const report = /^Agent (\S+) finished with status (Completed|Failed|Cancelled|Interrupted)\./u.exec(message.body);
  if (!report || report[1] !== message.sender) return { body: message.body };
  const body = message.body
    .slice(report[0].length)
    .replace(/^\n\nFinal result:\n/u, "")
    .replace(/^\n\n/u, "");
  return { body, status: report[2] };
}

function codeFenceRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  let open: { start: number; marker: string; length: number } | undefined;
  let offset = 0;
  for (const line of text.split("\n")) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (match) {
      if (!open) {
        open = { start: offset, marker: match[1][0], length: match[1].length };
      } else if (match[1][0] === open.marker && match[1].length >= open.length && !match[2].trim()) {
        ranges.push([open.start, offset + line.length]);
        open = undefined;
      }
    }
    offset += line.length + 1;
  }
  if (open) ranges.push([open.start, text.length]);
  return ranges;
}
