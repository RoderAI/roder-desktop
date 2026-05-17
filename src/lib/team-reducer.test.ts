import { describe, expect, it } from "vitest";
import { initialTeamState, teamReducer } from "./team-reducer";
import type { RoderTeam, RoderTeamMessage } from "@/types/team";

const baseTeam: RoderTeam = {
  id: "team-1",
  name: "Roder Lab",
  workspace: "/tmp/roder-lab",
  provider: "codex",
  model: "gpt-5.5",
  channels: [
    { id: "general", name: "general" },
    { id: "reviews", name: "reviews" },
  ],
  members: [
    { id: "lead", name: "Lead", role: "lead", status: "idle", provider: "codex", model: "gpt-5.5", worktree_path: "/tmp/lead" },
    { id: "reviewer", name: "Reviewer", role: "reviewer", status: "idle", provider: "codex", model: "gpt-5.5", worktree_path: "/tmp/reviewer" },
  ],
  messages: [],
  scheduler_running: true,
  aggressive_always_on: true,
  created_at: 1,
  updated_at: 1,
};

function message(id: string, channelId: string | null, text = id, authorMemberId: string | null = null): RoderTeamMessage {
  return {
    id,
    team_id: "team-1",
    channel_id: channelId,
    author_kind: authorMemberId ? "member" : "user",
    author_member_id: authorMemberId,
    text,
    created_at: 10,
  };
}

describe("teamReducer", () => {
  it("groups messages by channel when hydrating a team", () => {
    const state = teamReducer(initialTeamState(), {
      type: "team/loaded",
      team: {
        ...baseTeam,
        messages: [message("m1", "general"), message("m2", "reviews")],
      },
    });

    expect(state.messagesByChannel.general?.map((item) => item.id)).toEqual(["m1"]);
    expect(state.messagesByChannel.reviews?.map((item) => item.id)).toEqual(["m2"]);
  });

  it("groups direct member messages by member DM conversation", () => {
    const state = teamReducer(initialTeamState(), {
      type: "team/loaded",
      team: {
        ...baseTeam,
        messages: [message("dm1", null, "Can you review this?", "reviewer")],
      },
    });

    expect(state.messagesByChannel["dm:reviewer"]?.map((item) => item.id)).toEqual(["dm1"]);
    expect(state.messagesByChannel.direct).toBeUndefined();
  });

  it("increments unread counts only for inactive channels", () => {
    const selected = teamReducer(initialTeamState(), { type: "team/loaded", team: baseTeam });
    const withMessage = teamReducer(selected, { type: "message/received", message: message("m1", "reviews") });

    expect(withMessage.unreadByChannelId.reviews).toBe(1);
    expect(withMessage.unreadByChannelId.general).toBeUndefined();
  });

  it("clears a channel unread count when switching to it", () => {
    const state = teamReducer(
      {
        ...initialTeamState(),
        activeTeamId: "team-1",
        activeChannelId: "general",
        unreadByChannelId: { reviews: 2 },
      },
      { type: "channel/selected", channelId: "reviews" },
    );

    expect(state.activeChannelId).toBe("reviews");
    expect(state.selectedMessageId).toBeNull();
    expect(state.unreadByChannelId.reviews).toBeUndefined();
  });

  it("updates scheduler and aggressive always-on toggles", () => {
    const loaded = teamReducer(initialTeamState(), { type: "team/loaded", team: baseTeam });
    const paused = teamReducer(loaded, { type: "scheduler/set", running: false });
    const calm = teamReducer(paused, { type: "aggressiveAlwaysOn/set", enabled: false });

    expect(paused.schedulerRunning).toBe(false);
    expect(calm.aggressiveAlwaysOn).toBe(false);
  });
});
