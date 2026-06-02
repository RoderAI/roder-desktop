import { useEffect } from "react";
import { useThemeStore, type ThemePalette, type ThemeScheme } from "@/stores/theme-store";
import type { SystemAppearance } from "@/types/roder";

export function useThemeApplication(systemAppearance: SystemAppearance): void {
  const settings = useThemeStore((state) => state.settings);

  useEffect(() => {
    const scheme: ThemeScheme = settings.mode === "system" ? systemAppearance : settings.mode;
    const palette = settings[scheme];
    const root = document.documentElement;
    const variables = themeVariables(palette, scheme, settings.uiFontSize, settings.codeFontSize);

    root.classList.toggle("dark", scheme === "dark");
    root.classList.toggle("light", scheme === "light");
    root.classList.toggle("pointer-cursors", settings.pointerCursors);
    root.style.colorScheme = scheme;
    for (const [key, value] of Object.entries(variables)) {
      root.style.setProperty(key, value);
    }
  }, [settings, systemAppearance]);
}

export function themeVariables(
  palette: ThemePalette,
  scheme: ThemeScheme,
  uiFontSize: number,
  codeFontSize: number,
): Record<string, string> {
  const contrast = clamp(palette.contrast, 0, 100);
  const isDark = scheme === "dark";
  const bg = palette.background;
  const fg = palette.foreground;
  const accent = palette.accent;
  const sidebar = palette.sidebar;
  const card = mix(bg, isDark ? "#ffffff" : "#000000", isDark ? 6 : 2);
  const muted = mix(bg, fg, isDark ? 16 + contrast * 0.08 : 10 + contrast * 0.08);
  const border = mix(bg, fg, isDark ? 20 + contrast * 0.12 : 6 + contrast * 0.04);
  const activeSidebar = mix(sidebar, fg, isDark ? 12 + contrast * 0.12 : 10 + contrast * 0.12);
  const sidebarAlpha = palette.translucentSidebar ? " / 0.82" : "";

  return {
    "--color-background": bg,
    "--color-foreground": fg,
    "--color-card": card,
    "--color-card-foreground": fg,
    "--color-popover": mix(bg, isDark ? "#ffffff" : "#000000", isDark ? 9 : 3),
    "--color-popover-foreground": fg,
    "--color-primary": accent,
    "--color-primary-foreground": readableOn(accent),
    "--color-secondary": muted,
    "--color-secondary-foreground": fg,
    "--color-muted": muted,
    "--color-muted-foreground": mix(fg, bg, isDark ? 36 : 34),
    "--color-accent": mix(bg, accent, isDark ? 20 + contrast * 0.12 : 6 + contrast * 0.04),
    "--color-accent-foreground": fg,
    "--color-destructive": "#ef4444",
    "--color-destructive-foreground": "#fafafa",
    "--color-border": border,
    "--color-input": mix(border, fg, 12),
    "--color-ring": accent,
    "--color-sidebar": `${sidebar}${sidebarAlpha}`,
    "--color-sidebar-foreground": mix(fg, sidebar, 18),
    "--color-sidebar-heading": mix(fg, sidebar, 42),
    "--color-sidebar-muted": mix(fg, sidebar, 50),
    "--color-sidebar-accent": mix(sidebar, fg, isDark ? 9 + contrast * 0.08 : 8 + contrast * 0.08),
    "--color-sidebar-active": activeSidebar,
    "--color-sidebar-active-foreground": fg,
    "--color-sidebar-dot": mix(fg, sidebar, 58),
    "--font-ui": palette.uiFont,
    "--font-code": palette.codeFont,
    "--font-size-ui": `${clamp(uiFontSize, 11, 24)}px`,
    "--font-size-composer": `${clamp(uiFontSize + 3, 14, 27)}px`,
    "--font-size-code": `${clamp(codeFontSize, 11, 18)}px`,
  };
}

function readableOn(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return "#ffffff";
  }
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.56 ? "#151515" : "#ffffff";
}

function mix(left: string, right: string, weight: number): string {
  const a = hexToRgb(left);
  const b = hexToRgb(right);
  if (!a || !b) {
    return left;
  }
  const amount = clamp(weight, 0, 100) / 100;
  return rgbToHex({
    r: Math.round(a.r * (1 - amount) + b.r * amount),
    g: Math.round(a.g * (1 - amount) + b.g * amount),
    b: Math.round(a.b * (1 - amount) + b.b * amount),
  });
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const value = hex.replace("#", "").trim();
  const normalized =
    value.length === 3
      ? value
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  return `#${[rgb.r, rgb.g, rgb.b].map((value) => clamp(value, 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
