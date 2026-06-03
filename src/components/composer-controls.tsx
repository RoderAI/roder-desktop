import { Check, FileText, FileUp, ImageIcon, PencilLine, Search, ShieldCheck, X } from "lucide-react";
import { Combobox } from "@base-ui/react/combobox";
import { useState } from "react";
import type { DesktopAttachment, PolicyMode, ReasoningEffort, RoderModel } from "@/types/roder";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownTriggerChevron,
  dropdownMenuContentClassName,
  dropdownMenuItemClassName,
  dropdownMenuTriggerVariants,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PolicyModePicker({
  selectedMode,
  onChange,
}: {
  selectedMode: PolicyMode;
  onChange: (mode: PolicyMode) => void;
}): React.JSX.Element {
  const selected = policyModeOptions.find((option) => option.mode === selectedMode) ?? policyModeOptions[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        variant="pill"
        className="max-w-40 px-2.5 text-base text-muted-foreground sm:max-w-none sm:px-3"
        aria-label={`Choose permission mode: ${selected.label}`}
      >
        <ShieldCheck className="size-4 shrink-0" />
        <span className="truncate">{selected.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-64">
        <DropdownMenuGroup>
          {policyModeOptions.map((option) => (
            <DropdownMenuItem
              key={option.mode}
              selected={option.mode === selected.mode}
              className="items-start gap-2 py-2"
              onSelect={() => onChange(option.mode)}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-foreground">{option.label}</div>
                <div className="mt-0.5 text-sm leading-5 text-muted-foreground">{option.description}</div>
              </div>
              {option.mode === selected.mode && <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const policyModeOptions: Array<{
  mode: PolicyMode;
  label: string;
  description: string;
}> = [
  {
    mode: "accept_all",
    label: "Accept all",
    description: "Run edits and commands without stopping for approval.",
  },
  {
    mode: "default",
    label: "Ask before changes",
    description: "Pause before writes, commands, and other side effects.",
  },
  {
    mode: "plan",
    label: "Plan only",
    description: "Read and reason while blocking edits and commands.",
  },
  {
    mode: "bypass",
    label: "Full access",
    description: "Auto-approve every tool the harness allows.",
  },
];

export function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: DesktopAttachment;
  onRemove: () => void;
}): React.JSX.Element {
  const isImage = attachment.type.startsWith("image/");
  const canPreviewImage = isImage && Boolean(attachment.imageUrl);
  return (
    <span className="flex max-w-56 items-center gap-2 rounded-xl bg-muted px-2.5 py-1.5 text-base text-muted-foreground">
      {canPreviewImage ? (
        <img
          src={attachment.imageUrl}
          alt={attachment.name}
          className="size-9 shrink-0 rounded-md border border-border bg-background object-cover"
        />
      ) : isImage ? (
        <ImageIcon className="size-4 shrink-0" />
      ) : (
        <FileText className="size-4 shrink-0" />
      )}
      <span className="truncate">{attachment.name}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={`Remove ${attachment.name}`}
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </Button>
    </span>
  );
}

export function ComposerAttachMenuItems({
  onOpenSketch,
  onUploadFile,
}: {
  onOpenSketch: () => void;
  onUploadFile: () => void;
}): React.JSX.Element {
  return (
    <>
      <DropdownMenuItem className="h-9" onSelect={onUploadFile}>
        <FileUp className="size-4 shrink-0" />
        <span>Upload file</span>
      </DropdownMenuItem>
      <DropdownMenuItem className="h-9" onSelect={onOpenSketch}>
        <PencilLine className="size-4 shrink-0" />
        <span>Sketch</span>
      </DropdownMenuItem>
    </>
  );
}

export function ModelPicker({
  models,
  selectedModel,
  selectedModelProvider,
  selectedReasoning,
  onChange,
  onReasoningChange,
}: {
  models: RoderModel[];
  selectedModel: string;
  selectedModelProvider: string;
  selectedReasoning: ReasoningEffort;
  onChange: (model: string, provider?: string) => void;
  onReasoningChange: (reasoning: ReasoningEffort) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const visibleModels: RoderModel[] =
    models.length > 0 ? models : [{ id: selectedModel, name: "Codex 5.3", modelProvider: "codex" }];
  const selected =
    visibleModels.find((model) => model.id === selectedModel && model.modelProvider === selectedModelProvider) ??
    visibleModels.find((model) => model.id === selectedModel) ??
    visibleModels[0];

  return (
    <div className="flex shrink-0 items-center gap-2 text-foreground">
      <Combobox.Root<RoderModel>
        open={open}
        onOpenChange={setOpen}
        value={selected}
        items={visibleModels}
        limit={10}
        itemToStringLabel={modelName}
        itemToStringValue={(model) => `${model.modelProvider}:${model.id}`}
        isItemEqualToValue={(item, value) => item.id === value.id && item.modelProvider === value.modelProvider}
        filter={(model, inputValue) => {
          const haystack = `${model.name} ${model.id} ${model.modelProvider}`.toLowerCase();
          return haystack.includes(inputValue.trim().toLowerCase());
        }}
        onValueChange={(model) => {
          if (model) {
            onChange(model.id, model.modelProvider);
          }
        }}
      >
        <Combobox.Trigger className={cn(dropdownMenuTriggerVariants({ variant: "pill" }))} aria-label="Choose model">
          <Combobox.Value>{(model: RoderModel | null) => <span>{modelName(model ?? selected)}</span>}</Combobox.Value>
          <DropdownTriggerChevron />
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner align="end" side="top" sideOffset={8} className="z-50">
            <Combobox.Popup className={cn(dropdownMenuContentClassName, "w-[320px] p-0")} aria-label="Choose model">
              <div className="flex h-11 items-center gap-2.5 border-b border-border px-3.5">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <Combobox.Input
                  className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="Search models"
                />
              </div>
              <Combobox.Empty>
                <div className="px-3.5 py-4 text-base text-muted-foreground">No matching models</div>
              </Combobox.Empty>
              <Combobox.List className="max-h-[286px] overflow-y-auto p-1.5">
                {(model: RoderModel) => (
                  <Combobox.Item
                    key={`${model.modelProvider}:${model.id}`}
                    value={model}
                    className={cn(dropdownMenuItemClassName, "h-9 data-[selected]:font-medium")}
                  >
                    <ProviderLogo provider={model.modelProvider} />
                    <span className="min-w-0 flex-1 truncate text-foreground">{modelName(model)}</span>
                    <Combobox.ItemIndicator
                      keepMounted
                      className="ml-0.5 grid size-3.5 place-items-center text-primary opacity-0 data-[selected]:opacity-100"
                    >
                      <Check className="size-3.5" />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      <DropdownMenu>
        <DropdownMenuTrigger variant="pill" aria-label={`Choose thinking effort: ${reasoningLabel(selectedReasoning)}`}>
          <span>{reasoningLabel(selectedReasoning)}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" sideOffset={8}>
          <DropdownMenuGroup>
            {reasoningOptions.map((reasoning) => (
              <DropdownMenuItem
                key={reasoning}
                selected={reasoning === selectedReasoning}
                className="h-9 text-base"
                onSelect={() => onReasoningChange(reasoning)}
              >
                <span className="min-w-0 flex-1">{reasoningName(reasoning)}</span>
                {reasoning === selectedReasoning && <Check className="size-3.5 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const reasoningOptions: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];

type ProviderLogoDefinition = {
  title: string;
  viewBox?: string;
  paths: Array<{
    d: string;
    clipRule?: "evenodd";
    fill?: string;
  }>;
};

const providerLogos: Record<string, ProviderLogoDefinition> = {
  anthropic: {
    title: "Anthropic",
    paths: [
      {
        d: "M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-7.258 0h3.767L16.906 20h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm4.132 9.959L8.453 7.687 6.205 13.48H10.7z",
      },
    ],
  },
  cohere: {
    title: "Cohere",
    paths: [
      {
        d: "M8.128 14.099c.592 0 1.77-.033 3.398-.703 1.897-.781 5.672-2.2 8.395-3.656 1.905-1.018 2.74-2.366 2.74-4.18A4.56 4.56 0 0018.1 1H7.549A6.55 6.55 0 001 7.55c0 3.617 2.745 6.549 7.128 6.549z",
        clipRule: "evenodd",
      },
      {
        d: "M9.912 18.61a4.387 4.387 0 012.705-4.052l3.323-1.38c3.361-1.394 7.06 1.076 7.06 4.715a5.104 5.104 0 01-5.105 5.104l-3.597-.001a4.386 4.386 0 01-4.386-4.387z",
        clipRule: "evenodd",
      },
      {
        d: "M4.776 14.962A3.775 3.775 0 001 18.738v.489a3.776 3.776 0 007.551 0v-.49a3.775 3.775 0 00-3.775-3.775z",
      },
    ],
  },
  gemini: {
    title: "Gemini",
    paths: [
      {
        d: "M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z",
      },
    ],
  },
  groq: {
    title: "Groq",
    paths: [
      {
        d: "M12.036 2c-3.853-.035-7 3-7.036 6.781-.035 3.782 3.055 6.872 6.908 6.907h2.42v-2.566h-2.292c-2.407.028-4.38-1.866-4.408-4.23-.029-2.362 1.901-4.298 4.308-4.326h.1c2.407 0 4.358 1.915 4.365 4.278v6.305c0 2.342-1.944 4.25-4.323 4.279a4.375 4.375 0 01-3.033-1.252l-1.851 1.818A7 7 0 0012.029 22h.092c3.803-.056 6.858-3.083 6.879-6.816v-6.5C18.907 4.963 15.817 2 12.036 2z",
      },
    ],
  },
  meta: {
    title: "Meta",
    paths: [
      {
        d: "M6.897 4c1.915 0 3.516.932 5.43 3.376l.282-.373c.19-.246.383-.484.58-.71l.313-.35C14.588 4.788 15.792 4 17.225 4c1.273 0 2.469.557 3.491 1.516l.218.213c1.73 1.765 2.917 4.71 3.053 8.026l.011.392.002.25c0 1.501-.28 2.759-.818 3.7l-.14.23-.108.153c-.301.42-.664.758-1.086 1.009l-.265.142-.087.04a3.493 3.493 0 01-.302.118 4.117 4.117 0 01-1.33.208c-.524 0-.996-.067-1.438-.215-.614-.204-1.163-.56-1.726-1.116l-.227-.235c-.753-.812-1.534-1.976-2.493-3.586l-1.43-2.41-.544-.895-1.766 3.13-.343.592C7.597 19.156 6.227 20 4.356 20c-1.21 0-2.205-.42-2.936-1.182l-.168-.184c-.484-.573-.837-1.311-1.043-2.189l-.067-.32a8.69 8.69 0 01-.136-1.288L0 14.468c.002-.745.06-1.49.174-2.23l.1-.573c.298-1.53.828-2.958 1.536-4.157l.209-.34c1.177-1.83 2.789-3.053 4.615-3.16L6.897 4zm-.033 2.615l-.201.01c-.83.083-1.606.673-2.252 1.577l-.138.199-.01.018c-.67 1.017-1.185 2.378-1.456 3.845l-.004.022a12.591 12.591 0 00-.207 2.254l.002.188c.004.18.017.36.04.54l.043.291c.092.503.257.908.486 1.208l.117.137c.303.323.698.492 1.17.492 1.1 0 1.796-.676 3.696-3.641l2.175-3.4.454-.701-.139-.198C9.11 7.3 8.084 6.616 6.864 6.616zm10.196-.552l-.176.007c-.635.048-1.223.359-1.82.933l-.196.198c-.439.462-.887 1.064-1.367 1.807l.266.398c.18.274.362.56.55.858l.293.475 1.396 2.335.695 1.114c.583.926 1.03 1.6 1.408 2.082l.213.262c.282.326.529.54.777.673l.102.05c.227.1.457.138.718.138.176.002.35-.023.518-.073.338-.104.61-.32.813-.637l.095-.163.077-.162c.194-.459.29-1.06.29-1.785l-.006-.449c-.08-2.871-.938-5.372-2.2-6.798l-.176-.189c-.67-.683-1.444-1.074-2.27-1.074z",
      },
    ],
  },
  mistral: {
    title: "Mistral",
    paths: [
      {
        d: "M3.428 3.4h3.429v3.428h3.429v3.429h-.002 3.431V6.828h3.427V3.4h3.43v13.714H24v3.429H13.714v-3.428h-3.428v-3.429h-3.43v3.428h3.43v3.429H0v-3.429h3.428V3.4zm10.286 13.715h3.428v-3.429h-3.427v3.429z",
        clipRule: "evenodd",
      },
    ],
  },
  openai: {
    title: "OpenAI",
    paths: [
      {
        d: "M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z",
      },
    ],
  },
  opencode: {
    title: "OpenCode",
    viewBox: "0 0 240 300",
    paths: [
      { d: "M180 240H60V120H180V240Z", fill: "#CFCECD" },
      { d: "M180 60H60V240H180V60ZM240 300H0V0H240V300Z", fill: "#211E1E" },
    ],
  },
  perplexity: {
    title: "Perplexity",
    paths: [
      {
        d: "M19.785 0v7.272H22.5V17.62h-2.935V24l-7.037-6.194v6.145h-1.091v-6.152L4.392 24v-6.465H1.5V7.188h2.884V0l7.053 6.494V.19h1.09v6.49L19.786 0zm-7.257 9.044v7.319l5.946 5.234V14.44l-5.946-5.397zm-1.099-.08l-5.946 5.398v7.235l5.946-5.234V8.965zm8.136 7.58h1.844V8.349H13.46l6.105 5.54v2.655zm-8.982-8.28H2.59v8.195h1.8v-2.576l6.192-5.62zM5.475 2.476v4.71h5.115l-5.115-4.71zm13.219 0l-5.115 4.71h5.115v-4.71z",
      },
    ],
  },
  xai: {
    title: "xAI",
    paths: [
      {
        d: "M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z",
      },
    ],
  },
};

const providerLogoAliases: Record<string, string> = {
  claude: "anthropic",
  codex: "openai",
  google: "gemini",
  googlegemini: "gemini",
  grok: "xai",
  mistralai: "mistral",
  opencodego: "opencode",
};

const providerLogoAliasMatchers = Object.entries(providerLogoAliases).map(([token, logoKey]) => ({ token, logoKey }));
const providerLogoMatchers = Object.entries(providerLogos).map(([token, logo]) => ({ token, logo }));

function ProviderLogo({ provider }: { provider: string }): React.JSX.Element {
  const logo = providerLogoFor(provider);

  return (
    <span
      className="grid size-5 shrink-0 place-items-center text-foreground"
      title={logo?.title ?? providerName(provider)}
      aria-hidden="true"
    >
      {logo ? (
        <svg viewBox={logo.viewBox ?? "0 0 24 24"} className="size-4" fill="currentColor" fillRule="evenodd">
          {logo.paths.map((path) => (
            <path key={path.d} d={path.d} clipRule={path.clipRule} fill={path.fill} />
          ))}
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3.5 14.2 9l5.8 1-4.4 3.9 1.3 5.7L12 16.6l-4.9 3 1.3-5.7L4 10l5.8-1L12 3.5Z" />
        </svg>
      )}
    </span>
  );
}

function providerLogoFor(provider: string): ProviderLogoDefinition | undefined {
  const normalizedProvider = provider.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const { token, logoKey } of providerLogoAliasMatchers) {
    if (containsProviderToken(normalizedProvider, token)) {
      return providerLogos[logoKey];
    }
  }
  for (const { token, logo } of providerLogoMatchers) {
    if (containsProviderToken(normalizedProvider, token)) {
      return logo;
    }
  }
  return undefined;
}

function containsProviderToken(normalizedProvider: string, token: string): boolean {
  return normalizedProvider.indexOf(token) !== -1;
}

function modelName(model: RoderModel | undefined): string {
  return model?.name || model?.id || "Model";
}

function providerName(provider: string): string {
  if (!provider) {
    return "Roder";
  }
  if (provider.toLowerCase() === "openai") {
    return "OpenAI";
  }
  return provider.slice(0, 1).toUpperCase() + provider.slice(1);
}

function reasoningLabel(reasoning: ReasoningEffort): string {
  if (reasoning === "medium") {
    return "Med";
  }
  if (reasoning === "xhigh") {
    return "xHigh";
  }
  return reasoning.slice(0, 1).toUpperCase() + reasoning.slice(1);
}

function reasoningName(reasoning: ReasoningEffort): string {
  if (reasoning === "xhigh") {
    return "Extra high";
  }
  return reasoning.slice(0, 1).toUpperCase() + reasoning.slice(1);
}
