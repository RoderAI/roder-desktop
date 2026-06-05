import { harden } from "rehype-harden";
import { defaultRehypePlugins, Streamdown, type Components, type StreamdownProps } from "streamdown";
import { AlertCircle, Eye, FileCode2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { filePreviewReadLimitBytes } from "@/components/file-panel/constants";
import type { FileViewState } from "@/components/file-panel/types";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { highlightFileContent, type HighlightedFileContent } from "@/lib/file-syntax-highlight";
import {
  externalFileMarkdownPreviewHref,
  filePanelContentKey,
  filePanelMarkdownToggleLabel,
  filePanelSupportsMarkdownPreview,
  formatFilePanelBytes,
  nextFilePanelMarkdownViewMode,
  type FilePanelMarkdownViewMode,
} from "@/lib/file-panel";
import { cn } from "@/lib/utils";

const fileMarkdownPreviewRehypePlugins: NonNullable<StreamdownProps["rehypePlugins"]> = [
  defaultRehypePlugins.sanitize,
  [
    harden,
    {
      allowedLinkPrefixes: ["*"],
      allowedImagePrefixes: [],
      allowDataImages: false,
    },
  ],
];

const fileMarkdownPreviewComponents: Components = {
  a({ href, children, ...props }) {
    const safeHref = externalFileMarkdownPreviewHref(href);
    if (!safeHref) {
      return <span>{children}</span>;
    }
    const externalHref = safeHref;

    function openExternally(event: React.MouseEvent<HTMLAnchorElement>): void {
      event.preventDefault();
      void window.roderDesktop.openExternal(externalHref);
    }

    return (
      <a
        {...props}
        href={externalHref}
        rel="noreferrer noopener"
        target="_blank"
        onAuxClick={openExternally}
        onClick={openExternally}
      >
        {children}
      </a>
    );
  },
  img() {
    return null;
  },
};

export function FileViewer({
  state,
  onMarkdownViewModeChange,
}: {
  state: FileViewState;
  onMarkdownViewModeChange: (mode: FilePanelMarkdownViewMode) => void;
}): React.JSX.Element {
  if (state.status === "empty") {
    return <CenteredViewerText>Select a file to preview.</CenteredViewerText>;
  }

  const markdownPreviewAvailable =
    state.status === "text" && filePanelSupportsMarkdownPreview(state.selection.relativePath);
  const markdownToggleLabel = markdownPreviewAvailable ? filePanelMarkdownToggleLabel(state.markdownViewMode) : "";

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-background">
      <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 truncate text-base font-medium">{state.label}</div>
        {markdownPreviewAvailable && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "shrink-0 rounded-md",
              state.markdownViewMode === "preview" && "bg-accent/60 text-foreground",
            )}
            aria-label={markdownToggleLabel}
            aria-pressed={state.markdownViewMode === "preview"}
            title={markdownToggleLabel}
            onClick={() => onMarkdownViewModeChange(nextFilePanelMarkdownViewMode(state.markdownViewMode))}
          >
            {state.markdownViewMode === "preview" ? <FileCode2 className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
        )}
      </header>
      {state.status === "loading" && <InlineViewerText>Loading file&hellip;</InlineViewerText>}
      {state.status === "binary" && <InlineViewerText>Binary file cannot be previewed.</InlineViewerText>}
      {state.status === "too-large" && (
        <InlineViewerText>{`File is too large to preview (${formatFilePanelBytes(state.bytes)}).`}</InlineViewerText>
      )}
      {state.status === "error" && <PanelError message={state.error} inline />}
      {state.status === "text" && state.content.truncated && (
        <div className="border-b border-border bg-muted/30 px-4 py-2 text-base text-muted-foreground">
          {`Previewing first ${formatFilePanelBytes(filePreviewReadLimitBytes)} of ${formatFilePanelBytes(state.content.bytes)}.`}
        </div>
      )}
      {state.status === "text" && markdownPreviewAvailable && state.markdownViewMode === "preview" && (
        <FileMarkdownPreview
          key={`${state.selection.rootId}:${state.selection.relativePath}:${filePanelContentKey(state.content.text)}`}
          text={state.content.text}
        />
      )}
      {state.status === "text" && (!markdownPreviewAvailable || state.markdownViewMode === "source") && (
        <HighlightedCodeView
          key={`${state.selection.rootId}:${state.selection.relativePath}:${filePanelContentKey(state.content.text)}`}
          path={state.selection.relativePath}
          text={state.content.text}
        />
      )}
    </section>
  );
}

export function FileMarkdownPreview({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="file-markdown-preview workspace-scrollbar min-h-0 flex-1 overflow-auto px-6 py-5">
      <Streamdown
        className="file-markdown-preview-content text-base font-normal leading-7"
        components={fileMarkdownPreviewComponents}
        controls={{ code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false } }}
        lineNumbers={false}
        linkSafety={{ enabled: false }}
        mode="static"
        rehypePlugins={fileMarkdownPreviewRehypePlugins}
        skipHtml
      >
        {text}
      </Streamdown>
    </div>
  );
}

function HighlightedCodeView({ path, text }: { path: string; text: string }): React.JSX.Element {
  const [highlightedContent, setHighlightedContent] = useState<HighlightedFileContent | null>(null);
  const [failed, setFailed] = useState(false);

  useMountEffect(() => {
    let active = true;
    void highlightFileContent(path, text)
      .then((content) => {
        if (active) {
          setHighlightedContent(content);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  });

  if (highlightedContent && !failed) {
    return (
      <div
        className="file-code-view workspace-scrollbar min-h-0 flex-1 overflow-auto"
        dangerouslySetInnerHTML={{ __html: highlightedContent.html }}
      />
    );
  }

  return (
    <div className="workspace-scrollbar min-h-0 flex-1 overflow-auto">
      <pre className="m-0 min-w-full p-4 font-mono text-sm font-normal leading-6 text-foreground">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function CenteredViewerText({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-4 text-base text-muted-foreground">
      {children}
    </div>
  );
}

function InlineViewerText({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="p-4 text-base text-muted-foreground">{children}</div>;
}

function PanelError({ message, inline = false }: { message: string; inline?: boolean }): React.JSX.Element {
  return (
    <div className={cn(!inline && "px-3 py-2")}>
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-base text-destructive">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">{message}</span>
      </div>
    </div>
  );
}
