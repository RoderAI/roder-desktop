import { expect, test } from "vitest";
import {
  activeSubagentTraces,
  doneSubagentTraces,
  humanizeTeamMemberName,
  mergeHydratedSubagentTraces,
  reduceSubagentTraceNotification,
  subagentTraceBlurb,
  type SubagentTraceStoreSlice,
} from "../src/lib/subagent-traces";
import type { SubagentTraceSummary } from "../src/types/roder";

function emptySlice(): SubagentTraceStoreSlice {
  return {
    subagentTracesByThread: {},
    subagentLifecycleByThread: {},
    teamLeadThreadByTeamId: {},
    teamMemberTitlesByKey: {},
  };
}

function baseSummary(overrides: Partial<SubagentTraceSummary> = {}): SubagentTraceSummary {
  return {
    traceId: "trace-1",
    parent: { threadId: "thread-1", turnId: "turn-1" },
    childThreadId: "child-thread",
    childTurnId: "child-turn",
    title: "Token cleanup",
    role: "explore",
    status: "running",
    elapsedMs: 0,
    latestActivity: "starting",
    ...overrides,
  };
}

test("created → delta → statusChanged → completed updates blurb and lifecycle verbs", () => {
  let slice = emptySlice();

  const created = reduceSubagentTraceNotification(
    slice,
    "turn/subagentTraceCreated",
    {
      summary: baseSummary({ latestActivity: "queued" }),
      timestamp: "2026-07-21T10:00:00.000Z",
    },
    "msg-1",
  );
  expect(created).toBeTruthy();
  slice = { ...slice, ...created };

  expect(slice.subagentTracesByThread["thread-1"]).toHaveLength(1);
  expect(slice.subagentTracesByThread["thread-1"][0].title).toBe("Token cleanup");
  expect(slice.subagentLifecycleByThread["thread-1"].at(-1)?.verb).toBe("started working");

  const delta = reduceSubagentTraceNotification(
    slice,
    "turn/subagentTraceDelta",
    {
      delta: {
        traceId: "trace-1",
        parent: { threadId: "thread-1", turnId: "turn-1" },
        item: { type: "toolCall", toolId: "t1", toolName: "shell", input: {} },
      },
      timestamp: "2026-07-21T10:00:05.000Z",
    },
    "msg-2",
  );
  expect(delta).toBeTruthy();
  slice = { ...slice, ...delta };

  expect(subagentTraceBlurb(slice.subagentTracesByThread["thread-1"][0])).toBe("tool: shell");
  expect(slice.subagentLifecycleByThread["thread-1"].at(-1)).toMatchObject({
    verb: "updated",
    afterMessageId: "msg-2",
  });

  const statusChanged = reduceSubagentTraceNotification(
    slice,
    "turn/subagentTraceStatusChanged",
    {
      trace_id: "trace-1",
      parent: { threadId: "thread-1", turnId: "turn-1" },
      status: "running",
      detail: "tightening cleanup limits",
      timestamp: "2026-07-21T10:00:10.000Z",
    },
    "msg-3",
  );
  expect(statusChanged).toBeTruthy();
  slice = { ...slice, ...statusChanged };
  expect(subagentTraceBlurb(slice.subagentTracesByThread["thread-1"][0])).toBe("tightening cleanup limits");

  const completed = reduceSubagentTraceNotification(
    slice,
    "turn/subagentTraceCompleted",
    {
      summary: baseSummary({
        status: "completed",
        latestActivity: "cleanup finished",
        elapsedMs: 1200,
      }),
      timestamp: "2026-07-21T10:01:00.000Z",
    },
    "msg-4",
  );
  expect(completed).toBeTruthy();
  slice = { ...slice, ...completed };

  const traces = slice.subagentTracesByThread["thread-1"];
  expect(activeSubagentTraces(traces)).toEqual([]);
  expect(doneSubagentTraces(traces)).toHaveLength(1);
  expect(doneSubagentTraces(traces)[0].status).toBe("completed");
  expect(slice.subagentLifecycleByThread["thread-1"].at(-1)?.verb).toBe("finished");
});

