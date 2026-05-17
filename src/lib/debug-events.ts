export const MAX_DEBUG_EVENTS = 160;

export type DebugEventLevel = "info" | "warn" | "error";

export type DebugEventInput = {
  source: string;
  event: string;
  level?: DebugEventLevel;
  summary?: string;
  payload?: unknown;
};

export type DebugEvent = DebugEventInput & {
  id: string;
  createdAt: number;
  level: DebugEventLevel;
};

let sequence = 0;

export function createDebugEvent(input: DebugEventInput, now = Date.now()): DebugEvent {
  sequence += 1;
  return {
    ...input,
    id: `${now}-${sequence}`,
    createdAt: now,
    level: input.level ?? "info",
    payload: normalizePayload(input.payload),
  };
}

export function appendDebugEvent(events: DebugEvent[], event: DebugEvent): DebugEvent[] {
  return [event, ...events].slice(0, MAX_DEBUG_EVENTS);
}

function normalizePayload(payload: unknown): unknown {
  if (payload === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return String(payload);
  }
}
