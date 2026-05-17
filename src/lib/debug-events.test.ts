import { describe, expect, it } from "vitest";
import { appendDebugEvent, createDebugEvent, MAX_DEBUG_EVENTS, type DebugEvent } from "./debug-events";

describe("debug events", () => {
  it("keeps newest events first and caps the event log", () => {
    let events: DebugEvent[] = [];
    for (let index = 0; index < MAX_DEBUG_EVENTS + 2; index += 1) {
      events = appendDebugEvent(events, createDebugEvent({ source: "test", event: `event-${index}` }));
    }

    expect(events).toHaveLength(MAX_DEBUG_EVENTS);
    expect(events[0]?.event).toBe(`event-${MAX_DEBUG_EVENTS + 1}`);
    expect(events.at(-1)?.event).toBe("event-2");
  });
});
