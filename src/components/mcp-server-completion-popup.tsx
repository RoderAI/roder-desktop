import { Server } from "lucide-react";
import { ComposerCompletionPopup, composerCompletionOptionId } from "@/components/composer-completion-popup";
import type { McpServerCompletionItem } from "@/lib/roder-mcp";

type McpServerCompletionPopupProps = {
  visible: boolean;
  listboxId: string;
  servers: McpServerCompletionItem[];
  highlightedServerIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (server: McpServerCompletionItem) => void;
};

export function McpServerCompletionPopup({
  visible,
  listboxId,
  servers,
  highlightedServerIndex,
  onHighlight,
  onSelect,
}: McpServerCompletionPopupProps): React.JSX.Element | null {
  return (
    <ComposerCompletionPopup
      visible={visible}
      listboxId={listboxId}
      ariaLabel="MCP server completions"
      items={servers}
      highlightedIndex={highlightedServerIndex}
      onHighlight={onHighlight}
      onSelect={onSelect}
      renderItem={({ item }) => <McpServerCompletionItemRow server={item} />}
    />
  );
}

function McpServerCompletionItemRow({ server }: { server: McpServerCompletionItem }): React.JSX.Element {
  return (
    <>
      <Server className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        <span className="font-medium">@{server.name}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{server.scopeLabel}</span>
    </>
  );
}

export function mcpServerCompletionOptionId(listboxId: string, index: number): string {
  return composerCompletionOptionId(listboxId, index);
}
