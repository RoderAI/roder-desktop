import { MessageContent } from "./message-content";
import type { SkillDescriptor } from "@/types/roder";

type PhaseMessageProps = {
  isStreaming?: boolean;
  skills?: SkillDescriptor[];
  text: string;
};

type PhaseMessageText = {
  body: string;
  heading?: string;
};

const leadingBoldHeadingPattern = /^\s*\*\*([^*\n]{1,80})\*\*\s*(?:\r?\n+|$)/;

export function PhaseMessage({ isStreaming = false, skills = [], text }: PhaseMessageProps): React.JSX.Element {
  const phaseText = splitPhaseMessageText(text);

  return (
    <div className="text-base leading-[1.62] text-muted-foreground">
      {phaseText.heading && <div className="mb-1 font-semibold text-foreground/80">{phaseText.heading}</div>}
      <MessageContent isStreaming={isStreaming} skills={skills} text={phaseText.body} />
    </div>
  );
}

export function splitPhaseMessageText(text: string): PhaseMessageText {
  const match = leadingBoldHeadingPattern.exec(text);
  if (!match) {
    return { body: text, heading: undefined };
  }

  return {
    body: text.slice(match[0].length),
    heading: match[1].trim(),
  };
}
