import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "system" | "light" | "dark";
export type ThemeScheme = "light" | "dark";

export type ThemePalette = {
  presetId: string;
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

export type SettingsSection = "general" | "appearance" | "models" | "configuration" | "personalization" | "mcp" | "git" | "usage";

type ThemeStore = {
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  settings: ThemeSettings;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  setSettingsSection: (section: SettingsSection) => void;
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

const defaultUiFont = `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
const defaultCodeFont = `"SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", monospace`;

export const themePresets: ThemePreset[] = [
  {
    id: "gode-light",
    name: "Gode Light",
    scheme: "light",
    palette: {
      presetId: "gode-light",
      accent: "#242424",
      background: "#f7f7f7",
      foreground: "#242424",
      sidebar: "#e8e8e8",
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
    id: "gode-dark",
    name: "Gode Dark",
    scheme: "dark",
    palette: {
      presetId: "gode-dark",
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
  light: themePresets.find((preset) => preset.id === "gode-light")!.palette,
  dark: themePresets.find((preset) => preset.id === "gode-dark")!.palette,
  pointerCursors: false,
  uiFontSize: 14,
  codeFontSize: 13,
};

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      settingsOpen: false,
      settingsSection: "appearance",
      settings: defaultThemeSettings,
      openSettings: (section = "appearance") => set({ settingsOpen: true, settingsSection: section }),
      closeSettings: () => set({ settingsOpen: false }),
      setSettingsSection: (settingsSection) => set({ settingsSection }),
      setMode: (mode) => set((state) => ({ settings: { ...state.settings, mode } })),
      applyPreset: (scheme, presetId) => set((state) => {
        const preset = themePresets.find((item) => item.id === presetId && item.scheme === scheme);
        if (!preset) {
          return {};
        }
        return { settings: { ...state.settings, [scheme]: preset.palette } };
      }),
      updatePalette: (scheme, patch) => set((state) => ({
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
      name: "gode-desktop-theme",
      partialize: (state) => ({ settings: state.settings }),
      merge: (persisted, current) => {
        const value = persisted as Partial<ThemeStore> | undefined;
        return {
          ...current,
          settings: {
            ...current.settings,
            ...value?.settings,
            light: { ...current.settings.light, ...value?.settings?.light },
            dark: { ...current.settings.dark, ...value?.settings?.dark },
          },
        };
      },
    },
  ),
);

export function presetsForScheme(scheme: ThemeScheme): ThemePreset[] {
  return themePresets.filter((preset) => preset.scheme === scheme);
}
