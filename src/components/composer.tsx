import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { ArrowDown, ArrowUp, Loader2, Mic, Plus, Square } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  CommandDescriptor,
  DesktopAttachment,
  PolicyMode,
  RoderModel,
  ReasoningEffort,
  SkillDescriptor,
} from "@/types/roder";
import { Button, buttonVariants } from "@/components/ui/button";
import { AttachmentChip, ComposerAttachMenuItems, ModelPicker, PolicyModePicker } from "@/components/composer-controls";
import { CommandCompletionPopup, commandCompletionOptionId } from "@/components/command-completion-popup";
import { ComposerSketchPad } from "@/components/composer-sketch-pad";
import { SkillCompletionPopup, skillCompletionOptionId } from "@/components/skill-completion-popup";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCommandCompletion } from "@/hooks/use-command-completion";
import { useSkillCompletion } from "@/hooks/use-skill-completion";
import { useSpeechTranscription } from "@/hooks/use-speech-transcription";
import type { CommandInvocation } from "@/lib/roder-commands";
import {
  createSkillPromptEditor,
  readSkillPromptEditorSelectionOffset,
  readSkillPromptEditorText,
  registerSkillPromptPlainText,
  registerSkillPromptSubmit,
  writeSkillPromptEditorText,
} from "@/lib/lexical-skill-prompt";
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
  commands: CommandDescriptor[];
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
  onCommandSubmit: (invocation: CommandInvocation) => Promise<void>;
  onSend: (prompt: string, attachments: DesktopAttachment[]) => Promise<void>;
  onStop: () => Promise<void>;
};

async function imageFileToPngDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not prepare pasted image");
    }
    context.drawImage(bitmap, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}

