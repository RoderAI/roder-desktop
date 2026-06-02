import { AlertCircle, Check, RefreshCcw, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  filterSkills,
  groupSkillsBySource,
  skillActivationLabel,
  skillExposureLabel,
  skillIsEnabled,
  skillSourceGroupLabel,
} from "@/lib/roder-skills";
import { cn } from "@/lib/utils";
import { useSkillsStore } from "@/stores/skills-store";
import type { SkillDescriptor, SkillExposure } from "@/types/roder";

export function SkillsSettingsPanel(): React.JSX.Element {
  const skills = useSkillsStore((state) => state.skills);
  const diagnostics = useSkillsStore((state) => state.diagnostics);
  const loading = useSkillsStore((state) => state.loading);
  const loaded = useSkillsStore((state) => state.loaded);
  const error = useSkillsStore((state) => state.error);
  const load = useSkillsStore((state) => state.load);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void load();
  }, [load]);

  const filteredSkills = useMemo(() => filterSkills(skills, query), [skills, query]);
  const grouped = useMemo(() => groupSkillsBySource(filteredSkills), [filteredSkills]);
  const enabledCount = useMemo(() => skills.filter(skillIsEnabled).length, [skills]);

  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <header className="flex items-start justify-between gap-6 border-b border-border px-5 py-4">
        <div>
          <h1 className="text-base font-medium">Skills</h1>
          <p className="mt-1 text-base text-muted-foreground">
            {loaded ? `${enabledCount} of ${skills.length} enabled for the composer` : "Loading available skills"}
          </p>
        </div>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </header>

      <div className="flex h-12 items-center gap-3 border-b border-border px-5">
        <Search className="size-4 text-muted-foreground" />
        <input
          value={query}
          aria-label="Search skills"
          className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Search skills"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>

      {error && <SkillsBanner tone="error">{error}</SkillsBanner>}
      {diagnostics.length > 0 && (
        <SkillsBanner tone="warning">
          {diagnostics.length === 1 ? diagnostics[0] : `${diagnostics.length} skill diagnostics reported`}
        </SkillsBanner>
      )}

      {loading && !loaded ? (
        <div className="px-5 py-8 text-base text-muted-foreground">Loading skills from the app-server.</div>
      ) : skills.length === 0 ? (
        <div className="px-5 py-8 text-base text-muted-foreground">No skills loaded from the app-server.</div>
      ) : filteredSkills.length === 0 ? (
        <div className="px-5 py-8 text-base text-muted-foreground">No matching skills.</div>
      ) : (
        <div className="divide-y divide-border">
          {grouped.map((group) => (
            <section key={group.key} className="px-5 py-4">
              <h2 className="mb-2 text-base font-medium text-muted-foreground">{group.label}</h2>
              <div className="space-y-1">
                {group.skills.map((skill) => (
                  <SkillSettingsRow key={skill.canonicalPath} skill={skill} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function SkillSettingsRow({ skill }: { skill: SkillDescriptor }): React.JSX.Element {
  const pending = useSkillsStore((state) => Boolean(state.pendingByPath[skill.canonicalPath]));
  const rowError = useSkillsStore((state) => state.errorsByPath?.[skill.canonicalPath] ?? null);
  const setSkillEnabled = useSkillsStore((state) => state.setSkillEnabled);
  const setSkillExposure = useSkillsStore((state) => state.setSkillExposure);
  const enabled = skillIsEnabled(skill);
  const description = skill.shortDescription || skill.description;

  return (
    <div
      className={cn(
        "rounded-lg px-3 py-3 transition-colors",
        enabled ? "text-foreground hover:bg-accent/60" : "text-muted-foreground hover:bg-accent/30",
      )}
      title={skill.canonicalPath}
    >
      <div className="flex items-start gap-3">
        <EnableSwitch
          checked={enabled}
          disabled={pending}
          onChange={(next) => void setSkillEnabled(skill.canonicalPath, next)}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-base font-medium">{skill.name}</span>
            <Badge variant="muted">{skillSourceGroupLabel(skill.source)}</Badge>
            <Badge variant={enabled ? "secondary" : "muted"}>{skillActivationLabel(skill)}</Badge>
            {(skill.experimental || skill.activation === "experimental") && (
              <Badge variant="outline">Experimental</Badge>
            )}
            {skill.diagnostics.length > 0 && <Badge variant="outline">Diagnostics</Badge>}
          </div>
          {description && <div className="mt-1 text-base text-muted-foreground">{description}</div>}
          {skill.diagnostics.length > 0 && (
            <div className="mt-2 space-y-1 text-base text-muted-foreground">
              {skill.diagnostics.map((diagnostic, index) => (
                <div key={`${skill.canonicalPath}:diagnostic:${index}`} className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{diagnostic}</span>
                </div>
              ))}
            </div>
          )}
          {rowError && (
            <div className="mt-2 flex items-start gap-2 text-base text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>{rowError}</span>
            </div>
          )}
        </div>

        <ExposureControl
          value={skill.exposure}
          disabled={pending || !enabled}
          onChange={(exposure) => void setSkillExposure(skill.canonicalPath, exposure)}
        />
      </div>
    </div>
  );
}

function SkillsBanner({ children, tone }: { children: React.ReactNode; tone: "error" | "warning" }): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex items-start gap-2 border-b border-border px-5 py-3 text-base",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function EnableSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        "relative mt-0.5 h-6 w-10 shrink-0 overflow-hidden rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
        disabled && "cursor-not-allowed opacity-50",
      )}
      disabled={disabled}
      aria-pressed={checked}
      aria-label={checked ? "Disable skill" : "Enable skill"}
      onClick={() => onChange(!checked)}
    >
      <span
        className={cn(
          "absolute left-0 top-1 flex size-4 items-center justify-center rounded-full bg-white text-primary transition-transform",
          checked ? "translate-x-5" : "translate-x-1",
        )}
      >
        {checked && <Check className="size-3" />}
      </span>
    </button>
  );
}

function ExposureControl({
  value,
  disabled,
  onChange,
}: {
  value: SkillExposure;
  disabled: boolean;
  onChange: (value: SkillExposure) => void;
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 rounded-lg bg-muted p-1" aria-label={`Skill exposure: ${skillExposureLabel(value)}`}>
      <ExposureButton value="direct_only" current={value} disabled={disabled} onChange={onChange} />
      <ExposureButton value="global" current={value} disabled={disabled} onChange={onChange} />
    </div>
  );
}

function ExposureButton({
  value,
  current,
  disabled,
  onChange,
}: {
  value: SkillExposure;
  current: SkillExposure;
  disabled: boolean;
  onChange: (value: SkillExposure) => void;
}): React.JSX.Element {
  const active = value === current;
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-2 text-base transition-colors",
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        disabled && "cursor-not-allowed opacity-50 hover:text-muted-foreground",
      )}
      disabled={disabled || active}
      onClick={() => onChange(value)}
    >
      {value === "global" && <Sparkles className="size-3.5" />}
      {skillExposureLabel(value)}
    </button>
  );
}
