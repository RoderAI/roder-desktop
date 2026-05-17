import { create } from "zustand";
import { appendDebugEvent, createDebugEvent, type DebugEvent, type DebugEventInput } from "@/lib/debug-events";

type DebugEventStore = {
  events: DebugEvent[];
  record: (event: DebugEventInput) => void;
  clear: () => void;
};

export const useDebugEventStore = create<DebugEventStore>()((set) => ({
  events: [],
  record: (event) => set((state) => ({ events: appendDebugEvent(state.events, createDebugEvent(event)) })),
  clear: () => set({ events: [] }),
}));

export function recordDebugEvent(event: DebugEventInput): void {
  useDebugEventStore.getState().record(event);
}
