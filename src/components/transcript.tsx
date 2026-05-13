import type { ConversationMessage } from "@/types/gode";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { MessageContent } from "./message-content";

type TranscriptProps = {
  messages: ConversationMessage[];
};

export function Transcript({ messages }: TranscriptProps): React.JSX.Element {
  return (
    <div className="relative min-h-0 flex-1">
      <ScrollArea className="h-full">
        <main className="mx-auto flex w-full max-w-[980px] flex-col gap-6 px-8 pb-40 pt-2">
          {messages.map((message) => (
            <article
              key={message.id}
              className={cn(
                "text-[#262626]",
                message.role === "user" && "rounded-[14px] bg-card px-4 py-3 text-[16px] shadow-sm ring-1 ring-border",
              )}
            >
              {message.role === "assistant" ? (
                <MessageContent text={message.text || (message.status === "streaming" ? " " : "")} />
              ) : (
                <div className="text-[16px] leading-7">{message.text}</div>
              )}
            </article>
          ))}
        </main>
      </ScrollArea>
      <div className="transcript-fade pointer-events-none absolute inset-x-0 bottom-0 h-28" />
    </div>
  );
}
