import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import {
  isMarkdownShellLanguage,
  isRunnableMarkdownShellCode,
  type MarkdownShellCommand,
  type MarkdownShellResult,
} from "../../src/lib/markdown-shell-command";

export async function runMarkdownShellCommand(input: unknown): Promise<MarkdownShellResult> {
  const { code, cwd, language } = (input ?? {}) as Partial<MarkdownShellCommand>;
  if (!isMarkdownShellLanguage(language) || !isRunnableMarkdownShellCode(code)) {
    throw new Error("Only completed sh or bash blocks with visible commands can run.");
  }
  if (typeof cwd !== "string" || !isAbsolute(cwd) || cwd.includes("\0")) {
    throw new Error("An absolute local workspace path is required.");
  }
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error("Shell blocks can run locally only on macOS or Linux.");
  }

  const env = { ...process.env };
  delete env.BASH_ENV;
  delete env.ENV;

  return new Promise((resolve) => {
    const child = execFile(
      language === "bash" ? "/bin/bash" : "/bin/sh",
      ["-c", code],
      { cwd, env, timeout: 30_000, maxBuffer: 128 * 1024, killSignal: "SIGKILL" },
      (error, stdout, stderr) => {
        const exitCode = error ? (typeof error.code === "number" ? error.code : null) : 0;
        let failure: string | undefined;
        if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") failure = "Output exceeded the 128 KiB limit.";
        else if (error?.killed) failure = "The command exceeded the 30-second time limit.";
        else if (error && exitCode === null) failure = "The command could not run or was interrupted.";
        resolve({ stdout, stderr, exitCode, error: failure });
      },
    );
    child.stdin?.end();
  });
}
