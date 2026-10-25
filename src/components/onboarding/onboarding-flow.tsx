import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import roderAppIcon from "@/assets/roder-app-icon.png";
import { OnboardingModelsStep } from "@/components/onboarding/onboarding-models";
import { OnboardingProjectStep } from "@/components/onboarding/onboarding-project";
import { OnboardingProvidersStep } from "@/components/onboarding/onboarding-providers";
import { OnboardingReadyStep } from "@/components/onboarding/onboarding-ready";
import { OnboardingWelcomeStep } from "@/components/onboarding/onboarding-welcome";
import { primaryActionClassName } from "@/components/onboarding/onboarding-primitives";
import { Button } from "@/components/ui/button";
import {
  canContinueFromProviders,
  describeAutoDetected,
  isProviderReady,
  nextOnboardingStep,
  onboardingMinWindowWidth,
  onboardingStepIndex,
  onboardingSteps,
  pickDefaultModel,
  previousOnboardingStep,
  type OnboardingStep,
} from "@/lib/onboarding";
import { displayModelName, modelKey, visibleModelIdsFor } from "@/lib/roder-models";
import { cn } from "@/lib/utils";
import { useProviderSetupState } from "@/hooks/use-provider-setup-state";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { useRoderStore } from "@/stores/roder-store";
import type { RoderModel, Workspace } from "@/types/roder";

type ModelChoice = { id: string; provider: string };

