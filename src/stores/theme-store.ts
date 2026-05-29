import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "system" | "light" | "dark";
export type ThemeScheme = "light" | "dark";

export type ThemePalette = {
  presetId: string;
  presetName?: string;
  accent: string;
  background: string;
  foreground: string;
  sidebar: string;
  translucentSidebar: boolean;
  contrast: number;
  uiFont: string;
  codeFont: string;
};

export type ThemeSettings = {
  mode: ThemeMode;
  light: ThemePalette;
  dark: ThemePalette;
  pointerCursors: boolean;
  uiFontSize: number;
  codeFontSize: number;
};

export type SettingsSection =
  | "general"
  | "appearance"
  | "components"
  | "models"
  | "skills"
  | "extensions"
  | "configuration"
  | "personalization"
  | "mcp"
  | "git"
  | "usage";

type ThemeStore = {
  settings: ThemeSettings;
  extensionThemePresets: ThemePreset[];
  setExtensionThemePresets: (presets: ThemePreset[]) => void;
  setMode: (mode: ThemeMode) => void;
  applyPreset: (scheme: ThemeScheme, presetId: string) => void;
  updatePalette: (scheme: ThemeScheme, patch: Partial<ThemePalette>) => void;
  setPointerCursors: (enabled: boolean) => void;
  setUiFontSize: (size: number) => void;
  setCodeFontSize: (size: number) => void;
  resetTheme: () => void;
};

export type ThemePreset = {
  id: string;
  name: string;
  scheme: ThemeScheme;
  palette: ThemePalette;
};

