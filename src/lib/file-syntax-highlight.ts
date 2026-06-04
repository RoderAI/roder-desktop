import pierreDarkSoft from "@pierre/theme/pierre-dark-soft";
import pierreLight from "@pierre/theme/pierre-light";
import {
  createHighlighter,
  createJavaScriptRegexEngine,
  type BundledLanguage,
  type PlainTextLanguage,
  type ThemeRegistrationRaw,
} from "shiki";

export type HighlightedFileContent = {
  html: string;
  language: string;
};

const textLanguage = "text";
const highlighterThemes = {
  dark: "pierre-dark-soft",
  light: "pierre-light",
} as const;

type FileSyntaxLanguage = BundledLanguage | PlainTextLanguage;

let highlighterPromise: ReturnType<typeof createFileHighlighter> | null = null;

export async function highlightFileContent(path: string, code: string): Promise<HighlightedFileContent> {
  const language = languageForFilePath(path);
  const highlighter = await getFileHighlighter();
  if (language !== textLanguage && !highlighter.getLoadedLanguages().includes(language)) {
    await highlighter.loadLanguage(language);
  }
  return {
    html: highlighter.codeToHtml(code, {
      lang: language,
      themes: highlighterThemes,
      defaultColor: false,
    }),
    language,
  };
}

export function languageForFilePath(path: string): FileSyntaxLanguage {
  const fileName = basename(path).toLowerCase();
  const extension = fileName.includes(".") ? fileName.split(".").pop() : "";
  const language = fileLanguageByName.get(fileName) ?? (extension ? fileLanguageByExtension.get(extension) : undefined);
  return language ?? textLanguage;
}

function getFileHighlighter(): ReturnType<typeof createFileHighlighter> {
  highlighterPromise ??= createFileHighlighter();
  return highlighterPromise;
}

async function createFileHighlighter() {
  return createHighlighter({
    themes: [shikiTheme(pierreLight, highlighterThemes.light), shikiTheme(pierreDarkSoft, highlighterThemes.dark)],
    langs: [textLanguage],
    engine: createJavaScriptRegexEngine(),
  });
}

function shikiTheme(theme: typeof pierreLight, name: string): ThemeRegistrationRaw {
  return {
    name,
    type: theme.type,
    colors: { ...theme.colors },
    settings: theme.tokenColors.map((tokenColor) => ({
      ...tokenColor,
      scope: Array.isArray(tokenColor.scope) ? [...tokenColor.scope] : tokenColor.scope,
      settings: { ...tokenColor.settings },
    })),
  };
}

function basename(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() ?? path
  );
}

const fileLanguageByName = new Map<string, BundledLanguage>([
  [".babelrc", "json"],
  [".env", "dotenv"],
  [".env.example", "dotenv"],
  [".npmrc", "ini"],
  [".prettierrc", "json"],
  [".prettierrc.json", "json"],
  ["dockerfile", "docker"],
  ["gemfile", "ruby"],
  ["package.json", "json"],
  ["pnpm-lock.yaml", "yaml"],
  ["tsconfig.json", "jsonc"],
]);

const fileLanguageByExtension = new Map<string, BundledLanguage>([
  ["astro", "astro"],
  ["bash", "bash"],
  ["c", "c"],
  ["cjs", "javascript"],
  ["clj", "clojure"],
  ["cljs", "clojure"],
  ["cpp", "cpp"],
  ["cs", "csharp"],
  ["css", "css"],
  ["csv", "csv"],
  ["dart", "dart"],
  ["diff", "diff"],
  ["dockerfile", "docker"],
  ["ex", "elixir"],
  ["exs", "elixir"],
  ["go", "go"],
  ["graphql", "graphql"],
  ["h", "c"],
  ["hpp", "cpp"],
  ["html", "html"],
  ["ini", "ini"],
  ["java", "java"],
  ["jl", "julia"],
  ["js", "javascript"],
  ["json", "json"],
  ["jsonc", "jsonc"],
  ["jsx", "jsx"],
  ["kt", "kotlin"],
  ["kts", "kotlin"],
  ["less", "less"],
  ["lua", "lua"],
  ["md", "markdown"],
  ["mdx", "mdx"],
  ["mjs", "javascript"],
  ["php", "php"],
  ["pl", "perl"],
  ["prisma", "prisma"],
  ["py", "python"],
  ["r", "r"],
  ["rb", "ruby"],
  ["rs", "rust"],
  ["sass", "sass"],
  ["scala", "scala"],
  ["scss", "scss"],
  ["sh", "bash"],
  ["sql", "sql"],
  ["svelte", "svelte"],
  ["swift", "swift"],
  ["toml", "toml"],
  ["ts", "typescript"],
  ["tsx", "tsx"],
  ["vue", "vue"],
  ["xml", "xml"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["zig", "zig"],
  ["zsh", "bash"],
]);
