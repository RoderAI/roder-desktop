import { create } from "zustand";
import { errorMessage } from "@/lib/error-message";
import { roderIpc } from "@/lib/roder-ipc";
import type { SkillDescriptor, SkillExposure, SkillsListResult } from "@/types/roder";

type SkillsLoadOptions = {
  workspaceId?: string;
  rootId?: string;
  cwd?: string;
};

type SkillsStore = {
  skills: SkillDescriptor[];
  diagnostics: string[];
  loading: boolean;
  error: string | null;
  loaded: boolean;
  loadedContextKey: string | null;
  loadedContext: SkillsLoadOptions | null;
  pendingByPath: Record<string, boolean>;
  errorsByPath: Record<string, string>;
  load: (options?: SkillsLoadOptions) => Promise<void>;
  setSkillEnabled: (canonicalPath: string, enabled: boolean) => Promise<void>;
  setSkillExposure: (canonicalPath: string, exposure: SkillExposure) => Promise<void>;
  clearError: () => void;
};

type StoreSet = (partial: Partial<SkillsStore> | ((state: SkillsStore) => Partial<SkillsStore>)) => void;

export const useSkillsStore = create<SkillsStore>()((set, get) => ({
  skills: [],
  diagnostics: [],
  loading: false,
  error: null,
  loaded: false,
  loadedContextKey: null,
  loadedContext: null,
  pendingByPath: {},
  errorsByPath: {},
  load: async (options = {}) => {
    set({ loading: true, error: null });
    const normalizedOptions = normalizeSkillsLoadOptions(options);
    const contextKey = skillsLoadContextKey(normalizedOptions);
    try {
      applySkillsResult(set, await roderIpc.listSkills(normalizedOptions), contextKey, normalizedOptions);
    } catch (error) {
      set({ error: errorMessage(error), loaded: true, loadedContextKey: contextKey, loadedContext: normalizedOptions });
    } finally {
      set({ loading: false });
    }
  },
  setSkillEnabled: (canonicalPath, enabled) =>
    withPendingSkill(set, canonicalPath, async () => {
      await roderIpc.setSkillEnabled(canonicalPath, enabled);
      await reloadCurrentSkillsContext(set, get);
    }),
  setSkillExposure: (canonicalPath, exposure) =>
    withPendingSkill(set, canonicalPath, async () => {
      await roderIpc.setSkillExposure(canonicalPath, exposure);
      await reloadCurrentSkillsContext(set, get);
    }),
  clearError: () => set({ error: null }),
}));

function applySkillsResult(
  set: StoreSet,
  result: SkillsListResult,
  contextKey: string | undefined,
  context: SkillsLoadOptions | undefined,
): void {
  const normalizedResult = normalizeSkillsResult(result);
  set((state) => ({
    skills: normalizedResult.skills,
    diagnostics: normalizedResult.diagnostics,
    error: null,
    errorsByPath: {},
    loaded: true,
    loadedContextKey: contextKey ?? state.loadedContextKey,
    loadedContext: context ?? state.loadedContext,
  }));
}

async function reloadCurrentSkillsContext(set: StoreSet, get: () => SkillsStore): Promise<void> {
  const context = get().loadedContext ?? normalizeSkillsLoadOptions();
  applySkillsResult(set, await roderIpc.listSkills(context), skillsLoadContextKey(context), context);
}

function normalizeSkillsLoadOptions(options: SkillsLoadOptions = {}): SkillsLoadOptions {
  return {
    workspaceId: options.workspaceId || undefined,
    rootId: options.rootId || undefined,
    cwd: options.cwd || undefined,
  };
}

export function skillsLoadContextKey(options: SkillsLoadOptions = {}): string {
  return JSON.stringify({
    workspaceId: options.workspaceId || "",
    rootId: options.rootId || "",
    cwd: options.cwd || "",
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
