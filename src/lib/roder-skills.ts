import type { SkillDescriptor, SkillExposure, SkillSource } from "@/types/roder";

export type SkillCompletionToken = {
  start: number;
  end: number;
  query: string;
};

export type SkillSourceGroup = {
  key: string;
  label: string;
  skills: SkillDescriptor[];
};

export type SkillTokenRange = {
  start: number;
  end: number;
  name: string;
};

type SkillSearchIndex = {
  name: string;
  nameParts: string[];
  shortDescription: string;
  description: string;
  path: string;
  metadata: string;
  searchableText: string;
};

const skillSearchIndexCache = new WeakMap<SkillDescriptor, SkillSearchIndex>();

export function skillSourceGroupLabel(source: SkillSource): string {
  if (typeof source === "string") {
    switch (source) {
      case "builtIn":
        return "Built in";
      case "workspace":
        return "Workspace";
      case "user":
        return "User";
      case "system":
        return "System";
      default:
        return titleize(source);
    }
  }

  if ("pluginId" in source) {
    return `Plugin: ${source.pluginId}`;
  }
  if ("plugin" in source) {
    return `Plugin: ${source.plugin.pluginId}`;
  }

  if ("importId" in source) {
    return `Imported: ${source.importId}`;
  }
  if ("imported" in source) {
    return `Imported: ${source.imported.importId}`;
  }

  return "Other";
}

export function skillExposureLabel(exposure: SkillExposure): string {
  return exposure === "global" ? "Global" : "Direct only";
}

export function skillActivationLabel(skill: SkillDescriptor): string {
  if (skill.activation === "experimental" || skill.experimental) {
    return "Experimental";
  }
  return skill.activation === "disabled" ? "Disabled" : "Enabled";
}

export function humanizedSkillName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(humanizedSkillNamePart)
    .join(" ");
}

export function skillIsEnabled(skill: SkillDescriptor): boolean {
  return skill.activation !== "disabled";
}

export function enabledSkillsForCompletion(skills: SkillDescriptor[]): SkillDescriptor[] {
  return sortSkillsByName(skills.filter(skillIsEnabled));
}

export function filterSkills(skills: SkillDescriptor[], query: string): SkillDescriptor[] {
  const normalizedQuery = normalize(query);
  const sorted = sortSkillsByName(skills);
  if (!normalizedQuery) {
    return sorted;
  }
  return sorted.filter((skill) => searchableSkillText(skill).includes(normalizedQuery));
}

export function matchingSkillCompletions(skills: SkillDescriptor[], query: string, limit?: number): SkillDescriptor[] {
  const normalizedQuery = normalize(query);
  const enabledSkills = enabledSkillsForCompletion(skills);
  const matches = normalizedQuery
    ? enabledSkills
        .map((skill) => ({ skill, rank: skillCompletionMatchRank(skill, normalizedQuery) }))
        .filter((match): match is { skill: SkillDescriptor; rank: number } => match.rank !== null)
        .sort(
          (left, right) =>
            left.rank - right.rank ||
            left.skill.name.localeCompare(right.skill.name, undefined, { sensitivity: "base", numeric: true }),
        )
        .map((match) => match.skill)
    : enabledSkills;

  return typeof limit === "number" ? matches.slice(0, limit) : matches;
}

export function groupSkillsBySource(skills: SkillDescriptor[]): SkillSourceGroup[] {
  const groups = new Map<string, SkillSourceGroup>();
  for (const skill of skills) {
    const label = skillSourceGroupLabel(skill.source);
    const key = `${sourceSortIndex(skill.source)}:${label}`;
    const group = groups.get(key) ?? { key, label, skills: [] };
    group.skills.push(skill);
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => ({ ...group, skills: sortSkillsByName(group.skills) }))
    .sort((left, right) => left.key.localeCompare(right.key, undefined, { numeric: true }));
}

export function skillCompletionToken(text: string, caret: number): SkillCompletionToken | null {
  const end = Math.max(0, Math.min(caret, text.length));
  const beforeCaret = text.slice(0, end);
  const match = beforeCaret.match(/\$([A-Za-z0-9_-]*)$/);
  if (!match || match.index === undefined) {
    return null;
  }

  const start = match.index;
  const query = match[1] ?? "";
  if (start > 0 && !isSkillTokenBoundary(text[start - 1])) {
    return null;
  }
  if (query && /^[A-Z_][A-Z0-9_]*$/.test(query)) {
    return null;
  }

  return { start, end, query };
}

export function replaceSkillToken(
  text: string,
  token: SkillCompletionToken,
  skillName: string,
): { text: string; caret: number } {
  const replacement = `$${skillName}${shouldAppendCompletionSpace(text[token.end]) ? " " : ""}`;
  const nextText = `${text.slice(0, token.start)}${replacement}${text.slice(token.end)}`;
  return {
    text: nextText,
    caret: token.start + replacement.length,
  };
}

function shouldAppendCompletionSpace(nextCharacter: string | undefined): boolean {
  return !nextCharacter || (!/\s/.test(nextCharacter) && !isSkillTokenEndBoundary(nextCharacter));
}

