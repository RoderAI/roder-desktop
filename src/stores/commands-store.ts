import { create } from "zustand";
import { errorMessage } from "@/lib/error-message";
import { roderIpc } from "@/lib/roder-ipc";
import type { CommandDescriptor, CommandsListResult } from "@/types/roder";

type CommandsStore = {
  commands: CommandDescriptor[];
  loading: boolean;
  error: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  clearError: () => void;
};

type StoreSet = (partial: Partial<CommandsStore> | ((state: CommandsStore) => Partial<CommandsStore>)) => void;

let activeLoad: Promise<void> | null = null;

export const useCommandsStore = create<CommandsStore>()((set) => ({
  commands: [],
  loading: false,
  error: null,
  loaded: false,
  load: async () => {
    if (activeLoad) {
      return activeLoad;
    }
    activeLoad = loadCommands(set);
    return activeLoad.finally(() => {
      activeLoad = null;
    });
  },
  clearError: () => set({ error: null }),
}));

async function loadCommands(set: StoreSet): Promise<void> {
  set({ loading: true, error: null });
  try {
    applyCommandsResult(set, await roderIpc.listCommands());
  } catch (error) {
    set({
      commands: [],
      error: errorMessage(error),
      loaded: true,
    });
  } finally {
    set({ loading: false });
  }
}

function applyCommandsResult(set: StoreSet, result: CommandsListResult): void {
  set({
    commands: normalizeCommandsResult(result).commands,
    error: null,
    loaded: true,
  });
}

function normalizeCommandsResult(result: CommandsListResult): CommandsListResult {
  return {
    commands: Array.isArray(result.commands)
      ? result.commands.toSorted((left, right) =>
          left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }),
        )
      : [],
  };
}
