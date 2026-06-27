import { registerPlainText } from "@lexical/plain-text";
import {
  $applyNodeReplacement,
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $selectAll,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  createEditor,
  DecoratorNode,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  SELECT_ALL_COMMAND,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type PointType,
  type SerializedLexicalNode,
} from "lexical";
import {
  deleteSkillTokenAtCaret,
  humanizedSkillName,
  replaceSkillToken,
  skillTokenRanges,
  type SkillCompletionToken,
} from "@/lib/roder-skills";
import { isComposerSubmitKey } from "@/lib/composer-keyboard";
import type { SkillDescriptor } from "@/types/roder";

export type SerializedSkillTokenNode = SerializedLexicalNode & {
  name: string;
};

export type SkillPromptSelectionRange = {
  start: number;
  end: number;
};

export type SkillPromptTextEdit = {
  text: string;
  caret: number;
};

const SKILL_TOKEN_NODE_TYPE = "skill-token";
const headlessSelectionRanges = new WeakMap<LexicalEditor, SkillPromptSelectionRange>();

export {
  CONTROLLED_TEXT_INSERTION_COMMAND as SKILL_PROMPT_TEXT_INSERTION_COMMAND,
  KEY_BACKSPACE_COMMAND as SKILL_PROMPT_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND as SKILL_PROMPT_ENTER_COMMAND,
  SELECT_ALL_COMMAND as SKILL_PROMPT_SELECT_ALL_COMMAND,
};

export class SkillTokenNode extends DecoratorNode<null> {
  __name: string;

  static getType(): string {
    return SKILL_TOKEN_NODE_TYPE;
  }

  static clone(node: SkillTokenNode): SkillTokenNode {
    return new SkillTokenNode(node.__name, node.__key);
  }

  static importJSON(serializedNode: SerializedSkillTokenNode): SkillTokenNode {
    return new SkillTokenNode(serializedNode.name).updateFromJSON(serializedNode);
  }

  constructor(name: string, key?: NodeKey) {
    super(key);
    this.__name = name;
  }

  getSkillName(): string {
    return this.getLatest().__name;
  }

  setSkillName(name: string): this {
    const writable = this.getWritable();
    writable.__name = name;
    return writable;
  }

  getTextContent(): string {
    return `$${this.__name}`;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const token = document.createElement("span");
    token.className = "skill-prompt-token";
    token.contentEditable = "false";
    token.dataset.skillToken = this.__name;
    token.title = `$${this.__name}`;

    const icon = createSkillTokenIcon();
    const label = document.createElement("span");
    label.className = "skill-prompt-token-label";
    label.textContent = humanizedSkillName(this.__name);
    token.append(icon, label);

    return token;
  }

  updateDOM(prevNode: SkillTokenNode): boolean {
    return prevNode.__name !== this.__name;
  }

