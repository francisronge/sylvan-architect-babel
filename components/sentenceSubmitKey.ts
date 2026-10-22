interface SentenceKeyEvent {
  key: string;
  shiftKey: boolean;
  keyCode: number;
  nativeEvent: { isComposing: boolean };
}

/**
 * Enter submits the sentence and Shift+Enter keeps editing. An Enter that
 * confirms an input-method candidate belongs to the input method: browsers mark
 * it as composing, and Safari reports it with keyCode 229 after composition ends.
 */
export const submitsSentence = (event: SentenceKeyEvent): boolean =>
  event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229;
