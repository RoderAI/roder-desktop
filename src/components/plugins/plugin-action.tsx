import * as React from "react";
import { CircleMinus, CirclePlus } from "lucide-react";
import type { ButtonProps } from "@/components/ui/button";
import { DotMatrixSpinner } from "@/components/ui/dot-matrix-spinner";
import { cn } from "@/lib/utils";

const pluginActionButtonBaseClassName = "transition-none";

export type PluginActionState = "install" | "installing" | "uninstall" | "uninstalling";

export function PluginActionContent({ state }: { state: PluginActionState }): React.JSX.Element {
  const animate = useValueChanged(state);

  return (
    <>
      <span className="plugin-action-icon-slot" aria-hidden="true">
        <span key={state} className="plugin-action-icon" data-animate={animate}>
          {pluginActionIcon(state)}
        </span>
      </span>
      <span className="plugin-action-label-slot">
        <span key={state} className="plugin-action-label min-w-0 truncate" data-animate={animate}>
          {pluginActionLabel(state)}
        </span>
      </span>
    </>
  );
}

export function pluginActionLabel(state: PluginActionState): string {
  switch (state) {
    case "installing":
      return "Installing";
    case "uninstall":
      return "Uninstall";
    case "uninstalling":
      return "Uninstalling";
    case "install":
      return "Install";
  }
}

export function pluginActionIcon(state: PluginActionState): React.ReactNode {
  switch (state) {
    case "installing":
    case "uninstalling":
      return <DotMatrixSpinner />;
    case "uninstall":
      return <CircleMinus className="size-4" />;
    case "install":
      return <CirclePlus className="size-4" />;
  }
}

export function pluginActionButtonVariant(state: PluginActionState): NonNullable<ButtonProps["variant"]> {
  switch (state) {
    case "uninstall":
    case "uninstalling":
      return "warning";
    case "install":
    case "installing":
      return "accent";
  }
}

export function pluginActionButtonClassName(state: PluginActionState, className?: string): string {
  return cn(
    pluginActionButtonBaseClassName,
    pluginActionStateIsPending(state) && "plugin-action-button-pending",
    className,
  );
}

export function pluginActionStateIsPending(state: PluginActionState): boolean {
  return state === "installing" || state === "uninstalling";
}

export function immediatePluginActionState({
  installed,
  installing,
  uninstalling,
}: {
  installed: boolean;
  installing: boolean;
  uninstalling: boolean;
}): PluginActionState {
  if (installing) {
    return "installing";
  }
  if (uninstalling) {
    return "uninstalling";
  }
  return installed ? "uninstall" : "install";
}

function useValueChanged(value: string): boolean {
  const previousValue = React.useRef(value);
  const changed = previousValue.current !== value;

  React.useEffect(() => {
    previousValue.current = value;
  }, [value]);

  return changed;
}
