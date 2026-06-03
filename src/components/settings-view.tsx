import {
  ArrowLeft,
  Bot,
  Braces,
  Cog,
  Component,
  Database,
  GitBranch,
  Laptop,
  Monitor,
  Moon,
  Paintbrush,
  Puzzle,
  RotateCcw,
  Server,
  Sparkles,
  Sun,
  TerminalSquare,
  UserRound,
} from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ExtensionsSettingsPanel } from "@/components/extensions/extensions-settings-panel";
import { ComponentsSettingsPanel } from "@/components/settings-components-panel";
import { SettingsBrowserPanel } from "@/components/settings-browser-panel";
import { GeneralSettingsPanel } from "@/components/settings-general-panel";
import { ModelsSettingsPanel } from "@/components/settings-models-panel";
import { SkillsSettingsPanel } from "@/components/settings-skills-panel";
import { parseTerminalThemeJson, terminalThemeForSettings, terminalThemePresets } from "@/lib/terminal-theme";
import {
  presetsForScheme,
  selectedPresetLabel,
  useThemeStore,
  type SettingsSection,
  type ThemeMode,
  type ThemePalette,
  type ThemePreset,
  type ThemeScheme,
} from "@/stores/theme-store";
import { cn } from "@/lib/utils";

export function SettingsView({
  section,
  onClose,
  onSectionChange,
}: {
  section: SettingsSection;
  onClose: () => void;
  onSectionChange: (section: SettingsSection) => void;
}): React.JSX.Element {
  const resetTheme = useThemeStore((state) => state.resetTheme);

  return (
    <div className="fixed inset-0 z-[80] flex bg-background text-foreground">
      <aside className="drag-region flex w-[318px] shrink-0 flex-col border-r border-border bg-sidebar px-3 pb-5 pt-[62px] text-sidebar-foreground">
        <button
          type="button"
          className="squircle-corners no-drag mb-8 flex h-9 w-full items-center gap-3 rounded-xl px-2 text-left text-base text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
          onClick={onClose}
        >
          <ArrowLeft className="size-4" />
          Back to app
        </button>
        <nav className="no-drag flex flex-col gap-1">
          <SettingsNavItem
            id="general"
            active={section === "general"}
            icon={<Cog className="size-4" />}
            label="General"
            onClick={onSectionChange}
          />
          <SettingsNavItem
            id="appearance"
            active={section === "appearance"}
            icon={<Paintbrush className="size-4" />}
            label="Appearance"
            onClick={onSectionChange}
          />
          <SettingsNavItem
            id="components"
            active={section === "components"}
            icon={<Component className="size-4" />}
            label="Components"
            onClick={onSectionChange}
          />
          <SettingsNavItem
            id="models"
            active={section === "models"}
            icon={<Bot className="size-4" />}
            label="Models"
            onClick={onSectionChange}
          />
          <SettingsNavItem
            id="skills"
            active={section === "skills"}
            icon={<Sparkles className="size-4" />}
            label="Skills"
            onClick={onSectionChange}
          />
          <SettingsNavItem
            id="extensions"
            active={section === "extensions"}
            icon={<Puzzle className="size-4" />}
            label="Extensions"
            onClick={onSectionChange}
          />
          <SettingsNavItem
            id="browser"
            active={section === "browser"}
            icon={<Monitor className="size-4" />}
            label="Browser"
            onClick={onSectionChange}
          />
          <SettingsNavItem
            id="terminal"
            active={section === "terminal"}
            icon={<TerminalSquare className="size-4" />}
            label="Terminal"
            onClick={onSectionChange}
          />
          <SettingsNavItem
            id="configuration"
            active={section === "configuration"}
            icon={<Braces className="size-4" />}
            label="Configuration"
            onClick={onSectionChange}
          />
          <SettingsNavItem
            id="personalization"
            active={section === "personalization"}
            icon={<UserRound className="size-4" />}
            label="Personalization"
            onClick={onSectionChange}
          />
          <SettingsNavItem
            id="mcp"
            active={section === "mcp"}
            icon={<Server className="size-4" />}
            label="MCP servers"
            onClick={onSectionChange}
          />
          <SettingsNavItem
            id="git"
            active={section === "git"}
            icon={<GitBranch className="size-4" />}
            label="Git"
            onClick={onSectionChange}
          />
          <SettingsNavItem
            id="usage"
            active={section === "usage"}
            icon={<Database className="size-4" />}
            label="Usage"
            onClick={onSectionChange}
          />
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto px-10 py-12">
        <div className="mx-auto w-full max-w-[860px]">
          {section === "general" ? (
            <GeneralSettingsPanel />
          ) : section === "appearance" ? (
            <AppearancePanel onReset={resetTheme} />
          ) : section === "components" ? (
            <ComponentsSettingsPanel />
          ) : section === "models" ? (
            <ModelsSettingsPanel />
          ) : section === "skills" ? (
            <SkillsSettingsPanel />
          ) : section === "extensions" ? (
            <ExtensionsSettingsPanel />
          ) : section === "browser" ? (
            <SettingsBrowserPanel />
          ) : section === "terminal" ? (
            <TerminalSettingsPanel />
          ) : (
            <SettingsPlaceholder section={section} />
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
        "squircle-corners flex h-9 items-center gap-3 rounded-xl px-2 text-left text-base",
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
    <section className="rounded-xl bg-card p-5 shadow-sm ring-1 ring-border/70">
      <h1 className="text-base font-medium">{title}</h1>
      <p className="mt-2 max-w-[560px] text-base text-muted-foreground">
        This section is wired into settings navigation. Controls for {title.toLowerCase()} can be added here without
        changing the settings shell.
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
  const extensionThemePresets = useThemeStore((state) => state.extensionThemePresets);
  const themeJson = useMemo(() => JSON.stringify(settings, null, 2), [settings]);

  async function copyTheme(): Promise<void> {
    await navigator.clipboard.writeText(themeJson);
  }

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-border/70">
      <header className="flex items-start justify-between gap-6 border-b border-border px-5 py-4">
        <div>
          <h1 className="text-base font-medium">Theme</h1>
          <p className="mt-1 text-base text-muted-foreground">Use light, dark, or match your system</p>
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
        extensionThemePresets={extensionThemePresets}
        onPreset={(presetId) => applyPreset("light", presetId)}
        onChange={(patch) => updatePalette("light", patch)}
      />
      <ThemeEditor
        title="Dark theme"
        scheme="dark"
        palette={settings.dark}
        extensionThemePresets={extensionThemePresets}
        onPreset={(presetId) => applyPreset("dark", presetId)}
        onChange={(patch) => updatePalette("dark", patch)}
      />

      <div className="divide-y divide-border border-t border-border px-5">
        <SettingsRow
          label="Use pointer cursors"
          description="Change the cursor when hovering over interactive elements"
        >
          <Switch ariaLabel="Use pointer cursors" checked={settings.pointerCursors} onChange={setPointerCursors} />
        </SettingsRow>
        <SettingsRow label="UI font size" description="Adjust the base size used for the Roder UI">
          <NumberStepper
            ariaLabel="UI font size"
            value={settings.uiFontSize}
            min={11}
            max={24}
            suffix="px"
            onChange={setUiFontSize}
          />
        </SettingsRow>
        <SettingsRow label="Code font size" description="Adjust inline, transcript, and diff code text">
          <NumberStepper
            ariaLabel="Code font size"
            value={settings.codeFontSize}
            min={11}
            max={18}
            suffix="px"
            onChange={setCodeFontSize}
          />
        </SettingsRow>
      </div>
    </section>
  );
}

function ModeButton({
  mode,
  active,
  onClick,
}: {
  mode: ThemeMode;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Laptop;
  const label = mode === "system" ? "System" : mode[0].toUpperCase() + mode.slice(1);
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 items-center gap-2 rounded-lg px-3 text-base text-muted-foreground",
        active && "bg-card text-foreground shadow-sm",
      )}
      onClick={onClick}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

function ThemePreview({ light, dark }: { light: ThemePalette; dark: ThemePalette }): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 overflow-hidden border-b border-border font-mono text-base">
      <PreviewPane palette={light} side="left" />
      <PreviewPane palette={dark} side="right" />
    </div>
  );
}

