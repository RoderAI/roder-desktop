import { createContext, use } from "react";
import type { SetValues } from "nuqs";
import type { useRoderAgent } from "@/hooks/use-roder-agent";
import type { ThreadHunkSummary } from "@/hooks/use-thread-hunk-summary";
import type { LocalTranscriptOffset } from "@/lib/native-command-router";
import type { CommandInvocation } from "@/lib/roder-commands";
import type { NativeCommandOutput } from "@/lib/native-command-formatters";
import type { routeSearchParsers, RouteReviewScope, RouteSearchState } from "@/lib/route-search";
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
  nativeModelPickerOpen: boolean;
  nativeCommandOutput: NativeCommandOutput | null;
  folderOptions: FolderOption[];
  followSignal: number;
  hunkSummary: ThreadHunkSummary;
  routeSearch: RouteSearchState;
  selectedExtensionId: string | null;
  setCanScrollTranscriptToBottom: (canScroll: boolean) => void;
  setComposerAttachments: (attachments: DesktopAttachment[]) => void;
  setRouteSearch: SetValues<typeof routeSearchParsers>;
  showWorkingIndicator: boolean;
  localTranscriptOffset: LocalTranscriptOffset | null;
  threadOptions: RoderThread[];
  attachToComposer: (attachment: DesktopAttachment) => void;
  closeNativeModelPicker: () => void;
  followBottom: () => void;
  openReview: (scope: RouteReviewScope, turnId?: string) => void;
  selectNativeCommandModel: (modelId: string) => void;
  sendCommandInvocation: (invocation: CommandInvocation) => Promise<void>;
  sendPrompt: (prompt: string, attachments: DesktopAttachment[]) => Promise<void>;
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

export const AppShellProvider = AppShellContext.Provider;

export function useAppShell(): AppShellContextValue {
  const value = use(AppShellContext);
  if (!value) {
    throw new Error("useAppShell must be used inside AppShellProvider");
  }
  return value;
}
