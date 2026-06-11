import type { ConversationMessage } from "@/types/roder";
import { Collapsible } from "@base-ui/react/collapsible";
import { PatchDiff } from "@pierre/diffs/react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { canonicalToolName, isShellToolName } from "@/lib/tool-display";
import { splitUnifiedDiffFiles } from "@/lib/tool-preview";
import { toolStatus, toolTextClass, toolTitle } from "@/lib/tool-timeline";
import { cn } from "@/lib/utils";
import type { ToolDisclosureControlProps } from "./tool-disclosure-control";
import { ToolShellItem } from "./tool-shell-item";
import { DisclosureChevron, ShimmerText, ToolFailureDot } from "./tool-timeline-shared";

type ToolTimelineItemProps = ToolDisclosureControlProps & {
  message: ConversationMessage;
};

export function ToolTimelineItem({ message, onOpenChange, open }: ToolTimelineItemProps): React.JSX.Element {
  const status = toolStatus(message);
  const summary = message.toolSummary || message.text;
  const title = toolTitle(message, summary);
  const Title = status === "running" ? ShimmerText : "span";

  if (canonicalToolName(message.toolName) === "auto_model_routing") {
    return <RoutingDecisionToolItem message={message} onOpenChange={onOpenChange} open={open} title={title} />;
  }

  if (isShellToolName(message.toolName) && (message.toolInput || message.toolOutput)) {
    return (
      <ToolShellItem message={message} onOpenChange={onOpenChange} open={open} status={status} summary={summary} />
    );
  }

  if (message.toolPreview) {
    return <ToolEditItem message={message} onOpenChange={onOpenChange} open={open} status={status} summary={summary} />;
  }

  return (
    <div className="flex min-h-7 min-w-0 items-center gap-2 pl-5 text-base leading-7">
      <ToolFailureDot failed={status === "failed"} />
      <Title className={cn("min-w-0 truncate font-medium", toolTextClass())}>{title}</Title>
      {summary && summary !== title ? (
        <span className="min-w-0 truncate text-muted-foreground" title={summary}>
          {summary}
        </span>
      ) : null}
    </div>
  );
}

function RoutingDecisionToolItem({
  message,
  onOpenChange,
  open,
  title,
}: ToolDisclosureControlProps & {
  message: ConversationMessage;
  title: string;
}): React.JSX.Element {
  if (!message.toolOutput) {
    return (
      <div className="flex min-h-7 min-w-0 items-center gap-2 pl-5 text-base leading-7">
        <ToolFailureDot failed={false} />
        <span className={cn("min-w-0 truncate font-medium", toolTextClass())}>{title}</span>
      </div>
    );
  }

  return (
    <Collapsible.Root className="group/tool-group pl-5 text-base leading-7" onOpenChange={onOpenChange} open={open}>
      <Collapsible.Trigger
        className="flex min-h-7 w-full min-w-0 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
      >
        <ToolFailureDot failed={false} />
        <span className={cn("min-w-0 truncate font-medium", toolTextClass())}>{title}</span>
        <DisclosureChevron groupName="tool-group" />
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="tool-disclosure-panel pl-5 text-base leading-7 text-muted-foreground">
        <pre className="m-0 whitespace-pre-wrap break-words py-1 font-ui text-base leading-7">{message.toolOutput}</pre>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

export function SafePatchPreview({ patch }: { patch: string }): React.JSX.Element {
  const filePatches = splitUnifiedDiffFiles(patch);
  if (filePatches.length === 0) {
    return <PatchPreviewFallback patch={patch} />;
  }

  return (
    <PatchPreviewErrorBoundary patch={patch}>
      <div className="space-y-2">
        {filePatches.map((filePatch) => (
          <PatchDiff key={patchPreviewKey(filePatch)} patch={filePatch} options={toolPreviewDiffOptions} disableWorkerPool />
        ))}
      </div>
    </PatchPreviewErrorBoundary>
  );
}

function patchPreviewKey(filePatch: string): string {
  let hash = 0;
  for (let index = 0; index < filePatch.length; index += 1) {
    hash = (hash * 31 + filePatch.charCodeAt(index)) | 0;
  }
  return `${filePatch.split("\n", 1)[0]}:${hash}`;
}

function PatchPreviewFallback({ patch }: { patch: string }): React.JSX.Element {
  return <pre className="m-0 whitespace-pre-wrap break-words text-foreground">{patch}</pre>;
}

type PatchPreviewErrorBoundaryProps = {
  children: ReactNode;
  patch: string;
};

type PatchPreviewErrorBoundaryState = {
  failed: boolean;
};

class PatchPreviewErrorBoundary extends Component<PatchPreviewErrorBoundaryProps, PatchPreviewErrorBoundaryState> {
  state: PatchPreviewErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): PatchPreviewErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.warn("Patch preview failed to render", error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <PatchPreviewFallback patch={this.props.patch} />;
    }
    return this.props.children;
  }
}

const toolPreviewDiffOptions = {
  diffStyle: "unified",
  disableLineNumbers: true,
  hunkSeparators: "line-info-basic",
  overflow: "scroll",
  stickyHeader: false,
  theme: {
    dark: "pierre-dark-soft",
    light: "pierre-light",
  },
  themeType: "system",
  unsafeCSS: `
    :host {
      --diffs-header-font-family: var(--font-ui);
      --diffs-font-family: var(--font-code);
      --diffs-font-size: var(--font-size-code);
      --diffs-line-height: calc(var(--font-size-code) + 7px);
    }

    [data-diffs-header=default] {
      font-size: var(--font-size-ui);
      line-height: 1.5;
      padding-inline: 8px;
    }
  `,
} as const;

type ToolEditItemProps = ToolDisclosureControlProps & {
  message: ConversationMessage;
  status: "running" | "complete" | "failed";
  summary: string;
};

function ToolEditItem({ message, onOpenChange, open, status, summary }: ToolEditItemProps): React.JSX.Element {
  const title = toolTitle(message, summary);
  const Title = status === "running" ? ShimmerText : "span";

  return (
    <Collapsible.Root className="group/edit-tool pl-5 text-base leading-7" onOpenChange={onOpenChange} open={open}>
      <Collapsible.Trigger
        className="flex min-h-7 w-full min-w-0 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
      >
        <ToolFailureDot failed={status === "failed"} />
        <Title className={cn("min-w-0 truncate font-medium", toolTextClass())}>{title}</Title>
        <DisclosureChevron groupName="edit-tool" />
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="tool-disclosure-panel pl-5 text-base leading-7 text-muted-foreground">
        <div className="tool-edit-preview py-1 font-mono text-base leading-7">
          {message.toolPreviewKind === "patch" ? (
            <SafePatchPreview patch={message.toolPreview ?? ""} />
          ) : (
            <pre className="m-0 whitespace-pre-wrap break-words text-foreground">{message.toolPreview}</pre>
          )}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
