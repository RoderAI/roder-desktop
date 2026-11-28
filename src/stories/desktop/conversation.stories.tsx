import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Composer } from "@/components/composer";
import { MarkdownShellProvider } from "@/components/markdown-shell-block";
import { Transcript } from "@/components/transcript";
import type { DesktopAttachment, ModelSelectionMode, QueuedPrompt, ReasoningEffort } from "@/types/roder";
import { messages, models, noop, noopAsync, storybookShellTarget, threads } from "./fixtures";

const meta = { title: "Desktop/Conversation" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function ComposerExample({ busy = false }: { busy?: boolean }) {
  const [selection, setSelection] = useState<ModelSelectionMode & { type: "manual" }>({
    type: "manual",
    model: models[0].id,
    provider: models[0].modelProvider,
  });
  const [reasoning, setReasoning] = useState<ReasoningEffort>("medium");
  const [swarm, setSwarm] = useState(false);
  const [attachments, setAttachments] = useState<DesktopAttachment[]>(
    busy
      ? [{ id: "sample-file", name: "design.md", path: "/storybook/design.md", type: "text/markdown", size: 1024 }]
      : [],
  );
  const [queued, setQueued] = useState<QueuedPrompt[]>([]);
  const [working, setWorking] = useState(busy);
  const [sent, setSent] = useState("");

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Composer
        activeThreadId={threads[0].id}
        busy={working}
        commands={[]}
        models={models}
        routingOptions={[]}
        skills={[]}
        selectedModel={selection.model}
        selectedModelProvider={selection.provider}
        selectedSelectionMode={selection}
        agentSwarmMode={swarm}
        agentSwarmModeAvailable
        selectedReasoning={reasoning}
        attachments={attachments}
        queuedPrompts={queued}
        focusSignal={0}
        showScrollToBottom={false}
        onSelectedModelChange={(model, provider = models[0].modelProvider) =>
          setSelection({ type: "manual", model, provider })
        }
        onSelectedAutoModelChange={noop}
        onAgentSwarmModeChange={setSwarm}
        onSelectedReasoningChange={setReasoning}
        onScrollToBottom={noop}
        onAttachmentsChange={setAttachments}
        onQueuePrompt={(_threadId, prompt, files) => {
          const entry = { id: crypto.randomUUID(), prompt, attachments: files, createdAt: Date.now() };
          setQueued((previous) => [...previous, entry]);
          return entry;
        }}
        onRemoveQueuedPrompt={(_threadId, id) => setQueued((previous) => previous.filter((entry) => entry.id !== id))}
        onCommandSubmit={noopAsync}
        onSend={async (prompt) => setSent(prompt)}
        onSteer={async (prompt) => setSent(prompt)}
        onStop={async () => setWorking(false)}
      />
      {sent && (
        <p className="mt-3 text-muted-foreground" role="status">
          Sent to the story fixture: {sent}
        </p>
      )}
    </div>
  );
}

export const PromptComposer: Story = { render: () => <ComposerExample /> };
export const BusyComposer: Story = { render: () => <ComposerExample busy /> };

export const ThreadTranscript: Story = {
  render: () => (
    <div className="mx-auto h-[32rem] max-w-4xl overflow-hidden rounded-xl border border-border">
      <MarkdownShellProvider target={storybookShellTarget}>
        <Transcript messages={messages} followSignal={0} scrollStateKey="storybook-transcript" />
      </MarkdownShellProvider>
    </div>
  ),
};

export const WaitingForReply: Story = {
  render: () => (
    <div className="mx-auto h-72 max-w-4xl overflow-hidden rounded-xl border border-border">
      <Transcript
        messages={messages.slice(0, 2)}
        activeTurnId="sample-turn"
        showWorkingIndicator
        followSignal={0}
        scrollStateKey="storybook-waiting"
      />
    </div>
  ),
};
