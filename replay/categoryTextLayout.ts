export type CategoryTextMeasure = (text: string) => number;
export const CATEGORY_FONT = '900 42px Quicksand, sans-serif';
export const CATEGORY_LINE_HEIGHT = 48;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const fallbackMeasure: CategoryTextMeasure = value => [...value].length * 25;
const layouts = new WeakMap<CategoryTextMeasure, Map<string, ReturnType<typeof wrapCategoryText>>>();

/** A measurement callback represents one immutable font state. Keep wrapping
 * local to that callback so new font collectors still receive every probe. */
export function categoryTextLayout(text: string, measure: CategoryTextMeasure = fallbackMeasure) {
  let cache = layouts.get(measure);
  if (!cache) layouts.set(measure, cache = new Map());
  let layout = cache.get(text);
  if (!layout) {
    layout = wrapCategoryText(text, measure);
    cache.set(text, layout);
    if (cache.size > 256) cache.delete(cache.keys().next().value!);
  }
  return { ...layout, lines: [...layout.lines] };
}

/** Wrap display text without abbreviating, interpreting or changing its characters. */
function wrapCategoryText(text: string, measure: CategoryTextMeasure) {
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
