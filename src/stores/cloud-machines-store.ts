import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  BlaxelCliStatus,
  BlaxelSandboxSummary,
  BlaxelWorkspaceInfo,
  CloudMachine,
  CloudMachineInput,
  CloudProviderCredentialStatus,
  CloudRunnerProvider,
} from "@/lib/cloud-machines";
import { roderIpc } from "@/lib/roder-ipc";

function cleanErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const cleaned = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/u, "").trim();
  return cleaned || fallback;
}

type CloudMachinesState = {
  machines: CloudMachine[];
  providers: CloudRunnerProvider[];
  credentialStatuses: CloudProviderCredentialStatus[];
  blaxelCli: BlaxelCliStatus | null;
  blaxelWorkspaces: BlaxelWorkspaceInfo[];
  blaxelSandboxes: BlaxelSandboxSummary[];
  blaxelActiveWorkspace: string | null;
  loadingSandboxes: boolean;
  savingCredentials: boolean;
  selectedMachineId: string;
  error: string;
  busy: boolean;
  refresh: () => Promise<void>;
  refreshCredentials: () => Promise<void>;
  refreshBlaxelSandboxes: (workspace?: string) => Promise<void>;
  importBlaxelCli: (workspace?: string) => Promise<void>;
  saveBlaxelCredentials: (params: { apiKey: string; workspace?: string }) => Promise<void>;
  saveProviderToken: (providerId: string, token: string) => Promise<void>;
  clearProviderCredentials: (providerId: string) => Promise<void>;
  createBlaxelSandbox: (params: {
    name: string;
    workspace?: string;
    image?: string;
    memory?: number;
    region?: string;
    workingDir?: string;
  }) => Promise<BlaxelSandboxSummary>;
  save: (input: CloudMachineInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  select: (id: string) => void;
};

export const useCloudMachinesStore = create<CloudMachinesState>()(
  persist(
    (set, get) => ({
      machines: [],
      providers: [],
      credentialStatuses: [],
      blaxelCli: null,
      blaxelWorkspaces: [],
      blaxelSandboxes: [],
      blaxelActiveWorkspace: null,
      loadingSandboxes: false,
      savingCredentials: false,
      selectedMachineId: "",
      error: "",
      busy: false,
      refresh: async () => {
        if (get().busy) return;
        set({ busy: true, error: "" });
        try {
          const [profiles, runners] = await Promise.all([roderIpc.listCloudMachines(), roderIpc.listRunners()]);
          // Keep a missing selection visible: never silently send a remote prompt locally.
          set({ machines: profiles.machines, providers: runners.providers, busy: false });
          void get()
            .refreshCredentials()
            .catch(() => undefined);
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "Could not load cloud machines.", busy: false });
        }
      },
      refreshCredentials: async () => {
        try {
          const creds = await roderIpc.cloudCredentialsStatus();
          if (!creds || !Array.isArray(creds.statuses)) return;
          const blaxelStatus = creds.statuses.find((entry) => entry.providerId === "blaxel");
          set({
            credentialStatuses: creds.statuses,
            blaxelCli: creds.blaxelCli ?? null,
            blaxelActiveWorkspace: blaxelStatus?.workspace ?? creds.blaxelCli?.workspace ?? null,
          });
          if (blaxelStatus?.configured) {
            void get()
              .refreshBlaxelSandboxes(blaxelStatus.workspace ?? undefined)
              .catch(() => undefined);
          }
        } catch {
          // Optional enhancement when mocked or before engine is ready.
        }
      },
      refreshBlaxelSandboxes: async (workspace) => {
        set({ loadingSandboxes: true });
        try {
          const [sandboxesRes, workspacesRes] = await Promise.all([
            roderIpc.listBlaxelSandboxes(workspace),
            roderIpc.listBlaxelWorkspaces().catch(() => ({ workspaces: get().blaxelWorkspaces })),
          ]);
          set({
            blaxelSandboxes: Array.isArray(sandboxesRes?.sandboxes) ? sandboxesRes.sandboxes : [],
            blaxelActiveWorkspace: sandboxesRes?.workspace ?? workspace ?? get().blaxelActiveWorkspace,
            blaxelWorkspaces: Array.isArray(workspacesRes?.workspaces)
              ? workspacesRes.workspaces
              : get().blaxelWorkspaces,
            loadingSandboxes: false,
          });
        } catch (error) {
          set({
            loadingSandboxes: false,
            error: error instanceof Error ? error.message : "Could not load Blaxel sandboxes.",
          });
        }
      },
      importBlaxelCli: async (workspace) => {
        set({ savingCredentials: true, error: "" });
        try {
          const result = await roderIpc.importBlaxelCliCredentials(workspace);
          set({
            savingCredentials: false,
            blaxelWorkspaces: result.workspaces ?? [],
            blaxelActiveWorkspace: result.status?.workspace ?? workspace ?? null,
          });
          await get().refreshCredentials();
          await get().refreshBlaxelSandboxes(result.status?.workspace ?? workspace);
        } catch (error) {
          set({
            savingCredentials: false,
            error: cleanErrorMessage(error, "Could not import Blaxel CLI credentials."),
          });
          throw error;
        }
      },
      saveBlaxelCredentials: async (params) => {
        set({ savingCredentials: true, error: "" });
        try {
          const result = await roderIpc.saveBlaxelCredentials(params);
          set({
            savingCredentials: false,
            blaxelWorkspaces: result.workspaces ?? [],
            blaxelActiveWorkspace: result.status?.workspace ?? params.workspace ?? null,
          });
          await get().refreshCredentials();
          await get().refreshBlaxelSandboxes(result.status?.workspace ?? params.workspace);
        } catch (error) {
          set({
            savingCredentials: false,
            error: cleanErrorMessage(error, "Could not save Blaxel credentials."),
          });
          throw error;
        }
      },
      saveProviderToken: async (providerId, token) => {
        set({ savingCredentials: true, error: "" });
        try {
          await roderIpc.saveProviderCredentialToken(providerId, token);
          set({ savingCredentials: false });
          await get().refreshCredentials();
        } catch (error) {
          set({
            savingCredentials: false,
            error: cleanErrorMessage(error, "Could not save provider credentials."),
          });
          throw error;
        }
      },
      clearProviderCredentials: async (providerId) => {
        set({ savingCredentials: true, error: "" });
        try {
          await roderIpc.clearProviderCredentials(providerId);
          set((state) => ({
            savingCredentials: false,
            ...(providerId === "blaxel" ? { blaxelSandboxes: [], blaxelWorkspaces: [] } : {}),
            credentialStatuses: state.credentialStatuses.map((item) =>
              item.providerId === providerId ? { ...item, configured: false, source: "none", preview: null } : item,
            ),
          }));
          await get().refreshCredentials();
        } catch (error) {
          set({
            savingCredentials: false,
            error: cleanErrorMessage(error, "Could not disconnect provider."),
          });
          throw error;
        }
      },
      createBlaxelSandbox: async (params) => {
        set({ loadingSandboxes: true, error: "" });
        try {
          const { sandbox } = await roderIpc.createBlaxelSandbox(params);
          set((state) => ({
            loadingSandboxes: false,
            blaxelSandboxes: [sandbox, ...state.blaxelSandboxes.filter((entry) => entry.name !== sandbox.name)],
          }));
          return sandbox;
        } catch (error) {
          set({
            loadingSandboxes: false,
            error: cleanErrorMessage(error, "Could not create Blaxel sandbox."),
          });
          throw error;
        }
      },
      save: async (input) => {
        set({ busy: true, error: "" });
        try {
          await roderIpc.saveCloudMachine(input);
          set({ busy: false });
          await get().refresh();
        } catch (error) {
          set({ error: cleanErrorMessage(error, "Could not save cloud machine."), busy: false });
          throw error;
        }
      },
      remove: async (id) => {
        set({ busy: true, error: "" });
        try {
          await roderIpc.removeCloudMachine(id);
          set({ busy: false });
          await get().refresh();
        } catch (error) {
          set({ error: cleanErrorMessage(error, "Could not remove cloud machine."), busy: false });
          throw error;
        }
      },
      select: (selectedMachineId) => set({ selectedMachineId }),
    }),
    {
      name: "roder-cloud-machine-selection",
      partialize: (state) => ({ selectedMachineId: state.selectedMachineId }),
    },
  ),
);
