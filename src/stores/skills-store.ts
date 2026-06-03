import { create } from "zustand";
import { errorMessage } from "@/lib/error-message";
import { roderIpc } from "@/lib/roder-ipc";
import type { SkillDescriptor, SkillExposure, SkillsListResult } from "@/types/roder";

type SkillsStore = {
  skills: SkillDescriptor[];
  diagnostics: string[];
  loading: boolean;
  error: string | null;
  loaded: boolean;
  pendingByPath: Record<string, boolean>;
  errorsByPath: Record<string, string>;
  load: () => Promise<void>;
  setSkillEnabled: (canonicalPath: string, enabled: boolean) => Promise<void>;
  setSkillExposure: (canonicalPath: string, exposure: SkillExposure) => Promise<void>;
  clearError: () => void;
};

type StoreSet = (partial: Partial<SkillsStore> | ((state: SkillsStore) => Partial<SkillsStore>)) => void;

export const useSkillsStore = create<SkillsStore>()((set) => ({
  skills: [],
  diagnostics: [],
  loading: false,
  error: null,
  loaded: false,
  pendingByPath: {},
  errorsByPath: {},
  load: async () => {
    set({ loading: true, error: null });
    try {
      applySkillsResult(set, await roderIpc.listSkills());
    } catch (error) {
      set({ error: errorMessage(error), loaded: true });
    } finally {
      set({ loading: false });
    }
  },
  setSkillEnabled: (canonicalPath, enabled) =>
    withPendingSkill(set, canonicalPath, async () => {
      applySkillsResult(set, await roderIpc.setSkillEnabled(canonicalPath, enabled));
    }),
  setSkillExposure: (canonicalPath, exposure) =>
    withPendingSkill(set, canonicalPath, async () => {
      applySkillsResult(set, await roderIpc.setSkillExposure(canonicalPath, exposure));
    }),
  clearError: () => set({ error: null }),
}));

function applySkillsResult(set: StoreSet, result: SkillsListResult): void {
  const normalizedResult = normalizeSkillsResult(result);
  set({
    skills: normalizedResult.skills,
    diagnostics: normalizedResult.diagnostics,
    error: null,
    errorsByPath: {},
    loaded: true,
  });
}

function normalizeSkillsResult(result: SkillsListResult): SkillsListResult {
  return {
    skills: Array.isArray(result.skills)
      ? result.skills.map((skill) => ({
          ...skill,
          diagnostics: Array.isArray(skill.diagnostics) ? skill.diagnostics : [],
        }))
      : [],
    diagnostics: Array.isArray(result.diagnostics) ? result.diagnostics : [],
  };
}

async function withPendingSkill(set: StoreSet, canonicalPath: string, action: () => Promise<void>): Promise<void> {
  set((state) => ({
    pendingByPath: { ...state.pendingByPath, [canonicalPath]: true },
    errorsByPath: removeKey(state.errorsByPath ?? {}, canonicalPath),
    error: null,
  }));
  try {
    await action();
  } catch (error) {
    const message = errorMessage(error);
    set((state) => ({
      error: message,
      errorsByPath: { ...state.errorsByPath, [canonicalPath]: message },
    }));
  } finally {
    set((state) => {
      const { [canonicalPath]: _removed, ...pendingByPath } = state.pendingByPath;
      return { pendingByPath };
    });
  }
}

function removeKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...next } = record;
  return next;
}
