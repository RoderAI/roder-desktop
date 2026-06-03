import { ComposerCompletionPopup, composerCompletionOptionId } from "@/components/composer-completion-popup";
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
  return (
    <ComposerCompletionPopup
      visible={visible}
      listboxId={listboxId}
      ariaLabel="Skill completions"
      items={skills}
      highlightedIndex={highlightedSkillIndex}
      onHighlight={onHighlight}
      onSelect={onSelect}
      renderItem={({ item }) => <SkillCompletionItem skill={item} />}
    />
  );
}

type SkillCompletionItemProps = {
  skill: SkillDescriptor;
};

function SkillCompletionItem({ skill }: SkillCompletionItemProps): React.JSX.Element {
  const description = skill.shortDescription || skill.description;
  const label = humanizedSkillName(skill.name);

  return (
    <>
      <span className="min-w-0 flex-1 truncate text-base text-foreground">
        <span className="font-medium">{label}</span>
        {description && <span className="text-muted-foreground"> - {description}</span>}
      </span>
      {skill.experimental && (
        <span className="rounded-md border border-border px-1.5 py-0.5 text-base text-muted-foreground">
          Experimental
        </span>
      )}
    </>
  );
}

export function skillCompletionOptionId(listboxId: string, index: number): string {
  return composerCompletionOptionId(listboxId, index);
}
