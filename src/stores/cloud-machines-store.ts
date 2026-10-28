import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CloudMachine, CloudMachineInput, CloudRunnerProvider } from "@/lib/cloud-machines";
import { roderIpc } from "@/lib/roder-ipc";

type CloudMachinesState = {
  machines: CloudMachine[];
  providers: CloudRunnerProvider[];
  selectedMachineId: string;
  error: string;
  busy: boolean;
  refresh: () => Promise<void>;
  save: (input: CloudMachineInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  select: (id: string) => void;
};

export const useCloudMachinesStore = create<CloudMachinesState>()(
  persist(
    (set, get) => ({
      machines: [],
      providers: [],
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
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "Could not load cloud machines.", busy: false });
        }
      },
      save: async (input) => {
        set({ busy: true, error: "" });
        try {
          await roderIpc.saveCloudMachine(input);
          set({ busy: false });
          await get().refresh();
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "Could not save cloud machine.", busy: false });
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
          set({ error: error instanceof Error ? error.message : "Could not remove cloud machine.", busy: false });
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
