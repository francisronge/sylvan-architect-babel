/** Shared local-SVG text layout; measurement is supplied by the renderer, never a DOM dependency. */
export type PlaqueTextStyle = Readonly<{
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
}>;

export type PlaqueTextMetrics = {
  /** Horizontal extent from the text origin, including letter spacing. */
  width: number;
  ascent?: number;
  descent?: number;
};

export type PlaqueTextMeasure = (text: string, style: PlaqueTextStyle) => PlaqueTextMetrics;

export type PlaqueTextLine = {
  text: string;
  x: number;
  /** Baseline, in plaque-local SVG units. */
  y: number;
  width: number;
  ascent: number;
  descent: number;
};

export type PlaqueTextBlock = {
  text: string;
  style: PlaqueTextStyle;
  lines: PlaqueTextLine[];
};

export type PlaqueViewport = {
  height: number;
  /** Present only when fitting the complete text would make an extreme plaque unreadable. */
  overflow?: { contentHeight: number };
};

// The limit follows the text's own scale. Ordinary plaques retain their exact
// dimensions; only more than forty font-heights use a twenty-font-height viewport.
const plaqueViewport = (contentHeight: number, fontSize: number): PlaqueViewport =>
  contentHeight > fontSize * 40
    ? { height: fontSize * 20, overflow: { contentHeight } }
    : { height: contentHeight };

/** Later PF rows may be unrevealed; the complete stage has already reserved its viewport. */
export const reservePlaqueViewport = <T extends PlaqueViewport>(layout: T, scrollHeight?: number): T => {
  const contentHeight = layout.overflow?.contentHeight ?? layout.height;
  return scrollHeight && contentHeight > scrollHeight
    ? { ...layout, height: scrollHeight, overflow: { contentHeight } } : layout;
};

export type PlaqueTextLayout = PlaqueViewport & {
  width: number;
  height: number;
  title?: PlaqueTextBlock;
  rows: Array<PlaqueTextBlock & { rowIndex: number }>;
};

export type PlaqueTextLayoutOptions = {
  /** Plaque-local units, before marker counter-scaling. A single wider grapheme may grow the box. */
  maxWidth?: number;
  measureText?: PlaqueTextMeasure;
};

const styles = {
  generic: {
    title: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 400, letterSpacing: 0 },
    row: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 400, letterSpacing: 0 }
  },
  feature: {
    title: { fontFamily: "'JetBrains Mono', monospace", fontSize: 20, fontWeight: 800, letterSpacing: 2.4 },
    row: { fontFamily: "'JetBrains Mono', monospace", fontSize: 30, fontWeight: 800, letterSpacing: 0.6 }
  }
} as const;

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const graphemes = (text: string): string[] => Array.from(segmenter.segment(text), ({ segment }) => segment);

/** Conservative deterministic metrics for Node callers; browser drawing should inject measured ink. */
export const fallbackPlaqueTextMeasure: PlaqueTextMeasure = (text, style) => ({
  width: graphemes(text).reduce((width, grapheme) => width
    + style.fontSize * (/[^\u0000-\u024f\u0300-\u036f]/u.test(grapheme) ? 1 : 0.65)
    + style.letterSpacing, 0),
  ascent: style.fontSize * 0.8,
  descent: style.fontSize * 0.2
});

const validMetric = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) && value! >= 0 ? value! : fallback;

