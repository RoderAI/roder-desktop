import { ComposerCompletionPopup, composerCompletionOptionId } from "@/components/composer-completion-popup";
import { commandWarnings } from "@/lib/roder-commands";
import type { CommandDescriptor } from "@/types/roder";

type CommandCompletionPopupProps = {
  visible: boolean;
  listboxId: string;
  commands: CommandDescriptor[];
  highlightedCommandIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (command: CommandDescriptor) => void;
};

export function CommandCompletionPopup({
  visible,
  listboxId,
  commands,
  highlightedCommandIndex,
  onHighlight,
  onSelect,
}: CommandCompletionPopupProps): React.JSX.Element | null {
  return (
    <ComposerCompletionPopup
      visible={visible}
      listboxId={listboxId}
      ariaLabel="Command completions"
      items={commands}
      highlightedIndex={highlightedCommandIndex}
      onHighlight={onHighlight}
      onSelect={onSelect}
      renderItem={({ item }) => <CommandCompletionItem command={item} />}
    />
  );
}

function CommandCompletionItem({ command }: { command: CommandDescriptor }): React.JSX.Element {
  const warnings = commandWarnings(command);
  const detail = command.description;

  return (
    <>
      <span className="min-w-0 flex-1 truncate text-base text-foreground">
        <span className="font-medium">/{command.name}</span>
        {command.argument_hint && <span className="text-muted-foreground"> {command.argument_hint}</span>}
        {detail && <span className="text-muted-foreground"> - {detail}</span>}
      </span>
      <span className="rounded-md border border-border/70 px-1.5 py-0.5 text-base text-muted-foreground">
        {command.source}
      </span>
      {warnings.map((warning) => (
        <span key={warning} className="rounded-md border border-border px-1.5 py-0.5 text-base text-muted-foreground">
          {warning}
        </span>
      ))}
    </>
  );
}

export function commandCompletionOptionId(listboxId: string, index: number): string {
  return composerCompletionOptionId(listboxId, index);
}
