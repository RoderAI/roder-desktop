import { ArrowDown, ChevronDown, Mic, Plus } from "lucide-react";
import { useState } from "react";
import type { GodeModel } from "@/types/gode";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ComposerProps = {
  busy: boolean;
  models: GodeModel[];
  selectedModel: string;
  onSelectedModelChange: (model: string) => void;
  onSend: (prompt: string) => Promise<void>;
};

export function Composer({ busy, models, selectedModel, onSelectedModelChange, onSend }: ComposerProps): React.JSX.Element {
  const [prompt, setPrompt] = useState("");

  async function submit(): Promise<void> {
    const value = prompt.trim();
    if (!value || busy) {
      return;
    }
    setPrompt("");
    await onSend(value);
  }

  return (
    <div className="mx-auto w-full max-w-[980px] px-8 pb-5">
      <div className="mb-3 flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="subtle" size="compact" className="rounded-full px-3 text-[#5d5d5d]">
              Commit
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              <DropdownMenuItem>Commit current patch</DropdownMenuItem>
              <DropdownMenuItem>Create branch</DropdownMenuItem>
              <DropdownMenuItem>Open diff</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="icon" className="size-8 rounded-full text-[#6d6d6d]">
          <ArrowDown className="size-4" />
        </Button>
      </div>
      <div className="rounded-[18px] bg-card shadow-sm ring-1 ring-border">
        <div className="flex items-end gap-2 px-3 py-2">
          <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full text-[#7b7b7b]">
            <Plus className="size-5" />
          </Button>
          <Textarea
            value={prompt}
            placeholder="Send follow-up"
            disabled={busy}
            className="max-h-36 min-h-[44px] border-0 bg-transparent px-1 py-2 text-[16px] shadow-none ring-0 focus-visible:ring-0"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="flex shrink-0 items-center gap-2 text-sm text-[#858585]">
            <ModelSelect models={models} selectedModel={selectedModel} onChange={onSelectedModelChange} />
            <Button
              variant="default"
              size="icon"
              className={cn("size-9 rounded-full", !prompt.trim() && "bg-[#202020]")}
              disabled={busy}
              onClick={() => void submit()}
            >
              <Mic className="size-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelSelect({
  models,
  selectedModel,
  onChange,
}: {
  models: GodeModel[];
  selectedModel: string;
  onChange: (model: string) => void;
}): React.JSX.Element {
  const visibleModels = models.length > 0 ? models.slice(0, 8) : [{ id: selectedModel, name: "Codex 5.3", modelProvider: "codex" }];
  return (
    <Select value={selectedModel} onValueChange={onChange}>
      <SelectTrigger className="w-[160px]">
        <SelectValue placeholder="Model" />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          {visibleModels.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.name || model.id}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
