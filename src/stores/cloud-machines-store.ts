import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  BlaxelCliStatus,
  BlaxelSandboxSummary,
  BlaxelWorkspaceInfo,
  BoatCredentialStatus,
  BoatOAuthState,
  BoatSandboxSize,
  BoatSandboxSummary,
  CloudMachine,
  CloudMachineInput,
  CloudProviderCredentialStatus,
  CloudRunnerProvider,
  LocalSshEnvironment,
  LocalTailscaleStatus,
  TailscaleCredentialStatus,
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
  boatCredentials: BoatCredentialStatus | null;
  boatAuthState: BoatOAuthState | null;
  boatSandboxes: BoatSandboxSummary[];
  localTailscale: LocalTailscaleStatus | null;
  tailscaleCredentials: TailscaleCredentialStatus | null;
  localSsh: LocalSshEnvironment | null;
  loadingSandboxes: boolean;
  savingCredentials: boolean;
  selectedMachineId: string;
  error: string;
  busy: boolean;
  refresh: () => Promise<void>;
  refreshCredentials: () => Promise<void>;
  refreshBoatStatus: () => Promise<void>;
  applyBoatAuthState: (state: BoatOAuthState) => void;
  startBoatOAuth: () => Promise<BoatOAuthState>;
  cancelBoatOAuth: () => Promise<BoatOAuthState>;
  saveBoatApiKey: (apiKey: string) => Promise<void>;
  refreshBoatSandboxes: () => Promise<void>;
  createBoatSandbox: (params: {
    name?: string;
    type?: BoatSandboxSize;
    environment?: string;
    workingDir?: string;
  }) => Promise<BoatSandboxSummary>;
  stopBoatSandbox: (sandboxId: string) => Promise<void>;
  resumeBoatSandbox: (sandboxId: string) => Promise<BoatSandboxSummary>;
  refreshTailscale: () => Promise<void>;
  refreshSsh: () => Promise<void>;
  refreshBlaxelSandboxes: (workspace?: string) => Promise<void>;
  importBlaxelCli: (workspace?: string) => Promise<void>;
  saveBlaxelCredentials: (params: { apiKey: string; workspace?: string }) => Promise<void>;
  saveTailscaleAuthKey: (params: { authKey: string; preferForSandboxes?: boolean }) => Promise<void>;
  saveTailscaleOAuth: (params: {
    oauthClientId: string;
    oauthClientSecret: string;
    tags?: string[] | string;
    tailnet?: string;
    preferForSandboxes?: boolean;
  }) => Promise<void>;
  setTailscaleSandboxPreference: (preferForSandboxes: boolean) => Promise<void>;
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
      boatCredentials: null,
      boatAuthState: null,
      boatSandboxes: [],
      localTailscale: null,
      tailscaleCredentials: null,
      localSsh: null,
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
          const boatStatus = creds.boatCredentials ?? null;
          set({
            credentialStatuses: creds.statuses,
            blaxelCli: creds.blaxelCli ?? null,
            blaxelActiveWorkspace: blaxelStatus?.workspace ?? creds.blaxelCli?.workspace ?? null,
            ...(creds.boatCredentials !== undefined ? { boatCredentials: creds.boatCredentials } : {}),
            ...(creds.boatAuthState !== undefined ? { boatAuthState: creds.boatAuthState } : {}),
            ...(creds.localTailscale !== undefined ? { localTailscale: creds.localTailscale } : {}),
            ...(creds.tailscaleCredentials !== undefined ? { tailscaleCredentials: creds.tailscaleCredentials } : {}),
            ...(creds.localSsh !== undefined ? { localSsh: creds.localSsh } : {}),
          });
          if (blaxelStatus?.configured) {
            void get()
              .refreshBlaxelSandboxes(blaxelStatus.workspace ?? undefined)
              .catch(() => undefined);
          }
          if (boatStatus?.configured) {
            void get()
              .refreshBoatSandboxes()
              .catch(() => undefined);
          }
        } catch {
          // Optional enhancement when mocked or before engine is ready.
        }
      },
      refreshBoatStatus: async () => {
        try {
          const status = await roderIpc.boatStatus();
          if (!status) return;
          set({
            boatCredentials: status.credentials ?? null,
            boatAuthState: status.authState ?? null,
          });
          if (status.credentials?.configured) {
            void get()
              .refreshBoatSandboxes()
              .catch(() => undefined);
          }
        } catch {
          // Optional when mocked or before engine is ready.
        }
      },
      applyBoatAuthState: (boatAuthState) => {
        set({ boatAuthState });
        if (boatAuthState.phase === "completed") {
          void get()
            .refreshCredentials()
            .catch(() => undefined);
        }
      },
      startBoatOAuth: async () => {
        set({ error: "" });
        try {
          const { authState } = await roderIpc.startBoatOAuth();
          set({ boatAuthState: authState });
          return authState;
        } catch (error) {
          const message = cleanErrorMessage(error, "Could not start Boat sign-in.");
          set({ error: message });
          throw new Error(message);
        }
      },
      cancelBoatOAuth: async () => {
        try {
          const { authState } = await roderIpc.cancelBoatOAuth();
          set({ boatAuthState: authState });
          return authState;
        } catch (error) {
          const message = cleanErrorMessage(error, "Could not cancel Boat sign-in.");
          set({ error: message });
          throw new Error(message);
        }
      },
      saveBoatApiKey: async (apiKey) => {
        set({ savingCredentials: true, error: "" });
        try {
          const result = await roderIpc.saveBoatApiKey(apiKey);
          set({
            savingCredentials: false,
            boatCredentials: result.status,
          });
          await get().refreshCredentials();
          await get().refreshBoatSandboxes();
        } catch (error) {
          set({
            savingCredentials: false,
            error: cleanErrorMessage(error, "Could not verify or save Boat API key."),
          });
          throw error;
        }
      },
      refreshBoatSandboxes: async () => {
        set({ loadingSandboxes: true });
        try {
          const result = await roderIpc.listBoatSandboxes();
          set({
            boatSandboxes: Array.isArray(result?.sandboxes) ? result.sandboxes : [],
            loadingSandboxes: false,
          });
        } catch (error) {
          set({
            loadingSandboxes: false,
            error: cleanErrorMessage(error, "Could not load Boat sandboxes."),
          });
        }
      },
      createBoatSandbox: async (params) => {
        set({ loadingSandboxes: true, error: "" });
        try {
          const { sandbox } = await roderIpc.createBoatSandbox(params);
          set((state) => ({
            loadingSandboxes: false,
            boatSandboxes: [sandbox, ...state.boatSandboxes.filter((entry) => entry.id !== sandbox.id)],
          }));
          return sandbox;
        } catch (error) {
          set({
            loadingSandboxes: false,
            error: cleanErrorMessage(error, "Could not create Boat sandbox."),
          });
          throw error;
        }
      },
      stopBoatSandbox: async (sandboxId) => {
        set({ error: "" });
        try {
          await roderIpc.stopBoatSandbox(sandboxId);
          set((state) => ({
            boatSandboxes: state.boatSandboxes.map((entry) =>
              entry.id === sandboxId ? { ...entry, state: "stopped" } : entry,
            ),
          }));
        } catch (error) {
          set({
            error: cleanErrorMessage(error, "Could not stop Boat sandbox."),
          });
          throw error;
        }
      },
      resumeBoatSandbox: async (sandboxId) => {
        set({ error: "" });
        try {
          const { sandbox } = await roderIpc.resumeBoatSandbox(sandboxId);
          set((state) => ({
            boatSandboxes: state.boatSandboxes.some((entry) => entry.id === sandbox.id)
              ? state.boatSandboxes.map((entry) => (entry.id === sandbox.id ? sandbox : entry))
              : [sandbox, ...state.boatSandboxes],
          }));
          return sandbox;
        } catch (error) {
          set({
            error: cleanErrorMessage(error, "Could not resume Boat sandbox."),
          });
          throw error;
        }
      },
      refreshTailscale: async () => {
        try {
          const status = await roderIpc.tailscaleStatus();
          if (!status) return;
          set({
            localTailscale: status.local ?? null,
            tailscaleCredentials: status.credentials ?? null,
          });
        } catch {
          // Optional when mocked or before engine is ready.
        }
      },
      refreshSsh: async () => {
        try {
          const status = await roderIpc.sshStatus();
          if (!status) return;
          set({ localSsh: status.local ?? null });
        } catch {
          // Optional when mocked or before engine is ready.
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
      saveTailscaleAuthKey: async (params) => {
        set({ savingCredentials: true, error: "" });
        try {
          const result = await roderIpc.saveTailscaleAuthKey(params);
          set({
            savingCredentials: false,
            tailscaleCredentials: result.status,
          });
          await get().refreshTailscale();
        } catch (error) {
          set({
            savingCredentials: false,
            error: cleanErrorMessage(error, "Could not save Tailscale auth key."),
          });
          throw error;
        }
      },
      saveTailscaleOAuth: async (params) => {
        set({ savingCredentials: true, error: "" });
        try {
          const result = await roderIpc.saveTailscaleOAuth(params);
          set({
            savingCredentials: false,
            tailscaleCredentials: result.status,
          });
          await get().refreshTailscale();
        } catch (error) {
          set({
            savingCredentials: false,
            error: cleanErrorMessage(error, "Could not verify or save Tailscale OAuth credentials."),
          });
          throw error;
        }
      },
      setTailscaleSandboxPreference: async (preferForSandboxes) => {
        set({ savingCredentials: true, error: "" });
        try {
          const result = await roderIpc.setTailscaleSandboxPreference(preferForSandboxes);
          set({
            savingCredentials: false,
            tailscaleCredentials: result.status,
          });
        } catch (error) {
          set({
            savingCredentials: false,
            error: cleanErrorMessage(error, "Could not update Tailscale sandbox preference."),
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
            ...(providerId === "boat"
              ? {
                  boatSandboxes: [],
                  boatCredentials: {
                    configured: false,
                    mode: "none",
                    source: "none",
                    preview: null,
                    userLogin: null,
                    userDisplayName: null,
                    userEmail: null,
                    scope: null,
                    expiresAt: null,
                  },
                }
              : {}),
            ...(providerId === "tailscale"
              ? {
                  tailscaleCredentials: {
                    configured: false,
                    mode: "none",
                    source: "none",
                    preview: null,
                    oauthClientId: null,
                    tags: ["tag:roder"],
                    tailnet: null,
                    preferForSandboxes: true,
                  },
                }
              : {}),
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
