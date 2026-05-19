import { MessageContent } from "./message-content";

type PhaseMessageProps = {
  isStreaming?: boolean;
  text: string;
};

export function PhaseMessage({ isStreaming = false, text }: PhaseMessageProps): React.JSX.Element {
  return (
    <div className="text-[17px] leading-[1.62] text-muted-foreground">
      <MessageContent isStreaming={isStreaming} text={text} />
    </div>
  );
}