function PreviewPane({ palette, side }: { palette: ThemePalette; side: "left" | "right" }): React.JSX.Element {
  return (
    <div
      className={cn("px-4 py-3", side === "left" ? "border-r border-border" : "")}
      style={{ background: palette.background, color: palette.foreground }}
    >
      <div className="mb-2 text-muted-foreground">const themePreview: ThemeConfig = {"{"}</div>
      <CodeLine index={1} label="surface" value={palette.translucentSidebar ? "sidebar-elevated" : "sidebar"} />
      <CodeLine index={2} label="accent" value={palette.accent} accent={palette.accent} />
      <CodeLine index={3} label="contrast" value={String(palette.contrast)} />
      <div className="text-muted-foreground">{"};"}</div>
    </div>
  );
}

function CodeLine({
  index,
  label,
  value,
  accent,
}: {
  index: number;
  label: string;
  value: string;
  accent?: string;
}): React.JSX.Element {
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
  extensionThemePresets,
  onPreset,
  onChange,
}: {
  title: string;
  scheme: ThemeScheme;
  palette: ThemePalette;
  extensionThemePresets: ThemePreset[];
  onPreset: (presetId: string) => void;
  onChange: (patch: Partial<ThemePalette>) => void;
}): React.JSX.Element {
  const presets = presetsForScheme(scheme, extensionThemePresets);
  const hasSelectedPreset = palette.presetId === "custom" || presets.some((preset) => preset.id === palette.presetId);
  const selectedLabel = selectedPresetLabel(scheme, palette, extensionThemePresets);
  return (
    <section className="border-b border-border px-5 py-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="min-w-0 flex-1 text-base text-muted-foreground">{title}</h2>
        <select
          value={palette.presetId}
          aria-label={`${title} preset`}
          className="h-8 w-[210px] rounded-lg border border-border bg-muted px-3 text-base text-foreground outline-none"
          onChange={(event) => onPreset(event.currentTarget.value)}
        >
          <option value="custom">Custom</option>
          {!hasSelectedPreset && <option value={palette.presetId}>{selectedLabel}</option>}
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
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
          <Switch
            ariaLabel={`${title} translucent sidebar`}
            checked={palette.translucentSidebar}
            onChange={(translucentSidebar) => onChange({ translucentSidebar })}
          />
        </SettingsRow>
        <SettingsRow label="Contrast">
          <div className="flex min-w-[260px] items-center gap-4">
            <input
              type="range"
              min={0}
              max={100}
              value={palette.contrast}
              aria-label={`${title} contrast`}
              className="min-w-0 flex-1 accent-primary"
              onChange={(event) => onChange({ contrast: Number(event.currentTarget.value) })}
            />
            <span className="w-8 text-right text-base text-muted-foreground">{palette.contrast}</span>
          </div>
        </SettingsRow>
      </div>
    </section>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <SettingsRow label={label}>
      <div className="flex h-8 w-[174px] items-center gap-2 rounded-lg bg-muted px-2 text-base text-foreground">
        <input
          aria-label={`${label} color`}
          type="color"
          value={value}
          className="size-5 border-0 bg-transparent p-0"
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <input
          aria-label={`${label} hex value`}
          value={value.toUpperCase()}
          className="min-w-0 flex-1 bg-transparent font-mono outline-none"
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (/^#[0-9a-fA-F]{0,6}$/.test(next)) {
              onChange(next);
            }
          }}
        />
      </div>
    </SettingsRow>
  );
}

function TextRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <SettingsRow label={label}>
      <input
        aria-label={label}
        value={value}
        className="h-8 w-[260px] rounded-lg border border-border bg-transparent px-3 font-mono text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </SettingsRow>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-h-11 items-center gap-5 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-base text-foreground">{label}</div>
        {description && <div className="mt-0.5 text-base text-muted-foreground">{description}</div>}
      </div>
      {children}
    </div>
  );
}

function Switch({
  ariaLabel,
  checked,
  onChange,
}: {
  ariaLabel: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={cn(
        "relative h-6 w-10 shrink-0 overflow-hidden rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
      )}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span
        className={cn(
          "absolute left-0 top-1 size-4 rounded-full bg-white transition-transform",
          checked ? "translate-x-5" : "translate-x-1",
        )}
      />
    </button>
  );
}

function TerminalSettingsPanel(): React.JSX.Element {
  const terminalTheme = useThemeStore((state) => state.settings.terminalTheme);
  const setTerminalThemePreset = useThemeStore((state) => state.setTerminalThemePreset);
  const setTerminalThemeCustomJson = useThemeStore((state) => state.setTerminalThemeCustomJson);
  const effectiveTheme = terminalThemeForSettings(terminalTheme);
  const customParseResult = parseTerminalThemeJson(terminalTheme.customJson);

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-border/70">
      <header className="border-b border-border px-5 py-4">
        <h1 className="text-base font-medium">Terminal</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Choose a truecolour xterm theme or paste custom xterm.js theme JSON.
        </p>
      </header>

      <TerminalThemePreview theme={effectiveTheme} />

      <div className="divide-y divide-border border-t border-border px-5">
        <SettingsRow label="Theme" description="Applies to the embedded workspace terminal">
          <Select
            items={Object.fromEntries(terminalThemePresets.map((preset) => [preset.id, preset.name]))}
            value={terminalTheme.presetId}
            onValueChange={(value) => setTerminalThemePreset(value ?? "catppuccin-mocha")}
          >
            <SelectTrigger className="w-[240px] border border-border bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {terminalThemePresets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>

        {terminalTheme.presetId === "custom" && (
          <div className="py-4">
            <div className="mb-2 flex items-baseline justify-between gap-4">
              <div>
                <div className="text-base text-foreground">Custom theme JSON</div>
                <div className="mt-0.5 text-base text-muted-foreground">
                  Supports xterm.js ITheme keys, including the 16 ANSI colours and extendedAnsi.
                </div>
              </div>
              {customParseResult.error && <div className="text-base text-destructive">{customParseResult.error}</div>}
            </div>
            <Textarea
              value={terminalTheme.customJson}
              spellCheck={false}
              className="min-h-72 resize-y font-[var(--font-code)] text-[var(--font-size-code)]"
              placeholder={JSON.stringify(effectiveTheme, null, 2)}
              onChange={(event) => setTerminalThemeCustomJson(event.currentTarget.value)}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function TerminalThemePreview({ theme }: { theme: ReturnType<typeof terminalThemeForSettings> }): React.JSX.Element {
  return (
    <div className="p-5" style={{ background: theme.background, color: theme.foreground }}>
      <div className="rounded-lg bg-black/10 p-4 font-mono text-sm shadow-inner ring-1 ring-white/10">
        <div className="mb-3 flex items-center gap-2 text-xs opacity-75">
          <span className="size-2 rounded-full" style={{ background: theme.red }} />
          <span className="size-2 rounded-full" style={{ background: theme.yellow }} />
          <span className="size-2 rounded-full" style={{ background: theme.green }} />
          <span className="ml-2">roder: truecolour terminal</span>
        </div>
        <div>
          <span style={{ color: theme.green }}>$</span> pnpm test
        </div>
        <div>
          <span style={{ color: theme.blue }}>✓</span> 232 tests passed{" "}
          <span style={{ color: theme.brightBlack }}>in 1.45s</span>
        </div>
        <div className="mt-3 grid grid-cols-8 gap-1">
          {[
            theme.black,
            theme.red,
            theme.green,
            theme.yellow,
            theme.blue,
            theme.magenta,
            theme.cyan,
            theme.white,
            theme.brightBlack,
            theme.brightRed,
            theme.brightGreen,
            theme.brightYellow,
            theme.brightBlue,
            theme.brightMagenta,
            theme.brightCyan,
            theme.brightWhite,
          ].map((color, index) => (
            <span key={`${color}-${index}`} className="h-5 rounded" style={{ background: color }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function NumberStepper({
  ariaLabel,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  ariaLabel: string;
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
        aria-label={ariaLabel}
        className="h-8 w-20 rounded-lg border border-border bg-transparent px-3 text-right text-base text-foreground outline-none"
        onChange={(event) => onChange(clamp(Number(event.currentTarget.value), min, max))}
      />
      <span className="text-base text-muted-foreground">{suffix}</span>
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