export function skillTokenRanges(text: string, skills: SkillDescriptor[]): SkillTokenRange[] {
  const skillNames = new Set(skills.map((skill) => skill.name));
  if (skillNames.size === 0) {
    return [];
  }

  const ranges: SkillTokenRange[] = [];
  const tokenPattern = /\$([A-Za-z0-9_-]+)/g;
  for (const match of text.matchAll(tokenPattern)) {
    const start = match.index;
    const name = match[1] ?? "";
    if (!skillNames.has(name)) {
      continue;
    }
    if (start > 0 && !isSkillTokenBoundary(text[start - 1])) {
      continue;
    }
    const end = start + match[0].length;
    if (end < text.length && !isSkillTokenEndBoundary(text[end])) {
      continue;
    }
    ranges.push({ start, end, name });
  }
  return ranges;
}

export function deleteSkillTokenAtCaret(
  text: string,
  caret: number,
  direction: "previous" | "next",
  skills: SkillDescriptor[],
): { text: string; caret: number } | null {
  const normalizedCaret = Math.max(0, Math.min(caret, text.length));
  const range = skillTokenRanges(text, skills).find((candidate) =>
    direction === "previous"
      ? isCaretInPreviousDeleteRange(text, normalizedCaret, candidate)
      : isCaretInNextDeleteRange(normalizedCaret, candidate),
  );
  if (!range) {
    return null;
  }

  const deleteEnd = range.end < text.length && /\s/.test(text[range.end]) ? range.end + 1 : range.end;
  return {
    text: `${text.slice(0, range.start)}${text.slice(deleteEnd)}`,
    caret: range.start,
  };
}

function searchableSkillText(skill: SkillDescriptor): string {
  return skillSearchIndex(skill).searchableText;
}

function skillCompletionMatchRank(skill: SkillDescriptor, query: string): number | null {
  const index = skillSearchIndex(skill);
  if (index.name === query) {
    return 0;
  }
  if (isDesignModeQuery(query) && skillIsDesignMode(skill, query)) {
    return 0.25;
  }
  if (index.name.startsWith(query)) {
    return 1;
  }
  if (index.nameParts.some((part) => part.startsWith(query))) {
    return 2;
  }
  if (index.name.includes(query)) {
    return 3;
  }

  if (index.shortDescription.includes(query)) {
    return 4;
  }

  if (index.description.includes(query)) {
    return 5;
  }

  if (index.path.includes(query)) {
    return 6;
  }

  return index.metadata.includes(query) ? 7 : null;
}

function isDesignModeQuery(query: string): boolean {
  return query === "design" || query === "roder" || "roder-design-mode".startsWith(query);
}

function skillIsDesignMode(skill: SkillDescriptor, query: string): boolean {
  if (skill.name === "design") {
    return query === "design";
  }
  if (skill.name === "roder-design-mode") {
    return true;
  }
  return (skill.agentMetadata?.dependencies ?? []).some((dependency) => dependency.startsWith("design_"));
}

function skillSearchIndex(skill: SkillDescriptor): SkillSearchIndex {
  const cached = skillSearchIndexCache.get(skill);
  if (cached) {
    return cached;
  }

  const metadata = normalize(
    [skillSourceGroupLabel(skill.source), skillActivationLabel(skill), skillExposureLabel(skill.exposure)]
      .filter(Boolean)
      .join(" "),
  );
  const index = {
    name: normalize(skill.name),
    nameParts: skillNameParts(skill.name),
    shortDescription: normalize(skill.shortDescription),
    description: normalize(skill.description),
    path: normalize(skill.canonicalPath),
    metadata,
    searchableText: normalize(
      [skill.name, skill.shortDescription, skill.description, skill.canonicalPath, metadata].filter(Boolean).join(" "),
    ),
  };
  skillSearchIndexCache.set(skill, index);
  return index;
}

function skillNameParts(name: string): string[] {
  return name.split(/[-_\s]+/).flatMap((part) => {
    const normalized = normalize(part);
    return normalized ? [normalized] : [];
  });
}

function sortSkillsByName(skills: SkillDescriptor[]): SkillDescriptor[] {
  return skills.toSorted((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }),
  );
}

function sourceSortIndex(source: SkillSource): number {
  if (typeof source === "string") {
    switch (source) {
      case "builtIn":
        return 0;
      case "workspace":
        return 1;
      case "user":
        return 2;
      case "system":
        return 5;
      default:
        return 6;
    }
  }
  if ("pluginId" in source || "plugin" in source) {
    return 3;
  }
  if ("importId" in source || "imported" in source) {
    return 4;
  }
  return 6;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function titleize(value: string): string {
  return value.replace(
    /(^|_|\b)([a-z])/g,
    (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`,
  );
}

function humanizedSkillNamePart(value: string): string {
  const normalized = value.toLowerCase();
  switch (normalized) {
    case "ai":
    case "api":
    case "ci":
    case "cd":
    case "css":
    case "dom":
    case "html":
    case "js":
    case "json":
    case "mcp":
    case "sdk":
    case "tdd":
    case "ts":
    case "ui":
    case "url":
      return normalized.toUpperCase();
    default:
      return `${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1)}`;
  }
}

function isSkillTokenBoundary(character: string): boolean {
  return /\s/.test(character) || "([{,;".includes(character);
}

function isSkillTokenEndBoundary(character: string): boolean {
  return /\s/.test(character) || ")]},;.!?".includes(character);
}

function isCaretInPreviousDeleteRange(text: string, caret: number, range: SkillTokenRange): boolean {
  if (caret > range.start && caret <= range.end) {
    return true;
  }
  return caret === range.end + 1 && range.end < text.length && /\s/.test(text[range.end]);
}

function isCaretInNextDeleteRange(caret: number, range: SkillTokenRange): boolean {
  return caret >= range.start && caret < range.end;
}