export function OnboardingFlow(): React.JSX.Element {
  const navigate = useNavigate();
  const completeOnboarding = useOnboardingStore((state) => state.complete);
  const providers = useRoderStore((state) => state.providers);
  const models = useRoderStore((state) => state.models);
  const hiddenModelIds = useRoderStore((state) => state.hiddenModelIds);
  const setModelVisibility = useRoderStore((state) => state.setModelVisibility);
  const defaultModel = useRoderStore((state) => state.defaultModel);
  const defaultModelProvider = useRoderStore((state) => state.defaultModelProvider);
  const selectDefaultModel = useRoderStore((state) => state.selectDefaultModel);
  const openWorkspaceFolder = useRoderStore((state) => state.openWorkspaceFolder);

  const [step, setStep] = useState<OnboardingStep>("welcome");
  const contentRef = useRef<HTMLDivElement>(null);
  const { claudeCli, environment, recheckClaudeCli } = useProviderSetupState();
  const [defaultChoice, setDefaultChoice] = useState<ModelChoice | null>(
    defaultModel ? { id: defaultModel, provider: defaultModelProvider } : null,
  );
  const [project, setProject] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The shell lowers the native minimum when it mounts. Onboarding needs the full layout width.
    if (typeof window.roderDesktop.setMinWindowWidth === "function") {
      void window.roderDesktop.setMinWindowWidth(onboardingMinWindowWidth);
    }
  }, []);

  useEffect(() => {
    // Keyboard focus follows the step: without this, a focused button that disappears drops focus to the page.
    contentRef.current?.focus({ preventScroll: true });
  }, [step]);

  const readyProviderIds = new Set(
    providers.filter((provider) => isProviderReady(provider, claudeCli)).map((provider) => provider.id),
  );
  const readyModels: RoderModel[] = models.filter((model) => readyProviderIds.has(model.modelProvider));
  const chosenModel = pickDefaultModel(readyModels, readyProviderIds, defaultChoice);
  const visibleKeys = new Set(visibleModelIdsFor(models, hiddenModelIds));
  const readyProviderCount = readyProviderIds.size;

  const stepIndex = onboardingStepIndex(step);
  const isLastStep = step === "ready";

  function goTo(next: OnboardingStep): void {
    setError(null);
    setStep(next);
  }

  function finish(): void {
    void completeOnboarding();
    void navigate({ to: "/new" });
  }

  async function continueFromModels(): Promise<void> {
    if (!chosenModel) {
      return;
    }
    // A default that is hidden from the picker would leave new agents on a model the user cannot see.
    if (!visibleKeys.has(modelKey(chosenModel))) {
      setModelVisibility(modelKey(chosenModel), true);
    }
    const isCurrent = chosenModel.id === defaultModel && chosenModel.modelProvider === defaultModelProvider;
    if (!isCurrent) {
      setBusy(true);
      try {
        await selectDefaultModel(chosenModel.id, chosenModel.modelProvider);
      } catch (saveError) {
        setError((saveError as Error).message);
        return;
      } finally {
        setBusy(false);
      }
    }
    goTo(nextOnboardingStep(step));
  }

  async function chooseProject(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const workspace = await openWorkspaceFolder();
      if (workspace) {
        setProject(workspace);
      }
    } catch (openError) {
      setError((openError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function continueFromStep(): void {
    if (step === "models") {
      void continueFromModels();
      return;
    }
    if (step === "ready") {
      finish();
      return;
    }
    goTo(nextOnboardingStep(step));
  }

  const canContinue =
    step === "welcome"
      ? true
      : step === "providers"
        ? canContinueFromProviders(readyProviderCount)
        : step === "models"
          ? chosenModel !== null && !busy
          : step === "project"
            ? project !== null && !busy
            : true;

  const continueLabel = step === "welcome" ? "Get started" : step === "ready" ? "Start your first agent" : "Continue";

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-background text-foreground">
      <header className="drag-region flex h-(--desktop-header-height) shrink-0 items-center justify-between gap-6 pl-20 pr-40">
        <div className="flex items-center gap-2">
          <img src={roderAppIcon} alt="" className="size-5 rounded-md" draggable={false} />
          <span className="text-base font-medium">Roder</span>
        </div>
        {/* Pinned here, not in the scrolling content, so the user always sees where they are. */}
        <div className="min-w-0 max-w-md flex-1">
          <OnboardingProgress currentIndex={stepIndex} />
        </div>
        {!isLastStep && (
          <Button variant="ghost" size="sm" className="no-drag" onClick={finish}>
            Skip setup
          </Button>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8 px-8 pb-10 pt-8">
          <div key={step} ref={contentRef} tabIndex={-1} className="onboarding-step flex flex-col gap-8 outline-none">
            {step === "welcome" && <OnboardingWelcomeStep />}
            {step === "providers" && (
              <OnboardingProvidersStep
                providers={providers}
                claudeCli={claudeCli}
                environment={environment}
                autoDetected={describeAutoDetected({ environment, claudeCli, providers })}
                readyProviderIds={readyProviderIds}
                onRecheckClaudeCli={recheckClaudeCli}
                onError={setError}
              />
            )}
            {step === "models" && (
              <OnboardingModelsStep
                providers={providers}
                readyModels={readyModels}
                chosenModel={chosenModel}
                visibleKeys={visibleKeys}
                onChoose={(model) => setDefaultChoice({ id: model.id, provider: model.modelProvider })}
                onToggleVisible={(model, visible) => setModelVisibility(modelKey(model), visible)}
              />
            )}
            {step === "project" && (
              <OnboardingProjectStep project={project} busy={busy} onChooseFolder={() => void chooseProject()} />
            )}
            {step === "ready" && (
              <OnboardingReadyStep
                providers={providers}
                readyProviderIds={readyProviderIds}
                modelLabel={chosenModel ? displayModelName(chosenModel) : null}
                modelProviderId={chosenModel?.modelProvider ?? null}
                project={project}
              />
            )}
          </div>
        </div>
      </main>

      <footer className="shrink-0 border-t border-border/70 bg-background">
        <div className="mx-auto flex w-full max-w-[880px] items-center justify-between gap-4 px-8 py-4">
          <div className="min-h-5 min-w-0 flex-1 text-base text-destructive" role="alert">
            {error}
          </div>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <Button variant="ghost" onClick={() => goTo(previousOnboardingStep(step))} disabled={busy}>
                <ArrowLeft className="size-4" />
                Back
              </Button>
            )}
            {step === "project" && (
              <Button variant="ghost" onClick={() => goTo(nextOnboardingStep(step))} disabled={busy}>
                Skip for now
              </Button>
            )}
            <Button
              className={cn(primaryActionClassName, !canContinue && "opacity-50")}
              disabled={!canContinue || busy}
              onClick={continueFromStep}
            >
              {busy ? "Saving..." : continueLabel}
              {!isLastStep && <ArrowRight className="size-4" />}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function OnboardingProgress({ currentIndex }: { currentIndex: number }): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-3"
      role="progressbar"
      aria-label="Setup progress"
      aria-valuemin={1}
      aria-valuemax={onboardingSteps.length}
      aria-valuenow={currentIndex + 1}
    >
      <div className="flex flex-1 gap-1.5">
        {onboardingSteps.map((step, index) => (
          <span
            key={step}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              index <= currentIndex ? "bg-primary" : "bg-muted",
            )}
          />
        ))}
      </div>
      <span className="shrink-0 text-sm text-muted-foreground">
        {currentIndex + 1} / {onboardingSteps.length}
      </span>
    </div>
  );
}
