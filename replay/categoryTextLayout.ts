import { CATEGORY_FALLBACK_GLYPH_WIDTH, CATEGORY_LINE_HEIGHT } from './rendererMetrics.ts';

export type CategoryTextMeasure = (text: string) => number;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const fallbackMeasure: CategoryTextMeasure = value => [...value].length * CATEGORY_FALLBACK_GLYPH_WIDTH;
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

const LINE_WIDTH = 380;
// A label taller than this pushes its sisters' row down, so a label that would
// need more lines widens them, in eight steps up to twice the normal width.
const MAX_LINES = 4;
const WIDENING_STEPS = 8;
// What a line may hang past its width, generously: spaces and closing marks.
const HANG_ALLOWANCE = 100;

/** Wrap display text without abbreviating, interpreting or changing its characters.
 * A later line never starts with whitespace: whitespace that overflows a line
 * is the break itself, painted and measured on neither line. */
function wrapCategoryText(text: string, measure: CategoryTextMeasure) {
  const unwrappedWidth = measure(text);
  if (unwrappedWidth <= LINE_WIDTH) return { lines: [text], width: unwrappedWidth, height: 52, x: -unwrappedWidth / 2, y: -56 };
  const segments = [...graphemes.segment(text)].map(part => part.segment);
  const wrapAt = (maxWidth: number) => {
    const fits = (from: number, to: number) => measure(lineText(segments, from, to)) <= maxWidth;
    return [0, ...joinBlankLines(segments, wrapBreaks(segments, fits))];
  };
  let starts = wrapAt(LINE_WIDTH);
  if (starts.length > MAX_LINES) starts = widened(segments, starts, unwrappedWidth, wrapAt);
  const lines = starts.map((from, index) => lineText(segments, from, starts[index + 1]));
  const width = Math.max(...lines.map(measure));
  const height = 52 + (lines.length - 1) * CATEGORY_LINE_HEIGHT;
  return { lines, width, height, x: -width / 2, y: -height - 4 };
}

const lineText = (segments: string[], from: number, to = segments.length) => {
  if (from > 0) while (from < to && /^\s/u.test(segments[from])) from++;
  return segments.slice(from, to).join('');
};

/** The first wider wrapping within `MAX_LINES` that splits no more words and
 * leaves no more remnants than `starts`, or `starts` itself. Widths whose four
 * lines cannot hold the whole text are skipped without measuring. */
function widened(segments: string[], starts: number[], unwrappedWidth: number, wrapAt: (maxWidth: number) => number[]) {
  const defects = (lineStarts: number[]) => lineStarts.reduce(([splits, remnants], from, index) => index === 0 ? [splits, remnants]
    : [splits + (splitsWord(segments, from) ? 1 : 0),
      remnants + (isRemnant(segments, from, lineStarts[index + 1] ?? segments.length) ? 1 : 0)], [0, 0]);
  const [splits, remnants] = defects(starts);
  for (let step = 1; step <= WIDENING_STEPS; step++) {
    const maxWidth = LINE_WIDTH * (1 + step / WIDENING_STEPS);
    if (MAX_LINES * (maxWidth + HANG_ALLOWANCE) < unwrappedWidth) continue;
    const wider = wrapAt(maxWidth);
    if (wider.length > MAX_LINES) continue;
    const [widerSplits, widerRemnants] = defects(wider);
    if (widerSplits <= splits && widerRemnants <= remnants) return wider;
  }
  return starts;
}

type Fits = (from: number, to: number) => boolean;
type Wrap = { breaks: number[]; lines: number; splits: number; remnants: number };

