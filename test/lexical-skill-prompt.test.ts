import { $getRoot, $isLineBreakNode, $isTextNode } from "lexical";
import { expect, test } from "vitest";
import {
  $isSkillTokenNode,
  createSkillPromptEditor,
  registerSkillPromptPlainText,
  readSkillPromptEditorSelectionRange,
  readSkillPromptEditorSelectionOffset,
  readSkillPromptEditorText,
  deleteSkillPromptEditorSelectionText,
  replaceSkillPromptCompletionToken,
  replaceSkillPromptEditorSelectionText,
  selectSkillPromptEditorText,
  SKILL_PROMPT_BACKSPACE_COMMAND,
  SKILL_PROMPT_ENTER_COMMAND,
  SKILL_PROMPT_SELECT_ALL_COMMAND,
  SKILL_PROMPT_TEXT_INSERTION_COMMAND,
  writeSkillPromptEditorText,
} from "../src/lib/lexical-skill-prompt";
import { skillCompletionToken } from "../src/lib/roder-skills";
import type { SkillDescriptor } from "../src/types/roder";

test("writes known skill tokens as atomic Lexical skill nodes", () => {
  const editor = createSkillPromptEditor();

  writeSkillPromptEditorText(editor, "Use $ai-sdk now", [skill({ name: "ai-sdk" })], "Use $ai-sdk now".length);

  expect(readSkillPromptEditorText(editor)).toBe("Use $ai-sdk now");
  editor.getEditorState().read(() => {
    const paragraph = $getRoot().getFirstChildOrThrow();
    const children = paragraph.getChildren();

    expect(children).toHaveLength(3);
    expect($isTextNode(children[0]) ? children[0].getTextContent() : null).toBe("Use ");
    expect($isSkillTokenNode(children[1]) ? children[1].getSkillName() : null).toBe("ai-sdk");
    expect($isTextNode(children[2]) ? children[2].getTextContent() : null).toBe(" now");
  });
});

test("preserves newlines when syncing plain prompt text through Lexical", () => {
  const editor = createSkillPromptEditor();

  writeSkillPromptEditorText(editor, "Line one\n$commit safely", [skill({ name: "commit" })], 0);

  expect(readSkillPromptEditorText(editor)).toBe("Line one\n$commit safely");
  editor.getEditorState().read(() => {
    const paragraph = $getRoot().getFirstChildOrThrow();
    expect(paragraph.getChildren().some($isLineBreakNode)).toBe(true);
  });
});

test("replaces the active dollar query with a skill token and trailing space", () => {
  const editor = createSkillPromptEditor();
  const skills = [skill({ name: "ai-sdk" })];
  const initialPrompt = "Please use $ai";
  const token = skillCompletionToken(initialPrompt, initialPrompt.length);

  writeSkillPromptEditorText(editor, initialPrompt, skills, initialPrompt.length);
  const caret = replaceSkillPromptCompletionToken(editor, token!, "ai-sdk", skills);

  expect(readSkillPromptEditorText(editor)).toBe("Please use $ai-sdk ");
  expect(caret).toBe("Please use $ai-sdk ".length);
  expect(readSkillPromptEditorSelectionOffset(editor)).toBe(caret);
});

test("inserts and deletes plain text through the Lexical prompt model", () => {
  const editor = createSkillPromptEditor();
  const skills = [skill({ name: "commit" })];

  writeSkillPromptEditorText(editor, "Use ", skills, "Use ".length);
  expect(replaceSkillPromptEditorSelectionText(editor, "$commit", skills)).toEqual({
    caret: "Use $commit".length,
    text: "Use $commit",
  });
  expect(readSkillPromptEditorText(editor)).toBe("Use $commit");

  expect(replaceSkillPromptEditorSelectionText(editor, " safely", skills)).toEqual({
    caret: "Use $commit safely".length,
    text: "Use $commit safely",
  });
  expect(deleteSkillPromptEditorSelectionText(editor, "previous", skills)).toEqual({
    caret: "Use $commit safel".length,
    text: "Use $commit safel",
  });
});

test("selects the whole prompt so typing replaces text and skill tokens", () => {
  const editor = createSkillPromptEditor();
  const skills = [skill({ name: "commit" })];

  writeSkillPromptEditorText(editor, "$commit hello", skills, "$commit hello".length);
  selectSkillPromptEditorText(editor);

  expect(readSkillPromptEditorSelectionRange(editor)).toEqual({
    start: 0,
    end: "$commit hello".length,
  });
  expect(replaceSkillPromptEditorSelectionText(editor, "replacement", skills)).toEqual({
    caret: "replacement".length,
    text: "replacement",
  });
  expect(readSkillPromptEditorText(editor)).toBe("replacement");
});

