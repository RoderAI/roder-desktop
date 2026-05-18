import { create } from "zustand";
import { extensionsIpc } from "@/lib/extensions-ipc";
import type { ExtensionCatalogRecord, ExtensionCatalogSnapshot } from "@/types/extensions";

type ExtensionsStore = {
  extensions: ExtensionCatalogRecord[];
  loading: boolean;
  error: string | null;
  lastResult: string | null;
  logsByExtension: Record<string, string[]>;
  load: () => Promise<void>;
  installFromFolder: (folderPath: string) => Promise<void>;
  installFromArchive: (archivePath: string) => Promise<void>;
  selectAndInstallFolder: () => Promise<void>;
  selectAndInstallArchive: () => Promise<void>;
  enable: (id: string) => Promise<void>;
  disable: (id: string) => Promise<void>;
  reload: (id: string) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
  activate: (id: string) => Promise<void>;
  executeCommand: (commandId: string) => Promise<void>;
  executeTool: (toolId: string) => Promise<void>;
  updatePreference: (id: string, key: string, value: string | boolean | null) => Promise<void>;
  readLogs: (id: string) => Promise<void>;
  clearError: () => void;
};

type StoreSet = (partial: Partial<ExtensionsStore> | ((state: ExtensionsStore) => Partial<ExtensionsStore>)) => void;

export const useExtensionsStore = create<ExtensionsStore>()((set) => ({
  extensions: [],
  loading: false,
  error: null,
  lastResult: null,
  logsByExtension: {},
  load: () => withSnapshot(set, () => extensionsIpc.list()),
  installFromFolder: (folderPath) => withSnapshot(set, () => extensionsIpc.installFromFolder(folderPath)),
  installFromArchive: (archivePath) => withSnapshot(set, () => extensionsIpc.installFromArchive(archivePath)),
  selectAndInstallFolder: () => withSnapshot(set, () => extensionsIpc.selectAndInstallFolder()),
  selectAndInstallArchive: () => withSnapshot(set, () => extensionsIpc.selectAndInstallArchive()),
  enable: (id) => withSnapshot(set, () => extensionsIpc.enable(id)),
  disable: (id) => withSnapshot(set, () => extensionsIpc.disable(id)),
  reload: (id) => withSnapshot(set, () => extensionsIpc.reload(id)),
  uninstall: (id) => withSnapshot(set, () => extensionsIpc.uninstall(id)),
  activate: (id) => withSnapshot(set, () => extensionsIpc.activate(id)),
  executeCommand: async (commandId) => {
    await withAction(set, async () => {
      const result = await extensionsIpc.executeCommand(commandId);
      set({ lastResult: resultLabel(result) });
    });
  },
  executeTool: async (toolId) => {
    await withAction(set, async () => {
      const result = await extensionsIpc.executeTool(toolId, { text: "Hello from Roder Desktop" });
      set({ lastResult: resultLabel(result) });
    });
  },
  updatePreference: (id, key, value) => withSnapshot(set, () => extensionsIpc.updatePreference(id, key, value)),
  readLogs: async (id) => {
    await withAction(set, async () => {
      const logs = await extensionsIpc.readLogs(id);
      set((state) => ({ logsByExtension: { ...state.logsByExtension, [id]: logs } }));
    });
  },
  clearError: () => set({ error: null }),
}));

async function withSnapshot(set: StoreSet, action: () => Promise<ExtensionCatalogSnapshot>): Promise<void> {
  await withAction(set, async () => {
    const snapshot = await action();
    set({ extensions: snapshot.extensions });
  });
}

async function withAction(set: StoreSet, action: () => Promise<void>): Promise<void> {
  set({ loading: true, error: null });
  try {
    await action();
  } catch (error) {
    set({ error: (error as Error).message });
  } finally {
    set({ loading: false });
  }
}

function resultLabel(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  return JSON.stringify(result, null, 2);
}