test("failed notification marks the trace done and records a failed lifecycle chip", () => {
  let slice = emptySlice();
  const created = reduceSubagentTraceNotification(
    slice,
    "turn/subagentTraceCreated",
    { summary: baseSummary(), timestamp: "2026-07-21T10:00:00.000Z" },
    null,
  );
  slice = { ...slice, ...created! };

  const failed = reduceSubagentTraceNotification(
    slice,
    "turn/subagentTraceFailed",
    {
      summary: baseSummary({ status: "failed" }),
      error: "runner timed out",
      timestamp: "2026-07-21T10:02:00.000Z",
    },
    "msg-9",
  );
  slice = { ...slice, ...failed! };

  expect(doneSubagentTraces(slice.subagentTracesByThread["thread-1"])[0]).toMatchObject({
    status: "failed",
    errorSummary: "runner timed out",
  });
  expect(slice.subagentLifecycleByThread["thread-1"].at(-1)).toMatchObject({
    verb: "failed",
    afterMessageId: "msg-9",
  });
});

test("consecutive updated lifecycle chips for the same trace collapse to the latest", () => {
  let slice = emptySlice();
  slice = {
    ...slice,
    ...reduceSubagentTraceNotification(
      slice,
      "turn/subagentTraceCreated",
      { summary: baseSummary(), timestamp: "2026-07-21T10:00:00.000Z" },
      "msg-1",
    )!,
  };

  for (const [index, toolName] of ["read", "shell", "edit"].entries()) {
    slice = {
      ...slice,
      ...reduceSubagentTraceNotification(
        slice,
        "turn/subagentTraceDelta",
        {
          delta: {
            traceId: "trace-1",
            parent: { threadId: "thread-1", turnId: "turn-1" },
            item: { type: "toolCall", toolId: `t${index}`, toolName, input: {} },
          },
          timestamp: `2026-07-21T10:00:0${index + 1}.000Z`,
        },
        `msg-${index + 2}`,
      )!,
    };
  }

  const lifecycle = slice.subagentLifecycleByThread["thread-1"];
  expect(lifecycle.filter((event) => event.verb === "updated")).toHaveLength(1);
  expect(lifecycle.at(-1)).toMatchObject({ verb: "updated", afterMessageId: "msg-4" });
  expect(subagentTraceBlurb(slice.subagentTracesByThread["thread-1"][0])).toBe("tool: edit");
});

test("mergeHydratedSubagentTraces preserves live updates and imports list summaries", () => {
  const existing = mergeHydratedSubagentTraces(
    [],
    [baseSummary({ latestActivity: "live activity" })],
    1_000,
  );
  const merged = mergeHydratedSubagentTraces(
    existing.map((trace) => ({ ...trace, latestActivity: "newer live blurb", updatedAt: 2_000 })),
    [baseSummary({ status: "completed", latestActivity: "from list", elapsedMs: 50 })],
    3_000,
  );

  expect(merged).toHaveLength(1);
  expect(merged[0].status).toBe("completed");
  expect(merged[0].latestActivity).toBe("from list");
  expect(merged[0].createdAt).toBe(1_000);
  expect(merged[0].updatedAt).toBe(3_000);
});

const teamId = "824ae94d-1111-2222-3333-444444444444";
const parentTurnId = "turn-parent-1";
const fallbackThreadId = "thread-lead-1";

test("team/member/messageDelta lazily discovers a member and keeps a rolling blurb", () => {
  let slice = emptySlice();

  const first = reduceSubagentTraceNotification(
    slice,
    "team/member/messageDelta",
    {
      teamId,
      memberId: "member-3",
      turnId: parentTurnId,
      delta: "Hello",
    },
    "msg-1",
    { fallbackThreadId },
  );
  expect(first).toBeTruthy();
  slice = { ...slice, ...first };

  expect(slice.subagentTracesByThread[fallbackThreadId]).toHaveLength(1);
  expect(slice.subagentTracesByThread[fallbackThreadId][0]).toMatchObject({
    traceId: `team:${teamId}:member-3`,
    title: "Member 3",
    status: "running",
    latestActivity: "Hello",
    parent: { threadId: fallbackThreadId, turnId: parentTurnId },
  });
  expect(slice.subagentLifecycleByThread[fallbackThreadId].at(-1)?.verb).toBe("started working");

  // Simulate many tiny deltas (live runs emit 100+) — store only a rolling blurb.
  let activity = "Hello";
  for (const piece of [" from", " the", " subagent", " that", " keeps", " writing", " more", " text", " until", " over."]) {
    activity += piece;
    slice = {
      ...slice,
      ...reduceSubagentTraceNotification(
        slice,
        "team/member/messageDelta",
        { teamId, memberId: "member-3", turnId: parentTurnId, delta: piece },
        "msg-2",
        { fallbackThreadId },
      )!,
    };
  }

  const blurb = slice.subagentTracesByThread[fallbackThreadId][0].latestActivity ?? "";
  expect(blurb.endsWith(" until over.")).toBe(true);
  expect(blurb.length).toBeLessThanOrEqual(200);
  expect(slice.subagentLifecycleByThread[fallbackThreadId].filter((e) => e.verb === "updated")).toHaveLength(1);
});

