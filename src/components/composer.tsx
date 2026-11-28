import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { ArrowDown, ArrowUp, Loader2, Mic, Network, Pencil, Plus, Square, Trash2 } from "lucide-react";
import { AgentBackendPicker } from "@/components/agent-backend-picker";
import { CloudMachinePicker, ThreadExecutionMachine } from "@/components/cloud-machine-picker";
import { NewWorktreeCheckbox, WorktreeSetupProgress } from "@/components/new-worktree-controls";
import { useRoderStore } from "@/stores/roder-store";
import { AttachmentPreparation, attachmentImageType, mergeAttachments } from "@/lib/attachment-preparation";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  use,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { RoderAgentThreadContext } from "@/components/app-shell-context";
import type {
  CommandDescriptor,
  DesktopAttachment,
  InferenceRoutingOptionDescriptor,
  ModelSelectionMode,
  QueuedPrompt,
  RoderModel,
  ReasoningEffort,
  SkillDescriptor,
} from "@/types/roder";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AttachmentChip,
  ComposerAgentSwarmModeMenuItem,
  ComposerAttachMenuItems,
  ComposerMcpServersMenuItem,
  ComposerSkillsMenuItem,
  ModelPicker,
} from "@/components/composer-controls";
import { CommandCompletionPopup, commandCompletionOptionId } from "@/components/command-completion-popup";
import { ComposerSketchPad } from "@/components/composer-sketch-pad";
import { McpServerCompletionPopup, mcpServerCompletionOptionId } from "@/components/mcp-server-completion-popup";
import { SkillCompletionPopup, skillCompletionOptionId } from "@/components/skill-completion-popup";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCommandCompletion } from "@/hooks/use-command-completion";
import { useMcpServerCompletion } from "@/hooks/use-mcp-server-completion";
import { useSkillCompletion } from "@/hooks/use-skill-completion";
import { useSpeechTranscription } from "@/hooks/use-speech-transcription";
import { commandInvocationText, type CommandInvocation } from "@/lib/roder-commands";
import {
  createSkillPromptEditor,
  insertSkillPromptCompletionTrigger,
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
  activeThreadId: string;
  attachmentContextKey?: string;
  busy: boolean;
  queueBusy?: boolean;
  commands: CommandDescriptor[];
  models: RoderModel[];
  routingOptions: InferenceRoutingOptionDescriptor[];
  skills: SkillDescriptor[];
  selectedModel: string;
  selectedModelProvider: string;
  selectedSelectionMode: ModelSelectionMode;
  agentSwarmMode: boolean;
  agentSwarmModeAvailable: boolean;
  selectedReasoning: ReasoningEffort;
  attachments: DesktopAttachment[];
  queuedPrompts: QueuedPrompt[];
  focusSignal: number;
  showScrollToBottom: boolean;
  onSelectedModelChange: (model: string, provider?: string) => void;
  onSelectedAutoModelChange: (optionId: string) => void;
  onAgentSwarmModeChange: (enabled: boolean) => void;
  onSelectedReasoningChange: (reasoning: ReasoningEffort) => void;
  onScrollToBottom: () => void;
  onAttachmentsChange: (attachments: DesktopAttachment[]) => void;
  onQueuePrompt: (threadId: string, prompt: string, attachments: DesktopAttachment[]) => QueuedPrompt;
  onRemoveQueuedPrompt: (threadId: string, queuedPromptId: string) => void;
  onCommandSubmit: (invocation: CommandInvocation) => Promise<void>;
  onSend: (prompt: string, attachments: DesktopAttachment[]) => Promise<void>;
  onSteer: (prompt: string, attachments: DesktopAttachment[]) => Promise<void>;
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
  activeThreadId,
  attachmentContextKey = "",
  busy,
  queueBusy = busy,
  commands,
  models,
  routingOptions,
  skills,
  selectedModel,
  selectedModelProvider,
  selectedSelectionMode,
  agentSwarmMode,
  agentSwarmModeAvailable,
  selectedReasoning,
  attachments,
  queuedPrompts,
  focusSignal,
  showScrollToBottom,
  onSelectedModelChange,
  onSelectedAutoModelChange,
  onAgentSwarmModeChange,
  onSelectedReasoningChange,
  onScrollToBottom,
  onAttachmentsChange,
  onQueuePrompt,
  onRemoveQueuedPrompt,
  onCommandSubmit,
  onSend,
  onSteer,
  onStop,
}: ComposerProps): React.JSX.Element {
  const roderAgentThread = use(RoderAgentThreadContext);
  const activeBackend = useRoderStore((state) => state.activeBackend) ?? "roder";
  const [prompt, setPrompt] = useState("");
  // Guard only, never rendered: refs avoid synchronous setState inside the drain effect.
  const drainingQueuedPromptIdRef = useRef<string | null>(null);
  const steeringQueuedPromptIdRef = useRef<string | null>(null);
  const [blockedQueuedPromptId, setBlockedQueuedPromptId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [caretPosition, setCaretPosition] = useState(0);
  const [attachmentPreparation] = useState(() => new AttachmentPreparation());
  const attachmentContext = JSON.stringify([activeThreadId, attachmentContextKey]);
  const [attachmentStatus, setAttachmentStatus] = useState({
    context: attachmentContext,
    generation: attachmentPreparation.generation,
    pending: 0,
    errors: [] as string[],
  });
  const attachmentStatusCurrent =
    attachmentStatus.context === attachmentContext && attachmentStatus.generation === attachmentPreparation.generation;
  const preparingAttachments = attachmentStatusCurrent ? attachmentStatus.pending : 0;
  const attachmentErrors = attachmentStatusCurrent ? attachmentStatus.errors : [];
  const attachmentsRef = useRef(attachments);
  const changeAttachmentsRef = useRef(onAttachmentsChange);
  useLayoutEffect(() => {
    return () => attachmentPreparation.invalidate();
  }, [attachmentPreparation, activeThreadId, attachmentContextKey]);
  // Async preparation must merge into the latest committed composer, not its starting snapshot.
  useLayoutEffect(() => {
    attachmentsRef.current = attachments;
    changeAttachmentsRef.current = onAttachmentsChange;
  }, [attachments, onAttachmentsChange]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const skillPromptEditor = useMemo(() => createSkillPromptEditor(), []);
  const skillCompletionListboxId = useId();
  const commandCompletionListboxId = useId();
  const mcpServerCompletionListboxId = useId();
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
  const canSubmit = preparingAttachments === 0 && (prompt.trim().length > 0 || attachments.length > 0);
  const activeQueueKey = activeThreadId || "new-thread";
  const hasQueuedPrompts = queuedPrompts.length > 0;

  function restorePromptEditor(nextPrompt: string, nextAttachments: DesktopAttachment[]): void {
    setPrompt(nextPrompt);
    setCaretPosition(nextPrompt.length);
    writeSkillPromptEditorText(skillPromptEditor, nextPrompt, skills, nextPrompt.length);
    changeAttachments(nextAttachments);
  }

  useEffect(() => {
    if (
      queueBusy ||
      attachmentPreparation.pending > 0 ||
      preparingAttachments > 0 ||
      drainingQueuedPromptIdRef.current ||
      steeringQueuedPromptIdRef.current ||
      queuedPrompts.length === 0
    ) {
      return;
    }
    const nextQueuedPrompt = queuedPrompts[0];
    if (blockedQueuedPromptId === nextQueuedPrompt.id) {
      return;
    }
    drainingQueuedPromptIdRef.current = nextQueuedPrompt.id;
    void (async () => {
      try {
        await onSend(nextQueuedPrompt.prompt, nextQueuedPrompt.attachments);
        onRemoveQueuedPrompt(activeQueueKey, nextQueuedPrompt.id);
        setBlockedQueuedPromptId(null);
      } catch {
        setBlockedQueuedPromptId(nextQueuedPrompt.id);
      } finally {
        drainingQueuedPromptIdRef.current = null;
      }
    })();
  }, [
    activeQueueKey,
    blockedQueuedPromptId,
    onRemoveQueuedPrompt,
    onSend,
    queueBusy,
    preparingAttachments,
    attachmentPreparation,
    queuedPrompts,
  ]);

  function editQueuedPrompt(item: QueuedPrompt): void {
    setBlockedQueuedPromptId((blockedId) => (blockedId === item.id ? null : blockedId));
    onRemoveQueuedPrompt(activeQueueKey, item.id);
    setPrompt(item.prompt);
    setCaretPosition(item.prompt.length);
    writeSkillPromptEditorText(skillPromptEditor, item.prompt, skills, item.prompt.length);
    changeAttachments([...item.attachments]);
    skillPromptEditor.focus();
  }

  function deleteQueuedPrompt(itemId: string): void {
    setBlockedQueuedPromptId((blockedId) => (blockedId === itemId ? null : blockedId));
    onRemoveQueuedPrompt(activeQueueKey, itemId);
  }

  async function steerQueuedPrompt(item: QueuedPrompt): Promise<void> {
    if (attachmentPreparation.pending > 0 || steeringQueuedPromptIdRef.current) return;
    steeringQueuedPromptIdRef.current = item.id;
    try {
      await onSteer(item.prompt, item.attachments);
      setBlockedQueuedPromptId((blockedId) => (blockedId === item.id ? null : blockedId));
      onRemoveQueuedPrompt(activeQueueKey, item.id);
    } catch {
      // The store surfaces the error; retain the message when steering fails.
    } finally {
      if (steeringQueuedPromptIdRef.current === item.id) {
        steeringQueuedPromptIdRef.current = null;
      }
    }
  }

  const skillCompletion = useSkillCompletion({
    editor: skillPromptEditor,
    prompt,
    caretPosition,
    skills,
    onPromptChange: handlePromptEditorChange,
  });
  const mcpServerCompletion = useMcpServerCompletion({
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
    if (attachmentPreparation.pending > 0) return;
    const value = prompt.trim();
    if (!value && attachmentsRef.current.length === 0) {
      return;
    }
    const submittedAttachments = attachmentsRef.current;
    setPrompt("");
    setCaretPosition(0);
    writeSkillPromptEditorText(skillPromptEditor, "", skills, 0);
    changeAttachments([]);
    if (queueBusy) {
      onQueuePrompt(activeQueueKey, value, submittedAttachments);
      return;
    }
    try {
      await onSend(value, submittedAttachments);
    } catch {
      // The store has already surfaced the error; keep direct submits from becoming unhandled rejections.
      restorePromptEditor(value, submittedAttachments);
    }
  }

  async function submitCommand(invocation: CommandInvocation): Promise<void> {
    if (attachmentPreparation.pending > 0) return;
    const commandText = commandInvocationText(invocation);
    setPrompt("");
    setCaretPosition(0);
    writeSkillPromptEditorText(skillPromptEditor, "", skills, 0);
    changeAttachments([]);
    if (queueBusy) {
      onQueuePrompt(activeQueueKey, commandText, []);
      return;
    }
    try {
      await onCommandSubmit(invocation);
    } catch {
      // The store has already surfaced the error; keep direct submits from becoming unhandled rejections.
      restorePromptEditor(commandText, []);
    }
  }

  function handlePromptEditorKeyDownCapture(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (commandCompletion.handleCommandCompletionKeyDown(event)) {
      return;
    }
    if (mcpServerCompletion.handleMcpServerCompletionKeyDown(event)) {
      return;
    }
    skillCompletion.handleSkillCompletionKeyDown(event);
  }

  function toggleAgentSwarmMode(): void {
    if (agentSwarmModeAvailable) {
      onAgentSwarmModeChange(!agentSwarmMode);
    }
  }

  function changeAttachments(nextAttachments: DesktopAttachment[]): void {
    attachmentsRef.current = nextAttachments;
    changeAttachmentsRef.current(nextAttachments);
  }

  function addAttachments(nextAttachments: DesktopAttachment[]): void {
    changeAttachments(mergeAttachments(attachmentsRef.current, nextAttachments));
  }

  function removeAttachment(id: string): void {
    changeAttachments(attachmentsRef.current.filter((attachment) => attachment.id !== id));
  }

  function attachSketch(attachment: DesktopAttachment): void {
    addAttachments([attachment]);
    skillPromptEditor.focus();
  }

  function insertCompletionTrigger(trigger: string): void {
    const next = insertSkillPromptCompletionTrigger(skillPromptEditor, trigger, skills);
    handlePromptEditorChange(next.text, next.caret);
    requestAnimationFrame(() => {
      skillPromptEditor.focus();
    });
  }

  async function attachFiles(files: FileList | File[]): Promise<void> {
    await prepareAttachments(Array.from(files), async (source) => {
      const [file] = window.roderDesktop.resolveDroppedFiles([source]);
      if (!file) throw new Error(`Could not attach ${source.name}: no local file path`);
      let imageUrl: string | undefined;
      if (attachmentImageType(source)) {
        imageUrl = await imageFileToPngDataUrl(source);
      }
      return {
        ...file,
        type: imageUrl ? "image/png" : file.type,
        id: crypto.randomUUID(),
        imageUrl,
        source: "file" as const,
      };
    });
  }

  async function attachPastedImages(files: File[]): Promise<void> {
    await prepareAttachments(files, async (file) => {
      const dataUrl = await imageFileToPngDataUrl(file);
      const saved = await window.roderDesktop.clipboardSaveImage(dataUrl);
      return {
        ...saved,
        name: file.name || saved.name,
        id: crypto.randomUUID(),
        imageUrl: dataUrl,
        source: "clipboard" as const,
      };
    });
  }

  async function prepareAttachments(files: File[], prepare: (file: File) => Promise<DesktopAttachment>): Promise<void> {
    const work = attachmentPreparation.prepare(files, async (file) => {
      try {
        return await prepare(file);
      } catch (error) {
        throw new Error(
          `${file.name || "Image"}: ${error instanceof Error ? error.message : "Could not prepare attachment"}`,
        );
      }
    });
    setAttachmentStatus({
      context: attachmentContext,
      generation: attachmentPreparation.generation,
      pending: attachmentPreparation.pending,
      errors: [],
    });
    const result = await work;
    if (!result) return;
    addAttachments(result.attachments);
    setAttachmentStatus((status) => ({
      context: attachmentContext,
      generation: attachmentPreparation.generation,
      pending: attachmentPreparation.pending,
      errors: [
        ...(status.context === attachmentContext && status.generation === attachmentPreparation.generation
          ? status.errors
          : []),
        ...result.errors,
      ],
    }));
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>): void {
    const imageFiles = Array.from(event.clipboardData.files).filter((file) => attachmentImageType(file));
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
      void attachFiles(event.dataTransfer.files);
    }
  }

  const completionOpen =
    commandCompletion.showCommandCompletionMenu ||
    mcpServerCompletion.showMcpServerCompletionMenu ||
    skillCompletion.showSkillCompletionMenu;
  const activeCompletionListboxId = commandCompletion.showCommandCompletionMenu
    ? commandCompletionListboxId
    : mcpServerCompletion.showMcpServerCompletionMenu
      ? mcpServerCompletionListboxId
      : skillCompletionListboxId;
  const activeCompletionOptionId = commandCompletion.showCommandCompletionMenu
    ? commandCompletionOptionId(commandCompletionListboxId, commandCompletion.highlightedCommandIndex)
    : mcpServerCompletion.showMcpServerCompletionMenu
      ? mcpServerCompletionOptionId(mcpServerCompletionListboxId, mcpServerCompletion.highlightedMcpServerIndex)
      : skillCompletion.showSkillCompletionMenu
        ? skillCompletionOptionId(skillCompletionListboxId, skillCompletion.highlightedSkillIndex)
        : undefined;

  return (
    <div
      ref={speechLifecycleRef}
      className="@container mx-auto w-full max-w-3xl px-2.5 pb-2 pt-0 @[520px]:px-4 @[520px]:pb-3"
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
          "relative mt-1 rounded-xl bg-card/95 shadow-sm ring-1 ring-border/70 backdrop-blur-md transition-[background-color,box-shadow] @[520px]:mt-2 @[520px]:rounded-2xl",
          dragActive && "bg-card shadow-md ring-2 ring-ring/30",
        )}
      >
        <ScrollToBottomButton visible={showScrollToBottom} onClick={onScrollToBottom} />
        {!activeThreadId && <WorktreeSetupProgress />}
        {hasQueuedPrompts && (
          <QueuedPromptList
            busy={busy}
            items={queuedPrompts}
            onDelete={deleteQueuedPrompt}
            onEdit={editQueuedPrompt}
            onSteer={(item) => void steerQueuedPrompt(item)}
          />
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2">
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
        <McpServerCompletionPopup
          visible={mcpServerCompletion.showMcpServerCompletionMenu}
          listboxId={mcpServerCompletionListboxId}
          servers={mcpServerCompletion.mcpServerCompletions}
          highlightedServerIndex={mcpServerCompletion.highlightedMcpServerIndex}
          onHighlight={mcpServerCompletion.setHighlightedMcpServerIndex}
          onSelect={mcpServerCompletion.insertMcpServerCompletion}
        />
        <SkillCompletionPopup
          visible={skillCompletion.showSkillCompletionMenu}
          listboxId={skillCompletionListboxId}
          skills={skillCompletion.skillCompletions}
          highlightedSkillIndex={skillCompletion.highlightedSkillIndex}
          onHighlight={skillCompletion.setHighlightedSkillIndex}
          onSelect={skillCompletion.insertSkillCompletion}
        />
        <div className="px-2.5 py-1.5 @[520px]:px-3 @[520px]:py-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            aria-label="Attach files"
            className="hidden"
            onChange={(event) => {
              if (event.currentTarget.files) {
                void attachFiles(event.currentTarget.files);
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
          {preparingAttachments > 0 && (
            <div role="status" className="px-1 pb-2 text-sm text-muted-foreground">
              Preparing {preparingAttachments} attachment{preparingAttachments === 1 ? "" : "s"}...
            </div>
          )}
          {attachmentErrors.length > 0 && (
            <div role="alert" className="px-1 pb-2 text-sm text-destructive">
              {attachmentErrors.map((error, index) => (
                <div key={`${index}:${error}`}>{error}</div>
              ))}
            </div>
          )}
          <div className="mt-1 flex min-w-0 flex-wrap items-center justify-between gap-x-1.5 gap-y-1 @[520px]:gap-x-2">
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1 @[520px]:flex-nowrap @[520px]:gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger
                  variant="unstyled"
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon" }),
                    "size-7 shrink-0 rounded-full text-muted-foreground data-[popup-open]:bg-accent data-[popup-open]:text-foreground @[520px]:size-8",
                  )}
                  aria-label="Add input"
                  title="Add input"
                >
                  <Plus className="size-3.5 @[520px]:size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-48">
                  <DropdownMenuGroup>
                    <ComposerAgentSwarmModeMenuItem
                      enabled={agentSwarmMode}
                      available={agentSwarmModeAvailable}
                      onToggle={toggleAgentSwarmMode}
                    />
                    <ComposerSkillsMenuItem onSelect={() => insertCompletionTrigger("$")} />
                    <ComposerMcpServersMenuItem onSelect={() => insertCompletionTrigger("@")} />
                    <ComposerAttachMenuItems
                      onOpenSketch={() => setSketchOpen(true)}
                      onUploadFile={() => fileInputRef.current?.click()}
                    />
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {agentSwarmMode && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 min-w-0 max-w-32 rounded-full bg-primary/10 px-2 text-sm text-primary hover:bg-primary/15 hover:text-primary @[520px]:max-w-44 @[520px]:px-2.5 @[520px]:text-base"
                  aria-pressed="true"
                  title="Agent Swarm mode is on for this thread"
                  onClick={toggleAgentSwarmMode}
                >
                  <Network className="size-3.5 shrink-0 @[520px]:size-4" />
                  <span className="truncate">Agent Swarm</span>
                </Button>
              )}
              {activeThreadId ? (
                <ThreadExecutionMachine threadId={activeThreadId} />
              ) : (
                <>
                  <CloudMachinePicker disabled={busy || activeBackend !== "roder"} />
                  <NewWorktreeCheckbox disabled={busy || queueBusy || activeBackend !== "roder"} />
                </>
              )}
            </div>
            <div className="ml-auto flex min-w-0 max-w-full items-center gap-1 @[520px]:gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "size-7 shrink-0 rounded-full @[520px]:size-8",
                  isRecording
                    ? "bg-destructive/10 text-destructive animate-pulse hover:bg-destructive/20 hover:text-destructive"
                    : "text-muted-foreground",
                )}
                aria-label={isRecording ? "Stop recording" : "Record voice prompt"}
                onClick={toggleRecording}
                disabled={isTranscribing}
              >
                {isTranscribing ? (
                  <Loader2 className="size-3.5 animate-spin @[520px]:size-4" />
                ) : (
                  <Mic className="size-3.5 @[520px]:size-4" />
                )}
              </Button>
              <AgentBackendPicker disabled={busy || roderAgentThread} />
              <ModelPicker
                models={models}
                routingOptions={routingOptions}
                selectedModel={selectedModel}
                selectedModelProvider={selectedModelProvider}
                selectedSelectionMode={selectedSelectionMode}
                selectedReasoning={selectedReasoning}
                onChange={onSelectedModelChange}
                onAutoChange={onSelectedAutoModelChange}
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

function QueuedPromptList({
  busy,
  items,
  onDelete,
  onEdit,
  onSteer,
}: {
  busy: boolean;
  items: QueuedPrompt[];
  onDelete: (itemId: string) => void;
  onEdit: (item: QueuedPrompt) => void;
  onSteer: (item: QueuedPrompt) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-1 px-3 pb-1 pt-2" aria-label="Queued messages">
      {items.map((item, index) => (
        <div key={item.id} className="flex items-center gap-2 rounded-2xl bg-muted/30 px-2 py-1.5 text-sm">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <div className="mt-0.5 shrink-0 tabular-nums text-xs font-medium text-muted-foreground">{index + 1}.</div>
            <div className="min-w-0 flex-1">
              <div className="line-clamp-3 whitespace-pre-wrap text-foreground">
                {item.prompt || attachmentSummary(item.attachments)}
              </div>
              {item.attachments.length > 0 && item.prompt && (
                <div className="mt-1 text-xs text-muted-foreground">{attachmentSummary(item.attachments)}</div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs font-medium text-foreground hover:bg-accent"
              aria-label="Steer with queued message"
              disabled={!busy}
              title={busy ? "Steer running turn" : "Start a turn before steering"}
              onClick={() => onSteer(item)}
            >
              Steer
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Edit queued message"
              onClick={() => onEdit(item)}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Delete queued message"
              onClick={() => onDelete(item.id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function attachmentSummary(attachments: DesktopAttachment[]): string {
  if (attachments.length === 0) {
    return "Attachment-only message";
  }
  return `${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`;
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
  useLayoutEffect(() => {
    skillsRef.current = skills;
    onSubmitKeyRef.current = onSubmitKey;
  });

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
        <div className="pointer-events-none absolute left-1 top-1 font-[var(--font-ui)] text-[var(--font-size-composer)] font-medium leading-[1.45] text-muted-foreground @[520px]:top-2">
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
        className="skill-prompt-editor relative min-h-8 w-full whitespace-pre-wrap break-words rounded-md bg-transparent px-1 py-1 font-[var(--font-ui)] text-[var(--font-size-composer)] font-medium leading-[1.45] text-foreground caret-primary outline-none @[520px]:min-h-11 @[520px]:py-2 [&_p]:m-0 [&_p]:min-h-[1.45em]"
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
  const submitsDraft = canSubmit;
  const stopsActiveRun = busy && !submitsDraft;

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "composer-submit-button size-7 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground @[520px]:size-8",
      )}
      aria-label={stopsActiveRun ? "Stop inference" : busy ? "Queue message" : "Send message"}
      disabled={disabled}
      data-state={stopsActiveRun ? "stop" : busy ? "queue" : "send"}
      onClick={stopsActiveRun ? onStop : onSubmit}
    >
      {stopsActiveRun ? (
        <Square className="size-3 fill-current @[520px]:size-3.5" />
      ) : (
        <ArrowUp className="size-3.5 @[520px]:size-4" />
      )}
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
        variant="ghost"
        size="icon"
        className="rounded-full bg-card/95 text-muted-foreground shadow-sm ring-1 ring-border/70 hover:bg-card hover:text-foreground"
        aria-label="Scroll to bottom"
        tabIndex={visible ? 0 : -1}
        onClick={onClick}
      >
        <ArrowDown className="size-4" />
      </Button>
    </div>
  );
}