  exportJSON(): SerializedSkillTokenNode {
    return {
      ...super.exportJSON(),
      name: this.__name,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedSkillTokenNode>): this {
    return super.updateFromJSON(serializedNode).setSkillName(serializedNode.name);
  }

  decorate(): null {
    return null;
  }

  isInline(): true {
    return true;
  }

  isIsolated(): true {
    return true;
  }

  isKeyboardSelectable(): false {
    return false;
  }
}

export function $createSkillTokenNode(name: string): SkillTokenNode {
  return $applyNodeReplacement(new SkillTokenNode(name));
}

export function $isSkillTokenNode(node: LexicalNode | null | undefined): node is SkillTokenNode {
  return node instanceof SkillTokenNode;
}

export function createSkillPromptEditor(): LexicalEditor {
  return createEditor({
    namespace: "roder-skill-prompt",
    nodes: [SkillTokenNode],
    onError(error) {
      throw error;
    },
  });
}

export function readSkillPromptEditorText(editor: LexicalEditor): string {
  return editor.read(() => $getRoot().getTextContent());
}

export function readSkillPromptEditorSelectionOffset(editor: LexicalEditor): number {
  return readSkillPromptEditorSelectionRange(editor).end;
}

export function readSkillPromptEditorSelectionRange(editor: LexicalEditor): SkillPromptSelectionRange {
  if (!editor.getRootElement()) {
    const trackedSelection = headlessSelectionRanges.get(editor);
    if (trackedSelection) {
      return trackedSelection;
    }
  }
  return editor.read(() => $readSkillPromptSelectionRange());
}

export function writeSkillPromptEditorText(
  editor: LexicalEditor,
  text: string,
  skills: SkillDescriptor[],
  selectionOffset = text.length,
): void {
  editor.update(
    () => {
      $writeSkillPromptText(text, skills, selectionOffset);
    },
    { discrete: true },
  );
  trackHeadlessSelection(editor, selectionOffset, selectionOffset, text.length);
}

export function selectSkillPromptEditorText(editor: LexicalEditor): void {
  const textLength = readSkillPromptEditorText(editor).length;
  editor.update(
    () => {
      const root = $getRoot();
      const paragraph = root.getFirstChild();
      if (!$isElementNode(paragraph)) {
        root.selectStart();
        return;
      }
      paragraph.select(0, paragraph.getChildrenSize());
    },
    { discrete: true },
  );
  trackHeadlessSelection(editor, 0, textLength, textLength);
}

export function replaceSkillPromptCompletionToken(
  editor: LexicalEditor,
  token: SkillCompletionToken,
  skillName: string,
  skills: SkillDescriptor[],
): number {
  const next = replaceSkillToken(readSkillPromptEditorText(editor), token, skillName);
  writeSkillPromptEditorText(editor, next.text, skills, next.caret);
  return next.caret;
}

export function replaceSkillPromptEditorSelectionText(
  editor: LexicalEditor,
  replacement: string,
  skills: SkillDescriptor[],
): SkillPromptTextEdit {
  const currentText = readSkillPromptEditorText(editor);
  const selection = readSkillPromptEditorSelectionRange(editor);
  const nextText = `${currentText.slice(0, selection.start)}${replacement}${currentText.slice(selection.end)}`;
  const caret = selection.start + replacement.length;
  writeSkillPromptEditorText(editor, nextText, skills, caret);
  return { text: nextText, caret };
}

export function deleteSkillPromptEditorSelectionText(
  editor: LexicalEditor,
  direction: "previous" | "next",
  skills: SkillDescriptor[],
): SkillPromptTextEdit | null {
  const currentText = readSkillPromptEditorText(editor);
  const selection = readSkillPromptEditorSelectionRange(editor);
  let start = selection.start;
  let end = selection.end;

  if (start === end) {
    if (direction === "previous") {
      if (start === 0) {
        return null;
      }
      start -= 1;
    } else {
      if (end >= currentText.length) {
        return null;
      }
      end += 1;
    }
  }

  const nextText = `${currentText.slice(0, start)}${currentText.slice(end)}`;
  writeSkillPromptEditorText(editor, nextText, skills, start);
  return { text: nextText, caret: start };
}

export function registerSkillPromptPlainText(editor: LexicalEditor, readSkills: () => SkillDescriptor[]): () => void {
  const unregisterTokenBackspace = editor.registerCommand(
    KEY_BACKSPACE_COMMAND,
    (event) => deleteSkillTokenFromCommand(event, editor, "previous", readSkills),
    COMMAND_PRIORITY_CRITICAL,
  );
  const unregisterTokenDelete = editor.registerCommand(
    KEY_DELETE_COMMAND,
    (event) => deleteSkillTokenFromCommand(event, editor, "next", readSkills),
    COMMAND_PRIORITY_HIGH,
  );
  const unregisterHeadlessFallbacks = registerHeadlessPlainTextFallbacks(editor, readSkills);
  const unregisterPlainText = editor.getRootElement() ? registerPlainText(editor) : () => undefined;

  return () => {
    unregisterHeadlessFallbacks();
    unregisterPlainText();
    unregisterTokenDelete();
    unregisterTokenBackspace();
  };
}

export function registerSkillPromptSubmit(editor: LexicalEditor, onSubmit: () => void): () => void {
  return editor.registerCommand(
    KEY_ENTER_COMMAND,
    (event) => {
      if (event?.defaultPrevented) {
        return true;
      }
      if (!event || !isComposerSubmitKey(event)) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      onSubmit();
      return true;
    },
    COMMAND_PRIORITY_CRITICAL,
  );
}

function deleteSkillTokenFromCommand(
  event: KeyboardEvent,
  editor: LexicalEditor,
  direction: "previous" | "next",
  readSkills: () => SkillDescriptor[],
): boolean {
  const currentText = $getRoot().getTextContent();
  const selection = editor.getRootElement()
    ? $readSkillPromptSelectionRange()
    : readTrackedHeadlessSelection(editor, currentText.length);
  if (selection.start !== selection.end) {
    return false;
  }

  const skills = readSkills();
  const deletion = deleteSkillTokenAtCaret(currentText, selection.end, direction, skills);
  if (!deletion) {
    return false;
  }

  event.preventDefault();
  $writeSkillPromptText(deletion.text, skills, deletion.caret);
  trackHeadlessSelection(editor, deletion.caret, deletion.caret, deletion.text.length);
  return true;
}

function registerHeadlessPlainTextFallbacks(editor: LexicalEditor, readSkills: () => SkillDescriptor[]): () => void {
  const unregisterTextInsertion = editor.registerCommand(
    CONTROLLED_TEXT_INSERTION_COMMAND,
    (eventOrText) => {
      if (editor.getRootElement()) {
        return false;
      }
      const skills = readSkills();
      if (typeof eventOrText === "string") {
        return replaceHeadlessSelectionText(editor, eventOrText, skills);
      }

      const dataTransfer = inputDataTransfer(eventOrText);
      if (dataTransfer) {
        return replaceHeadlessSelectionText(editor, dataTransfer.getData("text/plain"), skills);
      }
      if (eventOrText.data) {
        return replaceHeadlessSelectionText(editor, eventOrText.data, skills);
      }
      return false;
    },
    COMMAND_PRIORITY_HIGH,
  );
  const unregisterSelectAll = editor.registerCommand(
    SELECT_ALL_COMMAND,
    (event) => {
      if (editor.getRootElement()) {
        return false;
      }
      event.preventDefault();
      $selectAll();
      const textLength = $getRoot().getTextContentSize();
      trackHeadlessSelection(editor, 0, textLength, textLength);
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  );
  const unregisterEnter = editor.registerCommand(
    KEY_ENTER_COMMAND,
    (event) => {
      if (editor.getRootElement()) {
        return false;
      }
      event?.preventDefault();
      return replaceHeadlessSelectionText(editor, "\n", readSkills());
    },
    COMMAND_PRIORITY_HIGH,
  );
  const unregisterBackspace = editor.registerCommand(
    KEY_BACKSPACE_COMMAND,
    (event) => deleteCharacterInHeadlessEditor(event, editor, true),
    COMMAND_PRIORITY_HIGH,
  );
  const unregisterDelete = editor.registerCommand(
    KEY_DELETE_COMMAND,
    (event) => deleteCharacterInHeadlessEditor(event, editor, false),
    COMMAND_PRIORITY_HIGH,
  );

  return () => {
    unregisterDelete();
    unregisterBackspace();
    unregisterEnter();
    unregisterSelectAll();
    unregisterTextInsertion();
  };
}

function deleteCharacterInHeadlessEditor(event: KeyboardEvent, editor: LexicalEditor, isBackward: boolean): boolean {
  if (editor.getRootElement()) {
    return false;
  }
  const currentText = $getRoot().getTextContent();
  const selection = readTrackedHeadlessSelection(editor, currentText.length);
  let start = selection.start;
  let end = selection.end;

  if (start === end) {
    if (isBackward) {
      if (start === 0) {
        return false;
      }
      start -= 1;
    } else {
      if (end >= currentText.length) {
        return false;
      }
      end += 1;
    }
  }

  const nextText = `${currentText.slice(0, start)}${currentText.slice(end)}`;
  event.preventDefault();
  $writeSkillPromptText(nextText, [], start);
  trackHeadlessSelection(editor, start, start, nextText.length);
  return true;
}

function replaceHeadlessSelectionText(editor: LexicalEditor, replacement: string, skills: SkillDescriptor[]): boolean {
  const currentText = $getRoot().getTextContent();
  const selection = readTrackedHeadlessSelection(editor, currentText.length);
  const nextText = `${currentText.slice(0, selection.start)}${replacement}${currentText.slice(selection.end)}`;
  const caret = selection.start + replacement.length;
  $writeSkillPromptText(nextText, skills, caret);
  trackHeadlessSelection(editor, caret, caret, nextText.length);
  return true;
}

function readTrackedHeadlessSelection(editor: LexicalEditor, textLength: number): SkillPromptSelectionRange {
  const range = headlessSelectionRanges.get(editor);
  if (!range) {
    return { start: textLength, end: textLength };
  }
  return {
    start: Math.max(0, Math.min(range.start, textLength)),
    end: Math.max(0, Math.min(range.end, textLength)),
  };
}

function trackHeadlessSelection(editor: LexicalEditor, start: number, end: number, textLength: number): void {
  if (editor.getRootElement()) {
    return;
  }
  const range = {
    start: Math.max(0, Math.min(start, textLength)),
    end: Math.max(0, Math.min(end, textLength)),
  };
  headlessSelectionRanges.set(editor, {
    start: Math.min(range.start, range.end),
    end: Math.max(range.start, range.end),
  });
}

function inputDataTransfer(event: InputEvent): DataTransfer | null {
  return event.dataTransfer ?? null;
}

function $writeSkillPromptText(text: string, skills: SkillDescriptor[], selectionOffset: number): void {
  const root = $getRoot();
  const paragraph = $createParagraphNode();
  appendPromptNodes(paragraph, text, skills);
  root.clear();
  root.append(paragraph);
  selectPromptOffset(selectionOffset);
}

function appendPromptNodes(
  parent: ReturnType<typeof $createParagraphNode>,
  text: string,
  skills: SkillDescriptor[],
): void {
  const ranges = skillTokenRanges(text, skills);
  let cursor = 0;

  for (const range of ranges) {
    if (range.start > cursor) {
      appendPlainTextNodes(parent, text.slice(cursor, range.start));
    }
    parent.append($createSkillTokenNode(range.name));
    cursor = range.end;
  }

  if (cursor < text.length) {
    appendPlainTextNodes(parent, text.slice(cursor));
  }
}

function appendPlainTextNodes(parent: ReturnType<typeof $createParagraphNode>, text: string): void {
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) {
      parent.append($createLineBreakNode());
    }
    if (line.length > 0) {
      parent.append($createTextNode(line));
    }
  });
}

