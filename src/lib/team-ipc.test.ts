import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { teamIpc } from "./team-ipc";

describe("teamIpc", () => {
  const request = vi.fn();

  beforeEach(() => {
    request.mockResolvedValue({});
    vi.stubGlobal("window", { godeDesktop: { request } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    request.mockReset();
  });

  it("maps team protocol methods and payloads", async () => {
    await teamIpc.startTeam({ name: "Roder Lab", workspace: "/tmp/roder", provider: "codex", model: "gpt-5.5" });
    await teamIpc.listTeams();
    await teamIpc.readTeam("team-1");
    await teamIpc.sendChannelMessage({
      teamId: "team-1",
      channelId: "reviews",
      text: "review this",
      authorMemberId: "lead",
      projectContext: "/tmp/roder",
      threadTs: "thread-1",
    });
    await teamIpc.sendMemberMessage({ teamId: "team-1", memberId: "reviewer", channelId: "reviews", text: "please review" });
    await teamIpc.interruptMember("team-1", "reviewer");
    await teamIpc.setScheduler("team-1", false);
    await teamIpc.cleanupTeam("team-1");

    expect(request.mock.calls).toEqual([
      ["team/start", { name: "Roder Lab", workspace: "/tmp/roder", provider: "codex", model: "gpt-5.5" }],
      ["team/list", {}],
      ["team/read", { team_id: "team-1" }],
      [
        "team/channel/message",
        {
          team_id: "team-1",
          channel_id: "reviews",
          text: "review this",
          author_member_id: "lead",
          project_context: "/tmp/roder",
          thread_ts: "thread-1",
        },
      ],
      ["team/member/message", { team_id: "team-1", member_id: "reviewer", channel_id: "reviews", text: "please review" }],
      ["team/member/interrupt", { team_id: "team-1", member_id: "reviewer" }],
      ["team/scheduler/set", { team_id: "team-1", running: false }],
      ["team/cleanup", { team_id: "team-1" }],
    ]);
  });
});