const breakAfter = /^[\s,]/u, hyphen = /^[-\u2010]/u, wordCharacter = /^[\p{L}\p{N}]/u;
// Slashes, hyphens and dashes join separate words, so a line may end after one.
const joiner = /^[/\-\u2010\u2012-\u2015]/u;
// These scripts break between any two characters without splitting a word.
const breaksAnywhere = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const openingBracket = /^\p{Ps}/u, closingBracket = /^\p{Pe}/u;
// Closing brackets and quotes, clause punctuation, primes and bar-level marks
// complete the text before them, so no line starts with one.
const completesPrevious = /^[\p{Pe}\p{Pf},.;:!?、。，．：；！？′″‴'°⁰]/u;
// A straight double quote opens or closes; one directly after other text closes it.
const completesAt = (segments: string[], index: number) => completesPrevious.test(segments[index] ?? '')
  || segments[index] === '"' && index > 0 && !/^\s/u.test(segments[index - 1]) && !openingBracket.test(segments[index - 1]);
const punctuationOnly = /^[\p{P}\p{S}\s]+$/u;
// Plaque text (relations/plaqueTextLayout.ts) breaks at the same characters.
export { completesPrevious, joiner, openingBracket, wordCharacter };

// Graphemes `from` to `to` are all whitespace, so a line of them would be blank.
const blank = (segments: string[], from: number, to: number) => {
  for (let index = from; index < to; index++) if (!/^\s/u.test(segments[index])) return false;
  return true;
};

const insideWord = (segments: string[], index: number) => wordCharacter.test(segments[index - 1])
  && wordCharacter.test(segments[index] ?? '');
const splitsWord = (segments: string[], index: number) => insideWord(segments, index)
  && !breaksAnywhere.test(segments[index - 1]) && !breaksAnywhere.test(segments[index]);
// A later line of at most two graphemes, or of punctuation alone, is a remnant.
const isRemnant = (segments: string[], from: number, to: number) => {
  while (from < to && /^\s+$/u.test(segments[from])) from++;
  while (to > from && /^\s+$/u.test(segments[to - 1])) to--;
  if (to - from <= 2) return to > from;
  for (let index = from; index < to; index++) if (!punctuationOnly.test(segments[index])) return false;
  return true;
};
// Fewer split words first, then fewer remnants, then fewer lines. A word that
// fits on a line stays whole even when that adds a line; only a word wider than
// a line on its own still splits.
const improves = (candidate: Wrap, best: Wrap) => candidate.splits !== best.splits ? candidate.splits < best.splits
  : candidate.remnants !== best.remnants ? candidate.remnants < best.remnants : candidate.lines < best.lines;

/** The start of every line after the first. Greedy filling (`lineBreak`) ends
 * each line. Where the greedy wrapping from a line on splits a word or leaves a
 * remnant line, the other word-preserving breaks of that line are compared,
 * each with its own best wrapping of the rest, and one that `improves` on the
 * greedy break replaces it. A clean greedy wrapping is kept as it is, so labels
 * that already wrap cleanly keep their breaks and cost no extra probes. */
function wrapBreaks(segments: string[], fits: Fits): number[] {
  const wraps = new Map<number, Wrap & { greedyDefect: boolean }>();
  // Every line from a later start fits up to `known`, the earlier overflow.
  const overflow = (start: number, known: number) => {
    for (let end = Math.max(start + 1, known); end < segments.length; end++) {
      if (fits(start, end + 1)) continue;
      const split = lineBreak(segments, start, end, fits);
      if (split <= end) return { end, split };
    }
  };
  const wrapFrom = (start: number, known: number) => {
    const cached = wraps.get(start);
    if (cached) return cached;
    const found = overflow(start, known);
    let result: Wrap & { greedyDefect: boolean };
    if (!found) {
      const remnants = start > 0 && isRemnant(segments, start, segments.length) ? 1 : 0;
      result = { breaks: [], lines: 1, splits: 0, remnants, greedyDefect: remnants > 0 };
    } else {
      const option = (split: number): Wrap => {
        const rest = wrapFrom(split, found.end);
        return { breaks: [split, ...rest.breaks], lines: rest.lines + 1,
          splits: rest.splits + (splitsWord(segments, split) ? 1 : 0),
          remnants: rest.remnants + (start > 0 && isRemnant(segments, start, split) ? 1 : 0) };
      };
      let best = option(found.split);
      const greedyDefect = splitsWord(segments, found.split)
        || start > 0 && isRemnant(segments, start, found.split) || wrapFrom(found.split, found.end).greedyDefect;
      if (greedyDefect) for (const split of alternativeBreaks(segments, start, found.end, found.split)) {
        const candidate = option(split);
        if (improves(candidate, best)) best = candidate;
      }
      result = { ...best, greedyDefect };
    }
    wraps.set(start, result);
    return result;
  };
  return wrapFrom(0, 1).breaks;
}

/** Line starts without blank lines: spaces alone on a line join the end of the
 * line before them, or the start of the next line when they come first, and
 * hang past the width there. */
function joinBlankLines(segments: string[], breaks: number[]) {
  const kept: number[] = [];
  let line = 0;
  breaks.forEach((from, index) => {
    if (blank(segments, from, breaks[index + 1] ?? segments.length) || blank(segments, line, from)) return;
    kept.push(line = from);
  });
  return kept;
}

/** Word-preserving breaks in the line from `start` that overflows at `end`,
 * latest first: after a space, comma, slash, hyphen or dash, or before an
 * opening bracket. No line starts with a space or completing mark. A greedy
 * break inside a word may also move back up to two graphemes, which keeps a
 * final remnant together with the end of its word. */
function alternativeBreaks(segments: string[], start: number, end: number, greedy: number) {
  const breaks: number[] = [];
  for (let index = end; index > start; index--) {
    const before = segments[index - 1], after = segments[index];
    if (index === greedy || /^\s/u.test(after) || completesAt(segments, index)) continue;
    if (breakAfter.test(before)
      || openingBracket.test(after) && !openingBracket.test(before) && !/^\s/u.test(before)
      || index - 1 > start && joiner.test(before) && wordCharacter.test(segments[index - 2])
        && (wordCharacter.test(after) || openingBracket.test(after))) breaks.push(index);
  }
  if (insideWord(segments, greedy))
    for (const index of [greedy - 1, greedy - 2]) if (index > start + 1 && insideWord(segments, index)) breaks.push(index);
  return breaks;
}

/** Choose where a line ends when grapheme `end` overflows the graphemes from
 * `start`; the line keeps graphemes before the returned index, and an index
 * past `end` keeps the overflowing grapheme on the line. Prefer the last space
 * or comma, then a break before an overflowing space, which already ends a
 * word. An overflowing completing mark then hangs past the width rather than
 * start a line, so it never adds one. Otherwise take the latest of two
 * word-preserving breaks: after a hyphen joining two word characters when the
 * rest of the label fits on one line, or before an opening bracket whose
 * complete group, with any text attached up to the next space or comma, fits on
 * one line. Otherwise break before the overflowing grapheme; that splits a word,
 * so `wrapBreaks` then weighs the line's other breaks, including hyphen breaks
 * that add a line. Lines exceed the width only by hanging marks or spaces
 * (`joinBlankLines`) or by a single wider grapheme. */
function lineBreak(segments: string[], start: number, end: number, fits: Fits) {
  for (let index = end; index > start; index--)
    if (breakAfter.test(segments[index - 1]) && !completesAt(segments, index)) return index;
  if (/^\s/u.test(segments[end])) return end;
  if (completesAt(segments, end)) return end + 1;
  const afterHyphen = (index: number) => index - 1 > start && hyphen.test(segments[index - 1])
    && wordCharacter.test(segments[index - 2]) && wordCharacter.test(segments[index]) && fits(index, segments.length);
  const beforeBracket = (index: number) => {
    if (index === end || !openingBracket.test(segments[index])) return false;
    let depth = 0, group = index;
    while (group < segments.length) {
      const segment = segments[group++];
      if (openingBracket.test(segment)) depth++;
      else if (closingBracket.test(segment)) depth--;
      else if (depth <= 0 && breakAfter.test(segment)) break;
    }
    return fits(index, group);
  };
  for (let index = end; index > start; index--) if (afterHyphen(index) || beforeBracket(index)) return index;
  return end;
}
