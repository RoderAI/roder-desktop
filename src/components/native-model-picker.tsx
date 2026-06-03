import { Check, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  CompletionMenuCount,
  CompletionMenuList,
  CompletionMenuOption,
  CompletionMenuShell,
} from "@/components/composer-completion-popup";
import { Button } from "@/components/ui/button";
import type { RoderModel } from "@/types/roder";

type NativeModelPickerProps = {
  models: RoderModel[];
  open: boolean;
  selectedModel: string;
  onDismiss: () => void;
  onSelect: (modelId: string) => void;
};

export function NativeModelPicker({
  models,
  open,
  selectedModel,
  onDismiss,
  onSelect,
}: NativeModelPickerProps): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();
  const modelOptions = models.length > 0 ? models : fallbackModels(selectedModel);
  const visibleModels = filteredModels(modelOptions, query);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setHighlightedIndex(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [open]);

  useEffect(() => {
    setHighlightedIndex((index) => Math.min(index, Math.max(visibleModels.length - 1, 0)));
  }, [visibleModels.length]);

  if (!open) {
    return null;
  }

  return (
    <section
      className="pointer-events-auto absolute inset-x-0 bottom-full mb-2 mx-auto w-full max-w-3xl px-8"
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
                  event.key === "ArrowDown"
                    ? (index + 1) % visibleModels.length
                    : (index - 1 + visibleModels.length) % visibleModels.length,
                );
                return;
              }
              if (event.key === "Enter") {
                const model = visibleModels[highlightedIndex];
                if (model) {
                  event.preventDefault();
                  onSelect(model.id);
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
            visibleModels.map((model, index) => {
              const active = index === highlightedIndex;
              const selectedModelRow = model.id === selectedModel;
              return (
                <CompletionMenuOption
                  key={`${model.modelProvider}:${model.id}`}
                  id={nativeModelOptionId(listboxId, index)}
                  index={index}
                  active={active}
                  className={selectedModelRow ? "text-foreground" : undefined}
                  onHighlight={setHighlightedIndex}
                  onClick={() => onSelect(model.id)}
                >
                  <span className="min-w-0 flex-1 truncate text-base text-foreground">
                    <span className="font-medium">{modelName(model)}</span>
                    <span className="text-muted-foreground"> - {model.id}</span>
                  </span>
                  <span className="rounded-md border border-border/70 px-1.5 py-0.5 text-base text-muted-foreground">
                    {model.modelProvider}
                  </span>
                  {selectedModelRow && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-base text-muted-foreground">
                      <Check className="size-3.5" />
                      Current
                    </span>
                  )}
                </CompletionMenuOption>
              );
            })
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

function fallbackModels(selectedModel: string): RoderModel[] {
  return selectedModel ? [{ id: selectedModel, name: selectedModel, modelProvider: "desktop" }] : [];
}

function nativeModelOptionId(listboxId: string, index: number): string {
  return `${listboxId}-model-option-${index}`;
}
