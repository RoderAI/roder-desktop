import {
  ArrowLeft,
  Bot,
  Braces,
  Cog,
  Component,
  Database,
  GitBranch,
  Laptop,
  Moon,
  Paintbrush,
  RotateCcw,
  Server,
  Sun,
  UserRound,
} from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ComponentsSettingsPanel } from "@/components/settings-components-panel";
import { ModelsSettingsPanel } from "@/components/settings-models-panel";
import {
  presetsForScheme,
  useThemeStore,
  type SettingsSection,
  type ThemeMode,
  type ThemePalette,
  type ThemeScheme,
} from "@/stores/theme-store";
import { cn } from "@/lib/utils";

export function SettingsView(): React.JSX.Element {
  const closeSettings = useThemeStore((state) => state.closeSettings);
  const settingsSection = useThemeStore((state) => state.settingsSection);
  const setSettingsSection = useThemeStore((state) => state.setSettingsSection);
  const resetTheme = useThemeStore((state) => state.resetTheme);

  return (
    <div className="fixed inset-0 z-[80] flex bg-background text-foreground">
      <aside className="drag-region flex w-[318px] shrink-0 flex-col border-r border-border bg-sidebar px-3 pb-5 pt-[62px] text-sidebar-foreground">
        <button
          type="button"
          className="no-drag mb-8 flex h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-[15px] text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
          onClick={closeSettings}
        >
          <ArrowLeft className="size-4" />
          Back to app
        </button>
        <nav className="no-drag flex flex-col gap-1">
          <SettingsNavItem id="general" active={settingsSection === "general"} icon={<Cog className="size-4" />} label="General" onClick={setSettingsSection} />
          <SettingsNavItem id="appearance" active={settingsSection === "appearance"} icon={<Paintbrush className="size-4" />} label="Appearance" onClick={setSettingsSection} />
          <SettingsNavItem id="components" active={settingsSection === "components"} icon={<Component className="size-4" />} label="Components" onClick={setSettingsSection} />
          <SettingsNavItem id="models" active={settingsSection === "models"} icon={<Bot className="size-4" />} label="Models" onClick={setSettingsSection} />
          <SettingsNavItem id="configuration" active={settingsSection === "configuration"} icon={<Braces className="size-4" />} label="Configuration" onClick={setSettingsSection} />
          <SettingsNavItem id="personalization" active={settingsSection === "personalization"} icon={<UserRound className="size-4" />} label="Personalization" onClick={setSettingsSection} />
          <SettingsNavItem id="mcp" active={settingsSection === "mcp"} icon={<Server className="size-4" />} label="MCP servers" onClick={setSettingsSection} />
          <SettingsNavItem id="git" active={settingsSection === "git"} icon={<GitBranch className="size-4" />} label="Git" onClick={setSettingsSection} />
          <SettingsNavItem id="usage" active={settingsSection === "usage"} icon={<Database className="size-4" />} label="Usage" onClick={setSettingsSection} />
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto px-10 py-12">
        <div className="mx-auto w-full max-w-[860px]">
          {settingsSection === "appearance" ? (
            <AppearancePanel onReset={resetTheme} />
          ) : settingsSection === "components" ? (
            <ComponentsSettingsPanel />
          ) : settingsSection === "models" ? (
            <ModelsSettingsPanel />
          ) : (
            <SettingsPlaceholder section={settingsSection} />
          )}
        </div>
      </main>
    </div>
  );
}

function SettingsNavItem({
  id,
  icon,
  label,
  active,
  onClick,
}: {
  id: SettingsSection;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: (section: SettingsSection) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        "flex h-9 items-center gap-3 rounded-lg px-2 text-left text-[15px]",
        active ? "bg-sidebar-active text-sidebar-active-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent",
      )}
      onClick={() => onClick(id)}
    >
      {icon}
      {label}
    </button>
  );
}

function SettingsPlaceholder({ section }: { section: SettingsSection }): React.JSX.Element {
  const title = sectionLabel(section);
  return (
    <section className="rounded-xl border border-border bg-card px-5 py-5 shadow-sm">
      <h1 className="text-[16px] font-medium">{title}</h1>
      <p className="mt-2 max-w-[560px] text-[14px] text-muted-foreground">
        This section is wired into settings navigation. Controls for {title.toLowerCase()} can be added here without changing the settings shell.
      </p>
    </section>
  );
}

