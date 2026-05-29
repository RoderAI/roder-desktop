export type ComposerSubmitKeyInput = {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
};

export function isComposerSubmitKey(event: ComposerSubmitKeyInput): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing && !event.nativeEvent?.isComposing;
}
