import { Boxes } from "lucide-react";
import type { ReactNode } from "react";
import { humanizedSkillName, skillTokenRanges } from "@/lib/roder-skills";
import type { SkillDescriptor } from "@/types/roder";

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const skippedMarkdownTokenParents = new Set(["a", "code", "pre", "script", "style"]);

export function SkillTokenPill({ name }: { name: string }): React.JSX.Element {
  return (
    <span className="skill-prompt-token" data-skill-token={name} title={`$${name}`}>
      <Boxes aria-hidden="true" className="skill-prompt-token-icon" />
      <span className="skill-prompt-token-label">{humanizedSkillName(name)}</span>
    </span>
  );
}

export function renderTextWithSkillTokens(text: string, skills: SkillDescriptor[]): ReactNode[] {
  const ranges = skillTokenRanges(text, skills);
  if (ranges.length === 0) {
    return [text];
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      nodes.push(text.slice(cursor, range.start));
    }
    nodes.push(<SkillTokenPill key={`${range.name}:${range.start}:${index}`} name={range.name} />);
    cursor = range.end;
  });
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
}

export function skillNameFromExactToken(text: string, skills: SkillDescriptor[]): string | null {
  const ranges = skillTokenRanges(text, skills);
  if (ranges.length !== 1) {
    return null;
  }
  const range = ranges[0];
  return range.start === 0 && range.end === text.length ? range.name : null;
}

export function createSkillTokenRehypePlugin(skills: SkillDescriptor[]) {
  return function skillTokenRehypePlugin() {
    return function transform(tree: HastNode): void {
      transformChildren(tree, skills);
    };
  };
}

function transformChildren(parent: HastNode, skills: SkillDescriptor[]): void {
  if (!parent.children || skippedMarkdownTokenParents.has(parent.tagName ?? "")) {
    return;
  }

  const nextChildren: HastNode[] = [];
  for (const child of parent.children) {
    if (child.type === "text" && typeof child.value === "string") {
      nextChildren.push(...textToHastNodes(child.value, skills));
      continue;
    }
    transformChildren(child, skills);
    nextChildren.push(child);
  }
  parent.children = nextChildren;
}

function textToHastNodes(text: string, skills: SkillDescriptor[]): HastNode[] {
  const ranges = skillTokenRanges(text, skills);
  if (ranges.length === 0) {
    return [{ type: "text", value: text }];
  }

  const nodes: HastNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      nodes.push({ type: "text", value: text.slice(cursor, range.start) });
    }
    nodes.push({
      type: "element",
      tagName: "skill-token",
      properties: { name: range.name },
      children: [],
    });
    cursor = range.end;
  }
  if (cursor < text.length) {
    nodes.push({ type: "text", value: text.slice(cursor) });
  }
  return nodes;
}
