export type MarkdownShellLanguage = "sh" | "bash";

export type MarkdownShellCommand = {
  language: MarkdownShellLanguage;
  code: string;
  cwd: string;
};

export type MarkdownShellResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
};

export function isMarkdownShellLanguage(language: unknown): language is MarkdownShellLanguage {
  return language === "sh" || language === "bash";
}

export function isRunnableMarkdownShellCode(code: unknown): code is string {
  if (typeof code !== "string" || code.length > 8_192 || !code.trim()) return false;

  // Do not run invisible control characters that can disguise the reviewed command.
  return Array.from(code).every((character) => {
    const point = character.charCodeAt(0);
    return (
      point === 9 || point === 10 || (point >= 32 && !(point >= 127 && point <= 159) && !/\p{Cf}/u.test(character))
    );
  });
}