test("team/member/completed sets terminal status and finalMessage; lead is excluded", () => {
  let slice = emptySlice();

  // Lead deltas must not create a subagent row.
  const leadDelta = reduceSubagentTraceNotification(
    slice,
    "team/member/messageDelta",
    { teamId, memberId: "lead", turnId: parentTurnId, delta: "." },
    "msg-0",
    { fallbackThreadId },
  );
  expect(leadDelta).toBeNull();

  slice = {
    ...slice,
    ...reduceSubagentTraceNotification(
      slice,
      "team/member/messageDelta",
      { teamId, memberId: "member-3", turnId: parentTurnId, delta: "working" },
      "msg-1",
      { fallbackThreadId },
    )!,
  };

  const leadCompleted = reduceSubagentTraceNotification(
    slice,
    "team/member/completed",
    {
      teamId,
      memberId: "lead",
      turnId: parentTurnId,
      status: "completed",
      finalMessage: "Lead wrap-up should be ignored.",
    },
    "msg-2",
    { fallbackThreadId },
  );
  expect(leadCompleted).toBeNull();

  const completed = reduceSubagentTraceNotification(
    slice,
    "team/member/completed",
    {
      teamId,
      memberId: "member-3",
      turnId: parentTurnId,
      status: "completed",
      finalMessage: "Demo repo used to validate subagent behavior.",
    },
    "msg-3",
    { fallbackThreadId },
  );
  expect(completed).toBeTruthy();
  slice = { ...slice, ...completed };

  const traces = slice.subagentTracesByThread[fallbackThreadId];
  expect(traces).toHaveLength(1);
  expect(activeSubagentTraces(traces)).toEqual([]);
  expect(doneSubagentTraces(traces)[0]).toMatchObject({
    status: "completed",
    latestActivity: "Demo repo used to validate subagent behavior.",
  });
  expect(slice.subagentLifecycleByThread[fallbackThreadId].at(-1)?.verb).toBe("finished");
});

test("team/started and team/member/started resolve lead thread and friendly names", () => {
  let slice = emptySlice();

  const started = reduceSubagentTraceNotification(
    slice,
    "team/started",
    {
      team: {
        id: teamId,
        leadThreadId: fallbackThreadId,
        displayMode: "in_process",
        members: [
          {
            id: "lead",
            role: "lead",
            name: "Lead",
            threadId: fallbackThreadId,
            status: "running",
            policyMode: "default",
          },
          {
            id: "member-3",
            role: "teammate",
            name: "readme_summary",
            threadId: "thread-member-3",
            parentThreadId: fallbackThreadId,
            status: "running",
            policyMode: "default",
            model: "gpt-5.5",
          },
        ],
        tasks: [],
      },
    },
    "msg-1",
    { fallbackThreadId: "wrong-thread" },
  );
  expect(started).toBeTruthy();
  slice = { ...slice, ...started };

  expect(slice.teamLeadThreadByTeamId[teamId]).toBe(fallbackThreadId);
  expect(slice.subagentTracesByThread[fallbackThreadId]).toHaveLength(1);
  expect(slice.subagentTracesByThread[fallbackThreadId][0]).toMatchObject({
    title: "Readme summary",
    status: "running",
    role: "teammate",
  });
  // Lead must not appear.
  expect(slice.subagentTracesByThread[fallbackThreadId].some((t) => t.title === "Lead")).toBe(false);

  const memberStarted = reduceSubagentTraceNotification(
    slice,
    "team/member/started",
    {
      teamId,
      member: {
        id: "member-4",
        role: "teammate",
        name: "list_files",
        threadId: "thread-member-4",
        parentThreadId: fallbackThreadId,
        status: "running",
        policyMode: "default",
      },
    },
    "msg-2",
  );
  expect(memberStarted).toBeTruthy();
  slice = { ...slice, ...memberStarted };

  expect(slice.subagentTracesByThread[fallbackThreadId].map((t) => t.title).toSorted()).toEqual([
    "List files",
    "Readme summary",
  ]);

  // Later deltas should reuse the friendly name and lead-thread mapping (no fallback needed).
  slice = {
    ...slice,
    ...reduceSubagentTraceNotification(
      slice,
      "team/member/messageDelta",
      { teamId, memberId: "member-3", turnId: parentTurnId, delta: "summarizing" },
      "msg-3",
    )!,
  };
  expect(slice.subagentTracesByThread[fallbackThreadId].find((t) => t.traceId.endsWith(":member-3"))).toMatchObject({
    title: "Readme summary",
    latestActivity: "summarizing",
  });
});

