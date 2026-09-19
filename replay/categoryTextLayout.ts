export type CategoryTextMeasure = (text: string) => number;
export const CATEGORY_FONT = '900 42px Quicksand, sans-serif';
export const CATEGORY_LINE_HEIGHT = 48;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Wrap display text without abbreviating, interpreting or changing its characters. */
export function categoryTextLayout(text: string, measure: CategoryTextMeasure = value => [...value].length * 25) {
  const maxWidth = 380;
  const unwrappedWidth = measure(text);
  if (unwrappedWidth <= maxWidth) return { lines: [text], width: unwrappedWidth, height: 52, x: -unwrappedWidth / 2, y: -56 };
  const segments = [...graphemes.segment(text)].map(part => part.segment);
  const lines: string[] = [];
  let line = '';
  for (const segment of segments) {
    while (line && measure(line + segment) > maxWidth) {
      const boundary = [...line.matchAll(/[\s,]/gu)].at(-1);
      const split = boundary ? boundary.index! + boundary[0].length : line.length;
      lines.push(line.slice(0, split));
      line = line.slice(split);
    }
    line += segment;
  }
  if (line || !lines.length) lines.push(line);
  const width = Math.max(...lines.map(measure));
  const height = 52 + (lines.length - 1) * CATEGORY_LINE_HEIGHT;
  return { lines, width, height, x: -width / 2, y: -height - 4 };
}
