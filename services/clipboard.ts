/**
 * Resolves true only after the browser accepts the text. Clipboard access is
 * absent outside secure contexts and can be refused by permission or focus,
 * so callers report the outcome rather than assuming success.
 */
export async function copyTextToClipboard(
  text: string,
  clipboard: Pick<Clipboard, 'writeText'> | undefined = globalThis.navigator?.clipboard
): Promise<boolean> {
  if (typeof clipboard?.writeText !== 'function') return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
