import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { ArrowDown, ArrowUp, Loader2, Mic, Plus, Square } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import type { DesktopAttachment, PolicyMode, RoderModel, ReasoningEffort, SkillDescriptor } from "@/types/roder";
import { Button } from "@/components/ui/button";
import { AttachmentChip, ModelPicker, PolicyModePicker } from "@/components/composer-controls";
import { SkillCompletionPopup, skillCompletionOptionId } from "@/components/skill-completion-popup";
import { useSkillCompletion } from "@/hooks/use-skill-completion";
import { useSpeechTranscription } from "@/hooks/use-speech-transcription";
import {
  createSkillPromptEditor,
  readSkillPromptEditorSelectionOffset,
  readSkillPromptEditorText,
  registerSkillPromptPlainText,
  writeSkillPromptEditorText,
} from "@/lib/lexical-skill-prompt";
import { isComposerSubmitKey } from "@/lib/composer-keyboard";
import { cn } from "@/lib/utils";
import type { LexicalEditor } from "lexical";

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
  skills: SkillDescriptor[];
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
  skills,
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
  const [caretPosition, setCaretPosition] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const skillPromptEditor = useMemo(() => createSkillPromptEditor(), []);
  const skillCompletionListboxId = useId();
  const skillsRef = useRef(skills);
  const skillNamesKey = useMemo(() => skills.map((skill) => skill.name).sort().join("|"), [skills]);
  skillsRef.current = skills;

  useEffect(() => {
    if (focusSignal > 0) {
      skillPromptEditor.focus();
    }
  }, [focusSignal, skillPromptEditor]);

  useEffect(() => {
    const selectionOffset = readSkillPromptEditorSelectionOffset(skillPromptEditor);
    writeSkillPromptEditorText(
      skillPromptEditor,
      readSkillPromptEditorText(skillPromptEditor),
      skillsRef.current,
      selectionOffset,
    );
  }, [skillPromptEditor, skillNamesKey]);

  const appendTranscribedText = useCallback(
    (text: string) => {
      const currentPrompt = readSkillPromptEditorText(skillPromptEditor);
      const trimmed = currentPrompt.trim();
      const nextPrompt = trimmed ? `${trimmed} ${text}` : text;
      writeSkillPromptEditorText(skillPromptEditor, nextPrompt, skills, nextPrompt.length);
      setPrompt(nextPrompt);
      setCaretPosition(nextPrompt.length);
    },
    [skillPromptEditor, skills],
  );
  const {
    isRecording,
    isTranscribing,
    recordingError,
    clearRecordingError,
    lifecycleRef: speechLifecycleRef,
    toggleRecording,
  } = useSpeechTranscription({ onTranscriptionText: appendTranscribedText });
  const handlePromptEditorChange = useCallback(
    (nextPrompt: string, nextCaret: number) => {
      setPrompt(nextPrompt);
      setCaretPosition(nextCaret);
      if (recordingError) {
        clearRecordingError();
      }
    },
    [clearRecordingError, recordingError],
  );
  const canSubmit = prompt.trim().length > 0 || attachments.length > 0;
  const skillCompletion = useSkillCompletion({
    editor: skillPromptEditor,
    prompt,
    caretPosition,
    skills,
    onPromptChange: handlePromptEditorChange,
  });

  async function submit(): Promise<void> {
    const value = prompt.trim();
    if (!value && attachments.length === 0) {
      return;
    }
    const submittedAttachments = attachments;
    setPrompt("");
    setCaretPosition(0);
    writeSkillPromptEditorText(skillPromptEditor, "", skills, 0);
    onAttachmentsChange([]);
    await onSend(value, submittedAttachments);
  }

  function handlePromptEditorKeyDownCapture(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (skillCompletion.handleSkillCompletionKeyDown(event)) {
      return;
    }

    if (isComposerSubmitKey(event)) {
      event.preventDefault();
      void submit();
      return;
    }
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
        <SkillCompletionPopup
          visible={skillCompletion.showSkillCompletionMenu}
          listboxId={skillCompletionListboxId}
          skills={skillCompletion.skillCompletions}
          highlightedSkillIndex={skillCompletion.highlightedSkillIndex}
          onHighlight={skillCompletion.setHighlightedSkillIndex}
          onSelect={skillCompletion.insertSkillCompletion}
        />
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
          <SkillPromptEditor
            editor={skillPromptEditor}
            skills={skills}
            value={prompt}
            placeholder={busy ? "Queue a follow-up or steer the current run" : "Send follow-up"}
            completionOpen={skillCompletion.showSkillCompletionMenu}
            completionListboxId={skillCompletionListboxId}
            activeCompletionId={
              skillCompletion.showSkillCompletionMenu
                ? skillCompletionOptionId(skillCompletionListboxId, skillCompletion.highlightedSkillIndex)
                : undefined
            }
            onChange={handlePromptEditorChange}
            onKeyDownCapture={handlePromptEditorKeyDownCapture}
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

type SkillPromptEditorProps = {
  editor: LexicalEditor;
  skills: SkillDescriptor[];
  value: string;
  placeholder: string;
  completionOpen: boolean;
  completionListboxId: string;
  activeCompletionId: string | undefined;
  onChange: (value: string, caret: number) => void;
  onKeyDownCapture: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

function SkillPromptEditor({
  editor,
  skills,
  value,
  placeholder,
  completionOpen,
  completionListboxId,
  activeCompletionId,
  onChange,
  onKeyDownCapture,
}: SkillPromptEditorProps): React.JSX.Element {
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const historyState = useMemo(() => createEmptyHistoryState(), []);
  const skillsRef = useRef(skills);
  // Registered Lexical commands read the latest skills without re-registering on every store update.
  skillsRef.current = skills;

  useEffect(() => {
    const rootElement = editorRootRef.current;
    if (!rootElement) {
      return;
    }
    editor.setRootElement(rootElement);
    return () => {
      editor.setRootElement(null);
    };
  }, [editor]);

  useEffect(() => registerSkillPromptPlainText(editor, () => skillsRef.current), [editor]);

  useEffect(() => registerHistory(editor, historyState, 300), [editor, historyState]);

  useEffect(
    () =>
      editor.registerUpdateListener(() => {
        onChange(readSkillPromptEditorText(editor), readSkillPromptEditorSelectionOffset(editor));
      }),
    [editor, onChange],
  );

  return (
    <div className="relative">
      {value.length === 0 && (
        <div className="pointer-events-none absolute left-1 top-2 font-[var(--font-ui)] text-[var(--font-size-composer)] font-medium leading-7 text-muted-foreground">
          {placeholder}
        </div>
      )}
      <div
        ref={editorRootRef}
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        aria-autocomplete="list"
        aria-controls={completionOpen ? completionListboxId : undefined}
        aria-activedescendant={completionOpen ? activeCompletionId : undefined}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        tabIndex={0}
        className="skill-prompt-editor relative min-h-16 w-full whitespace-pre-wrap break-words rounded-md bg-transparent px-1 py-2 font-[var(--font-ui)] text-[var(--font-size-composer)] font-medium leading-7 text-foreground caret-primary outline-none [&_p]:m-0 [&_p]:min-h-7"
        onKeyDownCapture={onKeyDownCapture}
      />
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
