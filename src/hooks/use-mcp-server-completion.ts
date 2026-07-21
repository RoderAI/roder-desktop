import type { KeyboardEvent } from "react";
import { useState } from "react";
import { useComposerCompletion } from "@/hooks/use-composer-completion";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { shouldClearDismissedCompletion } from "@/lib/composer-completions";
import { readSkillPromptEditorText, writeSkillPromptEditorText } from "@/lib/lexical-skill-prompt";
import {
  enabledMcpServersFromConfig,
  matchingMcpServerCompletions,
  mcpConfigScopes,
  mcpServerCompletionToken,
  mergeMcpServerCompletions,
  replaceMcpServerToken,
  type McpServerCompletionItem,
} from "@/lib/roder-mcp";
import { useRoderStore } from "@/stores/roder-store";
import type { SkillDescriptor } from "@/types/roder";
import type { LexicalEditor } from "lexical";

type McpServerCompletionState = {
  handleMcpServerCompletionKeyDown: (event: KeyboardEvent<HTMLDivElement>) => boolean;
  highlightedMcpServerIndex: number;
  insertMcpServerCompletion: (server: McpServerCompletionItem) => void;
  mcpServerCompletions: McpServerCompletionItem[];
  setHighlightedMcpServerIndex: (index: number) => void;
  showMcpServerCompletionMenu: boolean;
};

type UseMcpServerCompletionOptions = {
  editor: LexicalEditor;
  prompt: string;
  caretPosition: number;
  skills: SkillDescriptor[];
  onPromptChange: (prompt: string, caret: number) => void;
};

export function useMcpServerCompletion({
  editor,
  prompt,
  caretPosition,
  skills,
  onPromptChange,
}: UseMcpServerCompletionOptions): McpServerCompletionState {
  const servers = useMcpServersForCompletion();
  const completionToken = mcpServerCompletionToken(prompt, caretPosition);
  const mcpServerCompletions = completionToken
    ? matchingMcpServerCompletions(servers, completionToken.query)
    : [];
  const completion = useComposerCompletion({ token: completionToken, itemCount: mcpServerCompletions.length });
  const showMcpServerCompletionMenu = completion.showMenu;
  const highlightedMcpServerIndex = completion.highlightedIndex;

  function insertMcpServerCompletion(server: McpServerCompletionItem): void {
    if (!completionToken) {
      return;
    }
    const next = replaceMcpServerToken(readSkillPromptEditorText(editor), completionToken, server.name);
    writeSkillPromptEditorText(editor, next.text, skills, next.caret);
    onPromptChange(next.text, next.caret);
    completion.reset();
    requestAnimationFrame(() => {
      editor.focus();
    });
  }

  function selectedServerForKeyboard(): McpServerCompletionItem | undefined {
    return mcpServerCompletions[highlightedMcpServerIndex];
  }

  function handleMcpServerCompletionKeyDown(event: KeyboardEvent<HTMLDivElement>): boolean {
    if (shouldClearDismissedCompletion(completion.completionKey, completion.dismissedCompletionKey, event)) {
      completion.reset();
    }

    if (!showMcpServerCompletionMenu) {
      return false;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      completion.moveHighlight(event.key === "ArrowDown" ? "next" : "previous");
      return true;
    }

    if (event.key === "Tab" || event.key === "Enter") {
      const selectedServer = selectedServerForKeyboard();
      if (!selectedServer) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      insertMcpServerCompletion(selectedServer);
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      completion.dismiss();
      return true;
    }

    return false;
  }

  return {
    handleMcpServerCompletionKeyDown,
    highlightedMcpServerIndex,
    insertMcpServerCompletion,
    mcpServerCompletions,
    setHighlightedMcpServerIndex: completion.setHighlightedIndex,
    showMcpServerCompletionMenu,
  };
}

function useMcpServersForCompletion(): McpServerCompletionItem[] {
  const [servers, setServers] = useState<McpServerCompletionItem[]>([]);
  const cwd = useRoderStore((state) => state.selectedWorkspaceCwd || state.status.cwd || "");

  useMountEffect(() => {
    let cancelled = false;
    const homeDir = window.roderDesktop.homeDir;
    const scopes = mcpConfigScopes(homeDir, cwd);

    void (async () => {
      const results = await Promise.all(
        scopes.map(async (scope) => {
          const result = await window.roderDesktop.mcpReadConfig(scope.path);
          if (result.error) {
            return [] as McpServerCompletionItem[];
          }
          return enabledMcpServersFromConfig(result.config, scope.scope, scope.label);
        }),
      );
      if (!cancelled) {
        setServers(mergeMcpServerCompletions(results.flat()));
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  return servers;
}