export function Composer({
  busy,
  commands,
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
  onCommandSubmit,
  onSend,
  onStop,
}: ComposerProps): React.JSX.Element {
  const [prompt, setPrompt] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [caretPosition, setCaretPosition] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const skillPromptEditor = useMemo(() => createSkillPromptEditor(), []);
  const skillCompletionListboxId = useId();
  const commandCompletionListboxId = useId();
  const skillsRef = useRef(skills);
  const skillNamesKey = useMemo(
    () =>
      skills
        .map((skill) => skill.name)
        .sort()
        .join("|"),
    [skills],
  );
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
  const commandCompletion = useCommandCompletion({
    editor: skillPromptEditor,
    prompt,
    caretPosition,
    commands,
    skills,
    disabled: attachments.length > 0,
    onPromptChange: handlePromptEditorChange,
    onCommandSubmit: (invocation) => void submitCommand(invocation),
  });

  async function submit(): Promise<void> {
    if (busy) {
      return;
    }
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

  async function submitCommand(invocation: CommandInvocation): Promise<void> {
    if (busy) {
      return;
    }
    setPrompt("");
    setCaretPosition(0);
    writeSkillPromptEditorText(skillPromptEditor, "", skills, 0);
    onAttachmentsChange([]);
    await onCommandSubmit(invocation);
  }

  function handlePromptEditorKeyDownCapture(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (commandCompletion.handleCommandCompletionKeyDown(event)) {
      return;
    }
    skillCompletion.handleSkillCompletionKeyDown(event);
  }

  function addAttachments(nextAttachments: DesktopAttachment[]): void {
    const seen = new Set(attachments.map((attachment) => attachment.path));
    onAttachmentsChange([
      ...attachments,
      ...nextAttachments.flatMap((attachment) =>
        attachment.path && !seen.has(attachment.path)
          ? [
              {
                ...attachment,
                id: attachment.id || crypto.randomUUID(),
              },
            ]
          : [],
      ),
    ]);
  }

  function removeAttachment(id: string): void {
    onAttachmentsChange(attachments.filter((attachment) => attachment.id !== id));
  }

  function attachSketch(attachment: DesktopAttachment): void {
    addAttachments([attachment]);
    skillPromptEditor.focus();
  }

  function attachFiles(files: FileList | File[]): void {
    const resolved = window.roderDesktop
      .resolveDroppedFiles(Array.from(files))
      .map((file) => ({ ...file, id: crypto.randomUUID(), source: "file" as const }));
    addAttachments(resolved);
  }

  async function attachPastedImages(files: File[]): Promise<void> {
    const resolved = await Promise.all(
      files.map(async (file) => {
        const dataUrl = await imageFileToPngDataUrl(file);
        const saved = await window.roderDesktop.clipboardSaveImage(dataUrl);
        return {
          ...saved,
          name: file.name || saved.name,
          id: crypto.randomUUID(),
          imageUrl: dataUrl,
          source: "clipboard" as const,
        };
      }),
    );
    addAttachments(resolved);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>): void {
    const imageFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      return;
    }
    event.preventDefault();
    void attachPastedImages(imageFiles);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files.length > 0) {
      attachFiles(event.dataTransfer.files);
    }
  }

  const completionOpen = commandCompletion.showCommandCompletionMenu || skillCompletion.showSkillCompletionMenu;
  const activeCompletionListboxId = commandCompletion.showCommandCompletionMenu
    ? commandCompletionListboxId
    : skillCompletionListboxId;
  const activeCompletionOptionId = commandCompletion.showCommandCompletionMenu
    ? commandCompletionOptionId(commandCompletionListboxId, commandCompletion.highlightedCommandIndex)
    : skillCompletion.showSkillCompletionMenu
      ? skillCompletionOptionId(skillCompletionListboxId, skillCompletion.highlightedSkillIndex)
      : undefined;

  return (
    <div
      ref={speechLifecycleRef}
      className="mx-auto w-full max-w-3xl px-8 pb-5 pt-0"
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
        {sketchOpen && <ComposerSketchPad onAttach={attachSketch} onClose={() => setSketchOpen(false)} />}
        <CommandCompletionPopup
          visible={commandCompletion.showCommandCompletionMenu}
          listboxId={commandCompletionListboxId}
          commands={commandCompletion.commandCompletions}
          highlightedCommandIndex={commandCompletion.highlightedCommandIndex}
          onHighlight={commandCompletion.setHighlightedCommandIndex}
          onSelect={commandCompletion.runCommandCompletion}
        />
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
            aria-label="Attach files"
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
            placeholder={busy ? "Wait for the current run to finish" : "Send follow-up"}
            completionOpen={completionOpen}
            completionListboxId={activeCompletionListboxId}
            activeCompletionId={activeCompletionOptionId}
            onChange={handlePromptEditorChange}
            onKeyDownCapture={handlePromptEditorKeyDownCapture}
            onSubmitKey={() => void submit()}
            onPaste={handlePaste}
          />
          {recordingError && <div className="text-sm text-destructive px-1 pb-2">{recordingError}</div>}
          <div className="mt-1 flex min-h-9 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  variant="unstyled"
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon" }),
                    "shrink-0 rounded-full text-muted-foreground data-[popup-open]:bg-accent data-[popup-open]:text-foreground",
                  )}
                  aria-label="Add input"
                  title="Add input"
                >
                  <Plus className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-44">
                  <DropdownMenuGroup>
                    <ComposerAttachMenuItems
                      onOpenSketch={() => setSketchOpen(true)}
                      onUploadFile={() => fileInputRef.current?.click()}
                    />
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <PolicyModePicker selectedMode={selectedPolicyMode} onChange={onSelectedPolicyModeChange} />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "shrink-0 rounded-full",
                  isRecording
                    ? "bg-destructive/10 text-destructive animate-pulse hover:bg-destructive/20 hover:text-destructive"
                    : "text-muted-foreground",
                )}
                aria-label={isRecording ? "Stop recording" : "Record voice prompt"}
                onClick={toggleRecording}
                disabled={isTranscribing}
              >
                {isTranscribing ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
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
  onSubmitKey: () => void;
  onPaste: (event: React.ClipboardEvent<HTMLDivElement>) => void;
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
  onSubmitKey,
  onPaste,
}: SkillPromptEditorProps): React.JSX.Element {
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const historyState = useMemo(() => createEmptyHistoryState(), []);
  const skillsRef = useRef(skills);
  const onSubmitKeyRef = useRef(onSubmitKey);
  // Registered Lexical commands read the latest skills without re-registering on every store update.
  skillsRef.current = skills;
  onSubmitKeyRef.current = onSubmitKey;

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

  useEffect(() => registerSkillPromptSubmit(editor, () => onSubmitKeyRef.current()), [editor]);

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
        onPaste={onPaste}
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
        "composer-submit-button shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
      )}
      aria-label={busy ? "Stop inference" : "Send message"}
      disabled={disabled}
      data-state={busy ? "stop" : "send"}
      onClick={busy ? onStop : onSubmit}
    >
      {busy ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />}
    </Button>
  );
}

function ScrollToBottomButton({ visible, onClick }: { visible: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <div
      className="composer-scroll-button-region absolute -top-14 left-0 right-0 flex h-14 items-center"
      aria-hidden={!visible}
      data-visible={visible ? "true" : undefined}
      style={scrollButtonAnimationStyle}
    >
      <Button
        variant="outline"
        size="icon"
        className="rounded-full text-muted-foreground shadow-sm"
        aria-label="Scroll to bottom"
        tabIndex={visible ? 0 : -1}
        onClick={onClick}
      >
        <ArrowDown className="size-4" />
      </Button>
    </div>
  );
}