/** Wrap without dropping whitespace, splitting graphemes, or limiting the number of lines. */
export const wrapPlaqueText = (text: string, width: number, measure: (text: string) => Pick<PlaqueTextMetrics, 'width'>): string[] =>
  text.split(/\r\n|\r|\n/u).flatMap((paragraph) => {
    if (measure(paragraph).width <= width) return [paragraph];
    const units = graphemes(paragraph);
    const lines: string[] = [];
    let start = 0;
    while (start < units.length) {
      let low = start + 1;
      let high = low;
      // A single oversized grapheme stays intact; the final plaque width grows to contain it.
      let end = low;
      // Bound the search near this line instead of repeatedly measuring the whole remainder.
      while (high < units.length && measure(units.slice(start, high).join('')).width <= width) {
        end = high;
        low = high + 1;
        high = Math.min(units.length, start + (high - start) * 2);
      }
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (measure(units.slice(start, middle).join('')).width <= width) {
          end = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      if (end < units.length) {
        for (let boundary = end; boundary > start; boundary -= 1) {
          if (/\s/u.test(units[boundary - 1])) {
            end = boundary;
            break;
          }
        }
      }
      lines.push(units.slice(start, end).join(''));
      start = end;
    }
    return lines;
  });

const createTextMeasure = (measureText?: PlaqueTextMeasure) => {
  const measurements = new Map<PlaqueTextStyle, Map<string, Required<PlaqueTextMetrics>>>();
  return (text: string, style: PlaqueTextStyle): Required<PlaqueTextMetrics> => {
    let cache = measurements.get(style);
    if (!cache) measurements.set(style, cache = new Map());
    const cached = cache.get(text);
    if (cached) return cached;
    const fallback = fallbackPlaqueTextMeasure(text, style);
    const measured = measureText?.(text, style) ?? fallback;
    const result = {
      width: validMetric(measured.width, fallback.width),
      ascent: validMetric(measured.ascent, fallback.ascent!),
      descent: validMetric(measured.descent, fallback.descent!)
    };
    cache.set(text, result);
    return result;
  };
};

const prepareTextBlock = (
  text: string, style: PlaqueTextStyle,
  box: { x: number; top: number; width: number; baseline: number; lineHeight: number; inkPadding?: number },
  measure: ReturnType<typeof createTextMeasure>
): { block: PlaqueTextBlock; bottom: number; right: number } => {
  const measured = wrapPlaqueText(text, box.width, (line) => measure(line, style))
    .map((line) => ({ text: line, ...measure(line, style) }));
  const ascent = measured.reduce((maximum, line) => Math.max(maximum, line.ascent), 0);
  const descent = measured.reduce((maximum, line) => Math.max(maximum, line.descent), 0);
  const padding = box.inkPadding ?? 0;
  const baseline = Math.max(box.baseline, ascent + padding);
  const lineHeight = Math.max(box.lineHeight, baseline + descent + padding);
  return {
    block: { text, style, lines: measured.map((line, index) => ({
      ...line, x: box.x, y: box.top + baseline + index * lineHeight
    })) },
    bottom: box.top + measured.length * lineHeight,
    right: box.x + measured.reduce((maximum, line) => Math.max(maximum, line.width), 0)
  };
};

export const preparePlaqueTextLayout = (
  content: { title?: string; rows: readonly { label: string; value: string }[] },
  options: PlaqueTextLayoutOptions & { variant?: 'generic' | 'feature' } = {}
): PlaqueTextLayout => {
  const feature = options.variant === 'feature';
  const font = styles[feature ? 'feature' : 'generic'];
  const paddingX = feature ? 18 : 8;
  const measure = createTextMeasure(options.measureText);
  // Uppercase is the existing feature-title appearance; authored content remains on the plan item.
  const titleText = content.title?.trim()
    ? feature ? content.title.toUpperCase() : content.title
    : undefined;
  const rowTexts = content.rows.map(({ label, value }) => feature
    ? `[${label}: ${value}]`
    : value ? `${label}: ${value}` : label);
  let naturalWidth = feature ? 360 : 96;
  if (!feature) {
    const includeWidth = (text: string, style: PlaqueTextStyle) => {
      text.split(/\r\n|\r|\n/u).forEach((line) => {
        naturalWidth = Math.max(naturalWidth, measure(line, style).width + paddingX * 2);
      });
    };
    if (titleText) includeWidth(titleText, font.title);
    rowTexts.forEach((text) => includeWidth(text, font.row));
  }
  const maxWidth = Number.isFinite(options.maxWidth) && options.maxWidth! > 0 ? options.maxWidth! : 360;
  let width = Math.max(paddingX * 2 + 1, Math.min(maxWidth, naturalWidth));
  const textWidth = width - paddingX * 2;

  const block = (
    text: string, style: PlaqueTextStyle, top: number,
    nominalBaseline: number, nominalLineHeight: number, inkPadding = 0
  ): { block: PlaqueTextBlock; bottom: number } => {
    const result = prepareTextBlock(text, style, {
      x: paddingX, top, width: textWidth, baseline: nominalBaseline, lineHeight: nominalLineHeight, inkPadding
    }, measure);
    width = Math.max(width, result.right + paddingX);
    return result;
  };

  const title = titleText
    ? block(titleText, font.title, feature ? 5 : 3, feature ? 20 : 11, feature ? 26 : 15)
    : undefined;
  let rowTop = title
    ? Math.max(feature ? 46 : 20, title.bottom + (feature ? 15 : 2))
    : paddingX;
  const rows = rowTexts.map((text, rowIndex) => {
    const row = block(text, font.row, rowTop, feature ? 25 : 8, feature ? 32 : 15, feature ? 1 : 0);
    rowTop = row.bottom + (feature ? 12 : 0);
    return { ...row.block, rowIndex };
  });
  return { width, ...plaqueViewport(rowTop + (feature ? 16 : 0), font.row.fontSize), ...(title ? { title: title.block } : {}), rows };
};

/** Keep D6's row centres and spacing; longer authored rows grow within its width. */
export function prepareCasePlaqueRows(rows: readonly { label: string; value: string }[]) {
  let top = 62;
  const laidOut = rows.map(row => {
    const text = `[${row.label}: ${row.value}]`;
    const lines = wrapPlaqueText(text, 266, value => ({ width: graphemes(value).reduce((width, char) => width
      + (/[^\u0000-\u024f\u0300-\u036f]/u.test(char) ? 30 : 18) + 0.6, 0) }));
    const height = 62 + (lines.length - 1) * 38;
    const result = { ...row, lines, y: top + height / 2, firstLineY: top + 31 };
    top += height;
    return result;
  });
  return { width: 310, height: top + 14, rows: laidOut };
}

/** Native grid columns share one content-sized layout for reservation and drawing. */
export const prepareThetaGridTextLayout = (
  predicate: string,
  roles: readonly { label: string; index?: string }[],
  options: Pick<PlaqueTextLayoutOptions, 'measureText'> = {}
) => {
  const style: PlaqueTextStyle = {
    fontFamily: "'JetBrains Mono', monospace", fontSize: 26, fontWeight: 850, letterSpacing: 0.26
  };
  const indexStyle = { ...style, fontSize: 25, letterSpacing: 0.25 };
  const measure = createTextMeasure(options.measureText);
  // Preserve the Orchard's 430×126 template; wrap long columns within its
  // original 302-unit role area rather than making an unbounded horizontal grid.
  const columnWidth = (texts: Array<[string, PlaqueTextStyle]>, minimum: number, padding: number) =>
    Math.max(minimum, Math.ceil(Math.min(302, Math.max(0, ...texts.flatMap(([text, font]) =>
      text.split(/\r\n|\r|\n/u).map(line => measure(line, font).width))) + padding * 2)));
  const block = (text: string, font: PlaqueTextStyle, x: number, top: number,
    width: number, baseline: number, lineHeight: number, centered = false) => {
    const result = prepareTextBlock(text, font, { x, top, width, baseline, lineHeight }, measure);
    if (centered) result.block.lines.forEach(line => { line.x = x + width / 2; });
    return result;
  };
  const predicateWidth = columnWidth([[predicate, style]], 104, 16);
  const predicateBlock = block(predicate, style, 16, 47, predicateWidth - 32, 31, 32);
  let left = predicateWidth;
  const roleColumns = roles.map(role => {
    const width = columnWidth([[role.label, style], [role.index || '', indexStyle]],
      Math.max(0, 430 - predicateWidth - 24) / Math.max(1, roles.length), 12);
    const label = block(role.label, style, left + 12, 39, width - 24, 30, 40, true);
    const column = { left, width, label: label.block, bottom: label.bottom };
    left += width;
    return column;
  });
  const roleBottom = Math.max(79, ...roleColumns.map(column => column.bottom));
  const columns = roleColumns.map((column, i) => {
    const index = block(roles[i].index || '', indexStyle, column.left + 12, roleBottom + 3,
      column.width - 24, 26, 35, true);
    return { ...column, index: index.block, bottom: index.bottom };
  });
  return {
    width: Math.max(430, left + 24),
    height: Math.max(126, predicateBlock.bottom + 13, ...columns.map(column => column.bottom + 9)),
    predicate: predicateBlock.block, columns, predicateWidth
  };
};

const pfTitleStyle: PlaqueTextStyle = {
  fontFamily: "'JetBrains Mono', monospace", fontSize: 24, fontWeight: 900, letterSpacing: 3.84
};
const pfRowStyle: PlaqueTextStyle = {
  fontFamily: "'JetBrains Mono', monospace", fontSize: 28, fontWeight: 800, letterSpacing: 0
};

/** Native PF keeps its rewrite columns; literal rows use the full plaque width. */
export const preparePfPlaqueTextLayout = (
  rows: readonly { label: string; value: string; kind?: 'rewrite' | 'literal'; rowIndex: number; isFinal: boolean }[],
  options: { isZeroRealization?: boolean; measureText?: PlaqueTextMeasure } = {}
) => {
  const measure = createTextMeasure(options.measureText);
  const paddingX = 26;
  let width = options.isZeroRealization ? 360 : 590;
  const title = prepareTextBlock('PF REALIZATION', pfTitleStyle, {
    x: paddingX, top: 0, width: width - paddingX * 2, baseline: 34, lineHeight: 54
  }, measure);
  width = Math.max(width, title.right + paddingX);
  const titleRuleY = title.bottom;
  let rowTop = titleRuleY;
  const layouts = rows.map((row) => {
    const textBlock = (text: string, x: number, availableWidth: number) => prepareTextBlock(text, pfRowStyle, {
      x, top: rowTop, width: availableWidth, baseline: 34, lineHeight: 48, inkPadding: 6
    }, measure);
    const parts: Array<{ kind: 'literal' | 'input' | 'arrow' | 'output'; block: PlaqueTextBlock }> = [];
    let bottom: number;
    if (row.kind === 'rewrite') {
      const nominalArrowX = options.isZeroRealization ? 190 : 314;
      const nominalOutputX = options.isZeroRealization ? 246 : 370;
      const input = textBlock(row.label, paddingX, nominalArrowX - paddingX - 16);
      const arrowX = Math.max(nominalArrowX, input.right + 16);
      const arrow = textBlock('\u2192', arrowX, nominalOutputX - nominalArrowX - 16);
      const outputX = Math.max(nominalOutputX, arrow.right + 16);
      const output = textBlock(row.value, outputX, Math.max(1, width - paddingX - outputX));
      parts.push({ kind: 'input', block: input.block }, { kind: 'arrow', block: arrow.block },
        { kind: 'output', block: output.block });
      width = Math.max(width, output.right + paddingX);
      bottom = Math.max(input.bottom, arrow.bottom, output.bottom);
    } else {
      const literal = textBlock(row.label ? `${row.label}: ${row.value}` : row.value, paddingX, width - paddingX * 2);
      parts.push({ kind: 'literal', block: literal.block });
      width = Math.max(width, literal.right + paddingX);
      bottom = literal.bottom;
    }
    const ruleY = row.isFinal ? rowTop + 3 : undefined;
    rowTop = bottom;
    return { rowIndex: row.rowIndex, isFinal: row.isFinal, parts, ruleY };
  });
  return { width, ...plaqueViewport(rowTop + 30, pfRowStyle.fontSize), title: title.block, titleRuleY, rows: layouts };
};
