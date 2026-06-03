import { useEffect } from "react";
import { extensionsIpc } from "@/lib/extensions-ipc";
import { useExtensionsStore } from "@/stores/extensions-store";
import { defaultThemeSettings, useThemeStore, type ThemePalette, type ThemePreset } from "@/stores/theme-store";
import type { ExtensionTheme } from "@/types/extensions";

export function useExtensionThemes(): void {
  const extensions = useExtensionsStore((state) => state.extensions);
  const loadExtensions = useExtensionsStore((state) => state.load);
  const setExtensionThemePresets = useThemeStore((state) => state.setExtensionThemePresets);

  useEffect(() => {
    void loadExtensions();
  }, [loadExtensions]);

  useEffect(() => {
    let disposed = false;
    const themeContributions = extensions.flatMap((extension) =>
      extension.enabled
        ? extension.manifest.contributes.themes.map((theme) => ({
            extension,
            theme,
          }))
        : [],
    );

    Promise.all(
      themeContributions.map(async ({ extension, theme }) => {
        const extensionTheme = await extensionsIpc.readTheme(extension.id, theme.id);
        return themePresetFromExtensionTheme(extensionTheme);
      }),
    )
      .then((presets) => {
        if (!disposed) {
          setExtensionThemePresets(presets);
        }
      })
      .catch(() => {
        if (!disposed) {
          setExtensionThemePresets([]);
        }
      });

    return () => {
      disposed = true;
    };
  }, [extensions, setExtensionThemePresets]);
}

function themePresetFromExtensionTheme(theme: ExtensionTheme): ThemePreset {
  const name = theme.name === theme.label ? theme.name : `${theme.name} (${theme.label})`;
  const fallback = defaultThemeSettings[theme.scheme];
  return {
    id: `${theme.extensionId}:${theme.id}`,
    name,
    scheme: theme.scheme,
    palette: themePalette(theme, fallback, `${theme.extensionId}:${theme.id}`, name),
  };
}

function themePalette(
  theme: ExtensionTheme,
  fallback: ThemePalette,
  presetId: string,
  presetName: string,
): ThemePalette {
  return {
    presetId,
    presetName,
    accent: theme.colors.accent,
    background: theme.colors.background,
    foreground: theme.colors.foreground,
    sidebar: theme.colors.sidebar,
    translucentSidebar: theme.translucentSidebar ?? fallback.translucentSidebar,
    contrast: theme.contrast ?? fallback.contrast,
    uiFont: theme.uiFont ?? fallback.uiFont,
    codeFont: theme.codeFont ?? fallback.codeFont,
  };
}
