import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { actorLabel, IssueConversation, issueStatusDot, issueStatusLabel } from "@/components/roder-issue-conversation";
import { Button } from "@/components/ui/button";
import { groupIssues } from "@/lib/issues-ipc";
import { cn } from "@/lib/utils";
import type { Issue, IssueStatus } from "@/types/issues";
import type { RoderThread } from "@/types/roder";

/**
 * The Issues tab: the Roder's board grouped by status, needs-you first in
 * lifecycle order. Selecting an issue opens it as a conversation in place.
 */
export function RoderAgentIssues({
  issues,
  threads,
  roderName,
  selectedIssueId,
  answerFocus = false,
  onSelect,
  onComment,
  onOpenThread,
  onOpenPullRequest,
}: {
  issues: Issue[];
  threads: Pick<RoderThread, "id" | "name" | "preview">[];
  roderName?: string;
  selectedIssueId: string | null;
  /** Focus the answer box when the issue opened from a needs-you row. */
  answerFocus?: boolean;
  onSelect: (issueId: string | null) => void;
  onComment: (issueId: string, text: string) => Promise<void>;
  onOpenThread: (threadId: string) => void;
  onOpenPullRequest: (url: string) => void;
}): React.JSX.Element {
  const groupsId = useId();
  const [collapsed, setCollapsed] = useState<IssueStatus[]>(["done", "cancelled"]);
  const selected = issues.find((issue) => issue.id === selectedIssueId);
  if (selected)
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => onSelect(null)}>
          <ArrowLeft className="size-4" />
          All issues
        </Button>
        <IssueConversation
          issue={selected}
          threads={threads}
          roderName={roderName}
          autoFocusAnswer={answerFocus}
          onOpenThread={onOpenThread}
          onOpenPullRequest={onOpenPullRequest}
          onComment={(text) => onComment(selected.id, text)}
        />
      </div>
    );
  if (!issues.length)
    return (
      <p className="rounded-lg bg-muted/30 p-3 text-sm font-normal text-muted-foreground">
        No issues on this board yet. The Roder files issues as it plans work.
      </p>
    );
  // Needs-you leads the list: it is the only group waiting on the person reading it.
  const groups = groupIssues(issues, {}, collapsed).sort(
    (a, b) => Number(b.status === "needs_you") - Number(a.status === "needs_you"),
  );
  return (
    <div className="space-y-1">
      {groups.map((group) => (
        <section key={group.status} aria-label={`${issueStatusLabel(group.status)} issues`}>
          <h3>
            <button
              type="button"
              aria-expanded={group.expanded}
              aria-controls={`${groupsId}-${group.status}`}
              onClick={() =>
                setCollapsed((current) =>
                  current.includes(group.status)
                    ? current.filter((value) => value !== group.status)
                    : [...current, group.status],
                )
              }
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {group.expanded ? (
                <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
              ) : (
                <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
              )}
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", issueStatusDot(group.status))} />
              <span>{issueStatusLabel(group.status)}</span>
              <span className="text-sm text-muted-foreground">{group.issues.length}</span>
            </button>
          </h3>
          <ul id={`${groupsId}-${group.status}`} hidden={!group.expanded} className="space-y-0.5 pb-1">
            {group.issues.map((issue) => (
              <li key={issue.id}>
                <button
                  type="button"
                  onClick={() => onSelect(issue.id)}
                  className="flex w-full min-w-0 items-center gap-3 rounded-xl py-1.5 pr-2 pl-8 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="mr-2 text-sm text-muted-foreground">#{issue.number}</span>
                    {issue.title}
                  </span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {issue.pullRequests.length ? `${issue.pullRequests.length} PR · ` : ""}
                    {actorLabel(issue.owner, threads, roderName)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
