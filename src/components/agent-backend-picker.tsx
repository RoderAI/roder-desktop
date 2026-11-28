import { useNavigate } from "@tanstack/react-router";
import { Check, Loader2, Settings2 } from "lucide-react";
import { useState } from "react";
import roderAppIcon from "@/assets/roder-app-icon.png";
import { ProviderLogo } from "@/components/provider-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownTriggerChevron,
  dropdownMenuTriggerVariants,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useRoderStore } from "@/stores/roder-store";
import type { AgentBackendId, AgentBackendStatus } from "@/types/roder";

export const BACKEND_ORDER: readonly AgentBackendId[] = ["roder", "claude-code", "codex", "antigravity"];

export function AgentBackendPicker({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  const activeBackend = useRoderStore((state) => state.activeBackend) ?? "roder";
  const agentBackends = useRoderStore((state) => state.agentBackends);
  const selectAgentBackend = useRoderStore((state) => state.selectAgentBackend);
  const navigate = useNavigate();
  const [switchingTo, setSwitchingTo] = useState<AgentBackendId | null>(null);

  const activeInfo = agentBackends[activeBackend];
  const label = activeInfo?.name ?? backendDisplayName(activeBackend);

  async function chooseBackend(backend: AgentBackendId): Promise<void> {
    if (backend === activeBackend || switchingTo) {
      return;
    }
    const status = agentBackends[backend];
    if (backend !== "roder" && status && !status.runtimeInstalled) {
      void navigate({
        to: "/settings/$section",
        params: { section: "providers" },
        search: (previous) => ({ ...previous, setupProvider: backend }),
      });
      return;
    }
    setSwitchingTo(backend);
    try {
      await selectAgentBackend(backend);
    } catch {
      void navigate({
        to: "/settings/$section",
        params: { section: "providers" },
        search: (previous) => ({ ...previous, setupProvider: backend }),
      });
    } finally {
      setSwitchingTo(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || switchingTo !== null}
        className={cn(
          dropdownMenuTriggerVariants({ variant: "pill" }),
          "shrink-0 gap-1.5 px-2 text-sm @[520px]:px-2.5 @[520px]:text-base",
          activeBackend !== "roder" && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
        )}
        aria-label={`Agent backend: ${label}`}
        title={`Agent backend: ${label}`}
      >
        {switchingTo ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <BackendIcon backend={activeBackend} />}
        <span className="max-w-24 truncate">{label}</span>
        <DropdownTriggerChevron className="size-3.5 @[520px]:size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-[300px] rounded-xl p-1.5">
        <div className="px-2 pb-1.5 pt-1 text-xs font-medium text-muted-foreground">Agent backend</div>
        <DropdownMenuGroup>
          {BACKEND_ORDER.map((id) => {
            const info = agentBackends[id];
            const selected = id === activeBackend;
            return (
              <DropdownMenuItem
                key={id}
                selected={selected}
                className="flex h-auto items-center gap-2.5 rounded-lg px-2 py-2"
                onSelect={() => void chooseBackend(id)}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/50">
                  <BackendIcon backend={id} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium text-foreground">
                    {info?.name ?? backendDisplayName(id)}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">{backendSubtitle(id, info)}</span>
                </span>
                {selected ? (
                  <Check className="size-4 shrink-0 text-primary" />
                ) : id !== "roder" && !info?.connected ? (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {info?.runtimeInstalled ? "Connect" : "Set up"}
                  </span>
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <div className="my-1 border-t border-border" />
        <DropdownMenuItem
          className="h-8 gap-2 rounded-lg px-2 text-sm text-muted-foreground"
          onSelect={() => {
            void navigate({
              to: "/settings/$section",
              params: { section: "providers" },
            });
          }}
        >
          <Settings2 className="size-3.5 shrink-0" />
          <span>Manage backends in Settings</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BackendIcon({ backend }: { backend: AgentBackendId }): React.JSX.Element {
  if (backend === "roder") {
    return <img src={roderAppIcon} alt="" className="size-4 shrink-0 rounded-sm" draggable={false} />;
  }
  return <ProviderLogo provider={backend} />;
}

export function backendDisplayName(backend: AgentBackendId): string {
  if (backend === "claude-code") return "Claude Code";
  if (backend === "codex") return "Codex";
  if (backend === "antigravity") return "Antigravity";
  return "Roder";
}

function backendSubtitle(backend: AgentBackendId, info: AgentBackendStatus | undefined): string {
  if (backend === "roder") {
    return "Native runtime · configured providers";
  }
  if (info?.connected) {
    const count = info.modelCount;
    return `${backendDisplayName(backend)} CLI · ${count} ${count === 1 ? "model" : "models"}`;
  }
  if (backend === "claude-code")
    return info?.runtimeInstalled ? "Claude CLI found · click to connect" : "Install and sign in to Claude Code";
  if (info?.runtimeInstalled) {
    return backend === "codex" ? "Codex CLI found · click to connect" : "agy CLI found · sign in with Google";
  }
  return backend === "codex" ? "Install Codex CLI to use" : "Install agy CLI & sign in";
}
