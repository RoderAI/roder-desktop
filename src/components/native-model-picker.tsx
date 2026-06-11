import { Check, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  CompletionMenuCount,
  CompletionMenuList,
  CompletionMenuOption,
  CompletionMenuShell,
} from "@/components/composer-completion-popup";
import { Button } from "@/components/ui/button";
import { completionOptionId, moveCompletionIndex } from "@/lib/composer-completions";
import { groupModelsByProvider, modelKey, providerName } from "@/lib/roder-models";
import type { RoderModel } from "@/types/roder";

type NativeModelPickerProps = {
  models: RoderModel[];
  selectedModel: string;
  selectedModelProvider: string;
  onDismiss: () => void;
  onSelect: (modelId: string, modelProvider: string) => void;
};

export function NativeModelPicker({
  models,
  selectedModel,
  selectedModelProvider,
  onDismiss,
  onSelect,
}: NativeModelPickerProps): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();
  const modelOptions = models.length > 0 ? models : fallbackModels(selectedModel, selectedModelProvider);
  const visibleModels = filteredModels(modelOptions, query);
  const modelGroups = groupModelsByProvider(visibleModels.map((model, index) => ({ model, index, modelProvider: model.modelProvider })));
  const activeIndex = boundedModelIndex(highlightedIndex, visibleModels.length);

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  return (
    <section
      className="pointer-events-auto absolute inset-x-0 bottom-full mb-2 mx-auto w-full max-w-3xl px-5"
      aria-label="Choose model"
    >
      <CompletionMenuShell>
        <div className="flex h-11 items-center gap-2 border-b border-border/70 px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            aria-label="Search models"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onDismiss();
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (visibleModels.length === 0) {
                  return;
                }
                setHighlightedIndex((index) =>
                  moveCompletionIndex(index, visibleModels.length, event.key === "ArrowDown" ? "next" : "previous"),
                );
                return;
              }
              if (event.key === "Enter") {
                const model = visibleModels[activeIndex];
                if (model) {
                  event.preventDefault();
                  onSelect(model.id, model.modelProvider);
                }
              }
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Search models"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-7 rounded-full text-muted-foreground"
            aria-label="Close model picker"
            onClick={onDismiss}
          >
            <X className="size-4" />
          </Button>
        </div>

        <CompletionMenuList id={listboxId} ariaLabel="Model completions">
          {visibleModels.length > 0 ? (
            modelGroups.map((group) => (
              <div key={group.provider}>
                <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {providerName(group.provider)}
                </div>
                {group.models.map(({ model, index }) => {
                  const active = index === activeIndex;
                  const selectedModelRow = model.id === selectedModel && model.modelProvider === selectedModelProvider;
                  return (
                    <CompletionMenuOption
                      key={modelKey(model)}
                      id={completionOptionId(listboxId, index)}
                      index={index}
                      active={active}
                      className={selectedModelRow ? "text-foreground" : undefined}
                      onHighlight={setHighlightedIndex}
                      onClick={() => onSelect(model.id, model.modelProvider)}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        <span className="font-medium">{modelName(model)}</span>
                        <span className="text-muted-foreground"> - {model.modelProvider}</span>
                      </span>
                      {selectedModelRow && <Check className="size-4 shrink-0 text-foreground" />}
                    </CompletionMenuOption>
                  );
                })}
              </div>
            ))
          ) : (
            <div className="px-3 py-4 text-base text-muted-foreground">No matching models</div>
          )}
        </CompletionMenuList>
        {visibleModels.length > 8 && <CompletionMenuCount>{visibleModels.length} matches</CompletionMenuCount>}
      </CompletionMenuShell>
    </section>
  );
}

function filteredModels(models: RoderModel[], query: string): RoderModel[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return models;
  }
  return models.filter((model) =>
    `${model.name} ${model.id} ${model.modelProvider}`.toLowerCase().includes(normalizedQuery),
  );
}

function modelName(model: RoderModel): string {
  return model.name || model.id;
}

function fallbackModels(selectedModel: string, selectedModelProvider: string): RoderModel[] {
  return selectedModel
    ? [{ id: selectedModel, name: selectedModel, modelProvider: selectedModelProvider || "desktop" }]
    : [];
}

function boundedModelIndex(index: number, itemCount: number): number {
  return Math.max(0, Math.min(index, itemCount - 1));
}
