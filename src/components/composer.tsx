import { ArrowDown, ArrowUp, Loader2, Mic, Plus, Square } from "lucide-react";
import { useCallback, useRef, useState, type CSSProperties } from "react";
import type { DesktopAttachment, PolicyMode, RoderModel, ReasoningEffort } from "@/types/roder";
import { Button } from "@/components/ui/button";
import { AttachmentChip, ModelPicker, PolicyModePicker } from "@/components/composer-controls";
import { Textarea } from "@/components/ui/textarea";
import { useSpeechTranscription } from "@/hooks/use-speech-transcription";
import { cn } from "@/lib/utils";

/*
 * SCROLL BUTTON ANIMATION STORYBOARD
 *
 * Read top-to-bottom. Values are relative to scroll availability changing.
 *
 *   0ms   button mounts or begins exit with opacity 0 <-> 1
 * 120ms   button fade reaches its target opacity
 */
const SCROLL_BUTTON_TIMING = {
  fade: 120, // button opacity transition
};

type ComposerScrollButtonStyle = CSSProperties & {
  "--composer-scroll-button-fade-duration": string;
};

const scrollButtonAnimationStyle: ComposerScrollButtonStyle = {
  "--composer-scroll-button-fade-duration": `${SCROLL_BUTTON_TIMING.fade}ms`,
};

type ComposerProps = {
  busy: boolean;
  models: RoderModel[];
  selectedModel: string;
  selectedPolicyMode: PolicyMode;
  selectedReasoning: ReasoningEffort;
  attachments: DesktopAttachment[];
  focusSignal: number;
  showScrollToBottom: boolean;
  onSelectedModelChange: (model: string) => void;
  onSelectedPolicyModeChange: (mode: PolicyMode) => void;
  onSelectedReasoningChange: (reasoning: ReasoningEffort) => void;
  onScrollToBottom: () => void;
  onAttachmentsChange: (attachments: DesktopAttachment[]) => void;
  onSend: (prompt: string, attachments: DesktopAttachment[]) => Promise<void>;
  onStop: () => Promise<void>;
};

