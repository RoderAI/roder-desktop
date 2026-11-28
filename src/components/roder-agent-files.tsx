import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { roderAgentsIpc } from "@/lib/roder-agents-ipc";
import { roderIpc } from "@/lib/roder-ipc";
import { cn } from "@/lib/utils";
import type { RoderFile, RoderFilePath, RoderFileVersion } from "@/types/roder-agents";

const fileHints: Record<RoderFilePath, string> = {
  "INSTRUCTIONS.md": "What this Roder is for. Sent with every turn.",
  "AGENTS.md": "Your rules for the Roder. Only you can edit it. Up to 16 KiB is sent with every turn.",
  "NOTES.md": "Notes you and the Roder keep. Up to 8 KiB is sent with every turn.",
  "WORKERS.md": "Rules for the workers this Roder delegates to. Not added to worker prompts yet.",
  "DIGEST.md": "A summary the Roder keeps for you. Never sent to a model.",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** The current version named by a stale-write error, when the error is one. */
export function roderFileConflictVersion(error: unknown): number | null {
  const match = /version conflict on [A-Z]+\.md: expected \d+, current version is (\d+)/.exec(String(error));
  return match ? Number(match[1]) : null;
}

export function RoderAgentFiles({
  roderId,
  initialFiles,
}: {
  roderId: string;
  initialFiles: RoderFileVersion[];
}): React.JSX.Element {
  const [files, setFiles] = useState(initialFiles);
  const [selected, setSelected] = useState<RoderFilePath>(initialFiles[0]?.path ?? "INSTRUCTIONS.md");
  const [loaded, setLoaded] = useState<Partial<Record<RoderFilePath, RoderFile>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<RoderFilePath, string>>>({});
  const [history, setHistory] = useState<RoderFileVersion[] | null>(null);
  const [preview, setPreview] = useState<RoderFile | null>(null);
  const [conflict, setConflict] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const file = loaded[selected];
  const draft = drafts[selected] ?? file?.content ?? "";
  const dirty = !!file && draft !== file.content;

  async function attempt(work: () => Promise<void>) {
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      await work();
    } catch (cause) {
      const current = roderFileConflictVersion(cause);
      setConflict(current);
      setError(
        current === null
          ? String(cause)
          : `${selected} changed since you opened it; it is now at version ${current}. Your draft is kept.`,
      );
    }
    setWorking(false);
  }
  async function load(path: RoderFilePath, replaceDraft: boolean) {
    const latest = await roderAgentsIpc.readFile(roderId, path);
    setLoaded((previous) => ({ ...previous, [path]: latest }));
    if (replaceDraft)
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[path];
        return next;
      });
    setFiles((previous) => previous.map((entry) => (entry.path === path ? stripContent(latest) : entry)));
  }
  async function refreshHistory(path: RoderFilePath) {
    setHistory((await roderAgentsIpc.fileHistory(roderId, path)).versions);
  }
  function open(path: RoderFilePath) {
    setSelected(path);
    setHistory(null);
    setPreview(null);
    setConflict(null);
    setError(null);
    setMessage(null);
    if (!loaded[path]) void attempt(() => load(path, false));
  }

  useMountEffect(() => {
    let mounted = true;
    void roderAgentsIpc
      .readFile(roderId, selected)
      .then((latest) => {
        if (mounted) setLoaded((previous) => ({ ...previous, [latest.path]: latest }));
      })
      .catch((cause) => {
        if (mounted) setError(String(cause));
      });
    // The Roder writes NOTES.md from its own turns; keep versions current without touching drafts.
    const unsubscribe = roderIpc.onNotification((notification) => {
      if (!mounted || notification.method !== "desktop/roders/changed") return;
      void roderAgentsIpc
        .listFiles(roderId)
        .then((result) => {
          if (mounted) setFiles(result.files);
        })
        .catch(() => {});
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  });

  const current = files.find((entry) => entry.path === selected);
  const behind = !!file && !!current && current.version > file.version;
  return (
    <section aria-label="Roder files" className="space-y-3">
      <div className="space-y-1">
        <h3 className="font-semibold">Files</h3>
        <p className="text-sm font-normal text-muted-foreground">
          Every save is a new version. Restoring copies an old version into a new one, so nothing is lost.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <ul className="space-y-1" aria-label="Roder file list">
          {files.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                aria-current={entry.path === selected ? "true" : undefined}
                className={cn(
                  "flex h-11 w-full flex-col justify-center rounded-xl px-2.5 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  entry.path === selected && "bg-accent/60",
                )}
                onClick={() => open(entry.path)}
              >
                <span className="block truncate font-mono">
                  {entry.path}
                  {drafts[entry.path] !== undefined && drafts[entry.path] !== loaded[entry.path]?.content ? " •" : ""}
                </span>
                <span className="block truncate text-sm font-normal text-muted-foreground">
                  Version {entry.version} · {formatBytes(entry.bytes)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-2 sm:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-mono">{selected}</h4>
            <span className="text-sm text-muted-foreground">
              {file ? `Version ${file.version} · ${file.author === "roder" ? "by the Roder" : "by you"}` : "Loading…"}
            </span>
          </div>
          <p className="text-sm font-normal text-muted-foreground">{fileHints[selected]}</p>
          <textarea
            aria-label={`${selected} content`}
            name="content"
            value={draft}
            disabled={!file}
            rows={12}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDrafts((previous) => ({ ...previous, [selected]: value }));
            }}
            className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 font-mono text-base font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted/40"
          />
          {behind && !conflict ? (
            <p role="status" className="text-sm text-muted-foreground">
              Version {current.version} is newer than the one shown.{" "}
              {dirty ? (
                "Saving your draft will be refused; review the new version in History first."
              ) : (
                <button
                  type="button"
                  className="underline focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={working}
                  onClick={() => void attempt(() => load(selected, true))}
                >
                  Load it
                </button>
              )}
            </p>
          ) : null}
          {error ? (
            <div role="alert" className="space-y-2 rounded-lg border border-destructive p-2.5 text-sm text-destructive">
              <p>{error}</p>
              {conflict !== null ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={working}
                  onClick={() =>
                    void attempt(async () => {
                      await load(selected, true);
                      setConflict(null);
                    })
                  }
                >
                  Discard draft and load version {conflict}
                </Button>
              ) : null}
            </div>
          ) : null}
          {message ? (
            <p role="status" className="text-sm text-muted-foreground">
              {message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={working || !file || !dirty}
              onClick={() =>
                void attempt(async () => {
                  if (!file) return;
                  const written = await roderAgentsIpc.writeFile({
                    id: roderId,
                    path: selected,
                    content: draft,
                    expectedVersion: file.version,
                  });
                  setLoaded((previous) => ({ ...previous, [selected]: { ...written, content: draft } }));
                  setDrafts((previous) => {
                    const next = { ...previous };
                    delete next[selected];
                    return next;
                  });
                  setFiles((previous) => previous.map((entry) => (entry.path === selected ? written : entry)));
                  setConflict(null);
                  setMessage(`Saved ${selected} as version ${written.version}.`);
                  if (history) await refreshHistory(selected);
                })
              }
            >
              Save {selected}
            </Button>
            <Button
              variant="outline"
              disabled={working || !dirty}
              onClick={() =>
                setDrafts((previous) => {
                  const next = { ...previous };
                  delete next[selected];
                  return next;
                })
              }
            >
              Discard changes
            </Button>
            <Button
              variant="outline"
              disabled={working || !file}
              aria-expanded={history !== null}
              onClick={() => {
                if (history) {
                  setHistory(null);
                  setPreview(null);
                } else void attempt(() => refreshHistory(selected));
              }}
            >
              {history ? "Hide history" : "History"}
            </Button>
          </div>
          {history ? (
            <div className="space-y-2">
              <h4 className="font-semibold">History of {selected}</h4>
              {dirty ? (
                <p className="text-sm font-normal text-muted-foreground">Save or discard your changes to restore.</p>
              ) : null}
              <ul className="space-y-1">
                {history.map((entry) => (
                  <li
                    key={entry.version}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5"
                  >
                    <span className="min-w-0">
                      Version {entry.version}
                      {entry.version === file?.version ? " (current)" : ""}
                      <span className="block text-sm font-normal text-muted-foreground">
                        {entry.author === "roder" ? "The Roder" : "You"} · {new Date(entry.writtenAt).toLocaleString()}{" "}
                        · {formatBytes(entry.bytes)}
                        {entry.restoredFrom !== null ? ` · restored from version ${entry.restoredFrom}` : ""}
                      </span>
                    </span>
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={working}
                        onClick={() =>
                          void attempt(async () => {
                            setPreview(
                              preview?.version === entry.version
                                ? null
                                : await roderAgentsIpc.readFile(roderId, selected, entry.version),
                            );
                          })
                        }
                      >
                        {preview?.version === entry.version ? "Hide" : "View"}
                      </Button>
                      {entry.version !== file?.version ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={working || dirty || !file}
                          onClick={() =>
                            void attempt(async () => {
                              if (!file) return;
                              const written = await roderAgentsIpc.restoreFile({
                                id: roderId,
                                path: selected,
                                version: entry.version,
                                expectedVersion: file.version,
                              });
                              await load(selected, true);
                              await refreshHistory(selected);
                              setPreview(null);
                              setMessage(`Restored version ${entry.version} as version ${written.version}.`);
                            })
                          }
                        >
                          Restore
                        </Button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              {preview ? (
                <pre
                  aria-label={`${selected} version ${preview.version}`}
                  className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-2.5 font-mono text-base font-normal"
                >
                  {preview.content || "Empty."}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function stripContent(file: RoderFile): RoderFileVersion {
  const { content: _content, ...version } = file;
  return version;
}
