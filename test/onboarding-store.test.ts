import { afterEach, beforeEach, expect, test, vi, type Mock } from "vitest";

type RecordResult = { onboarded: boolean; completedAt: string | null };

async function loadOnboardingStore() {
  vi.resetModules();
  return import("../src/stores/onboarding-store");
}

type Desktop = {
  onboardingState: Mock<() => Promise<RecordResult>>;
  onboardingComplete: Mock<() => Promise<void>>;
};

function installDesktop(overrides: Partial<Desktop> = {}): Desktop {
  const desktop: Desktop = {
    onboardingState: vi.fn<() => Promise<RecordResult>>(async () => ({ onboarded: false, completedAt: null })),
    onboardingComplete: vi.fn<() => Promise<void>>(async () => undefined),
    ...overrides,
  };
  globalThis.window = { roderDesktop: desktop } as unknown as Window & typeof globalThis;
  return desktop;
}

let originalWindow: typeof globalThis.window;

beforeEach(() => {
  originalWindow = globalThis.window;
});

afterEach(() => {
  globalThis.window = originalWindow;
  vi.restoreAllMocks();
});

test("load reads the onboarded flag from ~/.roder and marks the store loaded", async () => {
  const desktop = installDesktop({
    onboardingState: vi.fn<() => Promise<RecordResult>>(async () => ({
      onboarded: true,
      completedAt: "2026-10-24T18:00:00.000Z",
    })),
  });
  const { useOnboardingStore } = await loadOnboardingStore();

  expect(useOnboardingStore.getState().loaded).toBe(false);
  await useOnboardingStore.getState().load();

  expect(desktop.onboardingState).toHaveBeenCalledTimes(1);
  expect(useOnboardingStore.getState()).toMatchObject({ loaded: true, completed: true });
});

test("load treats an IPC failure as not onboarded instead of skipping the flow", async () => {
  installDesktop({
    onboardingState: vi.fn<() => Promise<RecordResult>>(async () => Promise.reject(new Error("no ipc"))),
  });
  const { useOnboardingStore } = await loadOnboardingStore();

  await useOnboardingStore.getState().load();

  expect(useOnboardingStore.getState()).toMatchObject({ loaded: true, completed: false });
});

test("complete marks the store and writes the flag through IPC", async () => {
  const desktop = installDesktop();
  const { useOnboardingStore } = await loadOnboardingStore();
  await useOnboardingStore.getState().load();

  await useOnboardingStore.getState().complete();

  expect(useOnboardingStore.getState().completed).toBe(true);
  expect(desktop.onboardingComplete).toHaveBeenCalledTimes(1);
});

test("complete does not write again once the flag is already set", async () => {
  const desktop = installDesktop({
    onboardingState: vi.fn<() => Promise<RecordResult>>(async () => ({ onboarded: true, completedAt: null })),
  });
  const { useOnboardingStore } = await loadOnboardingStore();
  await useOnboardingStore.getState().load();

  await useOnboardingStore.getState().complete();

  expect(desktop.onboardingComplete).not.toHaveBeenCalled();
});

test("a failed write keeps the session working and reports to the console", async () => {
  installDesktop({
    onboardingComplete: vi.fn<() => Promise<void>>(async () => Promise.reject(new Error("disk full"))),
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const { useOnboardingStore } = await loadOnboardingStore();

  await expect(useOnboardingStore.getState().complete()).resolves.toBeUndefined();

  expect(useOnboardingStore.getState().completed).toBe(true);
  expect(warn).toHaveBeenCalled();
});