function selectPromptOffset(offset: number): void {
  const root = $getRoot();
  const paragraph = root.getFirstChild();
  if (!$isElementNode(paragraph)) {
    root.selectEnd();
    return;
  }

  const targetOffset = Math.max(0, Math.min(offset, root.getTextContentSize()));
  let remaining = targetOffset;
  const children = paragraph.getChildren();

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const childSize = child.getTextContentSize();

    if ($isTextNode(child) && remaining <= childSize) {
      child.select(remaining, remaining);
      return;
    }

    if (remaining <= childSize) {
      paragraph.select(remaining === 0 ? index : index + 1, remaining === 0 ? index : index + 1);
      return;
    }

    remaining -= childSize;
  }

  paragraph.select(children.length, children.length);
}

function readRootTextLength(): number {
  return $getRoot().getTextContentSize();
}

function $readSkillPromptSelectionRange(): SkillPromptSelectionRange {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    const length = readRootTextLength();
    return { start: length, end: length };
  }

  const points = selection.getStartEndPoints();
  if (!points) {
    const length = readRootTextLength();
    return { start: length, end: length };
  }

  const [start, end] = points;
  const startOffset = $pointToTextOffset(start);
  const endOffset = $pointToTextOffset(end);
  return {
    start: Math.min(startOffset, endOffset),
    end: Math.max(startOffset, endOffset),
  };
}