const defaultUiFont = `Geist, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
const defaultCodeFont = `"SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", monospace`;

export const themePresets: ThemePreset[] = [
  {
    id: "roder-light",
    name: "Roder Light",
    scheme: "light",
    palette: {
      presetId: "roder-light",
      accent: "#242424",
      background: "#ffffff",
      foreground: "#242424",
      sidebar: "#fbfbfb",
      translucentSidebar: false,
      contrast: 48,
      uiFont: defaultUiFont,
      codeFont: defaultCodeFont,
    },
  },
  {
    id: "rose-pine-dawn",
    name: "Rose Pine",
    scheme: "light",
    palette: {
      presetId: "rose-pine-dawn",
      accent: "#d7827e",
      background: "#faf4ed",
      foreground: "#575279",
      sidebar: "#f2e9e1",
      translucentSidebar: true,
      contrast: 52,
      uiFont: defaultUiFont,
      codeFont: defaultCodeFont,
    },
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin",
    scheme: "light",
    palette: {
      presetId: "catppuccin-latte",
      accent: "#8839ef",
      background: "#eff1f5",
      foreground: "#4c4f69",
      sidebar: "#e6e9ef",
      translucentSidebar: false,
      contrast: 58,
      uiFont: defaultUiFont,
      codeFont: defaultCodeFont,
    },
  },
  {
    id: "roder-dark",
    name: "Roder Dark",
    scheme: "dark",
    palette: {
      presetId: "roder-dark",
      accent: "#f0f0f0",
      background: "#141414",
      foreground: "#e0e0e0",
      sidebar: "#202020",
      translucentSidebar: false,
      contrast: 42,
      uiFont: defaultUiFont,
      codeFont: defaultCodeFont,
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    scheme: "dark",
    palette: {
      presetId: "dracula",
      accent: "#ff79c6",
      background: "#282a36",
      foreground: "#f8f8f2",
      sidebar: "#21222c",
      translucentSidebar: false,
      contrast: 16,
      uiFont: `ui-monospace, "SF Mono", Consolas, monospace`,
      codeFont: `ui-monospace, "SF Mono", Consolas, monospace`,
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    scheme: "dark",
    palette: {
      presetId: "tokyo-night",
      accent: "#7aa2f7",
      background: "#1a1b26",
      foreground: "#c0caf5",
      sidebar: "#16161e",
      translucentSidebar: true,
      contrast: 36,
      uiFont: defaultUiFont,
      codeFont: defaultCodeFont,
    },
  },
];

export const defaultThemeSettings: ThemeSettings = {
  mode: "system",
  light: themePresets.find((preset) => preset.id === "roder-light")!.palette,
  dark: themePresets.find((preset) => preset.id === "roder-dark")!.palette,
  pointerCursors: false,
  uiFontSize: 18,
  codeFontSize: 13,
};

const themeStorageVersion = 1;

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      settings: defaultThemeSettings,
      extensionThemePresets: [],
      setExtensionThemePresets: (extensionThemePresets) =>
        set((state) => ({
          extensionThemePresets,
          settings: reconcileSelectedPresets(state.settings, extensionThemePresets),
        })),
      setMode: (mode) => set((state) => ({ settings: { ...state.settings, mode } })),
      applyPreset: (scheme, presetId) =>
        set((state) => {
          const preset = [...themePresets, ...state.extensionThemePresets].find(
            (item) => item.id === presetId && item.scheme === scheme,
          );
          if (!preset) {
            return {};
          }
          return { settings: { ...state.settings, [scheme]: paletteFromPreset(preset) } };
        }),
      updatePalette: (scheme, patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            [scheme]: { ...state.settings[scheme], ...patch, presetId: patch.presetId ?? "custom" },
          },
        })),
      setPointerCursors: (pointerCursors) => set((state) => ({ settings: { ...state.settings, pointerCursors } })),
      setUiFontSize: (uiFontSize) => set((state) => ({ settings: { ...state.settings, uiFontSize } })),
      setCodeFontSize: (codeFontSize) => set((state) => ({ settings: { ...state.settings, codeFontSize } })),
      resetTheme: () => set({ settings: defaultThemeSettings }),
    }),
    {
      name: "roder-desktop-theme",
      version: themeStorageVersion,
      migrate: (persisted, version) => migratePersistedTheme(persisted, version),
      partialize: (state) => ({
        settings: state.settings,
      }),
      merge: (persisted, current) => {
        const value = persisted as Partial<ThemeStore> | undefined;
        return {
          ...current,
          settings: mergeThemeSettings(current.settings, value?.settings),
          extensionThemePresets: [],
        };
      },
    },
  ),
);

function migratePersistedTheme(persisted: unknown, version: number): unknown {
  const value = persisted as Partial<ThemeStore> | undefined;
  if (version >= themeStorageVersion || !value?.settings) {
    return persisted;
  }
  return {
    ...value,
    settings: {
      ...value.settings,
      uiFontSize: value.settings.uiFontSize === 14 ? defaultThemeSettings.uiFontSize : value.settings.uiFontSize,
    },
  };
}

function mergeThemeSettings(current: ThemeSettings, persisted: Partial<ThemeSettings> | undefined): ThemeSettings {
  return {
    ...current,
    ...persisted,
    light: mergePalette(current.light, persisted?.light),
    dark: mergePalette(current.dark, persisted?.dark),
  };
}

function mergePalette(current: ThemePalette, persisted: Partial<ThemePalette> | undefined): ThemePalette {
  if (!persisted) {
    return current;
  }
  const preset = themePresets.find((item) => item.id === persisted.presetId);
  if (preset) {
    return paletteFromPreset(preset);
  }
  return normalizeLegacyPalette({ ...current, ...persisted }, current);
}

function reconcileSelectedPresets(settings: ThemeSettings, extensionPresets: ThemePreset[]): ThemeSettings {
  return {
    ...settings,
    light: reconcileSelectedPreset("light", settings.light, extensionPresets),
    dark: reconcileSelectedPreset("dark", settings.dark, extensionPresets),
  };
}

function reconcileSelectedPreset(
  scheme: ThemeScheme,
  palette: ThemePalette,
  extensionPresets: ThemePreset[],
): ThemePalette {
  if (palette.presetId === "custom") {
    return palette;
  }
  const preset = presetsForScheme(scheme, extensionPresets).find((item) => item.id === palette.presetId);
  return preset ? paletteFromPreset(preset) : palette;
}

function paletteFromPreset(preset: ThemePreset): ThemePalette {
  return {
    ...preset.palette,
    presetId: preset.id,
    presetName: preset.name,
  };
}

function normalizeLegacyPalette(palette: ThemePalette, current: ThemePalette): ThemePalette {
  const legacyWhiteTrialValues = new Set(["#fbfbfb", "#f7f7f7", "#f5f5f5"]);
  const normalizedBackground = palette.background.toLowerCase();
  const normalizedSidebar = palette.sidebar.toLowerCase();
  if (current.presetId === "roder-light") {
    return {
      ...palette,
      background: legacyWhiteTrialValues.has(normalizedBackground) ? current.background : palette.background,
      sidebar: normalizedSidebar === "#e8e8e8" ? current.sidebar : palette.sidebar,
    };
  }
  return palette;
}

export function presetsForScheme(scheme: ThemeScheme, extensionPresets: ThemePreset[] = []): ThemePreset[] {
  return [...themePresets, ...extensionPresets].filter((preset) => preset.scheme === scheme);
}

export function selectedPresetLabel(
  scheme: ThemeScheme,
  palette: ThemePalette,
  extensionPresets: ThemePreset[] = [],
): string {
  if (palette.presetId === "custom") {
    return "Custom";
  }
  return (
    presetsForScheme(scheme, extensionPresets).find((preset) => preset.id === palette.presetId)?.name ??
    palette.presetName ??
    palette.presetId
  );
}
