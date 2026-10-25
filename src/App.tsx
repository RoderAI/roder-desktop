import { useEffect } from "react";
import { AppShellProvider } from "@/components/app-shell-context";
import { AppShellLayout } from "@/components/app-shell-layout";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { useAppShellController } from "@/hooks/use-app-shell-controller";
import { useOnboardingGate } from "@/hooks/use-onboarding-gate";
import { dismissBootSplash } from "@/lib/boot-splash";

export function App(): React.JSX.Element {
  const { appShellContext, layoutProps } = useAppShellController();
  const onboardingGate = useOnboardingGate();
  const hydrated = appShellContext.agent.hydrated;

  useEffect(() => {
    if (hydrated) {
      dismissBootSplash();
    }
  }, [hydrated]);

  return (
    <>
      {onboardingGate === "onboarding" ? (
        <OnboardingFlow />
      ) : onboardingGate === "wait" ? (
        <div className="drag-region fixed inset-0 bg-background" aria-hidden="true" />
      ) : (
        <AppShellProvider value={appShellContext}>
          <AppShellLayout {...layoutProps} />
        </AppShellProvider>
      )}
    </>
  );
}
