import type { ITheme } from "@xterm/xterm";
import type { TerminalThemeSettings } from "@/stores/theme-store";

export type TerminalThemePreset = {
  id: string;
  name: string;
  theme: ITheme;
};

export const terminalThemePresets: TerminalThemePreset[] = [
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    theme: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      cursor: "#f5e0dc",
      cursorAccent: "#1e1e2e",
      selectionBackground: "#585b70",
      selectionForeground: "#cdd6f4",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#94e2d5",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#f5c2e7",
      brightCyan: "#94e2d5",
      brightWhite: "#a6adc8",
    },
  },
  {
    id: "tokyo-night-storm",
    name: "Tokyo Night Storm",
    theme: {
      background: "#24283b",
      foreground: "#c0caf5",
      cursor: "#c0caf5",
      cursorAccent: "#24283b",
      selectionBackground: "#364a82",
      black: "#1d202f",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  },
  {
    id: "rose-pine-moon",
    name: "Rose Pine Moon",
    theme: {
      background: "#232136",
      foreground: "#e0def4",
      cursor: "#c4a7e7",
      cursorAccent: "#232136",
      selectionBackground: "#44415a",
      black: "#393552",
      red: "#eb6f92",
      green: "#3e8fb0",
      yellow: "#f6c177",
      blue: "#9ccfd8",
      magenta: "#c4a7e7",
      cyan: "#ea9a97",
      white: "#e0def4",
      brightBlack: "#6e6a86",
      brightRed: "#eb6f92",
      brightGreen: "#3e8fb0",
      brightYellow: "#f6c177",
      brightBlue: "#9ccfd8",
      brightMagenta: "#c4a7e7",
      brightCyan: "#ea9a97",
      brightWhite: "#e0def4",
    },
  },
  {
    id: "custom",
    name: "Custom JSON",
    theme: {},
  },
];

export const defaultTerminalTheme = terminalThemePresets[0].theme;

const themeKeys = new Set<keyof ITheme>([
  "foreground",
  "background",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "selectionForeground",
  "selectionInactiveBackground",
  "scrollbarSliderBackground",
  "scrollbarSliderHoverBackground",
  "scrollbarSliderActiveBackground",
  "overviewRulerBorder",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
  "extendedAnsi",
]);

export function terminalThemeForSettings(settings: TerminalThemeSettings): ITheme {
  if (settings.presetId === "custom") {
    const parsed = parseTerminalThemeJson(settings.customJson);
    return parsed.theme ?? defaultTerminalTheme;
  }
  return terminalThemePresets.find((preset) => preset.id === settings.presetId)?.theme ?? defaultTerminalTheme;
}

export function parseTerminalThemeJson(json: string): { theme: ITheme | null; error: string | null } {
  if (!json.trim()) {
    return { theme: null, error: null };
  }

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { theme: null, error: "Theme JSON must be an object." };
    }

    const theme: ITheme = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!themeKeys.has(key as keyof ITheme)) {
        continue;
      }
      if (key === "extendedAnsi") {
        if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
          theme.extendedAnsi = value;
        }
        continue;
      }
      if (typeof value === "string") {
        theme[key as keyof Omit<ITheme, "extendedAnsi">] = value;
      }
    }
    return { theme, error: null };
  } catch (error) {
    return { theme: null, error: (error as Error).message };
  }
}
