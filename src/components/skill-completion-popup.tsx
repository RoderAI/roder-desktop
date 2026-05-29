import { useCallback } from "react";
import { humanizedSkillName } from "@/lib/roder-skills";
import type { SkillDescriptor } from "@/types/roder";

type SkillCompletionPopupProps = {
  visible: boolean;
  listboxId: string;
  skills: SkillDescriptor[];
  highlightedSkillIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (skill: SkillDescriptor) => void;
};

export function SkillCompletionPopup({
  visible,
  listboxId,
  skills,
  highlightedSkillIndex,
  onHighlight,
  onSelect,
}: SkillCompletionPopupProps): React.JSX.Element | null {
  const scrollActiveOptionIntoView = useCallback((node: HTMLButtonElement | null) => {
    node?.scrollIntoView({ block: "nearest" });
  }, []);

  if (!visible) {
    return null;
  }

  const matchCountLabel = `${skills.length} ${skills.length === 1 ? "match" : "matches"}`;

  return (
    <div
      role="listbox"
      id={listboxId}
      aria-label="Skill completions"
      className="composer-skill-menu absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-3xl bg-white text-popover-foreground shadow-md ring-1 ring-foreground/10"
    >
      <div className="no-scrollbar max-h-72 scroll-py-1 overflow-y-auto overscroll-contain p-1">
        {skills.map((skill, index) => (
          <SkillCompletionItem
            key={skill.canonicalPath}
            optionId={skillCompletionOptionId(listboxId, index)}
            optionRef={index === highlightedSkillIndex ? scrollActiveOptionIntoView : undefined}
            skill={skill}
            index={index}
            active={index === highlightedSkillIndex}
            onHighlight={() => onHighlight(index)}
            onSelect={() => onSelect(skill)}
          />
        ))}
      </div>
      {skills.length > 8 && (
        <div className="border-t border-border/70 px-4 py-2 text-base text-muted-foreground">{matchCountLabel}</div>
      )}
    </div>
  );
}

type SkillCompletionItemProps = {
  optionId: string;
  optionRef?: (node: HTMLButtonElement | null) => void;
  skill: SkillDescriptor;
  index: number;
  active: boolean;
  onHighlight: () => void;
  onSelect: () => void;
};

function SkillCompletionItem({
  optionId,
  optionRef,
  skill,
  index,
  active,
  onHighlight,
  onSelect,
}: SkillCompletionItemProps): React.JSX.Element {
  const description = skill.shortDescription || skill.description;
  const label = humanizedSkillName(skill.name);

  return (
    <button
      ref={optionRef}
      id={optionId}
      type="button"
      role="option"
      aria-selected={active}
      tabIndex={-1}
      data-skill-completion-index={index}
      data-skill-active={active ? "true" : undefined}
      className="relative flex w-full cursor-default items-center gap-2 rounded-[1.25rem] px-3 py-2 text-left outline-hidden select-none data-[skill-active=true]:bg-foreground/8 data-[skill-active=true]:text-foreground"
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onMouseEnter={onHighlight}
      onClick={onSelect}
    >
      <span className="min-w-0 flex-1 truncate text-base text-foreground">
        <span className="font-medium">{label}</span>
        {description && <span className="text-muted-foreground"> - {description}</span>}
      </span>
      {skill.experimental && (
        <span className="rounded-md border border-border px-1.5 py-0.5 text-base text-muted-foreground">
          Experimental
        </span>
      )}
    </button>
  );
}

export function skillCompletionOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}
