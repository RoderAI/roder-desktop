import { ChevronRight, GitPullRequest, MessageSquare, MessageSquareMore } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { handBackTarget, issueTimeline, openQuestion } from "@/lib/roder-board";
import { cn } from "@/lib/utils";
import type { Issue, IssueActivity, IssueOwner } from "@/types/issues";
import type { RoderThread } from "@/types/roder";

export const issueStatusLabel = (status: string) =>
  status.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());

export function threadLabel(threads: Pick<RoderThread, "id" | "name" | "preview">[], id: string): string {
  const thread = threads.find((item) => item.id === id);
  return thread?.name || thread?.preview || id;
}

export function actorLabel(
  actor: IssueOwner,
  threads: Pick<RoderThread, "id" | "name" | "preview">[],
  roderName = "Roder",
): string {
  return actor.type === "thread" ? threadLabel(threads, actor.threadId) : actor.type === "user" ? "You" : roderName;
}

/** Status dot colour: needs-you and blocked stand out, finished work goes quiet. */
export function issueStatusDot(status: Issue["status"]): string {
  if (status === "needs_you") return "bg-amber-500";
  if (status === "blocked") return "bg-destructive";
  if (status === "in_progress") return "bg-emerald-500";
  if (status === "in_review") return "bg-sky-500";
  return "bg-muted-foreground/40";
}

const kindVerb: Record<IssueActivity["kind"], string> = {
  created: "created the issue",
  updated: "updated",
  comment: "commented",
  question: "asked",
  pullRequest: "linked a pull request",
  thread: "linked a thread",
  closed: "closed the issue",
};

const timeLabel = (at: string) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * One issue read as a conversation: attributed comments and questions as
 * cards, quiet changes as rows, the owner marker, linked threads and PR
 * badges. When the issue waits on the user, the composer answers it, and the
 * service hands the issue back.
 */