function AppearancePanel({ onReset }: { onReset: () => void }): React.JSX.Element {
  const settings = useThemeStore((state) => state.settings);
  const setMode = useThemeStore((state) => state.setMode);
  const applyPreset = useThemeStore((state) => state.applyPreset);
  const updatePalette = useThemeStore((state) => state.updatePalette);
  const setPointerCursors = useThemeStore((state) => state.setPointerCursors);
  const setUiFontSize = useThemeStore((state) => state.setUiFontSize);
  const setCodeFontSize = useThemeStore((state) => state.setCodeFontSize);
  const themeJson = useMemo(() => JSON.stringify(settings, null, 2), [settings]);

  async function copyTheme(): Promise<void> {
    await navigator.clipboard.writeText(themeJson);
  }

  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <header className="flex items-start justify-between gap-6 border-b border-border px-5 py-4">
        <div>
          <h1 className="text-[16px] font-medium">Theme</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">Use light, dark, or match your system</p>
        </div>
        <div className="flex rounded-xl bg-muted p-1">
          <ModeButton mode="light" active={settings.mode === "light"} onClick={() => setMode("light")} />
          <ModeButton mode="dark" active={settings.mode === "dark"} onClick={() => setMode("dark")} />
          <ModeButton mode="system" active={settings.mode === "system"} onClick={() => setMode("system")} />
        </div>
      </header>

      <ThemePreview light={settings.light} dark={settings.dark} />

      <div className="flex items-center justify-end gap-2 border-y border-border px-5 py-3">
        <Button variant="ghost" size="sm" onClick={() => void copyTheme()}>
          Copy theme
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
      </div>

      <ThemeEditor
        title="Light theme"
        scheme="light"
        palette={settings.light}
        onPreset={(presetId) => applyPreset("light", presetId)}
        onChange={(patch) => updatePalette("light", patch)}
      />
      <ThemeEditor
        title="Dark theme"
        scheme="dark"
        palette={settings.dark}
        onPreset={(presetId) => applyPreset("dark", presetId)}
        onChange={(patch) => updatePalette("dark", patch)}
      />

      <div className="divide-y divide-border border-t border-border px-5">
        <SettingsRow label="Use pointer cursors" description="Change the cursor when hovering over interactive elements">
          <Switch checked={settings.pointerCursors} onChange={setPointerCursors} />
        </SettingsRow>
        <SettingsRow label="UI font size" description="Adjust the base size used for the Roder UI">
          <NumberStepper value={settings.uiFontSize} min={11} max={18} suffix="px" onChange={setUiFontSize} />
        </SettingsRow>
        <SettingsRow label="Code font size" description="Adjust inline code and transcript code text">
          <NumberStepper value={settings.codeFontSize} min={11} max={18} suffix="px" onChange={setCodeFontSize} />
        </SettingsRow>
      </div>
    </section>
  );
}

function ModeButton({ mode, active, onClick }: { mode: ThemeMode; active: boolean; onClick: () => void }): React.JSX.Element {
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Laptop;
  const label = mode === "system" ? "System" : mode[0].toUpperCase() + mode.slice(1);
  return (
    <button
      type="button"
      className={cn("flex h-8 items-center gap-2 rounded-lg px-3 text-[14px] text-muted-foreground", active && "bg-card text-foreground shadow-sm")}
      onClick={onClick}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

function ThemePreview({ light, dark }: { light: ThemePalette; dark: ThemePalette }): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 overflow-hidden border-b border-border font-mono text-[13px]">
      <PreviewPane palette={light} side="left" />
      <PreviewPane palette={dark} side="right" />
    </div>
  );
}

function PreviewPane({ palette, side }: { palette: ThemePalette; side: "left" | "right" }): React.JSX.Element {
  return (
    <div className={cn("px-4 py-3", side === "left" ? "border-r border-border" : "")} style={{ background: palette.background, color: palette.foreground }}>
      <div className="mb-2 text-muted-foreground">const themePreview: ThemeConfig = {"{"}</div>
      <CodeLine index={1} label="surface" value={palette.translucentSidebar ? "sidebar-elevated" : "sidebar"} />
      <CodeLine index={2} label="accent" value={palette.accent} accent={palette.accent} />
      <CodeLine index={3} label="contrast" value={String(palette.contrast)} />
      <div className="text-muted-foreground">{"};"}</div>
    </div>
  );
}