function $pointToTextOffset(point: PointType): number {
  const node = point.getNode();
  if ($isTextNode(node)) {
    return $nodeStartTextOffset(node) + point.offset;
  }

  if ($isElementNode(node)) {
    const children = node.getChildren();
    return (
      $nodeStartTextOffset(node) +
      children.slice(0, point.offset).reduce((length, child) => length + child.getTextContentSize(), 0)
    );
  }

  return 0;
}

function $nodeStartTextOffset(target: LexicalNode): number {
  const root = $getRoot();
  let offset = 0;
  let found = false;

  function visit(node: LexicalNode): void {
    if (found) {
      return;
    }
    if (node.is(target)) {
      found = true;
      return;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        visit(child);
        if (found) {
          return;
        }
      }
      return;
    }
    offset += node.getTextContentSize();
  }

  visit(root);
  return offset;
}

function createSkillTokenIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "skill-prompt-token-icon");

  for (const d of BOXES_ICON_PATHS) {
    appendSvgPath(svg, d);
  }

  return svg;
}

// Lexical createDOM runs outside React, so this mirrors lucide-react's Boxes icon for DOM-only token rendering.
const BOXES_ICON_PATHS = [
  "M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z",
  "m7 16.5-4.74-2.85",
  "m7 16.5 5-3",
  "M7 16.5v5.17",
  "M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z",
  "m17 16.5-5-3",
  "m17 16.5 4.74-2.85",
  "M17 16.5v5.17",
  "M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z",
  "M12 8 7.26 5.15",
  "m12 8 4.74-2.85",
  "M12 13.5V8",
];

function appendSvgPath(svg: SVGSVGElement, d: string): void {
  const child = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
  child.setAttribute("d", d);
  svg.append(child);
}
