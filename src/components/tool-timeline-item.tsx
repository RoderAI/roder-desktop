import type { ConversationMessage } from "@/types/roder";
import { Collapsible } from "@base-ui/react/collapsible";
import { PatchDiff } from "@pierre/diffs/react";
import { isShellToolName } from "@/lib/tool-display";
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

const toolPreviewDiffOptions = {
  diffStyle: "unified",
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
            <PatchDiff patch={message.toolPreview ?? ""} options={toolPreviewDiffOptions} disableWorkerPool />
          ) : (
            <pre className="m-0 whitespace-pre-wrap break-words text-foreground">{message.toolPreview}</pre>
          )}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
