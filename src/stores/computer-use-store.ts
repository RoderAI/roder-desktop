import { create } from "zustand";
import { persist } from "zustand/middleware";

// NOTE: This store holds the user's *desktop-side* computer-use policy for the
// Google Chrome integration. The four permission settings and the six domain
// allow/deny lists are persisted locally and surfaced in the Computer use
// settings screens. Wiring these values into roder's actual enforcement
// (e.g. via `chrome/permissions/update`) is a follow-up — today they are stored
// preferences only.

export type ComputerUsePermission = "allow" | "ask" | "never";

export type ComputerUsePermissionKey = "approval" | "history" | "downloads" | "uploads";

export type ComputerUseDomainList =
  | "blockedDomains"
  | "allowedDomains"
  | "blockedDownloadDomains"
  | "allowedDownloadDomains"
  | "blockedUploadDomains"
  | "allowedUploadDomains";

export type ComputerUsePolicy = {
  permissions: Record<ComputerUsePermissionKey, ComputerUsePermission>;
  blockedDomains: string[];
  allowedDomains: string[];
  blockedDownloadDomains: string[];
  allowedDownloadDomains: string[];
  blockedUploadDomains: string[];
  allowedUploadDomains: string[];
};

type ComputerUseStore = ComputerUsePolicy & {
  setPermission: (key: ComputerUsePermissionKey, value: ComputerUsePermission) => void;
  addDomain: (list: ComputerUseDomainList, domain: string) => void;
  removeDomain: (list: ComputerUseDomainList, domain: string) => void;
};

export const defaultComputerUsePolicy: ComputerUsePolicy = {
  permissions: {
    approval: "ask",
    history: "ask",
    downloads: "ask",
    uploads: "ask",
  },
  blockedDomains: [],
  allowedDomains: [],
  blockedDownloadDomains: [],
  allowedDownloadDomains: [],
  blockedUploadDomains: [],
  allowedUploadDomains: [],
};

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//u, "")
    .replace(/\/.*$/u, "");
}

export const useComputerUseStore = create<ComputerUseStore>()(
  persist(
    (set) => ({
      ...defaultComputerUsePolicy,
      setPermission: (key, value) =>
        set((state) => ({ permissions: { ...state.permissions, [key]: value } })),
      addDomain: (list, domain) =>
        set((state) => {
          const normalized = normalizeDomain(domain);
          if (!normalized || state[list].includes(normalized)) {
            return {};
          }
          return { [list]: [...state[list], normalized] } as Pick<ComputerUsePolicy, ComputerUseDomainList>;
        }),
      removeDomain: (list, domain) =>
        set(
          (state) =>
            ({ [list]: state[list].filter((item) => item !== domain) }) as Pick<
              ComputerUsePolicy,
              ComputerUseDomainList
            >,
        ),
    }),
    {
      name: "computer-use-store",
      version: 1,
      partialize: (state) => ({
        permissions: state.permissions,
        blockedDomains: state.blockedDomains,
        allowedDomains: state.allowedDomains,
        blockedDownloadDomains: state.blockedDownloadDomains,
        allowedDownloadDomains: state.allowedDownloadDomains,
        blockedUploadDomains: state.blockedUploadDomains,
        allowedUploadDomains: state.allowedUploadDomains,
      }),
      merge: (persisted, current) => {
        const value = persisted as Partial<ComputerUsePolicy> | undefined;
        return {
          ...current,
          ...value,
          permissions: { ...current.permissions, ...value?.permissions },
        };
      },
    },
  ),
);
