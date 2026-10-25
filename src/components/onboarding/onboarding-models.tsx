import type { KeyboardEvent } from "react";
import { StepIntro } from "@/components/onboarding/onboarding-primitives";
import { ProviderLogo } from "@/components/provider-logo";
import { displayModelName, groupModelsByProvider, modelKey, providerName } from "@/lib/roder-models";
import { cn } from "@/lib/utils";
import type { ProviderDescriptor, RoderModel } from "@/types/roder";

const nextKeys = ["ArrowDown", "ArrowRight"];
const previousKeys = ["ArrowUp", "ArrowLeft"];

export function OnboardingModelsStep({
  providers,
  readyModels,
  chosenModel,
  visibleKeys,
  onChoose,
  onToggleVisible,
}: {
  providers: ProviderDescriptor[];
  readyModels: RoderModel[];
  chosenModel: RoderModel | null;
  visibleKeys: ReadonlySet<string>;
  onChoose: (model: RoderModel) => void;
  onToggleVisible: (model: RoderModel, visible: boolean) => void;
}): React.JSX.Element {
  const groups = groupModelsByProvider(readyModels);
  const chosenKey = chosenModel ? modelKey(chosenModel) : null;

  // One radio group spans every provider, so arrow keys move through all models in display order.
  function handleArrowKeys(event: KeyboardEvent<HTMLDivElement>): void {
    const step = nextKeys.includes(event.key) ? 1 : previousKeys.includes(event.key) ? -1 : 0;
    if (step === 0 || readyModels.length === 0) {
      return;
    }
    event.preventDefault();
    const currentIndex = readyModels.findIndex((model) => modelKey(model) === chosenKey);
    const from = currentIndex === -1 ? 0 : currentIndex;
    const next = readyModels[(from + step + readyModels.length) % readyModels.length];
    onChoose(next);
    document.getElementById(radioId(modelKey(next)))?.focus();
  }

  return (
    <section className="flex flex-col gap-6">
      <StepIntro
        title="Choose your default model"
        description="New agents start on this model. Use the switches to choose which models appear in the composer picker."
      />

      {groups.length === 0 ? (
        <div className="rounded-xl bg-card p-5 text-base text-muted-foreground ring-1 ring-border/70">
          No models are available yet. Go back and connect a provider first.
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label="Default model"
          tabIndex={-1}
          onKeyDown={handleArrowKeys}
          className="flex flex-col gap-6 outline-none"
        >
          {groups.map((group) => {
            const provider = providers.find((candidate) => candidate.id === group.provider);
            return (
              <div key={group.provider} className="flex flex-col gap-2">
                <h2 className="flex items-center gap-2 px-1 text-base font-medium text-muted-foreground">
                  <ProviderLogo provider={group.provider} />
                  {provider?.name || providerName(group.provider)}
                </h2>
                <div className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-border/70">
                  {group.models.map((model) => {
                    const key = modelKey(model);
                    const isDefault = key === chosenKey;
                    // The default is always shown in the picker: Continue makes it visible, so the switch says so.
                    const visible = isDefault || visibleKeys.has(key);
                    return (
                      <div key={key} className="flex items-center gap-4 px-4 py-3">
                        <button
                          id={radioId(key)}
                          type="button"
                          role="radio"
                          aria-checked={isDefault}
                          tabIndex={isDefault ? 0 : -1}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => onChoose(model)}
                        >
                          <span
                            className={cn(
                              "grid size-4 shrink-0 place-items-center rounded-full ring-1 transition-colors duration-200",
                              isDefault ? "bg-primary ring-primary" : "ring-muted-foreground/70",
                            )}
                            aria-hidden="true"
                          >
                            {isDefault && <span className="size-1.5 rounded-full bg-primary-foreground" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-base font-medium">{displayModelName(model)}</span>
                              {isDefault && (
                                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-sm">Default</span>
                              )}
                            </span>
                            {model.description && (
                              <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                                {model.description}
                              </span>
                            )}
                          </span>
                        </button>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={visible}
                          aria-label={`Show ${displayModelName(model)} in the picker`}
                          disabled={isDefault}
                          className={cn(
                            "relative h-6 w-10 shrink-0 rounded-full outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                            visible ? "bg-primary" : "bg-muted-foreground/80",
                          )}
                          onClick={() => onToggleVisible(model, !visible)}
                        >
                          <span
                            className={cn(
                              "absolute left-1 top-1 size-4 rounded-full bg-white transition-transform duration-200",
                              visible && "translate-x-4",
                            )}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function radioId(key: string): string {
  return `onboarding-model-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
