import { createContext, useContext } from "react";
import type { SetValues } from "nuqs";
import type { useRoderAgent } from "@/hooks/use-roder-agent";
import type { routeSearchParsers, RouteSearchState } from "@/lib/route-search";
import type { FolderOption } from "@/lib/workspace-thread-options";
import type { DesktopAttachment, RoderThread } from "@/types/roder";

export type AppShellContextValue = {
  agent: ReturnType<typeof useRoderAgent>;
  activeThread?: RoderThread;
  activeThreadBusy: boolean;
  activeWorkspaceCwd: string;
  canScrollTranscriptToBottom: boolean;
  composerAttachments: DesktopAttachment[];
  composerFocusSignal: number;
  folderOptions: FolderOption[];
  followSignal: number;
  routeSearch: RouteSearchState;
  selectedExtensionId: string | null;
  setCanScrollTranscriptToBottom: (canScroll: boolean) => void;
  setComposerAttachments: (attachments: DesktopAttachment[]) => void;
  setRouteSearch: SetValues<typeof routeSearchParsers>;
  showWorkingIndicator: boolean;
  threadOptions: RoderThread[];
  attachToComposer: (attachment: DesktopAttachment) => void;
  followBottom: () => void;
  sendPrompt: (prompt: string, attachments: DesktopAttachment[]) => Promise<void>;
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

export const AppShellProvider = AppShellContext.Provider;

export function useAppShell(): AppShellContextValue {
  const value = useContext(AppShellContext);
  if (!value) {
    throw new Error("useAppShell must be used inside AppShellProvider");
  }
  return value;
}