export function IssueConversation({
  issue,
  threads,
  roderName,
  onOpenThread,
  onOpenPullRequest,
  onComment,
  autoFocusAnswer = false,
}: {
  issue: Issue;
  threads: Pick<RoderThread, "id" | "name" | "preview">[];
  roderName?: string;
  onOpenThread?: (threadId: string) => void;
  onOpenPullRequest?: (url: string) => void;
  /** Posts a user comment. Absent, the conversation is read-only. */
  onComment?: (text: string) => Promise<void>;
  autoFocusAnswer?: boolean;
}): React.JSX.Element {
  const question = openQuestion(issue);
  const owner = actorLabel(issue.owner, threads, roderName);
  return (
    <article aria-label={`Issue #${issue.number}`} className="space-y-4">
      <header className="space-y-2">
        <h3 className="font-semibold">
          <span className="mr-2 text-muted-foreground">#{issue.number}</span>
          {issue.title}
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-muted/50 px-2">
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", issueStatusDot(issue.status))} />
            {issueStatusLabel(issue.status)}
          </span>
          {issue.priority === "normal" ? null : (
            <span className="inline-flex h-6 items-center rounded-md bg-muted/50 px-2">
              {issueStatusLabel(issue.priority)} priority
            </span>
          )}
          <span
            aria-label={`Owner: ${owner}`}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-md px-2 ring-1",
              issue.owner.type === "user" ? "ring-amber-500/50" : "ring-border/70",
            )}
          >
            <span className="text-muted-foreground">Owner</span>
            {owner}
          </span>
        </div>
      </header>
      {issue.description ? <p className="whitespace-pre-wrap font-normal">{issue.description}</p> : null}
      {issue.doneCriteria || issue.outOfScope ? (
        <dl className="space-y-2 rounded-lg bg-muted/30 p-3 text-sm">
          {issue.doneCriteria ? (
            <div>
              <dt className="text-muted-foreground">Done criteria</dt>
              <dd className="whitespace-pre-wrap font-normal">{issue.doneCriteria}</dd>
            </div>
          ) : null}
          {issue.outOfScope ? (
            <div>
              <dt className="text-muted-foreground">Out of scope</dt>
              <dd className="whitespace-pre-wrap font-normal">{issue.outOfScope}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <IssueLinks issue={issue} threads={threads} onOpenThread={onOpenThread} onOpenPullRequest={onOpenPullRequest} />
      <section aria-label="Activity" className="space-y-2">
        <h4 className="text-sm text-muted-foreground">Activity</h4>
        <ol className="space-y-2">
          {issueTimeline(issue.activity).map((item) =>
            item.type === "group" ? (
              <li key={item.entries[0].id}>
                <details className="group/fold">
                  <summary className="flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring">
                    <ChevronRight aria-hidden="true" className="size-3.5 group-open/fold:rotate-90" />
                    {item.entries.length} updates
                  </summary>
                  <ol className="mt-1 space-y-1">
                    {item.entries.map((entry) => (
                      <EventRow key={entry.id} entry={entry} threads={threads} roderName={roderName} />
                    ))}
                  </ol>
                </details>
              </li>
            ) : item.type === "event" ? (
              <EventRow key={item.entry.id} entry={item.entry} threads={threads} roderName={roderName} />
            ) : (
              <EntryCard
                key={item.entry.id}
                entry={item.entry}
                threads={threads}
                roderName={roderName}
                open={item.entry.id === question?.id}
              />
            ),
          )}
        </ol>
      </section>
      {onComment ? (
        <IssueComposer
          key={issue.id}
          issue={issue}
          threads={threads}
          roderName={roderName}
          onComment={onComment}
          focusOnMount={autoFocusAnswer}
        />
      ) : null}
    </article>
  );
}

function IssueLinks({
  issue,
  threads,
  onOpenThread,
  onOpenPullRequest,
}: {
  issue: Issue;
  threads: Pick<RoderThread, "id" | "name" | "preview">[];
  onOpenThread?: (threadId: string) => void;
  onOpenPullRequest?: (url: string) => void;
}): React.JSX.Element | null {
  if (!issue.threadIds.length && !issue.pullRequests.length) return null;
  const chip =
    "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-2 text-sm ring-1 ring-border/70 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="space-y-2">
      {issue.threadIds.length ? (
        <section aria-label="Linked threads" className="space-y-1">
          <h4 className="text-sm text-muted-foreground">Threads {issue.threadIds.length}</h4>
          <ul className="flex flex-wrap gap-1.5">
            {issue.threadIds.map((id) => (
              <li key={id} className="min-w-0">
                <button type="button" className={chip} onClick={() => onOpenThread?.(id)}>
                  <MessageSquare aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  <span className="truncate">{threadLabel(threads, id)}</span>
                  {issue.owner.type === "thread" && issue.owner.threadId === id ? (
                    <span className="text-muted-foreground">Owner</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {issue.pullRequests.length ? (
        <section aria-label="Pull requests" className="space-y-1">
          <h4 className="text-sm text-muted-foreground">Pull requests</h4>
          <ul className="flex flex-wrap gap-1.5">
            {issue.pullRequests.map((pr) => (
              <li key={pr.url} className="min-w-0">
                <button type="button" title={pr.url} className={chip} onClick={() => onOpenPullRequest?.(pr.url)}>
                  <GitPullRequest aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  <span className="truncate">{pullRequestLabel(pr)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** A PR badge reads `#123 Title` when the URL ends in a number. */
export function pullRequestLabel(pr: { url: string; title: string }): string {
  const number = /\/pull\/(\d+)/.exec(pr.url)?.[1];
  return [number ? `#${number}` : null, pr.title || (number ? null : pr.url)].filter(Boolean).join(" ");
}

function EntryCard({
  entry,
  threads,
  roderName,
  open,
}: {
  entry: IssueActivity;
  threads: Pick<RoderThread, "id" | "name" | "preview">[];
  roderName?: string;
  /** The question the issue waits on now. */
  open: boolean;
}): React.JSX.Element {
  const author = actorLabel(entry.actor, threads, roderName);
  return (
    <li
      className={cn(
        "space-y-1 rounded-lg p-3 ring-1",
        open
          ? "bg-card ring-amber-500/50"
          : entry.actor.type === "user"
            ? "bg-muted/30 ring-transparent"
            : "bg-card ring-border/70",
      )}
    >
      <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
        {entry.kind === "question" ? (
          <MessageSquareMore aria-hidden="true" className="size-3.5" />
        ) : (
          <MessageSquare aria-hidden="true" className="size-3.5" />
        )}
        <span className="text-foreground">{author}</span>
        <span>{kindVerb[entry.kind]}</span>
        {entry.kind === "question" && entry.threadId && entry.actor.type !== "thread" ? (
          <span>for {threadLabel(threads, entry.threadId)}</span>
        ) : null}
        <span aria-hidden="true">·</span>
        <time dateTime={entry.createdAt}>{timeLabel(entry.createdAt)}</time>
        {open ? <span className="ml-auto text-amber-700 dark:text-amber-500">Needs your answer</span> : null}
      </p>
      <p className="whitespace-pre-wrap text-reading font-normal">{entry.text}</p>
    </li>
  );
}

function EventRow({
  entry,
  threads,
  roderName,
}: {
  entry: IssueActivity;
  threads: Pick<RoderThread, "id" | "name" | "preview">[];
  roderName?: string;
}): React.JSX.Element {
  return (
    <li className="flex items-baseline gap-1.5 px-2 text-sm text-muted-foreground">
      <span className="max-w-48 shrink-0 truncate text-foreground">{actorLabel(entry.actor, threads, roderName)}</span>
      <span className="min-w-0 truncate font-normal" title={entry.text}>
        {entry.kind === "updated" && entry.text ? entry.text : kindVerb[entry.kind]}
      </span>
      <time className="ml-auto shrink-0" dateTime={entry.createdAt}>
        {timeLabel(entry.createdAt)}
      </time>
    </li>
  );
}

function IssueComposer({
  issue,
  threads,
  roderName,
  onComment,
  focusOnMount,
}: {
  issue: Issue;
  threads: Pick<RoderThread, "id" | "name" | "preview">[];
  roderName?: string;
  onComment: (text: string) => Promise<void>;
  focusOnMount: boolean;
}): React.JSX.Element {
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answering = issue.status === "needs_you";
  const target = handBackTarget(issue);
  return (
    <form
      className="space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onComment(text);
          setText("");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
        setBusy(false);
      }}
    >
      <label htmlFor={id} className="block">
        {answering ? "Your answer" : "Comment"}
      </label>
      <Textarea
        id={id}
        // Only after the user chose Answer on a needs-you row, so focus follows their action.
        ref={(node) => {
          if (focusOnMount) node?.focus();
        }}
        className="min-h-20 font-normal"
        value={text}
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" className="rounded-lg" disabled={busy || !text.trim()}>
          {answering ? "Answer and hand back" : "Comment"}
        </Button>
        {answering ? (
          <p className="text-sm font-normal text-muted-foreground">
            Hands the issue back to{" "}
            {target.type === "thread" ? threadLabel(threads, target.threadId) : (roderName ?? "the Roder")}.
          </p>
        ) : null}
      </div>
    </form>
  );
}
