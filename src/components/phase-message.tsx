import { MessageContent } from "./message-content";

type PhaseMessageProps = {
  text: string;
};

export function PhaseMessage({ text }: PhaseMessageProps): React.JSX.Element {
  return (
    <div className="text-[17px] leading-[1.62] text-muted-foreground">
      <MessageContent text={text} />
    </div>
  );
}
