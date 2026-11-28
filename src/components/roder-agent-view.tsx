import { useState, type ReactNode } from "react";
import { RoderAgentFiles } from "@/components/roder-agent-files";
import { RoderAgentIssues } from "@/components/roder-agent-issues";
import { RoderAgentOverview, type RoderAgentTab } from "@/components/roder-agent-overview";
import { RoderAgentThreads } from "@/components/roder-agent-threads";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { needsYouItems, roderBoard, type RoderWorkerEvent } from "@/lib/roder-board";
import type { Issue, IssueProject } from "@/types/issues";
import type { RoderThread } from "@/types/roder";
import type { RoderAgent, RoderFileVersion } from "@/types/roder-agents";

/**
 * One Roder, as tabs: Overview, Issues, Threads, Files, and Settings for the
 * run controls. Data comes in as props so the page and Storybook share it.
 */
export function RoderAgentView({
  roder,
  files,
  projects,
  issues,
  threads,
  events,
  settings,
  initialTab = "overview",
  initialIssueId = null,
  onComment,
  onOpenThread,
  onOpenPullRequest,
}: {
  roder: RoderAgent;
  files: RoderFileVersion[];
  projects: IssueProject[];
  issues: Issue[];
  threads: Pick<RoderThread, "id" | "name" | "preview">[];
  /** Slice 7 seam: supervision events, when the backend reports them. */
  events?: RoderWorkerEvent[];
  /** The Settings tab body; the tab is hidden without it. */
  settings?: ReactNode;
  initialTab?: RoderAgentTab;
  initialIssueId?: string | null;
  onComment: (issueId: string, text: string) => Promise<void>;
  onOpenThread: (threadId: string) => void;
  onOpenPullRequest: (url: string) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<RoderAgentTab>(initialTab);
  const [issueId, setIssueId] = useState<string | null>(initialIssueId);
  const [answerFocus, setAnswerFocus] = useState(false);
  const board = roderBoard(roder, projects, issues);
  const asks = needsYouItems(board.issues).length;
  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as RoderAgentTab)} className="min-w-0 flex-col gap-4">
      <TabsList variant="chrome" aria-label={`${roder.name} sections`}>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="issues">
          Issues
          {asks ? (
            <span
              aria-label={`${asks} need you`}
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-xs text-white"
            >
              {asks}
            </span>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="threads">Threads</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        {settings ? <TabsTrigger value="settings">Settings</TabsTrigger> : null}
      </TabsList>
      <TabsContent value="overview" className="text-base">
        <RoderAgentOverview
          roder={roder}
          project={board.project}
          issues={board.issues}
          threads={threads}
          events={events}
          onShowTab={(next) => {
            if (next === "issues") setIssueId(null);
            setTab(next);
          }}
          onOpenIssue={(id, options) => {
            setIssueId(id);
            setAnswerFocus(Boolean(options?.answer));
            setTab("issues");
          }}
          onOpenThread={onOpenThread}
          onOpenPullRequest={onOpenPullRequest}
        />
      </TabsContent>
      <TabsContent value="issues" className="text-base">
        <RoderAgentIssues
          issues={board.issues}
          threads={threads}
          roderName={roder.name}
          selectedIssueId={issueId}
          answerFocus={answerFocus}
          onSelect={(id) => {
            setIssueId(id);
            setAnswerFocus(false);
          }}
          onComment={onComment}
          onOpenThread={onOpenThread}
          onOpenPullRequest={onOpenPullRequest}
        />
      </TabsContent>
      <TabsContent value="threads" className="text-base">
        <RoderAgentThreads
          roder={roder}
          issues={board.issues}
          threads={threads}
          events={events}
          onOpenThread={onOpenThread}
        />
      </TabsContent>
      <TabsContent value="files" className="text-base">
        <RoderAgentFiles key={roder.id} roderId={roder.id} initialFiles={files} />
      </TabsContent>
      {settings ? (
        <TabsContent value="settings" className="text-base">
          {settings}
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