test("plain-text command adapter inserts text through Lexical commands", () => {
  const editor = createSkillPromptEditor();
  const unregister = registerSkillPromptPlainText(editor, () => []);

  writeSkillPromptEditorText(editor, "$", [], 1);
  editor.dispatchCommand(SKILL_PROMPT_TEXT_INSERTION_COMMAND, "commit");

  expect(readSkillPromptEditorText(editor)).toBe("$commit");
  expect(readSkillPromptEditorSelectionOffset(editor)).toBe("$commit".length);
  unregister();
});

test("plain-text command adapter tokenizes inserted text with current skills", () => {
  const editor = createSkillPromptEditor();
  const skills = [skill({ name: "commit" })];
  const unregister = registerSkillPromptPlainText(editor, () => skills);

  writeSkillPromptEditorText(editor, "$", skills, 1);
  editor.dispatchCommand(SKILL_PROMPT_TEXT_INSERTION_COMMAND, "commit");

  expect(readSkillPromptEditorText(editor)).toBe("$commit");
  editor.getEditorState().read(() => {
    const paragraph = $getRoot().getFirstChildOrThrow();
    const children = paragraph.getChildren();
    expect(children).toHaveLength(1);
    expect($isSkillTokenNode(children[0]) ? children[0].getSkillName() : null).toBe("commit");
  });
  unregister();
});

test("plain-text command adapter handles select all replacement", () => {
  const editor = createSkillPromptEditor();
  const unregister = registerSkillPromptPlainText(editor, () => []);

  writeSkillPromptEditorText(editor, "first second", [], "first second".length);
  editor.dispatchCommand(SKILL_PROMPT_SELECT_ALL_COMMAND, keyboardEvent("a"));
  editor.dispatchCommand(SKILL_PROMPT_TEXT_INSERTION_COMMAND, "replacement");

  expect(readSkillPromptEditorText(editor)).toBe("replacement");
  expect(readSkillPromptEditorSelectionOffset(editor)).toBe("replacement".length);
  unregister();
});

test("plain-text command adapter inserts newlines on shift-enter command", () => {
  const editor = createSkillPromptEditor();
  const unregister = registerSkillPromptPlainText(editor, () => []);

  writeSkillPromptEditorText(editor, "one", [], "one".length);
  editor.dispatchCommand(SKILL_PROMPT_ENTER_COMMAND, keyboardEvent("Enter", { shiftKey: true }));

  expect(readSkillPromptEditorText(editor)).toBe("one\n");
  unregister();
});

test("plain-text command adapter removes skill tokens as a unit", () => {
  const editor = createSkillPromptEditor();
  const skills = [skill({ name: "commit" })];
  const unregister = registerSkillPromptPlainText(editor, () => skills);

  writeSkillPromptEditorText(editor, "$commit hello", skills, "$commit ".length);
  editor.dispatchCommand(SKILL_PROMPT_BACKSPACE_COMMAND, keyboardEvent("Backspace"));

  expect(readSkillPromptEditorText(editor)).toBe("hello");
  expect(readSkillPromptEditorSelectionOffset(editor)).toBe(0);
  unregister();
});

function skill(patch: Partial<SkillDescriptor>): SkillDescriptor {
  return {
    id: patch.id ?? `builtin:${patch.name ?? "skill"}`,
    name: patch.name ?? "skill",
    canonicalPath: patch.canonicalPath ?? `builtin://skills/${patch.name ?? "skill"}/SKILL.md`,
    source: patch.source ?? "builtIn",
    exposure: patch.exposure ?? "direct_only",
    activation: patch.activation ?? "enabled",
    description: patch.description ?? "Skill description.",
    shortDescription: patch.shortDescription,
    experimental: patch.experimental ?? false,
    diagnostics: patch.diagnostics ?? [],
    agentMetadata: patch.agentMetadata,
  };
}

function keyboardEvent(
  key: string,
  patch: Partial<Pick<KeyboardEvent, "shiftKey" | "metaKey" | "ctrlKey" | "altKey">> = {},
): KeyboardEvent {
  return {
    key,
    shiftKey: patch.shiftKey ?? false,
    metaKey: patch.metaKey ?? false,
    ctrlKey: patch.ctrlKey ?? false,
    altKey: patch.altKey ?? false,
    preventDefault() {},
    stopPropagation() {},
  } as KeyboardEvent;
}
