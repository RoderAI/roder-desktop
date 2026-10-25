import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, ClipboardList, FolderPlus, Plus, RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { groupIssues, issuesIpc, useIssuesStore } from "@/lib/issues-ipc";
import { useRoderStore } from "@/stores/roder-store";
import { issueStatuses, type Issue, type IssueProject, type IssueStatus } from "@/types/issues";
import type { RoderThread, Workspace } from "@/types/roder";

const controlClass =
  "h-8 rounded-lg border border-input bg-background px-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";
const statusLabel = (status: string) => status.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());

export function IssuesPage(): React.JSX.Element {
  const { projects, issues, loading, loaded, error, refresh } = useIssuesStore();
  const workspaces = useRoderStore((state) => state.workspaces);
  const threads = useRoderStore((state) => state.threads);
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState("");
  const [assignment, setAssignment] = useState("");
  const [collapsedStatuses, setCollapsedStatuses] = useState<IssueStatus[]>(["done", "cancelled"]);
  const groupsId = useId();
  const [editor, setEditor] = useState<
    { type: "issue"; issue?: Issue } | { type: "project"; project?: IssueProject } | null
  >(null);
  const groups = groupIssues(issues, { query, projectId, status, assignment }, collapsedStatuses);
  const filteredCount = groups.reduce((count, group) => count + group.issues.length, 0);
  const revealingMatches = Boolean(query.trim() || projectId || status || assignment);
  const selectedProject = projects.find((project) => project.id === projectId);

  function toggleStatusGroup(status: IssueStatus): void {
    setCollapsedStatuses((current) =>
      current.includes(status) ? current.filter((value) => value !== status) : [...current, status],
    );
  }

  useMountEffect(() => {
    void useIssuesStore.getState().refresh();
    return window.roderDesktop.onNotification((event) => {
      if (event.method === "desktop/issues/changed") void useIssuesStore.getState().refresh();
    });
  });

  return (
    <main className="flex h-full min-h-0 flex-col bg-background text-base font-medium">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <h1 className="text-base font-semibold">Issues</h1>
          <p className="mt-1 text-sm font-normal text-muted-foreground">
            Local projects and issues, shared with your agents.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="rounded-lg" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setEditor({ type: "project" })}>
            <FolderPlus className="size-4" />
            New project
          </Button>
          <Button
            size="sm"
            className="rounded-lg"
            disabled={!projects.some((project) => !project.archived)}
            onClick={() => setEditor({ type: "issue" })}
          >
            <Plus className="size-4" />
            New issue
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 pb-3">
        <input
          aria-label="Search issues"
          placeholder="Search issues…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={`${controlClass} min-w-40 flex-1`}
        />
        <select
          aria-label="Filter by project"
          className={controlClass}
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
              {project.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by status"
          className={controlClass}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All statuses</option>
          {issueStatuses.map((value) => (
            <option key={value} value={value}>
              {statusLabel(value)}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by assignment"
          className={controlClass}
          value={assignment}
          onChange={(event) => setAssignment(event.target.value)}
        >
          <option value="">All assignments</option>
          <option value="assigned">Assigned</option>
          <option value="unassigned">Unassigned</option>
        </select>
        {selectedProject ? (
          <Button variant="ghost" size="sm" onClick={() => setEditor({ type: "project", project: selectedProject })}>
            Edit project
          </Button>
        ) : null}
        {selectedProject?.persistentAgentThreadId ? (
          <Link
            className="inline-flex h-8 items-center rounded-lg px-2.5 text-sm hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
            to="/threads/$threadId"
            params={{ threadId: selectedProject.persistentAgentThreadId }}
            search={true}
          >
            Open project PA
          </Link>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 overflow-auto">
        <section aria-label="Issues list" className="min-w-0 flex-1 px-4 pb-4">
          {error ? (
            <p role="alert" className="py-3 text-destructive">
              {error}{" "}
              <Button size="sm" onClick={() => void refresh()}>
                Retry
              </Button>
            </p>
          ) : null}
          {!loaded && loading ? (
            <p role="status" className="py-6 text-muted-foreground">
              Loading issues…
            </p>
          ) : null}
          {loaded ? (
            <p className="py-2 text-sm font-normal text-muted-foreground">
              {filteredCount} issues{selectedProject?.description ? ` · ${selectedProject.description}` : ""}
            </p>
          ) : null}
          {loaded && !filteredCount ? (
            <div className="rounded-xl bg-muted/30 p-5 text-center">
              <ClipboardList className="mx-auto mb-3 size-6 text-muted-foreground" />
              <p>{issues.length ? "No issues match these filters." : "Make room for your next piece of work."}</p>
              <p className="mt-1 text-sm font-normal text-muted-foreground">
                {projects.length
                  ? "Create an issue or ask your agent to file one."
                  : "Create a local project, then add your first issue."}
              </p>
            </div>
          ) : null}
          {groups.map((group) => (
            <section
              key={group.status}
              aria-label={`${statusLabel(group.status)} issues`}
              className="border-b border-border py-2"
            >
              <h2>
                <button
                  type="button"
                  aria-expanded={group.expanded}
                  aria-controls={`${groupsId}-${group.status}`}
                  disabled={revealingMatches}
                  title={revealingMatches ? "Clear filters to collapse status groups" : undefined}
                  onClick={() => toggleStatusGroup(group.status)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {group.expanded ? (
                    <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                  )}
                  <span>{statusLabel(group.status)}</span>
                  <span className="text-sm font-normal text-muted-foreground">{group.issues.length}</span>
                </button>
              </h2>
              <ul id={`${groupsId}-${group.status}`} hidden={!group.expanded} className="divide-y divide-border">
                {group.issues.map((issue) => (
                  <li key={issue.id} className="flex items-center gap-3 py-1">
                    <button
                      type="button"
                      onClick={() => setEditor({ type: "issue", issue })}
                      className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="mr-2 text-sm text-muted-foreground">#{issue.number}</span>
                      {issue.title}
                      <span className="mt-1 block text-sm font-normal text-muted-foreground">
                        {projects.find((project) => project.id === issue.projectId)?.name} · {statusLabel(issue.status)}
                      </span>
                    </button>
                    {issue.threadId ? (
                      <Link
                        className="rounded-md px-2 py-1 text-sm hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                        to="/threads/$threadId"
                        params={{ threadId: issue.threadId }}
                        search={true}
                      >
                        Open thread
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">Unassigned</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
        {editor ? (
          <aside
            aria-label={editor.type === "issue" ? "Issue editor" : "Project editor"}
            className="w-96 shrink-0 overflow-auto border-l border-border p-4"
          >
            {editor.type === "issue" ? (
              <IssueEditor
                key={editor.issue?.id ?? "new-issue"}
                issue={editor.issue}
                projects={projects}
                defaultProjectId={projectId}
                threads={threads}
                onClose={() => setEditor(null)}
              />
            ) : (
              <ProjectEditor
                key={editor.project?.id ?? "new-project"}
                project={editor.project}
                workspaces={workspaces}
                onClose={() => setEditor(null)}
              />
            )}
          </aside>
        ) : null}
      </div>
    </main>
  );
}

function IssueEditor({
  issue,
  projects,
  defaultProjectId,
  threads,
  onClose,
}: {
  issue?: Issue;
  projects: IssueProject[];
  defaultProjectId: string;
  threads: RoderThread[];
  onClose: () => void;
}): React.JSX.Element {
  const descriptionId = useId();
  const navigate = useNavigate();
  const [title, setTitle] = useState(issue?.title ?? "");
  const [description, setDescription] = useState(issue?.description ?? "");
  const [projectId, setProjectId] = useState(
    issue?.projectId ??
      (projects.find((project) => project.id === defaultProjectId && !project.archived)?.id ||
        projects.find((project) => !project.archived)?.id ||
        ""),
  );
  const [status, setStatus] = useState<IssueStatus>(issue?.status ?? "backlog");
  const [threadId, setThreadId] = useState(issue?.threadId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = projects.find((item) => item.id === projectId);
  const availableThreads = threads.filter(
    (thread) => !project?.workspaceId || thread.workspaceId === project.workspaceId || thread.id === threadId,
  );

  async function save(launch = false): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const saved = issue
        ? await issuesIpc.updateIssue({
            id: issue.id,
            title,
            description,
            projectId,
            status,
            threadId: threadId || null,
          })
        : await issuesIpc.createIssue({ title, description, projectId, status, threadId: threadId || null });
      if (launch) {
        const result = await issuesIpc.launchIssue(saved.issue.id);
        await useIssuesStore.getState().refresh();
        onClose();
        await navigate({ to: "/threads/$threadId", params: { threadId: result.threadId }, search: true });
      } else {
        await useIssuesStore.getState().refresh();
        onClose();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    setBusy(false);
  }

  async function remove(): Promise<void> {
    if (!issue || !window.confirm(`Permanently delete issue #${issue.number}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await issuesIpc.deleteIssue(issue.id);
      await useIssuesStore.getState().refresh();
      onClose();
    } catch (cause) {
      setError(String(cause));
    }
    setBusy(false);
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2 className="font-semibold">{issue ? `Issue #${issue.number}` : "New issue"}</h2>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block space-y-1">
          <span>Title</span>
          <input
            required
            maxLength={1000}
            className={`${controlClass} w-full`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label htmlFor={descriptionId} className="block space-y-1">
          <span>Description</span>
          <Textarea
            id={descriptionId}
            className="min-h-36 font-normal"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span>Project</span>
          <select
            required
            className={`${controlClass} w-full`}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            {projects.map((item) =>
              !item.archived || item.id === projectId ? (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ) : null,
            )}
          </select>
        </label>
        <label className="block space-y-1">
          <span>Status</span>
          <select
            className={`${controlClass} w-full`}
            value={status}
            onChange={(event) => setStatus(event.target.value as IssueStatus)}
          >
            {issueStatuses.map((value) => (
              <option key={value} value={value}>
                {statusLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span>Assigned thread</span>
          <select
            className={`${controlClass} w-full`}
            value={threadId}
            onChange={(event) => setThreadId(event.target.value)}
          >
            <option value="">Unassigned</option>
            {threadId && !availableThreads.some((thread) => thread.id === threadId) ? (
              <option value={threadId}>{threadId}</option>
            ) : null}
            {availableThreads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.name || thread.preview || thread.id}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm font-normal text-muted-foreground">
          Assignment lists loaded threads{project?.workspaceId ? " in this workspace" : ""}. Agents can also assign a
          thread by ID.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" className="rounded-lg" disabled={!title.trim() || !projectId}>
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-lg"
            disabled={!title.trim() || !project?.workspaceId || project.archived || !issue}
            onClick={() => void save(true)}
          >
            {threadId ? "Save & open thread" : "Save & launch work"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
        {!project?.workspaceId ? (
          <p className="text-sm font-normal text-muted-foreground">Link this project to a workspace to launch work.</p>
        ) : null}
        {!issue ? (
          <p className="text-sm font-normal text-muted-foreground">
            Save the issue first, then launch work from its editor.
          </p>
        ) : null}
        {issue ? (
          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => void remove()}>
            Delete issue
          </Button>
        ) : null}
      </fieldset>
    </form>
  );
}

function ProjectEditor({
  project,
  workspaces,
  onClose,
}: {
  project?: IssueProject;
  workspaces: Workspace[];
  onClose: () => void;
}): React.JSX.Element {
  const descriptionId = useId();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [workspaceId, setWorkspaceId] = useState(project?.workspaceId ?? "");
  const [archived, setArchived] = useState(project?.archived ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (project)
        await issuesIpc.updateProject({
          id: project.id,
          name,
          description,
          workspaceId: workspaceId || null,
          archived,
        });
      else await issuesIpc.createProject({ name, description, workspaceId: workspaceId || null });
      await useIssuesStore.getState().refresh();
      onClose();
    } catch (cause) {
      setError(String(cause));
    }
    setBusy(false);
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2 className="font-semibold">{project ? "Edit project" : "New project"}</h2>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block space-y-1">
          <span>Name</span>
          <input
            required
            maxLength={1000}
            className={`${controlClass} w-full`}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label htmlFor={descriptionId} className="block space-y-1">
          <span>Description</span>
          <Textarea
            id={descriptionId}
            className="min-h-28 font-normal"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span>Workspace</span>
          <select
            className={`${controlClass} w-full`}
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            <option value="">No workspace linked</option>
            {workspaceId && !workspaces.some((workspace) => workspace.id === workspaceId) ? (
              <option value={workspaceId}>{workspaceId} (unavailable)</option>
            ) : null}
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm font-normal text-muted-foreground">
          Link an existing workspace to launch agents on this project's issues. Your records stay on this computer.
        </p>
        {project ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />
            Archived
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" className="rounded-lg" disabled={!name.trim()}>
            Save project
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
