import { useEffect, useState } from "react";
import { hasExistingSetup, onboardingGate, type OnboardingGate } from "@/lib/onboarding";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { useRoderStore } from "@/stores/roder-store";

/**
 * Decides whether first-run onboarding replaces the app shell. The onboarded flag is read from ~/.roder
 * first. A returning user who already has threads is marked complete without seeing the flow.
 */
export function useOnboardingGate(): OnboardingGate {
  const loaded = useOnboardingStore((state) => state.loaded);
  const completed = useOnboardingStore((state) => state.completed);
  const completeOnboarding = useOnboardingStore((state) => state.complete);
  const loadOnboarding = useOnboardingStore((state) => state.load);
  const hydrated = useRoderStore((state) => state.hydrated);
  const engineState = useRoderStore((state) => state.status.state);
  const threadCount = useRoderStore((state) => state.threads.length);

  useEffect(() => {
    void loadOnboarding();
  }, [loadOnboarding]);

  // Once the flow is on screen it stays until it completes, even if the engine restarts while the user
  // saves a key. Otherwise a restart could drop the user back into the app mid-setup.
  const [flowStarted, setFlowStarted] = useState(false);
  const existingSetup = hasExistingSetup({ threadCount });
  const gate = onboardingGate({
    loaded,
    completed,
    hydrated,
    engineState,
    hasExistingSetup: existingSetup,
  });

  // Latch during render, not in an effect: the flow stays up once it has been shown.
  if (gate === "onboarding" && !flowStarted) {
    setFlowStarted(true);
  }

  useEffect(() => {
    if (loaded && !completed && hydrated && existingSetup && !flowStarted) {
      void completeOnboarding();
    }
  }, [loaded, completed, hydrated, existingSetup, flowStarted, completeOnboarding]);

  if (flowStarted && !completed) {
    return "onboarding";
  }
  return gate;
}
