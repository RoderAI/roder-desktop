import { create } from "zustand";

type OnboardingStore = {
  /** True once the flag has been read from ~/.roder. Until then nothing can be decided. */
  loaded: boolean;
  completed: boolean;
  load: () => Promise<void>;
  complete: () => Promise<void>;
};

/**
 * The onboarded flag lives in ~/.roder/desktop-onboarding.json, not in browser storage, so it is shared
 * by every window and build of the same Roder home and survives cleared site data.
 */
export const useOnboardingStore = create<OnboardingStore>()((set, get) => ({
  loaded: false,
  completed: false,
  load: async () => {
    if (get().loaded) {
      return;
    }
    let onboarded = false;
    try {
      onboarded = (await window.roderDesktop.onboardingState()).onboarded;
    } catch {
      // An unreadable flag shows the flow once more, which is safer than skipping it.
      onboarded = false;
    }
    set({ loaded: true, completed: onboarded });
  },
  complete: async () => {
    if (get().completed) {
      return;
    }
    set({ completed: true });
    try {
      await window.roderDesktop.onboardingComplete();
    } catch (error) {
      // The app keeps working this session; the flow would only show again on the next launch.
      console.warn("Could not save the onboarding flag to ~/.roder:", error);
    }
  },
}));
