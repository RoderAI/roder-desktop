import type { SkillDescriptor } from "@/types/roder";
import { textWithSkillTokens } from "@/components/skill-token-pill";

type UserMessageContentProps = {
  images?: Array<{ imageUrl: string }>;
  skills: SkillDescriptor[];
  text: string;
};

const emptyImages: Array<{ imageUrl: string }> = [];

export function UserMessageContent({ images = emptyImages, skills, text }: UserMessageContentProps): React.JSX.Element {
  return (
    <div className="space-y-3 font-medium text-base leading-7">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <img
              key={`${image.imageUrl}:${index}`}
              src={image.imageUrl}
              alt="Sketch attachment"
              className="max-h-56 max-w-full rounded-lg border border-border bg-background object-contain"
            />
          ))}
        </div>
      )}
      {text && (
        <div>
          <UserMessageText skills={skills} text={text} />
        </div>
      )}
    </div>
  );
}

function UserMessageText({ skills, text }: { skills: SkillDescriptor[]; text: string }): React.JSX.Element {
  return <>{textWithSkillTokens(text, skills)}</>;
}
