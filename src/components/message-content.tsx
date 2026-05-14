import { cn } from "@/lib/utils";

type MessageContentProps = {
  text: string;
};

export function MessageContent({ text }: MessageContentProps): React.JSX.Element {
  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  return (
    <div className="flex flex-col gap-3 text-[16px] leading-[1.55]">
      {paragraphs.map((paragraph, index) => (
        <Paragraph key={`${paragraph.slice(0, 24)}-${index}`} text={paragraph} />
      ))}
    </div>
  );
}

function Paragraph({ text }: { text: string }): React.JSX.Element {
  const lines = text.split("\n").filter(Boolean);
  const isList = lines.every((line) => line.trim().startsWith("•"));
  if (isList) {
    return (
      <ul className="flex list-disc flex-col gap-2 pl-7">
        {lines.map((line, index) => (
          <li key={`${line}-${index}`} className={cn(line.startsWith("  ") && "ml-6")}>
            <InlineCode text={line.replace(/^\s*•\s?/, "")} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p>
      <InlineCode text={text} />
    </p>
  );
}

function InlineCode({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={`${part}-${index}`} className="rounded-md bg-muted px-1.5 py-0.5 text-[0.94em] text-foreground">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}
