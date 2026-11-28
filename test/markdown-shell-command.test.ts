import { realpath } from "node:fs/promises";
import { expect, test } from "vitest";
import { runMarkdownShellCommand } from "../electron/terminal/markdown-shell-command";

test.skipIf(process.platform === "win32")("runs a bash fence in the selected working directory", async () => {
  const cwd = await realpath(process.cwd());

  const result = await runMarkdownShellCommand({
    language: "bash",
    code: 'items=(ready); printf "%s\\n" "$PWD" "${items[0]}"',
    cwd,
  });

  expect(result).toMatchObject({ stdout: `${cwd}\nready\n`, stderr: "", exitCode: 0 });
});

test.skipIf(process.platform === "win32")("returns stderr and exit status from a sh fence", async () => {
  await expect(
    runMarkdownShellCommand({
      language: "sh",
      code: 'printf "example error" >&2; exit 7',
      cwd: process.cwd(),
    }),
  ).resolves.toMatchObject({ exitCode: 7, stderr: "example error" });
});

test("rejects unsupported fences and missing workspace paths", async () => {
  await expect(runMarkdownShellCommand({ language: "python", code: "print(1)", cwd: process.cwd() })).rejects.toThrow(
    "completed sh or bash",
  );
  await expect(runMarkdownShellCommand({ language: "sh", code: "pwd", cwd: "." })).rejects.toThrow(
    "absolute local workspace path",
  );
});

test("rejects empty and hidden-control scripts", async () => {
  for (const code of ["   ", "pwd\u001b", "pwd\u202E"]) {
    await expect(runMarkdownShellCommand({ language: "bash", code, cwd: process.cwd() })).rejects.toThrow(
      "completed sh or bash",
    );
  }
});
