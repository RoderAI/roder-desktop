import { Play } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { CodeBlockCopyButton, type CustomRendererProps } from "streamdown";
import { Button } from "@/components/ui/button";
import {
  isMarkdownShellLanguage,
  isRunnableMarkdownShellCode,
  type MarkdownShellCommand,
  type MarkdownShellResult,
} from "@/lib/markdown-shell-command";
import { previewShellPrefix } from "@/lib/markdown-shell-fences";

type ShellTarget = {
  cwd: string;
  run: (command: MarkdownShellCommand) => Promise<MarkdownShellResult>;
};

const MarkdownShellContext = createContext<ShellTarget | null>(null);

export function MarkdownShellProvider({ target, children }: { target: ShellTarget | null; children?: ReactNode }) {
  return <MarkdownShellContext value={target}>{children}</MarkdownShellContext>;
}

type RunState = { status: "idle" | "running" } | { status: "finished"; result: MarkdownShellResult };

export function MarkdownShellBlock({ code, language: fenceLanguage, isIncomplete }: CustomRendererProps) {
  const target = useContext(MarkdownShellContext);
  const previewOnly = fenceLanguage.startsWith(previewShellPrefix);
  const language = previewOnly ? fenceLanguage.slice(previewShellPrefix.length) : fenceLanguage;
  const canRun =
    target && !previewOnly && !isIncomplete && isMarkdownShellLanguage(language) && isRunnableMarkdownShellCode(code);
  const [state, setState] = useState<RunState>({ status: "idle" });
  const running = state.status === "running";

  async function run() {
    if (!target || !canRun || !isMarkdownShellLanguage(language) || running) return;
    setState({ status: "running" });
    try {
      const result = await target.run({ cwd: target.cwd, language, code });
      setState({ status: "finished", result });
    } catch (error) {
      setState({
        status: "finished",
        result: {
          stdout: "",
          stderr: "",
          exitCode: null,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-lg bg-muted/30" data-shell-block={language} dir="ltr">
      <div className="flex min-w-0 items-start gap-1 py-1 pl-3 pr-1">
        <pre
          aria-label={`${language} code`}
          className="min-w-0 flex-1 overflow-x-auto whitespace-pre py-1 font-mono text-[length:var(--font-size-code)] leading-4 font-normal"
        >
          <code>{code}</code>
        </pre>
        <CodeBlockCopyButton
          code={code}
          className="grid size-6 shrink-0 place-items-center rounded-md p-0 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        />
        {canRun && (
          <Button
            type="button"
            variant="secondary"
            size="compact"
            className="h-6 shrink-0 gap-1 rounded-md px-2 text-sm [&_svg]:size-3"
            disabled={running}
            aria-label={`Run ${language} command`}
            title={`Run locally in ${target.cwd} with your permissions`}
            onClick={() => void run()}
          >
            <Play className="fill-current" aria-hidden="true" />
            Run
          </Button>
        )}
      </div>
      {running && (
        <p className="px-3 pb-2 text-sm text-muted-foreground" role="status">
          Running...
        </p>
      )}
      {state.status === "finished" && (
        <div className="border-t border-border px-3 py-2">
          <p className="text-sm text-muted-foreground" role="status">
            {state.result.error ??
              (state.result.exitCode === 0 ? "Finished" : `Exited with status ${state.result.exitCode}`)}
          </p>
          {(state.result.stdout || state.result.stderr) && (
            <pre className="max-h-52 overflow-auto font-mono text-sm font-normal" dir="ltr">
              {state.result.stdout}
              {state.result.stdout && state.result.stderr && !state.result.stdout.endsWith("\n") ? "\n" : ""}
              {state.result.stderr}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