test("member names are recovered from sender/task paths in team payloads", () => {
  let slice = emptySlice();

  // A delta whose text carries a sender path (mirrors lead FINAL_ANSWER payloads).
  slice = {
    ...slice,
    ...reduceSubagentTraceNotification(
      slice,
      "team/member/messageDelta",
      {
        teamId,
        memberId: "member-5",
        turnId: parentTurnId,
        delta: "Sender: /root/haiku_writer\nAutumn files drift down",
      },
      "msg-1",
      { fallbackThreadId },
    )!,
  };
  expect(slice.subagentTracesByThread[fallbackThreadId].find((t) => t.traceId.endsWith(":member-5"))).toMatchObject({
    title: "Haiku writer",
  });

  // Completed finalMessage with a task path names a member never seen with a name.
  slice = {
    ...slice,
    ...reduceSubagentTraceNotification(
      slice,
      "team/member/completed",
      {
        teamId,
        memberId: "member-6",
        turnId: parentTurnId,
        status: "completed",
        finalMessage: "Task name: /root/file_counter. Workspace root: 3 entries.",
      },
      "msg-2",
      { fallbackThreadId },
    )!,
  };
  expect(slice.subagentTracesByThread[fallbackThreadId].find((t) => t.traceId.endsWith(":member-6"))).toMatchObject({
    title: "File counter",
    status: "completed",
  });

  // The lifecycle chips reuse the resolved pretty titles.
  const lifecycle = slice.subagentLifecycleByThread[fallbackThreadId];
  expect(lifecycle.some((event) => event.title === "Haiku writer")).toBe(true);
  expect(lifecycle.at(-1)?.title).toBe("File counter");
});

test("humanizeTeamMemberName sentence-cases raw names and keeps acronyms", () => {
  expect(humanizeTeamMemberName("haiku_writer")).toBe("Haiku writer");
  expect(humanizeTeamMemberName("native-runner-review")).toBe("Native runner review");
  expect(humanizeTeamMemberName("api_docs_check")).toBe("API docs check");
  expect(humanizeTeamMemberName("member-5")).toBe("Member 5");
});

test("team/started task titles name members that lack a descriptor name", () => {
  let slice = emptySlice();

  slice = {
    ...slice,
    ...reduceSubagentTraceNotification(
      slice,
      "team/started",
      {
        team: {
          id: teamId,
          leadThreadId: fallbackThreadId,
          displayMode: "in_process",
          members: [
            {
              id: "member-7",
              role: "teammate",
              name: "",
              threadId: "thread-member-7",
              status: "running",
              policyMode: "default",
            },
          ],
          tasks: [
            { id: "task-1", title: "token_cleanup", status: "open", assigneeMemberId: "member-7" },
          ],
        },
      },
      "msg-1",
      { fallbackThreadId },
    )!,
  };

  expect(slice.subagentTracesByThread[fallbackThreadId][0]).toMatchObject({
    title: "Token cleanup",
  });
});

test("team/member/completed with failed status records error blurb", () => {
  let slice = emptySlice();
  slice = {
    ...slice,
    ...reduceSubagentTraceNotification(
      slice,
      "team/member/messageDelta",
      { teamId, memberId: "member-3", turnId: parentTurnId, delta: "…" },
      null,
      { fallbackThreadId },
    )!,
  };

  slice = {
    ...slice,
    ...reduceSubagentTraceNotification(
      slice,
      "team/member/completed",
      {
        teamId,
        memberId: "member-3",
        turnId: parentTurnId,
        status: "failed",
        error: "runner timed out",
      },
      "msg-err",
      { fallbackThreadId },
    )!,
  };

  expect(doneSubagentTraces(slice.subagentTracesByThread[fallbackThreadId])[0]).toMatchObject({
    status: "failed",
    errorSummary: "runner timed out",
    latestActivity: "runner timed out",
  });
  expect(slice.subagentLifecycleByThread[fallbackThreadId].at(-1)?.verb).toBe("failed");
});