export function Composer({
  busy,
  models,
  selectedModel,
  selectedPolicyMode,
  selectedReasoning,
  attachments,
  focusSignal,
  showScrollToBottom,
  onSelectedModelChange,
  onSelectedPolicyModeChange,
  onSelectedReasoningChange,
  onScrollToBottom,
  onAttachmentsChange,
  onSend,
  onStop,
}: ComposerProps): React.JSX.Element {
  const [prompt, setPrompt] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const focusedSignalRef = useRef(0);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  const scheduleTextareaResize = useCallback(() => {
    requestAnimationFrame(resizeTextarea);
  }, [resizeTextarea]);

  const setTextareaNode = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
      if (!node) {
        return;
      }
      resizeTextarea();
      if (focusSignal > 0 && focusedSignalRef.current !== focusSignal) {
        focusedSignalRef.current = focusSignal;
        node.focus();
      }
    },
    [focusSignal, resizeTextarea],
  );

  const appendTranscribedText = useCallback(
    (text: string) => {
      setPrompt((previous) => {
        const trimmed = previous.trim();
        return trimmed ? `${trimmed} ${text}` : text;
      });
      scheduleTextareaResize();
    },
    [scheduleTextareaResize],
  );
  const {
    isRecording,
    isTranscribing,
    recordingError,
    clearRecordingError,
    lifecycleRef: speechLifecycleRef,
    toggleRecording,
  } = useSpeechTranscription({ onTranscriptionText: appendTranscribedText });
  const canSubmit = prompt.trim().length > 0 || attachments.length > 0;

  async function submit(): Promise<void> {
    const value = prompt.trim();
    if (!value && attachments.length === 0) {
      return;
    }
    const submittedAttachments = attachments;
    setPrompt("");
    scheduleTextareaResize();
    onAttachmentsChange([]);
    await onSend(value, submittedAttachments);
  }

  function addAttachments(nextAttachments: DesktopAttachment[]): void {
    const seen = new Set(attachments.map((attachment) => attachment.path));
    onAttachmentsChange([
      ...attachments,
      ...nextAttachments
        .filter((attachment) => attachment.path && !seen.has(attachment.path))
        .map((attachment) => ({
          ...attachment,
          id: attachment.id || crypto.randomUUID(),
        })),
    ]);
  }

  function removeAttachment(id: string): void {
    onAttachmentsChange(attachments.filter((attachment) => attachment.id !== id));
  }

  function attachFiles(files: FileList | File[]): void {
    const resolved = window.roderDesktop
      .resolveDroppedFiles(Array.from(files))
      .map((file) => ({ ...file, id: crypto.randomUUID() }));
    addAttachments(resolved);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files.length > 0) {
      attachFiles(event.dataTransfer.files);
    }
  }

  return (
    <div
      ref={speechLifecycleRef}
      className="mx-auto w-full max-w-[980px] px-8 pb-5 pt-2"
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          setDragActive(true);
        }
      }}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          setDragActive(false);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
        }
      }}
      onDrop={handleDrop}
    >
      <div
        className={cn(
          "relative mt-3 rounded-3xl border border-border bg-card/95 shadow-sm backdrop-blur-md transition-[background-color,border-color,box-shadow]",
          dragActive && "border-ring bg-card shadow-md ring-2 ring-ring/25",
        )}
      >
        <ScrollToBottomButton visible={showScrollToBottom} onClick={onScrollToBottom} />
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
            {attachments.map((attachment) => (
              <AttachmentChip
                key={attachment.id}
                attachment={attachment}
                onRemove={() => removeAttachment(attachment.id)}
              />
            ))}
          </div>
        )}
        <div className="px-3 py-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.currentTarget.files) {
                attachFiles(event.currentTarget.files);
              }
              event.currentTarget.value = "";
            }}
          />
          <Textarea
            ref={setTextareaNode}
            value={prompt}
            placeholder={busy ? "Queue a follow-up or steer the current run" : "Send follow-up"}
            className="min-h-16 overflow-hidden border-0 bg-transparent px-1 py-2 text-[var(--font-size-composer)] leading-6 shadow-none focus-visible:border-transparent focus-visible:ring-0"
            onChange={(event) => {
              setPrompt(event.target.value);
              resizeTextarea();
              if (recordingError) {
                clearRecordingError();
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          {recordingError && <div className="text-sm text-destructive px-1 pb-2">{recordingError}</div>}
          <div className="mt-1 flex min-h-10 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 rounded-full text-muted-foreground"
                aria-label="Attach files"
                onClick={() => fileInputRef.current?.click()}
              >
                <Plus className="size-5" />
              </Button>
              <PolicyModePicker selectedMode={selectedPolicyMode} onChange={onSelectedPolicyModeChange} />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "size-9 shrink-0 rounded-full",
                  isRecording
                    ? "bg-destructive/10 text-destructive animate-pulse hover:bg-destructive/20 hover:text-destructive"
                    : "text-muted-foreground",
                )}
                aria-label={isRecording ? "Stop recording" : "Record voice prompt"}
                onClick={toggleRecording}
                disabled={isTranscribing}
              >
                {isTranscribing ? <Loader2 className="size-5 animate-spin" /> : <Mic className="size-5" />}
              </Button>
              <ModelPicker
                models={models}
                selectedModel={selectedModel}
                selectedReasoning={selectedReasoning}
                onChange={onSelectedModelChange}
                onReasoningChange={onSelectedReasoningChange}
              />
              <SubmitOrStopButton
                busy={busy}
                canSubmit={canSubmit}
                onSubmit={() => void submit()}
                onStop={() => void onStop()}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/*
 * SUBMIT BUTTON STATE STORYBOARD
 *
 * Read top-to-bottom. Values are relative to the thread running state changing.
 *
 *   0ms   same button slot keeps position while color/icon state changes
 * 120ms   background and foreground colors settle
 */
function SubmitOrStopButton({
  busy,
  canSubmit,
  onSubmit,
  onStop,
}: {
  busy: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onStop: () => void;
}): React.JSX.Element {
  const disabled = !busy && !canSubmit;

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "composer-submit-button size-9 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
      )}
      aria-label={busy ? "Stop inference" : "Send message"}
      disabled={disabled}
      data-state={busy ? "stop" : "send"}
      onClick={busy ? onStop : onSubmit}
    >
      {busy ? <Square className="size-4 fill-current" /> : <ArrowUp className="size-5" />}
    </Button>
  );
}

function ScrollToBottomButton({ visible, onClick }: { visible: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <div
      className="composer-scroll-button-region absolute -top-11 left-0 flex items-center"
      aria-hidden={!visible}
      data-visible={visible ? "true" : undefined}
      style={scrollButtonAnimationStyle}
    >
      <Button
        variant="outline"
        size="icon"
        className="size-8 rounded-full text-muted-foreground shadow-sm"
        aria-label="Scroll to bottom"
        tabIndex={visible ? 0 : -1}
        onClick={onClick}
      >
        <ArrowDown className="size-4" />
      </Button>
    </div>
  );
}