function CodeLine({ index, label, value, accent }: { index: number; label: string; value: string; accent?: string }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[28px_1fr] gap-3">
      <span className="text-right opacity-55">{index}</span>
      <span>
        <span style={{ color: accent ?? "currentColor" }}>{label}</span>: "{value}",
      </span>
    </div>
  );
}

function ThemeEditor({
  title,
  scheme,
  palette,
  onPreset,
  onChange,
}: {
  title: string;
  scheme: ThemeScheme;
  palette: ThemePalette;
  onPreset: (presetId: string) => void;
  onChange: (patch: Partial<ThemePalette>) => void;
}): React.JSX.Element {
  return (
    <section className="border-b border-border px-5 py-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="min-w-0 flex-1 text-[15px] text-muted-foreground">{title}</h2>
        <select
          value={palette.presetId}
          className="h-8 w-[210px] rounded-lg border border-border bg-muted px-3 text-[14px] text-foreground outline-none"
          onChange={(event) => onPreset(event.currentTarget.value)}
        >
          <option value="custom">Custom</option>
          {presetsForScheme(scheme).map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.name}</option>
          ))}
        </select>
      </div>
      <div className="divide-y divide-border">
        <ColorRow label="Accent" value={palette.accent} onChange={(accent) => onChange({ accent })} />
        <ColorRow label="Background" value={palette.background} onChange={(background) => onChange({ background })} />
        <ColorRow label="Foreground" value={palette.foreground} onChange={(foreground) => onChange({ foreground })} />
        <TextRow label="UI font" value={palette.uiFont} onChange={(uiFont) => onChange({ uiFont })} />
        <TextRow label="Code font" value={palette.codeFont} onChange={(codeFont) => onChange({ codeFont })} />
        <SettingsRow label="Translucent sidebar">
          <Switch checked={palette.translucentSidebar} onChange={(translucentSidebar) => onChange({ translucentSidebar })} />
        </SettingsRow>
        <SettingsRow label="Contrast">
          <div className="flex min-w-[260px] items-center gap-4">
            <input
              type="range"
              min={0}
              max={100}
              value={palette.contrast}
              className="min-w-0 flex-1 accent-primary"
              onChange={(event) => onChange({ contrast: Number(event.currentTarget.value) })}
            />
            <span className="w-8 text-right text-[14px] text-muted-foreground">{palette.contrast}</span>
          </div>
        </SettingsRow>
      </div>
    </section>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): React.JSX.Element {
  return (
    <SettingsRow label={label}>
      <label className="flex h-8 w-[174px] items-center gap-2 rounded-lg bg-muted px-2 text-[14px] text-foreground">
        <input type="color" value={value} className="size-5 border-0 bg-transparent p-0" onChange={(event) => onChange(event.currentTarget.value)} />
        <input
          value={value.toUpperCase()}
          className="min-w-0 flex-1 bg-transparent font-mono outline-none"
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (/^#[0-9a-fA-F]{0,6}$/.test(next)) {
              onChange(next);
            }
          }}
        />
      </label>
    </SettingsRow>
  );
}

function TextRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): React.JSX.Element {
  return (
    <SettingsRow label={label}>
      <input
        value={value}
        className="h-8 w-[260px] rounded-lg border border-border bg-transparent px-3 font-mono text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </SettingsRow>
  );
}

function SettingsRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-11 items-center gap-5 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] text-foreground">{label}</div>
        {description && <div className="mt-0.5 text-[13px] text-muted-foreground">{description}</div>}
      </div>
      {children}
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn("relative h-6 w-10 shrink-0 overflow-hidden rounded-full transition-colors", checked ? "bg-primary" : "bg-muted")}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span className={cn("absolute left-0 top-1 size-4 rounded-full bg-white transition-transform", checked ? "translate-x-5" : "translate-x-1")} />
    </button>
  );
}

function NumberStepper({
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        className="h-8 w-20 rounded-lg border border-border bg-transparent px-3 text-right text-[14px] text-foreground outline-none"
        onChange={(event) => onChange(clamp(Number(event.currentTarget.value), min, max))}
      />
      <span className="text-[14px] text-muted-foreground">{suffix}</span>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function sectionLabel(section: SettingsSection): string {
  switch (section) {
    case "mcp":
      return "MCP servers";
    case "git":
      return "Git";
    case "usage":
      return "Usage";
    default:
      return section.slice(0, 1).toUpperCase() + section.slice(1);
  }
}
