import { describe, expect, it } from "vitest";
import { toTeamShellMembers, toTeamShellMessages } from "./team-view-model";
import type { RoderTeamMessage } from "@/types/team";

function message(overrides: Partial<RoderTeamMessage>): RoderTeamMessage {
  return {
    id: "message-1",
    team_id: "team-1",
    author_kind: "user",
    author_member_id: null,
    channel_id: "general",
    text: "hello",
    created_at: "2026-05-17T12:00:00Z",
    ...overrides,
  };
}

describe("team view model", () => {
  it("adds the local user as a teammate", () => {
    const members = toTeamShellMembers(null);

    expect(members[0]).toMatchObject({
      id: "self",
      name: "You",
      title: "Local teammate",
    });
  });

  it("renders user-authored channel messages as the local user", () => {
    const [shellMessage] = toTeamShellMessages([message({ author_kind: "user", author_member_id: null })]);

    expect(shellMessage?.authorId).toBe("self");
  });

  it("renders user-authored direct prompts as the local user but keeps the target DM bucket", () => {
    const [shellMessage] = toTeamShellMessages([
      message({
        author_kind: "user",
        author_member_id: "engineering-lead",
        channel_id: null,
        turn_id: "turn-1",
      }),
    ]);

    expect(shellMessage?.authorId).toBe("self");
    expect(shellMessage?.channelId).toBe("dm:engineering-lead");
  });

  it("renders system-authored messages as Roder", () => {
    const [shellMessage] = toTeamShellMessages([message({ author_kind: "system", author_member_id: null })]);

    expect(shellMessage?.authorId).toBe("system");
  });
});
